// Purchasing (P3 steps 2-4). Step 2, vendor products and price lists (FR-8.02):
// checkVP():     a vendor product saved through the generic API (purchasing.manage): the vendor is a vendor, the
//                unit belongs to the product, the pack size comes from the unit, the currency from the vendor,
//                a cost change keeps the previous cost and when; one preferred vendor per product.
// importList():  a vendor's price list (rows from CSV/Excel read in the browser): matched by the vendor's code,
//                then by barcode; costs updated (up / down listed); rows that match nothing are returned.
// compare():     every vendor of a product with its cost per base unit in CAD (exchange rate today); cheapest.
// better():      products whose preferred vendor is not the cheapest, with the saving per base unit.

const st = () => require(`${__hooks}/lib/stock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const fx = (app, cur, day) => require(`${__hooks}/lib/parties.js`).rateOn(app, cur, day || st().today());

function vendorOf(app, id) {
  let v = null;
  try { v = app.findRecordById("parties", id); } catch (_) { v = null; }
  if (!v || v.getString("deleted_at") || (v.getString("kind") !== "vendor" && v.getString("kind") !== "both")) bad("Choose a vendor.");
  return v;
}

function checkVP(app, rec) {
  const v = vendorOf(app, rec.getString("vendor"));
  let p = null;
  try { p = app.findRecordById("products", rec.getString("product")); } catch (_) { p = null; }
  if (!p || p.getString("deleted_at")) bad("Choose a product.");
  if (rec.getString("selling_unit")) {
    let u = null;
    try { u = app.findRecordById("selling_units", rec.getString("selling_unit")); } catch (_) { u = null; }
    if (!u || u.getString("product") !== p.id) bad("That unit is not one of this product's units.");
    rec.set("pack_qty", u.getFloat("base_qty") || 1);
  } else if (!(rec.getFloat("pack_qty") > 0)) rec.set("pack_qty", 1);
  if (!rec.getString("currency")) rec.set("currency", v.getString("currency") || "CAD");
  rec.set("currency", rec.getString("currency").toUpperCase());
  rec.set("vendor_sku", String(rec.getString("vendor_sku") || "").trim());
  if (rec.isNew()) rec.set("active", true);                 // new ones are in use; switch off later
  // A cost change: keep the cost before and when it changed
  let before = null;
  if (!rec.isNew()) { try { before = app.findRecordById("vendor_products", rec.id); } catch (_) { before = null; } }
  if (!before || before.getInt("cost_cents") !== rec.getInt("cost_cents")) {
    if (before) rec.set("previous_cost_cents", before.getInt("cost_cents"));
    rec.set("price_at", new DateTime());
  }
}

// One preferred vendor per product (after a save that marks this one preferred)
function onePreferred(app, rec) {
  if (!rec.getBool("preferred")) return;
  app.findRecordsByFilter("vendor_products", "product = {:p} && id != {:id} && preferred = true", "", 0, 0, { p: rec.getString("product"), id: rec.id }).forEach((o) => {
    o.set("preferred", false); o.set("updated_by", "system:purchasing"); o.set("@actor", "system:purchasing"); app.save(o);
  });
}

function vpView(app, x) {
  let pname = "", uname = "";
  try { pname = app.findRecordById("products", x.getString("product")).getString("name"); } catch (_) { pname = "(gone)"; }
  if (x.getString("selling_unit")) { try { uname = app.findRecordById("selling_units", x.getString("selling_unit")).getString("name"); } catch (_) { uname = ""; } }
  return { id: x.id, vendor: x.getString("vendor"), product: x.getString("product"), product_name: pname, selling_unit: x.getString("selling_unit"), unit_name: uname,
    vendor_sku: x.getString("vendor_sku"), description: x.getString("description"), pack_qty: x.getFloat("pack_qty"), cost_cents: x.getInt("cost_cents"), currency: x.getString("currency"),
    previous_cost_cents: x.getInt("previous_cost_cents"), price_at: x.getString("price_at"), min_order_qty: x.getFloat("min_order_qty"), lead_days: x.getInt("lead_days"),
    preferred: x.getBool("preferred"), active: x.getBool("active") };
}

function vendorList(app, vendorId) {
  vendorOf(app, vendorId);
  return { items: app.findRecordsByFilter("vendor_products", "vendor = {:v} && deleted_at = ''", "", 0, 0, { v: vendorId }).map((x) => vpView(app, x))
    .sort((a, b) => a.product_name.localeCompare(b.product_name)) };
}

const cents = (v) => { const t = String(v === undefined || v === null ? "" : v).replace(/[$,\s]/g, ""); if (!t) return null; const n = Math.round(Number(t) * 100); return isFinite(n) && n >= 0 ? n : null; };

function importList(app, c, vendorId, rows) {
  const v = vendorOf(app, vendorId);
  if (!Array.isArray(rows) || !rows.length) bad("The price list has no rows.");
  if (rows.length > 5000) bad("At most 5000 rows at a time.");
  const cat = require(`${__hooks}/lib/catalogue.js`);
  const out = { created: 0, updated: 0, unchanged: 0, unmatched: [], up: [], down: [] };
  rows.forEach((row, i) => {
    const sku = String(row.vendor_sku || "").trim(), code = String(row.barcode || "").trim();
    const cost = cents(row.cost);
    if (cost === null) { out.unmatched.push({ row: i + 1, vendor_sku: sku, barcode: code, description: row.description || "", reason: "No cost" }); return; }
    let vp = sku ? app.findRecordsByFilter("vendor_products", "vendor = {:v} && vendor_sku = {:s} && deleted_at = ''", "", 1, 0, { v: v.id, s: sku })[0] : null;
    let unit = null, product = "";
    if (!vp && code) {
      const m = cat.lookup(app, code).matches[0];
      if (m) {
        product = m.product.id; unit = m.unit.id;
        vp = app.findRecordsByFilter("vendor_products", "vendor = {:v} && product = {:p} && selling_unit = {:u} && deleted_at = ''", "", 1, 0, { v: v.id, p: product, u: unit })[0] || null;
      }
    }
    if (!vp && !product) { out.unmatched.push({ row: i + 1, vendor_sku: sku, barcode: code, description: row.description || "", reason: code ? "Barcode not in the catalogue" : "No barcode and an unknown code" }); return; }
    const isNew = !vp;
    if (!vp) {
      vp = new Record(app.findCollectionByNameOrId("vendor_products"));
      vp.load({ vendor: v.id, product: product, selling_unit: unit || "", active: true, currency: v.getString("currency") || "CAD" });
    }
    const was = vp.getInt("cost_cents");
    if (!isNew && was === cost && (!sku || vp.getString("vendor_sku") === sku)) { out.unchanged++; return; }
    if (sku) vp.set("vendor_sku", sku);
    if (row.description) vp.set("description", String(row.description).substring(0, 200));
    if (row.min_order_qty !== undefined && row.min_order_qty !== "") vp.set("min_order_qty", Number(row.min_order_qty) || 0);
    if (row.lead_days !== undefined && row.lead_days !== "") vp.set("lead_days", Math.max(0, Math.round(Number(row.lead_days) || 0)));
    vp.set("cost_cents", cost);
    checkVP(app, vp);
    stamp(vp, c);
    app.save(vp);
    const name = vpView(app, vp).product_name;
    if (isNew) out.created++;
    else { out.updated++; if (cost > was) out.up.push({ product: name, from_cents: was, to_cents: cost }); else if (cost < was) out.down.push({ product: name, from_cents: was, to_cents: cost }); }
  });
  return out;
}

function perBase(app, x) {
  const r = fx(app, x.getString("currency"));
  const pack = x.getFloat("pack_qty") || 1;
  return r ? Math.round((x.getInt("cost_cents") * r.rate) / pack * 100) / 100 : null;
}

function compare(app, productId) {
  const list = app.findRecordsByFilter("vendor_products", "product = {:p} && active = true && deleted_at = ''", "", 0, 0, { p: productId }).map((x) => {
    let vname = "";
    try { vname = app.findRecordById("parties", x.getString("vendor")).getString("name"); } catch (_) { vname = ""; }
    return Object.assign(vpView(app, x), { vendor_name: vname, cad_per_base_cents: perBase(app, x) });
  });
  const known = list.filter((x) => x.cad_per_base_cents !== null);
  const min = known.length ? Math.min.apply(null, known.map((x) => x.cad_per_base_cents)) : null;
  list.forEach((x) => { x.cheapest = min !== null && x.cad_per_base_cents === min; });
  return { product: productId, vendors: list.sort((a, b) => (a.cad_per_base_cents === null) - (b.cad_per_base_cents === null) || a.cad_per_base_cents - b.cad_per_base_cents),
    missing_rates: list.filter((x) => x.cad_per_base_cents === null).map((x) => x.currency) };
}

function better(app) {
  const byProduct = {};
  app.findRecordsByFilter("vendor_products", "active = true && deleted_at = ''", "", 0, 0).forEach((x) => { (byProduct[x.getString("product")] || (byProduct[x.getString("product")] = [])).push(x); });
  const out = [];
  Object.keys(byProduct).forEach((pid) => {
    const xs = byProduct[pid];
    if (xs.length < 2) return;
    const pref = xs.find((x) => x.getBool("preferred"));
    if (!pref) return;
    const pc = perBase(app, pref);
    const best = xs.map((x) => ({ x: x, c: perBase(app, x) })).filter((y) => y.c !== null).sort((a, b) => a.c - b.c)[0];
    if (!best || pc === null || best.x.id === pref.id || best.c >= pc) return;
    let vname = "";
    try { vname = app.findRecordById("parties", best.x.getString("vendor")).getString("name"); } catch (_) { vname = ""; }
    out.push({ product: pid, product_name: vpView(app, pref).product_name, preferred_cents: pc, best_cents: best.c, best_vendor: vname, saving_pct: Math.round((10000 * (pc - best.c)) / pc) / 100 });
  });
  return { items: out.sort((a, b) => b.saving_pct - a.saving_pct) };
}

module.exports = { checkVP, onePreferred, vendorList, importList, compare, better, vendorOf, vpView, fx, cents, stamp };

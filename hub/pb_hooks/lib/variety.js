// Product variety (P3 step 8; FR-5.17-5.19).
// Bundles and kits: a product made of stocked items (components: [{product, selling_unit, qty}]). It has no
// stock of its own: selling one takes its components out of stock (FEFO, cost = the components' cost),
// checking each is available; a return puts them back; an offline sale takes them like any line.
//   stockItems(app, l) -> the lines stock works on for a sale line l ({p, u, qty, base, key}).
// Variants: one parent product (variant_axes, e.g. ["Size", "Colour"]) and its variant products (each with its
// own barcode, price and stock; variant {Size: "M", Colour: "Red"}). makeVariants() creates the missing
// combinations from the parent.
// Serial numbers / IMEI: a product with serial_tracked needs one serial per unit at the sale (kept on the
// sale line); warranty() finds a serial's sale, date, customer and warranty end (warranty_days).

function bad(msg) { throw new BadRequestError(msg); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const r3 = (x) => Math.round(x * 1000) / 1000;

function componentsOf(p) { return p.getBool("is_bundle") ? j(p, "components", []) : []; }

// For one sale line: itself, or its bundle's components (each its own product, unit and quantity).
function stockItems(app, l) {
  const comps = componentsOf(l.p);
  if (!comps.length) return [l];
  return comps.map((c, i) => {
    let p = null, u = null;
    try { p = app.findRecordById("products", c.product); } catch (_) { p = null; }
    if (!p) bad("'" + l.p.getString("name") + "' has a component that no longer exists.");
    const units = require(`${__hooks}/lib/catalogue.js`).unitsOf(app, p.id);
    u = c.selling_unit ? units.find((x) => x.id === c.selling_unit) : units.find((x) => (x.getFloat("base_qty") || 1) === 1 && x.getString("kind") !== "weight");
    if (!u) bad("A component of '" + l.p.getString("name") + "' has no unit to take from.");
    const qty = r3(Number(c.qty) * l.qty);
    return { p: p, u: u, qty: qty, base: r3(qty * (u.getFloat("base_qty") || 1)), key: l.key + ":" + i, name: p.getString("name"), break_pack: true, bundle: l.p.getString("name") };
  });
}

// A bundle saved: components are stocked products (not bundles themselves), whole quantities above 0
function checkBundle(app, rec) {
  // Consignment (P3 step 9): the vendor must be a vendor
  const cv = rec.getString("consignment_vendor");
  if (cv) {
    let v = null;
    try { v = app.findRecordById("parties", cv); } catch (_) { v = null; }
    if (!v || v.getString("kind") === "client") bad("Choose the vendor who owns the consignment goods.");
  }
  if (!rec.getBool("is_bundle")) return;
  const comps = j(rec, "components", []);
  if (!Array.isArray(comps) || !comps.length) bad("A bundle needs at least one component.");
  if (comps.length > 30) bad("At most 30 components.");
  rec.set("components", comps.map((c, i) => {
    let p = null;
    try { p = app.findRecordById("products", String(c.product || "")); } catch (_) { p = null; }
    if (!p || p.getString("deleted_at")) bad("Component " + (i + 1) + ": choose a product.");
    if (p.id === rec.id || p.getBool("is_bundle")) bad("Component " + (i + 1) + ": a bundle is made of stocked items, not other bundles.");
    const q = Number(c.qty);
    if (!(q > 0)) bad("Component " + (i + 1) + ": a quantity above 0.");
    return { product: p.id, selling_unit: String(c.selling_unit || ""), qty: r3(q), name: p.getString("name") };
  }));
}

// What a bundle can be sold now: the fewest whole bundles its components allow
function bundleAvailable(app, p) {
  let n = Infinity;
  componentsOf(p).forEach((c) => {
    const lv = app.findRecordsByFilter("stock_levels", "product = {:p}", "", 1, 0, { p: c.product })[0];
    let base = 1;
    if (c.selling_unit) { try { base = app.findRecordById("selling_units", c.selling_unit).getFloat("base_qty") || 1; } catch (_) { base = 1; } }
    n = Math.min(n, Math.floor(((lv ? lv.getFloat("on_hand") - lv.getFloat("reserved") : 0) / (Number(c.qty) * base)) + 1e-9));
  });
  return n === Infinity ? 0 : Math.max(0, n);
}

// ---- Variants (FR-5.17) ------------------------------------------------------------------------------------

// body: {axes: {Size: ["S", "M"], Colour: ["Red"]}, price_cents?} → creates the variant products not there yet
function makeVariants(app, c, parentId, body) {
  const parent = app.findRecordById("products", parentId);
  if (parent.getString("parent")) bad("A variant cannot have variants; use its parent.");
  const axes = body.axes || {};
  const names = Object.keys(axes).filter((k) => Array.isArray(axes[k]) && axes[k].length).slice(0, 3);
  if (!names.length) bad("Give at least one axis with values, e.g. Size: S, M, L.");
  let combos = [{}];
  names.forEach((k) => {
    const vals = axes[k].map((v) => String(v).trim()).filter(Boolean).slice(0, 30);
    combos = combos.flatMap((cmb) => vals.map((v) => Object.assign({}, cmb, { [k]: v })));
  });
  if (combos.length > 200) bad("At most 200 variants.");
  parent.set("variant_axes", names); parent.set("updated_by", c.actor); parent.set("@actor", c.actor); app.save(parent);
  // Compared with the keys sorted (the database gives them back in its own order)
  const canon = (o) => Object.keys(o).sort().map((k) => k + "=" + o[k]).join("|");
  const existing = app.findRecordsByFilter("products", "parent = {:p} && deleted_at = ''", "", 0, 0, { p: parent.id }).map((x) => canon(j(x, "variant", {})));
  const pUnit = require(`${__hooks}/lib/catalogue.js`).unitsOf(app, parent.id).find((u) => u.getBool("is_default")) || require(`${__hooks}/lib/catalogue.js`).unitsOf(app, parent.id)[0];
  const price = body.price_cents !== undefined && body.price_cents !== "" ? Math.round(Number(body.price_cents)) : pUnit ? pUnit.getInt("price_cents") : 0;
  const made = [];
  combos.forEach((cmb) => {
    if (existing.indexOf(canon(cmb)) >= 0) return;
    const p = new Record(app.findCollectionByNameOrId("products"));
    p.load({ name: (parent.getString("name") + " " + names.map((k) => cmb[k]).join(" / ")).substring(0, 160), category: parent.getString("category"), base_unit: parent.getString("base_unit"),
      tax_class: parent.getString("tax_class"), cost_cents: parent.getInt("cost_cents"), pos_button: parent.getBool("pos_button"), status: "draft", parent: parent.id, variant: cmb,
      perishable: parent.getBool("perishable"), age_restricted: parent.getBool("age_restricted"), min_age: parent.getInt("min_age"), serial_tracked: parent.getBool("serial_tracked"), warranty_days: parent.getInt("warranty_days") });
    p.set("created_by", c.actor); p.set("updated_by", c.actor); p.set("@actor", c.actor);
    app.save(p);
    const u = new Record(app.findCollectionByNameOrId("selling_units"));
    u.load({ product: p.id, name: "Single", kind: parent.getString("base_unit") === "each" ? "single" : "weight", barcodes: [], price_cents: price, sell_at_pos: true, is_default: true, sort: 1, base_qty: 1 });
    u.set("created_by", c.actor); u.set("updated_by", c.actor); u.set("@actor", c.actor);
    app.save(u);
    made.push({ id: p.id, name: p.getString("name") });
  });
  return { parent: parent.id, axes: names, created: made, total: combos.length };
}

function variantsOf(app, parentId) {
  return app.findRecordsByFilter("products", "parent = {:p} && deleted_at = ''", "name", 0, 0, { p: parentId }).map((p) => {
    const lv = app.findRecordsByFilter("stock_levels", "product = {:p}", "", 1, 0, { p: p.id })[0];
    const u = require(`${__hooks}/lib/catalogue.js`).unitsOf(app, p.id)[0];
    return { id: p.id, name: p.getString("name"), status: p.getString("status"), variant: j(p, "variant", {}), on_hand: lv ? lv.getFloat("on_hand") : 0,
      unit: u ? u.id : "", price_cents: u ? u.getInt("price_cents") : 0, barcodes: u ? require(`${__hooks}/lib/catalogue.js`).barcodesOf(u) : [] };
  });
}

// ---- Serial numbers (FR-5.19) -------------------------------------------------------------------------------

// A sale line of a serial-tracked product needs one serial per unit, all different, not sold before
function checkSerials(app, l, problems) {
  if (!l.p.getBool("serial_tracked")) return [];
  const list = (Array.isArray(l.serials) ? l.serials : []).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  if (list.length !== Math.round(l.qty)) { problems.push({ key: l.key, type: "serials", message: "Scan the serial or IMEI of each '" + l.p.getString("name") + "' (" + list.length + " of " + Math.round(l.qty) + ")." }); return list; }
  if (new Set(list).size !== list.length) problems.push({ key: l.key, type: "serials", message: "The same serial twice on '" + l.p.getString("name") + "'." });
  list.forEach((s) => {
    const sold = app.findRecordsByFilter("sale_lines", "serials ~ {:s} && voided = false && sale.status = 'completed'", "", 1, 0, { s: '"' + s + '"' });
    if (sold.length) problems.push({ key: l.key, type: "serials", message: "Serial " + s + " was already sold." });
  });
  return list;
}

function warranty(app, q) {
  const s = String(q || "").trim().toUpperCase();
  if (s.length < 3) bad("Type at least 3 characters of the serial or IMEI.");
  return { results: app.findRecordsByFilter("sale_lines", "serials ~ {:s} && voided = false", "-created_at", 20, 0, { s: s }).map((l) => {
    let sale = null, p = null;
    try { sale = app.findRecordById("sales", l.getString("sale")); } catch (_) { sale = null; }
    try { p = app.findRecordById("products", l.getString("product")); } catch (_) { p = null; }
    const day = sale ? sale.getString("completed_at").substring(0, 10) : "";
    const wd = p ? p.getInt("warranty_days") : 0;
    let until = "";
    if (day && wd) { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + wd); until = d.toISOString().substring(0, 10); }
    let who = "";
    if (sale && sale.getString("customer")) { try { who = app.findRecordById("customers", sale.getString("customer")).getString("first_name"); } catch (_) { who = ""; } }
    return { serials: j(l, "serials", []).filter((x) => x.indexOf(s) >= 0), product: l.getString("product"), product_name: l.getString("name"), sale: l.getString("sale"),
      sale_number: sale ? sale.getString("number") : "", day: day, customer: who, warranty_days: wd, warranty_until: until, in_warranty: !!until && until >= new Date().toISOString().substring(0, 10),
      returned: false };
  }) };
}

module.exports = { stockItems, checkBundle, bundleAvailable, makeVariants, variantsOf, checkSerials, warranty, componentsOf };

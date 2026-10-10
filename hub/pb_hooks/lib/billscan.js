// Receiving from a bill photo (P3 step 5; FR-6.11, 6.12, P3-c, P3-d). The browser reads the bill into lines;
// match() finds the product of each: a match learned from this vendor's earlier bills, the vendor's code in
// their price list, a barcode, then the closest name (vendor's description or product name); with up to three
// candidates and the vendor's open order to check against. confirm() receives the reviewed lines (against the
// order when there is one, else as a delivery) with freight, duty and brokerage spread over them by value,
// learns the matches, and records the bill when asked.

const st = () => require(`${__hooks}/lib/stock.js`);
const P = () => require(`${__hooks}/lib/purchasing.js`);
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = { the: 1, and: 1, of: 1, x: 1, ea: 1, each: 1, pk: 1, pack: 1, case: 1, cs: 1, ct: 1, g: 1, kg: 1, ml: 1, l: 1 };
const words = (s) => norm(s).split(" ").filter((w) => w.length > 1 && !STOP[w]);
function keysOf(line) { const k = []; if (line.code) k.push("code:" + norm(line.code).substring(0, 90)); if (line.description) k.push("text:" + norm(line.description).substring(0, 90)); return k; }
function score(a, b) {
  const A = words(a), B = words(b);
  if (!A.length || !B.length) return 0;
  const set = {};
  B.forEach((w) => { set[w] = true; });
  let hit = 0;
  A.forEach((w) => { if (set[w] || B.some((x) => x.length > 3 && (x.indexOf(w) === 0 || w.indexOf(x) === 0))) hit++; });
  return Math.round((100 * hit) / Math.max(A.length, B.length)) / 100;
}

function nameOf(app, coll, id) { try { return app.findRecordById(coll, id).getString("name"); } catch (_) { return ""; } }

function match(app, vendorId, lines) {
  const v = P().vendorOf(app, vendorId);
  if (!Array.isArray(lines) || !lines.length) bad("No lines were read from the bill.");
  const vps = app.findRecordsByFilter("vendor_products", "vendor = {:v} && deleted_at = ''", "", 0, 0, { v: v.id });
  const prods = app.findRecordsByFilter("products", "deleted_at = '' && status != 'archived'", "", 0, 0).map((p) => ({ id: p.id, name: p.getString("name") }));
  const cat = require(`${__hooks}/lib/catalogue.js`);
  const out = lines.slice(0, 300).map((ln) => {
    const r = { raw: ln.raw || "", code: ln.code || "", description: ln.description || "", qty: Number(ln.qty) || 1, unit_cents: Math.round(Number(ln.unit_cents) || 0), total_cents: Math.round(Number(ln.total_cents) || 0),
      product: "", selling_unit: "", via: "", score: 0, candidates: [] };
    const take = (pid, uid, via, sc) => { r.product = pid; r.selling_unit = uid || ""; r.via = via; r.score = sc; };
    // 1. Learned from this vendor's earlier bills
    keysOf(ln).some((k) => { const m = app.findRecordsByFilter("scan_matches", "vendor = {:v} && key = {:k}", "", 1, 0, { v: v.id, k: k })[0]; if (m) take(m.getString("product"), m.getString("selling_unit"), "learned", 1); return !!m; });
    // 2. Their code in their price list
    if (!r.product && ln.code) { const x = vps.find((p) => p.getString("vendor_sku") && norm(p.getString("vendor_sku")) === norm(ln.code)); if (x) take(x.getString("product"), x.getString("selling_unit"), "vendor_code", 1); }
    // 3. A barcode
    if (!r.product && /^\d{8,14}$/.test(String(ln.code || ""))) { const m = cat.lookup(app, ln.code).matches[0]; if (m) take(m.product.id, m.unit.id, "barcode", 1); }
    // 4. The closest name
    const cand = vps.map((x) => ({ product: x.getString("product"), selling_unit: x.getString("selling_unit"), s: Math.max(score(ln.description, x.getString("description")), score(ln.description, nameOf(app, "products", x.getString("product")))) }))
      .concat(prods.map((p) => ({ product: p.id, selling_unit: "", s: score(ln.description, p.name) * 0.9 })))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const seen = {};
    r.candidates = cand.filter((x) => (seen[x.product] ? false : (seen[x.product] = true))).slice(0, 3).map((x) => ({ product: x.product, name: nameOf(app, "products", x.product), selling_unit: x.selling_unit, score: Math.round(x.s * 100) / 100 }));
    if (!r.product && r.candidates.length && r.candidates[0].score >= 0.5) take(r.candidates[0].product, r.candidates[0].selling_unit, "name", r.candidates[0].score);
    if (r.product) {
      r.product_name = nameOf(app, "products", r.product);
      if (!r.selling_unit) { const vp = vps.find((x) => x.getString("product") === r.product); if (vp) r.selling_unit = vp.getString("selling_unit"); }
      r.unit_name = r.selling_unit ? nameOf(app, "selling_units", r.selling_unit) : "";
    }
    return r;
  });
  // The vendor's open orders: the newest is suggested, with what each still expects
  const pos = app.findRecordsByFilter("purchase_orders", "vendor = {:v} && (status = 'sent' || status = 'partial')", "-created_at", 10, 0, { v: v.id }).map((po) => ({
    id: po.id, number: po.getString("number"), order_date: po.getString("order_date"),
    lines: app.findRecordsByFilter("po_lines", "po = {:p} && deleted_at = ''", "line_no", 0, 0, { p: po.id }).map((l) => ({ id: l.id, product: l.getString("product"), left: Math.max(0, l.getFloat("qty") - l.getFloat("received_qty")), cost_cents: l.getInt("cost_cents") })) }));
  out.forEach((r) => {
    if (!r.product || !pos.length) return;
    const l = pos[0].lines.find((x) => x.product === r.product);
    r.po_check = l ? (Math.abs(l.left - r.qty) < 1e-9 && l.cost_cents === r.unit_cents ? "as ordered" : "ordered " + l.left + " at " + (l.cost_cents / 100).toFixed(2)) : "not on " + pos[0].number;
  });
  return { vendor: v.id, currency: v.getString("currency") || "CAD", lines: out, orders: pos };
}

// Freight, duty and brokerage (CAD cents) spread over lines by value; returns the CAD cents to add per unit
function spread(values, landed) {
  const total = ["freight_cents", "duty_cents", "brokerage_cents"].reduce((a, k) => a + (Math.round(Number((landed || {})[k])) || 0), 0);
  const sum = values.reduce((a, v) => a + v.value, 0);
  if (!total || !sum) return values.map(() => 0);
  let given = 0;
  return values.map((v, i) => {
    const share = i === values.length - 1 ? total - given : Math.round((total * v.value) / sum);
    given += share;
    return v.qty ? share / v.qty : 0;
  });
}

function learn(app, c, vendorId, ln) {
  keysOf({ code: ln.raw_code, description: ln.raw_description }).forEach((k) => {
    let m = app.findRecordsByFilter("scan_matches", "vendor = {:v} && key = {:k}", "", 1, 0, { v: vendorId, k: k })[0];
    if (!m) { m = new Record(app.findCollectionByNameOrId("scan_matches")); m.load({ vendor: vendorId, key: k, uses: 0 }); }
    m.set("product", ln.product); m.set("selling_unit", ln.selling_unit || "");
    m.set("uses", m.getInt("uses") + 1);
    stamp(m, c); app.save(m);
  });
}

// body: {vendor, po?, op_id, lines: [{product, selling_unit, qty, cost_cents, expiry_date, raw_code, raw_description}],
//        landed: {freight_cents, duty_cents, brokerage_cents}, bill: {make, party_ref, doc_date, taxes}}
function confirm(app, c, b) {
  const v = P().vendorOf(app, b.vendor);
  const lines = (Array.isArray(b.lines) ? b.lines : []).filter((l) => l.product && Number(l.qty) > 0);
  if (!lines.length) bad("No lines to receive: match each line to a product.");
  lines.forEach((l) => learn(app, c, v.id, l));
  let receipt = null, po = null;
  if (b.po) {
    po = app.findRecordById("purchase_orders", b.po);
    if (po.getString("vendor") !== v.id) bad("That order is not from this vendor.");
    const left = {};
    app.findRecordsByFilter("po_lines", "po = {:p} && deleted_at = ''", "line_no", 0, 0, { p: po.id }).forEach((l) => { (left[l.getString("product")] || (left[l.getString("product")] = [])).push(l); });
    const recv = lines.map((l) => {
      const pl = (left[l.product] || []).find((x) => !x.used) || null;
      if (pl) pl.used = true;
      return pl ? { po_line: pl.id, qty: Number(l.qty), cost_cents: l.cost_cents, expiry_date: l.expiry_date }
        : { product: l.product, selling_unit: l.selling_unit, qty: Number(l.qty), cost_cents: l.cost_cents, expiry_date: l.expiry_date };
    });
    receipt = require(`${__hooks}/lib/po.js`).receive(app, c, po.id, { op_id: b.op_id, lines: recv, landed: b.landed, note: "From the bill " + (b.bill && b.bill.party_ref ? b.bill.party_ref : ""), source: "bill_scan", close: !!b.close }).receipt;
  } else {
    const day = st().today(), fx = P().fx(app, v.getString("currency") || "CAD", day);
    if (!fx) bad("Enter an exchange rate for " + v.getString("currency") + " first.");
    const values = lines.map((l) => ({ qty: Number(l.qty), value: Number(l.qty) * (Number(l.cost_cents) || 0) * fx.rate }));
    const add = spread(values, b.landed);
    st().receive(app, { lines: lines.map((l, i) => ({ product: l.product, selling_unit: l.selling_unit, qty: Number(l.qty), expiry_date: l.expiry_date,
      cost_cents: l.cost_cents === undefined || l.cost_cents === null || l.cost_cents === "" ? undefined : Math.round(Number(l.cost_cents) * fx.rate + add[i]), note: "Bill " + (b.bill && b.bill.party_ref ? b.bill.party_ref : "") + " · " + v.getString("name") })) },
      { actor: c.actor, device: c.device, op: String(b.op_id || "") });
  }
  let bill = null;
  if (b.bill && b.bill.make) {
    const B = require(`${__hooks}/lib/bills.js`);
    const extra = ["freight_cents", "duty_cents", "brokerage_cents"].filter((k) => Number((b.landed || {})[k]) > 0)
      .map((k) => ({ description: { freight_cents: "Freight", duty_cents: "Duty", brokerage_cents: "Brokerage" }[k], qty: 1, unit_cents: Math.round(Number(b.landed[k]) / ((P().fx(app, v.getString("currency") || "CAD", st().today()) || { rate: 1 }).rate)) }));
    bill = B.create(app, c, { kind: "bill", party: v.id, po: po ? po.id : undefined, party_ref: b.bill.party_ref, doc_date: b.bill.doc_date, taxes: b.bill.taxes,
      lines: lines.map((l) => ({ description: (l.raw_code ? l.raw_code + " " : "") + (l.raw_description || nameOf(app, "products", l.product)), product: l.product, qty: Number(l.qty), unit_cents: Math.round(Number(l.cost_cents) || 0) })).concat(extra) });
  }
  return { received: lines.length, po: po ? po.id : "", receipt: receipt ? receipt.id : "", bill: bill ? { id: bill.id, number: bill.getString("number") } : null };
}

module.exports = { match, confirm, spread, score };

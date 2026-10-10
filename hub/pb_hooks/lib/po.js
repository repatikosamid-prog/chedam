// Purchase orders and min/max reorder (P3 step 3; FR-8.03, 6.13).
// A PO: draft (changed freely) → sent (its quantities count as incoming stock) → partly or fully received →
// received / closed; or cancelled. Costs are per ordered unit in the vendor's currency, with the exchange rate
// of the order date kept on the PO (P3-b). Receiving goes through the P1 receive action (lots, cost, FEFO;
// P3-c) at the PO's rate; short, over, cost differences and items not on the PO are flagged on the receipt
// and the PO, and a task tells the managers. A repeated receipt (same op_id) changes nothing (BR-10).
// reorder(): products at or below their reorder point (on hand + incoming) get a draft PO per vendor (the
// preferred one, else the cheapest) up to their max, in whole ordered units, at least the vendor's minimum.

const st = () => require(`${__hooks}/lib/stock.js`);
const P = () => require(`${__hooks}/lib/purchasing.js`);
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const r3 = (x) => Math.round(x * 1000) / 1000;
const OPEN = ["sent", "partial"];

function linesOf(app, poId) { return app.findRecordsByFilter("po_lines", "po = {:p} && deleted_at = ''", "line_no", 0, 0, { p: poId }); }

function view(app, po, showCost) {
  let vname = "";
  try { vname = app.findRecordById("parties", po.getString("vendor")).getString("name"); } catch (_) { vname = ""; }
  const lines = linesOf(app, po.id).map((l) => {
    let pname = "", uname = "";
    try { pname = app.findRecordById("products", l.getString("product")).getString("name"); } catch (_) { pname = "(gone)"; }
    try { uname = app.findRecordById("selling_units", l.getString("selling_unit")).getString("name"); } catch (_) { uname = ""; }
    const o = { id: l.id, line_no: l.getInt("line_no"), product: l.getString("product"), product_name: pname, selling_unit: l.getString("selling_unit"), unit_name: uname,
      vendor_sku: l.getString("vendor_sku"), description: l.getString("description"), pack_qty: l.getFloat("pack_qty"), qty: l.getFloat("qty"), received_qty: l.getFloat("received_qty") };
    if (showCost) { o.cost_cents = l.getInt("cost_cents"); o.line_total_cents = l.getInt("line_total_cents"); }
    return o;
  });
  const receipts = app.findRecordsByFilter("po_receipts", "po = {:p}", "created_at", 0, 0, { p: po.id }).map((r) => {
    let d = [];
    try { d = JSON.parse(r.getString("differences") || "[]"); } catch (_) { d = []; }
    return { id: r.id, at: r.getString("created_at"), by: r.getString("by_name"), differences: d, note: r.getString("note") };
  });
  const o = { id: po.id, number: po.getString("number"), vendor: po.getString("vendor"), vendor_name: vname, status: po.getString("status"), source: po.getString("source"),
    currency: po.getString("currency"), fx_rate: po.getFloat("fx_rate"), order_date: po.getString("order_date"), expected_date: po.getString("expected_date"), notes: po.getString("notes"),
    sent_at: po.getString("sent_at"), received_at: po.getString("received_at"), differences: po.getBool("differences"), lines: lines, receipts: receipts };
  if (showCost) { o.total_cents = po.getInt("total_cents"); o.total_cad_cents = po.getInt("total_cad_cents"); }
  return o;
}

function list(app, q, showCost) {
  const parts = ["deleted_at = ''"], params = {};
  if (q.status === "open") parts.push("(status = 'draft' || status = 'sent' || status = 'partial')");
  else if (q.status) { parts.push("status = {:s}"); params.s = q.status; }
  if (q.vendor) { parts.push("vendor = {:v}"); params.v = q.vendor; }
  return { orders: app.findRecordsByFilter("purchase_orders", parts.join(" && "), "-created_at", 200, 0, params).map((po) => {
    const v = view(app, po, showCost);
    return Object.assign({}, v, { lines: undefined, line_count: v.lines.length, received_lines: v.lines.filter((l) => l.received_qty >= l.qty).length });
  }) };
}

// The unit a line is ordered in: the given one, the vendor product's, or the product's loose unit.
function lineUnit(app, p, unitId) {
  const units = require(`${__hooks}/lib/catalogue.js`).unitsOf(app, p.id);
  if (unitId) { const u = units.find((x) => x.id === unitId); if (!u) bad("That unit is not one of '" + p.getString("name") + "''s units."); return u; }
  const u = units.find((x) => (x.getFloat("base_qty") || 1) === 1);
  if (!u) bad("'" + p.getString("name") + "' needs a unit to order it in.");
  return u;
}

function totals(app, po) {
  let t = 0;
  linesOf(app, po.id).forEach((l) => { t += l.getInt("line_total_cents"); });
  po.set("total_cents", t);
  po.set("total_cad_cents", Math.round(t * (po.getFloat("fx_rate") || 1)));
}

function setLines(app, c, po, lines) {
  if (!Array.isArray(lines) || !lines.length) bad("Add at least one line.");
  if (lines.length > 300) bad("At most 300 lines.");
  linesOf(app, po.id).forEach((l) => { l.set("deleted_at", new DateTime()); stamp(l, c); app.save(l); });
  const rate = po.getFloat("fx_rate") || 1;
  lines.forEach((ln, i) => {
    let p = null;
    try { p = app.findRecordById("products", String(ln.product || "")); } catch (_) { p = null; }
    if (!p || p.getString("deleted_at")) bad("Line " + (i + 1) + ": choose a product.");
    let vp = null;
    if (ln.vendor_product) { try { vp = app.findRecordById("vendor_products", ln.vendor_product); } catch (_) { vp = null; } }
    if (!vp) vp = app.findRecordsByFilter("vendor_products", "vendor = {:v} && product = {:p} && active = true && deleted_at = ''", "-preferred", 1, 0, { v: po.getString("vendor"), p: p.id })[0] || null;
    const u = lineUnit(app, p, ln.selling_unit || (vp ? vp.getString("selling_unit") : ""));
    const pack = u.getFloat("base_qty") || 1;
    const qty = Number(ln.qty);
    if (!(qty > 0)) bad("Line " + (i + 1) + ": order more than 0.");
    let cost = ln.cost_cents === undefined || ln.cost_cents === null || ln.cost_cents === "" ? null : Math.round(Number(ln.cost_cents));
    if (cost === null) cost = vp && vp.getString("selling_unit") === u.id ? vp.getInt("cost_cents") : Math.round((p.getInt("cost_cents") * pack) / rate);
    if (!(cost >= 0)) bad("Line " + (i + 1) + ": the cost is not a valid amount.");
    const l = new Record(app.findCollectionByNameOrId("po_lines"));
    l.load({ po: po.id, line_no: i + 1, product: p.id, selling_unit: u.id, vendor_sku: vp ? vp.getString("vendor_sku") : "", description: String(ln.description || (vp ? vp.getString("description") : "") || "").substring(0, 200),
      pack_qty: pack, qty: r3(qty), cost_cents: cost, received_qty: 0, line_total_cents: Math.round(cost * qty) });
    stamp(l, c); app.save(l);
  });
}

function create(app, c, b, source) {
  const v = P().vendorOf(app, b.vendor);
  const day = st().today();
  const cur = v.getString("currency") || "CAD";
  const fx = P().fx(app, cur, day);
  if (!fx) bad("Enter an exchange rate for " + cur + " first (Vendors and clients → Exchange rates).");
  const po = new Record(app.findCollectionByNameOrId("purchase_orders"));
  po.load({ vendor: v.id, status: "draft", source: source || "manual", currency: cur, fx_rate: fx.rate, order_date: day, notes: String(b.notes || "").substring(0, 2000),
    expected_date: /^\d{4}-\d{2}-\d{2}$/.test(b.expected_date || "") ? b.expected_date : st().today(Math.max(0, Number(b.lead_days) || 0)), differences: false });
  po.set("number", "PO-" + ("000000" + require(`${__hooks}/lib/sales.js`).nextNumber(app, "po", c)).slice(-6));
  stamp(po, c); app.save(po);
  setLines(app, c, po, b.lines);
  totals(app, po); app.save(po);
  return po;
}

function update(app, c, id, b) {
  const po = app.findRecordById("purchase_orders", id);
  if (po.getString("status") !== "draft") bad("Only a draft can be changed; this one is " + po.getString("status") + ".");
  if (b.notes !== undefined) po.set("notes", String(b.notes || "").substring(0, 2000));
  if (b.expected_date !== undefined) po.set("expected_date", /^\d{4}-\d{2}-\d{2}$/.test(b.expected_date || "") ? b.expected_date : "");
  if (b.lines) setLines(app, c, po, b.lines);
  totals(app, po); stamp(po, c); app.save(po);
  return po;
}

// Incoming stock: what sent POs still expect, in base units
function addIncoming(app, c, productId, base) {
  const lv = st().level(app, productId, c);
  lv.set("incoming", Math.max(0, r3(lv.getFloat("incoming") + base)));
  st().stamp(lv, c); app.save(lv);
}
function remaining(l) { return Math.max(0, l.getFloat("qty") - l.getFloat("received_qty")) * (l.getFloat("pack_qty") || 1); }

function act(app, c, id, action) {
  const po = app.findRecordById("purchase_orders", id);
  const s = po.getString("status");
  if (action === "send") {
    if (s !== "draft") bad("Only a draft can be sent.");
    linesOf(app, po.id).forEach((l) => addIncoming(app, c, l.getString("product"), remaining(l)));
    po.set("status", "sent"); po.set("sent_at", new DateTime()); po.set("sent_by", c.actor);
  } else if (action === "cancel") {
    if (["draft", "sent"].indexOf(s) < 0) bad("Only a draft or a sent order with nothing received can be cancelled; close it instead.");
    if (s === "sent") linesOf(app, po.id).forEach((l) => addIncoming(app, c, l.getString("product"), -remaining(l)));
    po.set("status", "cancelled");
  } else if (action === "close") {
    if (OPEN.indexOf(s) < 0) bad("Only a sent or partly received order can be closed.");
    linesOf(app, po.id).forEach((l) => addIncoming(app, c, l.getString("product"), -remaining(l)));
    po.set("status", "closed");
  } else if (action === "reopen") {
    if (s !== "cancelled" && s !== "draft") bad("Only a cancelled order can go back to draft.");
    po.set("status", "draft");
  } else throw new NotFoundError("Unknown order action.");
  stamp(po, c); app.save(po);
  return po;
}

// body: {op_id, lines: [{po_line, qty, cost_cents?, expiry_date?, lot_code?, storage_area?} | {product, selling_unit, qty, ...} (not on the PO)], note, close,
//        landed: {freight_cents, duty_cents, brokerage_cents} (CAD, spread over the lines by value)}
function receive(app, c, id, b) {
  const po = app.findRecordById("purchase_orders", id);
  if (OPEN.indexOf(po.getString("status")) < 0) bad(po.getString("status") === "draft" ? "Send the order first (or receive without an order)." : "This order is " + po.getString("status") + ".");
  const op = String(b.op_id || "");
  if (op) { const done = app.findRecordsByFilter("po_receipts", "op_id = {:o}", "", 1, 0, { o: op })[0]; if (done) return { po: po, receipt: done, duplicate: true }; }
  const lines = Array.isArray(b.lines) ? b.lines.filter((x) => Number(x.qty) > 0) : [];
  if (!lines.length) bad("Enter what arrived.");
  const rate = po.getFloat("fx_rate") || 1;
  const byId = {};
  linesOf(app, po.id).forEach((l) => { byId[l.id] = l; });
  const recv = [], diffs = [], out = [];
  lines.forEach((ln, i) => {
    const l = ln.po_line ? byId[ln.po_line] : null;
    if (ln.po_line && !l) bad("Line " + (i + 1) + " is not on this order.");
    const qty = r3(Number(ln.qty));
    const cost = ln.cost_cents === undefined || ln.cost_cents === null || ln.cost_cents === "" ? (l ? l.getInt("cost_cents") : null) : Math.round(Number(ln.cost_cents));
    const product = l ? l.getString("product") : String(ln.product || "");
    const unit = l ? l.getString("selling_unit") : String(ln.selling_unit || "");
    recv.push({ product: product, selling_unit: unit, qty: qty, cost_cents: cost === null ? null : Math.round(cost * rate), expiry_date: ln.expiry_date, lot_code: ln.lot_code, storage_area: ln.storage_area,
      note: po.getString("number") });
    out.push({ po_line: l ? l.id : "", product: product, qty: qty, cost_cents: cost });
    if (!l) { diffs.push({ kind: "extra", product: product, received: qty }); return; }
    const before = l.getFloat("received_qty"), ordered = l.getFloat("qty");
    l.set("received_qty", r3(before + qty));
    stamp(l, c); app.save(l);
    // Incoming goes down by what this line still expected (never below 0)
    addIncoming(app, c, product, -Math.min(qty, Math.max(0, ordered - before)) * (l.getFloat("pack_qty") || 1));
    if (cost !== null && cost !== l.getInt("cost_cents")) diffs.push({ kind: "cost", po_line: l.id, product: product, ordered_cost_cents: l.getInt("cost_cents"), received_cost_cents: cost });
  });
  // Landed cost (FR-6.12): freight, duty and brokerage (CAD) spread over the lines by value
  const add = require(`${__hooks}/lib/billscan.js`).spread(recv.map((x) => ({ qty: x.qty, value: x.qty * (x.cost_cents || 0) })), b.landed);
  recv.forEach((x, i) => { if (add[i] && x.cost_cents !== null) x.cost_cents = Math.round(x.cost_cents + add[i]); });
  st().receive(app, { lines: recv }, { actor: c.actor, device: c.device, op: op });
  // Short and over against the whole order so far
  const all = linesOf(app, po.id);
  const close = !!b.close;
  all.forEach((l) => {
    const got = l.getFloat("received_qty"), want = l.getFloat("qty");
    if (got > want + 1e-9) diffs.push({ kind: "over", po_line: l.id, product: l.getString("product"), ordered: want, received: got });
    else if (close && got + 1e-9 < want) diffs.push({ kind: "short", po_line: l.id, product: l.getString("product"), ordered: want, received: got });
  });
  const full = all.every((l) => l.getFloat("received_qty") + 1e-9 >= l.getFloat("qty"));
  if (full) po.set("status", "received");
  else if (close) { all.forEach((l) => addIncoming(app, c, l.getString("product"), -remaining(l))); po.set("status", "closed"); }
  else po.set("status", "partial");
  if (full || close) po.set("received_at", new DateTime());
  // A full receipt short on nothing still flags over / cost / extra; a partial one flags short only on closing
  if (diffs.length) po.set("differences", true);
  stamp(po, c); app.save(po);
  const r = new Record(app.findCollectionByNameOrId("po_receipts"));
  const landed = {};
  ["freight_cents", "duty_cents", "brokerage_cents"].forEach((k) => { if (Number((b.landed || {})[k]) > 0) landed[k] = Math.round(Number(b.landed[k])); });
  r.load({ po: po.id, op_id: op, by_name: c.user ? c.user.getString("name") : "", lines: out, differences: diffs, note: String(b.note || "").substring(0, 1000), landed: landed, source: b.source || "manual" });
  stamp(r, c); app.save(r);
  if (diffs.length) {
    const t = new Record(app.findCollectionByNameOrId("tasks"));
    t.load({ title: po.getString("number") + " received with " + diffs.length + " difference" + (diffs.length === 1 ? "" : "s") + " (" + diffs.map((d) => d.kind).filter((x, i, a) => a.indexOf(x) === i).join(", ") + ")",
      kind: "po_differences", source: "manual", status: "open", priority: "normal", link_collection: "purchase_orders", link_id: po.id });
    stamp(t, c); app.save(t);
  }
  return { po: po, receipt: r, duplicate: false };
}

// ---- Min/max reorder (FR-6.13) --------------------------------------------------------------------------

function needs(app) {
  const out = [];
  app.findRecordsByFilter("products", "status = 'active' && deleted_at = '' && reorder_point > 0", "name", 0, 0).forEach((p) => {
    const lv = app.findRecordsByFilter("stock_levels", "product = {:p}", "", 1, 0, { p: p.id })[0];
    const on = lv ? lv.getFloat("on_hand") : 0, inc = lv ? lv.getFloat("incoming") : 0;
    const avail = r3(on + inc);
    if (avail > p.getFloat("reorder_point")) return;
    const max = p.getFloat("reorder_max") > p.getFloat("reorder_point") ? p.getFloat("reorder_max") : p.getFloat("reorder_point") * 2;
    out.push({ product: p, on_hand: on, incoming: inc, need_base: r3(max - avail), min: p.getFloat("reorder_point"), max: max });
  });
  return out;
}

function reorder(app, c) {
  const groups = {}, noVendor = [];
  needs(app).forEach((n) => {
    const vps = app.findRecordsByFilter("vendor_products", "product = {:p} && active = true && deleted_at = ''", "", 0, 0, { p: n.product.id });
    let vp = vps.find((x) => x.getBool("preferred"));
    if (!vp && vps.length) {
      const priced = vps.map((x) => ({ x: x, c: P().fx(app, x.getString("currency")) ? x.getInt("cost_cents") * P().fx(app, x.getString("currency")).rate / (x.getFloat("pack_qty") || 1) : Infinity })).sort((a, b) => a.c - b.c);
      vp = priced[0].x;
    }
    if (!vp) { noVendor.push({ product: n.product.id, name: n.product.getString("name"), need_base: n.need_base }); return; }
    const pack = vp.getFloat("pack_qty") || 1;
    const qty = Math.max(Math.ceil(n.need_base / pack - 1e-9), Math.ceil(vp.getFloat("min_order_qty") || 0), 1);
    (groups[vp.getString("vendor")] || (groups[vp.getString("vendor")] = { lead: 0, lines: [] })).lines.push({ product: n.product.id, vendor_product: vp.id, selling_unit: vp.getString("selling_unit"), qty: qty });
    groups[vp.getString("vendor")].lead = Math.max(groups[vp.getString("vendor")].lead, vp.getInt("lead_days"));
  });
  const made = Object.keys(groups).map((vid) => create(app, c, { vendor: vid, lines: groups[vid].lines, lead_days: groups[vid].lead, notes: "Made by the reorder rules (min/max)" }, "reorder"));
  return { created: made.map((po) => ({ id: po.id, number: po.getString("number"), vendor: po.getString("vendor"), lines: linesOf(app, po.id).length })), no_vendor: noVendor };
}

module.exports = { view, list, create, update, act, receive, needs, reorder };

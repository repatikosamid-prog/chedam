// Delivery-app orders, manual mode (P3 step 9; FR-8.09) and consignment stock (FR-6.14).
// A delivery order is typed in from the platform's tablet (platform, its order number, the items at the
// platform's prices): accepted → its stock is reserved; preparing; picked up → a sale is made on this device's
// open till at the platform's prices, paid by the platform (method "platform"), and the reservation released;
// cancelled → released. Platform prices per selling unit and platform (with "available" for the menu).
// Consignment: a product owned by a vendor until sold (consignment_vendor, the cost owed per base unit);
// each sale adds what is owed (a return takes it back); the unbilled list per vendor becomes a vendor bill.

const st = () => require(`${__hooks}/lib/stock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const r3 = (x) => Math.round(x * 1000) / 1000;

function view(o) {
  return { id: o.id, platform: o.getString("platform"), number: o.getString("number"), customer_name: o.getString("customer_name"), lines: j(o, "lines", []), total_cents: o.getInt("total_cents"),
    status: o.getString("status"), sale: o.getString("sale"), notes: o.getString("notes"), created_at: o.getString("created_at"), picked_up_at: o.getString("picked_up_at") };
}

function priceFor(app, platform, unit) {
  const pp = app.findRecordsByFilter("platform_prices", "platform = {:p} && selling_unit = {:u}", "", 1, 0, { p: platform, u: unit.id })[0];
  return pp ? pp.getInt("price_cents") : unit.getInt("price_cents");
}

function reserve(app, c, lines, sign) {
  lines.forEach((l) => {
    const lv = st().level(app, l.product, c);
    if (sign > 0 && lv.getFloat("on_hand") - lv.getFloat("reserved") + 1e-9 < l.base) bad("Only " + r3(Math.max(0, lv.getFloat("on_hand") - lv.getFloat("reserved"))) + " of '" + l.name + "' is free.");
    lv.set("reserved", Math.max(0, r3(lv.getFloat("reserved") + sign * l.base)));
    st().stamp(lv, c); app.save(lv);
  });
}

// body: {platform, number, customer_name, notes, lines: [{product, selling_unit, qty, price_cents?}]}
function accept(app, c, b) {
  const platforms = setting(app, "delivery.platforms", []) || [];
  const platform = String(b.platform || "");
  if (platforms.indexOf(platform) < 0) bad("Choose the platform.");
  const number = String(b.number || "").trim();
  if (!number) bad("Type the platform's order number.");
  if (app.findRecordsByFilter("delivery_orders", "platform = {:p} && number = {:n}", "", 1, 0, { p: platform, n: number }).length) bad(platform + " order " + number + " is already here.");
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 100).map((ln, i) => {
    let p = null;
    try { p = app.findRecordById("products", ln.product); } catch (_) { p = null; }
    if (!p || p.getString("status") !== "active") bad("Line " + (i + 1) + ": choose an active product.");
    const units = require(`${__hooks}/lib/catalogue.js`).unitsOf(app, p.id);
    const u = ln.selling_unit ? units.find((x) => x.id === ln.selling_unit) : (units.find((x) => x.getBool("is_default")) || units[0]);
    if (!u) bad("Line " + (i + 1) + ": choose its unit.");
    const qty = Number(ln.qty);
    if (!(qty > 0) || qty !== Math.floor(qty)) bad("Line " + (i + 1) + ": a whole quantity above 0.");
    const price = ln.price_cents === undefined || ln.price_cents === null || ln.price_cents === "" ? priceFor(app, platform, u) : Math.round(Number(ln.price_cents));
    return { product: p.id, selling_unit: u.id, name: p.getString("name"), qty: qty, base: r3(qty * (u.getFloat("base_qty") || 1)), price_cents: price, total_cents: price * qty };
  });
  if (!lines.length) bad("Add the order's items.");
  reserve(app, c, lines, 1);
  const o = new Record(app.findCollectionByNameOrId("delivery_orders"));
  o.load({ platform: platform, number: number, customer_name: String(b.customer_name || "").substring(0, 80), lines: lines, total_cents: lines.reduce((a, l) => a + l.total_cents, 0),
    status: "accepted", notes: String(b.notes || "").substring(0, 500) });
  stamp(o, c); app.save(o);
  return o;
}

// preparing | picked_up | cancel
function act(app, c, id, action) {
  const o = app.findRecordById("delivery_orders", id);
  const s = o.getString("status");
  if (action === "preparing") {
    if (s !== "accepted") bad("This order is " + s + ".");
    o.set("status", "preparing");
  } else if (action === "cancel") {
    if (["accepted", "preparing"].indexOf(s) < 0) bad("This order is " + s + ".");
    reserve(app, c, j(o, "lines", []), -1);
    o.set("status", "cancelled");
  } else if (action === "picked_up") {
    if (["accepted", "preparing"].indexOf(s) < 0) bad("This order is " + s + ".");
    const lines = j(o, "lines", []);
    reserve(app, c, lines, -1);
    // The sale: the platform's prices (overrides with the platform as the reason), paid by the platform
    const input = { id: $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"), note: o.getString("platform") + " " + o.getString("number"),
      lines: lines.map((l, i) => ({ key: "d" + i, product: l.product, selling_unit: l.selling_unit, qty: l.qty, price_cents: l.price_cents, override_reason: o.getString("platform") + " price" })) };
    const S = require(`${__hooks}/lib/sales.js`);
    const q = S.quoteView(S.build(app, input, c.user), null);
    if (q.problems && q.problems.length) bad(q.problems[0].message);
    const r = S.complete(app, Object.assign(input, { expected_total_cents: q.total_cents, approval: undefined,
      payments: [{ method: "platform", amount_cents: q.total_cents, reference: (o.getString("platform") + " " + o.getString("number")).substring(0, 60), processor: o.getString("platform").substring(0, 40) }] }), Object.assign({}, c, { showCost: false }), { delivery: true });
    if (r.refused) bad(r.message);
    o.set("status", "picked_up"); o.set("sale", r.sale.id); o.set("picked_up_at", new DateTime());
  } else throw new NotFoundError("Unknown action.");
  stamp(o, c); app.save(o);
  return o;
}

function list(app, q) {
  const parts = ["deleted_at = ''"];
  if (q.open) parts.push("(status = 'accepted' || status = 'preparing')");
  return { platforms: setting(app, "delivery.platforms", []), items: app.findRecordsByFilter("delivery_orders", parts.join(" && "), "-created_at", 200, 0).map(view) };
}

// Platform prices: {platform, selling_unit, price_cents, available}
function setPrice(app, c, b) {
  const platforms = setting(app, "delivery.platforms", []) || [];
  if (platforms.indexOf(String(b.platform || "")) < 0) bad("Choose the platform.");
  const u = app.findRecordById("selling_units", String(b.selling_unit || ""));
  let r = app.findRecordsByFilter("platform_prices", "platform = {:p} && selling_unit = {:u}", "", 1, 0, { p: b.platform, u: u.id })[0];
  if (!r) { r = new Record(app.findCollectionByNameOrId("platform_prices")); r.load({ platform: b.platform, selling_unit: u.id, product: u.getString("product") }); }
  const price = Math.round(Number(b.price_cents));
  if (!(price >= 0)) bad("Enter the platform's price.");
  r.set("price_cents", price); r.set("available", b.available !== false);
  stamp(r, c); app.save(r);
  return { id: r.id, platform: b.platform, selling_unit: u.id, price_cents: price, available: r.getBool("available") };
}

// ---- Consignment (FR-6.14) ---------------------------------------------------------------------------------

// Called by lib/sales.js and lib/returns.js for each line (sign −1 for a return)
function onSold(app, c, p, base, saleId, returnId) {
  const vendor = p.getString("consignment_vendor");
  if (!vendor || !base) return;
  const r = new Record(app.findCollectionByNameOrId("consignment_sales"));
  r.load({ vendor: vendor, product: p.id, sale: saleId || "", return_id: returnId || "", qty_base: r3(base), amount_cents: Math.round(base * p.getInt("consignment_cost_cents")), bill: "" });
  stamp(r, c); app.save(r);
}

function owed(app, vendorId) {
  const rows = app.findRecordsByFilter("consignment_sales", "bill = ''" + (vendorId ? " && vendor = {:v}" : ""), "created_at", 0, 0, { v: vendorId || "" });
  const by = {};
  rows.forEach((r) => {
    const k = r.getString("vendor") + "|" + r.getString("product");
    const x = by[k] || (by[k] = { vendor: r.getString("vendor"), product: r.getString("product"), qty_base: 0, amount_cents: 0 });
    x.qty_base = r3(x.qty_base + r.getFloat("qty_base")); x.amount_cents += r.getInt("amount_cents");
  });
  const names = {};
  const nm = (coll, id) => names[id] || (names[id] = (() => { try { return app.findRecordById(coll, id).getString("name"); } catch (_) { return ""; } })());
  return { items: Object.values(by).map((x) => Object.assign(x, { vendor_name: nm("parties", x.vendor), product_name: nm("products", x.product) })) };
}

function billVendor(app, c, vendorId) {
  const rows = app.findRecordsByFilter("consignment_sales", "bill = '' && vendor = {:v}", "", 0, 0, { v: vendorId });
  if (!rows.length) bad("Nothing sold on consignment for this vendor since the last bill.");
  const lines = owed(app, vendorId).items.filter((x) => x.amount_cents).map((x) => ({ description: "Consignment sold: " + x.product_name, product: x.product, qty: x.qty_base, unit_cents: x.qty_base ? Math.round(x.amount_cents / x.qty_base) : x.amount_cents }));
  const bill = require(`${__hooks}/lib/bills.js`).create(app, c, { kind: "bill", party: vendorId, lines: lines, notes: "Consignment goods sold" });
  rows.forEach((r) => { r.set("bill", bill.id); stamp(r, c); app.save(r); });
  return bill;
}

module.exports = { accept, act, list, setPrice, view, onSold, owed, billVendor };

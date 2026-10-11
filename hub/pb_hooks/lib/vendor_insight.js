// Vendors (testing round 3, 2026-10-11): everything about one vendor or client in one place, and the best
// supplier for a product.
//   summary()       products they sell us (price, last change), consignment items and what is owed, their bills,
//                   credits and invoices, purchase orders, and how to order (portal, account, method; no passwords)
//   bestSupplier()  for a product (and a quantity): each vendor that sells it, ranked by cost in CAD per base
//                   unit (their price list, else the last price we paid), with the last purchase, the latest price
//                   change, lead time, minimum order and consignment; who to contact and how to order
const P = () => require(`${__hooks}/lib/purchasing.js`);
function bad(msg) { throw new BadRequestError(msg); }
const name = (app, col, id, f) => { try { return app.findRecordById(col, id).getString(f || "name"); } catch (_) { return ""; } };

function ordering(p) {
  return { method: p.getString("order_method"), email: p.getString("order_email") || p.getString("email"), phone: p.getString("phone"),
    portal_url: p.getString("portal_url"), portal_account: p.getString("portal_account"), portal_user: p.getString("portal_user"),
    cutoff: p.getString("order_cutoff"), min_order_cents: p.getInt("min_order_cents") };
}

function summary(app, id) {
  let p;
  try { p = app.findRecordById("parties", id); } catch (_) { bad("Vendor or client not found."); }
  const products = app.findRecordsByFilter("vendor_products", "vendor = {:v} && deleted_at = ''", "", 500, 0, { v: id }).map((x) => {
    const v = P().vpView(app, x);
    return Object.assign(v, { cad_per_base_cents: (() => { const r = P().fx(app, x.getString("currency")); const pack = x.getFloat("pack_qty") || 1; return r ? Math.round((x.getInt("cost_cents") * r.rate) / pack * 100) / 100 : null; })(),
      change_pct: x.getInt("previous_cost_cents") ? Math.round((10000 * (x.getInt("cost_cents") - x.getInt("previous_cost_cents"))) / x.getInt("previous_cost_cents")) / 100 : null });
  });
  // Products whose usual supplier is this vendor but with no price list line yet
  const listed = {};
  products.forEach((x) => { listed[x.product] = true; });
  app.findRecordsByFilter("products", "vendor = {:v} && deleted_at = ''", "name", 500, 0, { v: id }).forEach((pr) => {
    if (!listed[pr.id]) products.push({ product: pr.id, product_name: pr.getString("name"), usual_only: true });
  });
  const owed = {};
  app.findRecordsByFilter("consignment_sales", "vendor = {:v} && bill = ''", "", 0, 0, { v: id }).forEach((x) => {
    const o = owed[x.getString("product")] || (owed[x.getString("product")] = { qty: 0, cents: 0 });
    o.qty += x.getFloat("qty_base"); o.cents += x.getInt("amount_cents");
  });
  const consignment = app.findRecordsByFilter("products", "consignment_vendor = {:v} && deleted_at = ''", "name", 500, 0, { v: id }).map((pr) => {
    const lv = app.findRecordsByFilter("stock_levels", "product = {:p}", "", 1, 0, { p: pr.id })[0];
    return { product: pr.id, product_name: pr.getString("name"), cost_cents: pr.getInt("consignment_cost_cents"), on_hand: lv ? lv.getFloat("on_hand") : 0,
      sold_unbilled: Math.round(((owed[pr.id] || {}).qty || 0) * 1000) / 1000, owed_cents: (owed[pr.id] || {}).cents || 0 };
  });
  const docs = app.findRecordsByFilter("bills", "party = {:v}", "-doc_date", 200, 0, { v: id }).map((b) => ({ id: b.id, kind: b.getString("kind"), number: b.getString("number"),
    party_ref: b.getString("party_ref"), doc_date: b.getString("doc_date"), due_date: b.getString("due_date"), status: b.getString("status"), currency: b.getString("currency"),
    total_cents: b.getInt("total_cents"), paid_cents: b.getInt("paid_cents"), balance_cents: b.getInt("total_cents") - b.getInt("paid_cents") }));
  const orders = app.findRecordsByFilter("purchase_orders", "vendor = {:v} && deleted_at = ''", "-order_date", 100, 0, { v: id }).map((o) => ({ id: o.id, number: o.getString("number"),
    status: o.getString("status"), order_date: o.getString("order_date"), expected_date: o.getString("expected_date"), total_cents: o.getInt("total_cents"), currency: o.getString("currency") }));
  const open = docs.filter((d) => d.status === "open" || d.status === "partial");
  return { party: { id: p.id, name: p.getString("name"), kind: p.getString("kind"), currency: p.getString("currency") }, ordering: ordering(p), products: products, consignment: consignment, documents: docs, orders: orders,
    totals: { owed_to_them_cents: open.filter((d) => d.kind === "bill").reduce((a, d) => a + d.balance_cents, 0) - open.filter((d) => d.kind === "vendor_credit").reduce((a, d) => a + d.balance_cents, 0),
      they_owe_cents: open.filter((d) => d.kind === "invoice").reduce((a, d) => a + d.balance_cents, 0), consignment_owed_cents: consignment.reduce((a, x) => a + x.owed_cents, 0) } };
}

function bestSupplier(app, productId, qty) {
  let pr;
  try { pr = app.findRecordById("products", productId); } catch (_) { bad("Product not found."); }
  const want = Math.max(0, Number(qty) || 0);
  const byVendor = {};
  const add = (vid) => byVendor[vid] || (byVendor[vid] = { vendor: vid, reasons: [] });
  app.findRecordsByFilter("vendor_products", "product = {:p} && active = true && deleted_at = ''", "", 0, 0, { p: productId }).forEach((x) => {
    const c = add(x.getString("vendor"));
    const r = P().fx(app, x.getString("currency")), pack = x.getFloat("pack_qty") || 1;
    c.vp = x.id; c.vendor_sku = x.getString("vendor_sku"); c.pack_qty = pack; c.order_unit_cents = x.getInt("cost_cents"); c.currency = x.getString("currency") || "CAD";
    c.list_cad_per_base = r ? Math.round((x.getInt("cost_cents") * r.rate) / pack * 100) / 100 : null;
    c.lead_days = x.getInt("lead_days"); c.min_order_qty = x.getFloat("min_order_qty"); c.preferred = x.getBool("preferred"); c.price_at = x.getString("price_at");
    if (x.getInt("previous_cost_cents")) c.change_pct = Math.round((10000 * (x.getInt("cost_cents") - x.getInt("previous_cost_cents"))) / x.getInt("previous_cost_cents")) / 100;
  });
  if (pr.getString("vendor")) add(pr.getString("vendor")).usual = true;
  if (pr.getString("consignment_vendor")) { const c = add(pr.getString("consignment_vendor")); c.consignment = true; c.consignment_cents = pr.getInt("consignment_cost_cents"); }
  // The last price we actually paid each vendor (purchase orders that were sent or received)
  app.findRecordsByFilter("po_lines", "product = {:p} && po.status != 'draft' && po.status != 'cancelled'", "-created_at", 200, 0, { p: productId }).forEach((l) => {
    let po;
    try { po = app.findRecordById("purchase_orders", l.getString("po")); } catch (_) { return; }
    const c = byVendor[po.getString("vendor")] || add(po.getString("vendor"));
    if (c.last_purchase) return;
    const pack = l.getFloat("pack_qty") || 1, rate = po.getFloat("fx_rate") || 1;
    c.last_purchase = { day: po.getString("order_date"), number: po.getString("number"), cad_per_base: Math.round((l.getInt("cost_cents") * rate) / pack * 100) / 100, qty: l.getFloat("qty") };
  });
  const list = Object.values(byVendor).map((c) => {
    let pa;
    try { pa = app.findRecordById("parties", c.vendor); } catch (_) { return null; }
    c.vendor_name = pa.getString("name");
    c.cad_per_base = c.list_cad_per_base !== undefined && c.list_cad_per_base !== null ? c.list_cad_per_base : c.last_purchase ? c.last_purchase.cad_per_base : c.consignment ? c.consignment_cents : null;
    c.basis = c.list_cad_per_base != null ? "price list" : c.last_purchase ? "last paid" : c.consignment ? "consignment (paid when sold)" : "no price";
    if (c.change_pct) c.reasons.push("price " + (c.change_pct > 0 ? "up " : "down ") + Math.abs(c.change_pct) + "% at the last change");
    if (c.last_purchase) c.reasons.push("last bought " + c.last_purchase.day + " (" + c.last_purchase.number + ") at $" + (c.last_purchase.cad_per_base / 100).toFixed(2));
    if (c.lead_days) c.reasons.push(c.lead_days + " days to deliver");
    if (c.min_order_qty) c.reasons.push("minimum " + c.min_order_qty + " order units");
    if (c.consignment) c.reasons.push("on consignment: paid only when sold");
    if (c.usual) c.reasons.push("the product's usual supplier");
    if (c.pack_qty && want) c.order_units = Math.max(c.min_order_qty || 0, Math.ceil(want / c.pack_qty));
    const contact = app.findRecordsByFilter("party_contacts", "party = {:p} && deleted_at = ''", "-primary,name", 1, 0, { p: pa.id })[0];
    c.contact = contact ? { name: contact.getString("name"), phone: contact.getString("phone"), email: contact.getString("email") } : null;
    c.ordering = ordering(pa);
    return c;
  }).filter(Boolean);
  list.sort((a, b) => (a.cad_per_base === null) - (b.cad_per_base === null) || (a.cad_per_base - b.cad_per_base) || ((a.lead_days || 99) - (b.lead_days || 99)));
  if (list.length && list[0].cad_per_base !== null) { list[0].best = true; list[0].reasons.unshift("lowest cost per " + pr.getString("base_unit")); }
  const lv = app.findRecordsByFilter("stock_levels", "product = {:p}", "", 1, 0, { p: productId })[0];
  return { product: { id: pr.id, name: pr.getString("name"), base_unit: pr.getString("base_unit"), on_hand: lv ? lv.getFloat("on_hand") : 0, reorder_point: pr.getFloat("reorder_point"), reorder_max: pr.getFloat("reorder_max") },
    qty: want, vendors: list };
}

module.exports = { summary, bestSupplier };

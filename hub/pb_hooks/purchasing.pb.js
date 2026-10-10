/// <reference path="../pb_data/types.d.ts" />
// Purchasing (P3 steps 2-4). Logic: lib/purchasing.js.

onRecordCreateRequest((e) => { require(`${__hooks}/lib/purchasing.js`).checkVP(e.app, e.record); e.next(); require(`${__hooks}/lib/purchasing.js`).onePreferred(e.app, e.record); }, "vendor_products");
onRecordUpdateRequest((e) => { require(`${__hooks}/lib/purchasing.js`).checkVP(e.app, e.record); e.next(); require(`${__hooks}/lib/purchasing.js`).onePreferred(e.app, e.record); }, "vendor_products");

// What a vendor sells us
routerAdd("GET", "/api/chedam/vendors/{id}/products", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.view|purchasing.manage");
  return e.json(200, require(`${__hooks}/lib/purchasing.js`).vendorList(e.app, e.request.pathValue("id")));
});
// Import a vendor's price list: {rows: [{vendor_sku, barcode, description, cost, min_order_qty, lead_days}]}
routerAdd("POST", "/api/chedam/vendors/{id}/price-list", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/purchasing.js`).importList(t, c, e.request.pathValue("id"), c.body.rows); });
  return e.json(200, out);
});
// Every vendor of a product, cheapest first (cost per base unit in CAD)
routerAdd("GET", "/api/chedam/products/{id}/vendors", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.view|purchasing.manage");
  return e.json(200, require(`${__hooks}/lib/purchasing.js`).compare(e.app, e.request.pathValue("id")));
});
// Products whose preferred vendor is not the cheapest
routerAdd("GET", "/api/chedam/purchasing/better", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.view|purchasing.manage");
  return e.json(200, require(`${__hooks}/lib/purchasing.js`).better(e.app));
});

// ---- Purchase orders (P3 step 3). Logic: lib/po.js -------------------------------------------------------
// ?status=open|draft|sent|partial|received|closed|cancelled&vendor=<id>
routerAdd("GET", "/api/chedam/purchase-orders", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.view|purchasing.manage|stock.receive");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/po.js`).list(e.app, { status: q.get("status"), vendor: q.get("vendor") }, c.showCost));
});
routerAdd("GET", "/api/chedam/purchase-orders/needs", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.view|purchasing.manage");
  return e.json(200, { items: require(`${__hooks}/lib/po.js`).needs(e.app).map((n) => ({ product: n.product.id, name: n.product.getString("name"), on_hand: n.on_hand, incoming: n.incoming, min: n.min, max: n.max, need_base: n.need_base })) });
});
routerAdd("GET", "/api/chedam/purchase-orders/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.view|purchasing.manage|stock.receive");
  return e.json(200, require(`${__hooks}/lib/po.js`).view(e.app, e.app.findRecordById("purchase_orders", e.request.pathValue("id")), c.showCost));
});
// New draft: {vendor, expected_date, notes, lines: [{product, vendor_product?, selling_unit?, qty, cost_cents?}]}
routerAdd("POST", "/api/chedam/purchase-orders", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.manage");
  let out = null;
  e.app.runInTransaction((t) => { const P = require(`${__hooks}/lib/po.js`); out = P.view(t, P.create(t, c, c.body, "manual"), true); });
  return e.json(200, out);
});
// Draft orders from the min/max rules, one per vendor
routerAdd("POST", "/api/chedam/purchase-orders/reorder", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/po.js`).reorder(t, c); });
  return e.json(200, out);
});
// Change a draft: {notes, expected_date, lines}
routerAdd("POST", "/api/chedam/purchase-orders/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.manage");
  let out = null;
  e.app.runInTransaction((t) => { const P = require(`${__hooks}/lib/po.js`); out = P.view(t, P.update(t, c, e.request.pathValue("id"), c.body), true); });
  return e.json(200, out);
});
// send | cancel | close | reopen (purchasing.manage); receive (also stock.receive)
routerAdd("POST", "/api/chedam/purchase-orders/{id}/{action}", (e) => {
  const action = e.request.pathValue("action");
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, action === "receive" ? "purchasing.manage|stock.receive" : "purchasing.manage");
  const P = require(`${__hooks}/lib/po.js`);
  let out = null;
  e.app.runInTransaction((t) => {
    if (action === "receive") { const r = P.receive(t, c, e.request.pathValue("id"), c.body); out = Object.assign(P.view(t, r.po, c.showCost), { duplicate: r.duplicate }); }
    else out = P.view(t, P.act(t, c, e.request.pathValue("id"), action), c.showCost);
  });
  return e.json(200, out);
});

// ---- Receiving from a bill photo (P3 step 5). Logic: lib/billscan.js --------------------------------------
// {vendor, lines: [{raw, code, description, qty, unit_cents, total_cents}]} (read in the browser)
routerAdd("POST", "/api/chedam/bill-scan/match", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "stock.receive|purchasing.manage");
  return e.json(200, require(`${__hooks}/lib/billscan.js`).match(e.app, c.body.vendor, c.body.lines));
});
// {vendor, po, op_id, close, lines: [{product, selling_unit, qty, cost_cents, expiry_date, raw_code, raw_description}], landed, bill: {make, party_ref, doc_date, taxes}}
routerAdd("POST", "/api/chedam/bill-scan/confirm", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "stock.receive|purchasing.manage");
  if (c.body.bill && c.body.bill.make && !c.can("finance.manage") && !c.can("purchasing.manage")) throw new ForbiddenError("Only purchasing managers or the accountant record the bill.");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/billscan.js`).confirm(t, c, c.body); });
  return e.json(200, out);
});

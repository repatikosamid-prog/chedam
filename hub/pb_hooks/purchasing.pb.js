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

/// <reference path="../pb_data/types.d.ts" />
// Delivery-app orders (manual) and consignment (P3 step 9). Logic: lib/delivery.js.

// ?open=1
routerAdd("GET", "/api/chedam/delivery", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|sales.view");
  return e.json(200, require(`${__hooks}/lib/delivery.js`).list(e.app, { open: e.request.url.query().get("open") === "1" }));
});
// Accept an order: {platform, number, customer_name, notes, lines: [{product, selling_unit, qty, price_cents?}]}
routerAdd("POST", "/api/chedam/delivery", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  let out = null;
  e.app.runInTransaction((t) => { const D = require(`${__hooks}/lib/delivery.js`); out = D.view(D.accept(t, c, c.body)); });
  return e.json(200, out);
});
// Platform price of a selling unit: {platform, selling_unit, price_cents, available}
routerAdd("POST", "/api/chedam/delivery/prices", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "prices.edit|catalogue.edit");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/delivery.js`).setPrice(t, c, c.body); });
  return e.json(200, out);
});
// preparing | picked_up (a sale on this device's open till) | cancel
routerAdd("POST", "/api/chedam/delivery/{id}/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  let out = null;
  e.app.runInTransaction((t) => { const D = require(`${__hooks}/lib/delivery.js`); out = D.view(D.act(t, c, e.request.pathValue("id"), e.request.pathValue("action"))); });
  return e.json(200, out);
});
// Consignment: owed per vendor and product (not billed yet); bill a vendor
routerAdd("GET", "/api/chedam/consignment", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.view|finance.manage");
  return e.json(200, require(`${__hooks}/lib/delivery.js`).owed(e.app, e.request.url.query().get("vendor") || ""));
});
routerAdd("POST", "/api/chedam/consignment/{vendor}/bill", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage|purchasing.manage");
  let out = null;
  e.app.runInTransaction((t) => { const b = require(`${__hooks}/lib/delivery.js`).billVendor(t, c, e.request.pathValue("vendor")); out = require(`${__hooks}/lib/bills.js`).view(t, b); });
  return e.json(200, out);
});

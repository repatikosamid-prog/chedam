/// <reference path="../pb_data/types.d.ts" />
// Product variety (P3 step 8): variants, bundles, serial numbers. Logic: lib/variety.js.

// A parent's variants with stock and price
routerAdd("GET", "/api/chedam/products/{id}/variants", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, { items: require(`${__hooks}/lib/variety.js`).variantsOf(e.app, e.request.pathValue("id")) });
});
// Make the missing variants: {axes: {Size: [..], Colour: [..]}, price_cents}
routerAdd("POST", "/api/chedam/products/{id}/variants", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "catalogue.edit");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/variety.js`).makeVariants(t, c, e.request.pathValue("id"), c.body); });
  return e.json(200, out);
});
// How many of a bundle its components allow now
routerAdd("GET", "/api/chedam/products/{id}/bundle", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  const p = e.app.findRecordById("products", e.request.pathValue("id"));
  const V = require(`${__hooks}/lib/variety.js`);
  return e.json(200, { components: V.componentsOf(p), available: V.bundleAvailable(e.app, p) });
});
// Warranty lookup by serial / IMEI: ?q=
routerAdd("GET", "/api/chedam/warranty", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|sales.view|sales.return");
  return e.json(200, require(`${__hooks}/lib/variety.js`).warranty(e.app, e.request.url.query().get("q")));
});

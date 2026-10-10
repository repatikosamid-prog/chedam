/// <reference path="../pb_data/types.d.ts" />
// Layaway, special orders, quotes, house accounts (P3 step 7). Logic: lib/client_orders.js.

// Quotes past their date expire (hourly)
cronAdd("chedam_client_orders", "17 * * * *", () => {
  try { $app.runInTransaction((tx) => { require(`${__hooks}/lib/client_orders.js`).expireQuotes(tx); }); }
  catch (err) { console.log("client orders: " + err); }
});

// ?kind=layaway|special_order|quote&open=1
routerAdd("GET", "/api/chedam/client-orders", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|sales.view");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/client_orders.js`).list(e.app, { kind: q.get("kind"), open: q.get("open") === "1" }));
});
routerAdd("GET", "/api/chedam/house-accounts", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|sales.view|finance.manage");
  return e.json(200, require(`${__hooks}/lib/client_orders.js`).accounts(e.app));
});
routerAdd("GET", "/api/chedam/client-orders/{id}", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|sales.view");
  return e.json(200, require(`${__hooks}/lib/client_orders.js`).view(e.app, e.app.findRecordById("client_orders", e.request.pathValue("id"))));
});
// What the till rings up for it
routerAdd("GET", "/api/chedam/client-orders/{id}/till", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/client_orders.js`).toTill(e.app, e.request.pathValue("id")));
});
// {kind, party|customer|name+phone, lines, due_date, notes, deposit: {amount_cents, method, till}}
routerAdd("POST", "/api/chedam/client-orders", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  let out = null;
  e.app.runInTransaction((t) => { const O = require(`${__hooks}/lib/client_orders.js`); out = O.view(t, O.create(t, c, c.body)); });
  return e.json(200, out);
});
// pay | refund | ordered | ready | cancel | convert (also the accountant: a quote into an invoice)
routerAdd("POST", "/api/chedam/client-orders/{id}/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, e.request.pathValue("action") === "convert" ? "sales.sell|finance.manage" : "sales.sell");
  let out = null;
  e.app.runInTransaction((t) => { const O = require(`${__hooks}/lib/client_orders.js`); out = O.view(t, O.act(t, c, e.request.pathValue("id"), e.request.pathValue("action"), c.body)); });
  return e.json(200, out);
});

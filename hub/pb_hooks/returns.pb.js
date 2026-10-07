/// <reference path="../pb_data/types.d.ts" />
// Returns and exchanges (P1 step 6). Logic: lib/returns.js; return slip: lib/receipt_layout.js and
// lib/printing.js. A return (and its exchange sale) is one transaction (BR-10). Returns need the hub.

// Find the sale: ?number=S-000012 (or OFF-...), or ?date=YYYY-MM-DD&amount_cents=&last4=
routerAdd("GET", "/api/chedam/returns/find", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.return");
  const q = e.request.url.query();
  return e.json(200, { sales: require(`${__hooks}/lib/returns.js`).find(e.app, {
    number: q.get("number"), date: q.get("date"), amount_cents: q.get("amount_cents"), last4: q.get("last4") }) });
});

// A sale with what can still come back per line, its policy and what went back to the card.
routerAdd("GET", "/api/chedam/returns/sale/{id}", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.return");
  return e.json(200, require(`${__hooks}/lib/returns.js`).returnable(e.app, e.request.pathValue("id")));
});

// The refund for the chosen items, and what needs a manager's PIN. Nothing is saved.
routerAdd("POST", "/api/chedam/returns/quote", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.return");
  const r = require(`${__hooks}/lib/returns.js`);
  return e.json(200, r.quoteView(r.build(e.app, c.body, c.user), false));
});

// Record a return: {id, sale?, lines, reason, restocking_fee, refunds, approval, exchange?}
routerAdd("POST", "/api/chedam/returns", (e) => {
  const h = require(`${__hooks}/lib/sales_http.js`);
  const c = h.ctx(e, "sales.return");
  if (c.body.exchange && !c.can("sales.sell")) throw new ForbiddenError("You cannot sell, so you cannot exchange.");
  return h.run(e, (tx) => require(`${__hooks}/lib/returns.js`).complete(tx, c.body, c));
});

// Recent returns (this device's open till first when ?till= is given).
routerAdd("GET", "/api/chedam/returns", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.return|sales.view");
  const till = e.request.url.query().get("till");
  const rows = till ? e.app.findRecordsByFilter("returns", "till = {:t}", "-completed_at", 50, 0, { t: till })
    : e.app.findRecordsByFilter("returns", "id != ''", "-completed_at", 50, 0);
  const r = require(`${__hooks}/lib/returns.js`);
  return e.json(200, { returns: rows.map((x) => { const v = r.view(e.app, x.id, c.showCost); delete v.business; return v; }) });
});

routerAdd("GET", "/api/chedam/returns/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.return|sales.view");
  try { e.app.findRecordById("returns", e.request.pathValue("id")); } catch (_) { throw new NotFoundError("Unknown return."); }
  return e.json(200, require(`${__hooks}/lib/returns.js`).view(e.app, e.request.pathValue("id"), c.showCost));
});

// Print (or reprint) the return slip. Body: {reprint, kick}
routerAdd("POST", "/api/chedam/returns/{id}/print", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.return");
  return e.json(200, require(`${__hooks}/lib/printing.js`).printReturn(e.app, e.request.pathValue("id"), c.body, c));
});

// A store credit's balance, before the till takes it as payment.
routerAdd("GET", "/api/chedam/store-credits/{code}", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/returns.js`).credit(e.app, e.request.pathValue("code")));
});

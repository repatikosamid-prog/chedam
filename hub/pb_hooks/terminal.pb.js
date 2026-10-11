/// <reference path="../pb_data/types.d.ts" />
// Linked card payments at the till (P5 step 2). Logic: lib/terminal.js. sales.sell; the unused paid checkouts
// list is for managers (sales.view).

routerAdd("POST", "/api/chedam/terminal/checkouts", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/terminal.js`).start(e.app, c, c.body));
});
routerAdd("GET", "/api/chedam/terminal/checkouts", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|sales.view");
  const sale = e.request.url.query().get("sale");
  const t = require(`${__hooks}/lib/terminal.js`);
  if (sale) return e.json(200, { items: t.unused(e.app, sale) });
  if (!c.can("sales.view")) throw new ForbiddenError("You do not have permission for this.");
  return e.json(200, { items: t.orphans(e.app) });
});
routerAdd("GET", "/api/chedam/terminal/checkouts/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/terminal.js`).poll(e.app, c, e.request.pathValue("id")));
});
routerAdd("POST", "/api/chedam/terminal/checkouts/{id}/cancel", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/terminal.js`).cancel(e.app, c, e.request.pathValue("id")));
});

// ---- P5 step 3: refunds through the processor, fees and payouts. Logic: lib/procrefunds.js ----------------

// The processor's fee per linked payment and its payouts (hourly, when connected and online)
cronAdd("chedam_payproc_fees", "41 * * * *", () => {
  try { require(`${__hooks}/lib/procrefunds.js`).syncFees($app); } catch (err) { console.log("payproc fees: " + err); }
});
// {sale, ref, purpose: return|void, amount_cents}: returns go with sales.return, voids with sales.sell (the void
// itself still needs sales.void or a manager's approval)
routerAdd("POST", "/api/chedam/terminal/refunds", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.return|sales.sell");
  return e.json(200, require(`${__hooks}/lib/procrefunds.js`).start(e.app, c, c.body));
});
routerAdd("GET", "/api/chedam/terminal/refunds", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.return|sales.sell");
  return e.json(200, { items: require(`${__hooks}/lib/procrefunds.js`).unused(e.app, e.request.url.query().get("ref")) });
});
routerAdd("GET", "/api/chedam/terminal/refunds/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.return|sales.sell");
  return e.json(200, require(`${__hooks}/lib/procrefunds.js`).poll(e.app, c, e.request.pathValue("id")));
});
// A paid checkout that no sale took: the whole amount back to the card (managers)
routerAdd("POST", "/api/chedam/terminal/checkouts/{id}/refund", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.void");
  return e.json(200, require(`${__hooks}/lib/procrefunds.js`).refundUnused(e.app, c, e.request.pathValue("id")));
});
routerAdd("GET", "/api/chedam/payproc/payouts", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage|payments.connect");
  return e.json(200, { items: require(`${__hooks}/lib/procrefunds.js`).payoutList(e.app) });
});
routerAdd("POST", "/api/chedam/payproc/sync", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage|payments.connect");
  const p = require(`${__hooks}/lib/procrefunds.js`);
  return e.json(200, Object.assign(p.syncFees(e.app, true), { items: p.payoutList(e.app) }));
});

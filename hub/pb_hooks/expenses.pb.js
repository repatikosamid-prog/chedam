/// <reference path="../pb_data/types.d.ts" />
// Expenses and petty cash (P3 step 6). Logic: lib/expenses.js.

// ?who=mine&status=submitted|approved|rejected|reimbursed
routerAdd("GET", "/api/chedam/expenses", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/expenses.js`).list(e.app, c, { who: q.get("who"), status: q.get("status") }));
});
// A claim (JSON, or a form with "data" = JSON and "receipts" files)
routerAdd("POST", "/api/chedam/expenses", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let b = c.body;
  if (typeof b.data === "string") { try { b = JSON.parse(b.data); } catch (_) { throw new BadRequestError("Unreadable claim."); } }
  let files = [];
  try { files = e.findUploadedFiles("receipts") || []; } catch (_) { files = []; }
  let out = null;
  e.app.runInTransaction((t) => { const X = require(`${__hooks}/lib/expenses.js`); out = X.view(t, X.submit(t, c, b, files)); });
  return e.json(200, out);
});
// Add receipt photos (a form with "receipts")
routerAdd("POST", "/api/chedam/expenses/{id}/receipts", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let files = [];
  try { files = e.findUploadedFiles("receipts") || []; } catch (_) { files = []; }
  let out = null;
  e.app.runInTransaction((t) => { const X = require(`${__hooks}/lib/expenses.js`); out = X.view(t, X.addReceipts(t, c, e.request.pathValue("id"), files)); });
  return e.json(200, out);
});
// approve | reject {reason} | reimburse {with, reference, till}
routerAdd("POST", "/api/chedam/expenses/{id}/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "expenses.approve");
  let out = null;
  e.app.runInTransaction((t) => { const X = require(`${__hooks}/lib/expenses.js`); out = X.view(t, X.decide(t, c, e.request.pathValue("id"), e.request.pathValue("action"), c.body)); });
  return e.json(200, out);
});
// Petty cash: the box's balance and moves; top_up {amount_cents, note} | count {counted_cents, note}
routerAdd("GET", "/api/chedam/petty-cash", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "expenses.approve");
  return e.json(200, require(`${__hooks}/lib/expenses.js`).pettyView(e.app));
});
routerAdd("POST", "/api/chedam/petty-cash/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "expenses.approve");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/expenses.js`).pettyAct(t, c, e.request.pathValue("action"), c.body); });
  return e.json(200, out);
});

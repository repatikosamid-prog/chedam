/// <reference path="../pb_data/types.d.ts" />
// Bills, invoices, payments, statements, vendor returns (P3 step 4). Logic: lib/bills.js.

// ?side=payable|receivable&status=open&party=<id>
routerAdd("GET", "/api/chedam/bills", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage|purchasing.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/bills.js`).list(e.app, { side: q.get("side"), status: q.get("status"), party: q.get("party") }));
});
routerAdd("GET", "/api/chedam/bills/{id}", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage|purchasing.manage");
  return e.json(200, require(`${__hooks}/lib/bills.js`).view(e.app, e.app.findRecordById("bills", e.request.pathValue("id"))));
});
// New document (JSON or a form with "attachment" files and "data" = JSON): {kind, party, party_ref, po, doc_date, due_date, lines, taxes, notes}
routerAdd("POST", "/api/chedam/bills", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage|purchasing.manage");
  let b = c.body;
  if (typeof b.data === "string") { try { b = JSON.parse(b.data); } catch (_) { throw new BadRequestError("Unreadable document."); } }
  const kind = b.kind || "bill";
  if ((kind === "invoice" || kind === "client_credit") && !c.can("finance.manage")) throw new ForbiddenError("You do not have permission for this.");
  let files = [];
  try { files = e.findUploadedFiles("attachment") || []; } catch (_) { files = []; }
  let out = null;
  e.app.runInTransaction((t) => { const B = require(`${__hooks}/lib/bills.js`); out = B.view(t, B.create(t, c, b, files)); });
  return e.json(200, out);
});
// A bill from a received purchase order: {party_ref, doc_date, taxes, notes}
routerAdd("POST", "/api/chedam/bills/from-po/{po}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage|purchasing.manage");
  let out = null;
  e.app.runInTransaction((t) => { const B = require(`${__hooks}/lib/bills.js`); out = B.view(t, B.fromPO(t, c, e.request.pathValue("po"), c.body)); });
  return e.json(200, out);
});
// pay {day, amount_cents, method, reference, credit_doc} | void {reason}
routerAdd("POST", "/api/chedam/bills/{id}/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage");
  const B = require(`${__hooks}/lib/bills.js`);
  const action = e.request.pathValue("action");
  if (action !== "pay" && action !== "void") throw new NotFoundError("Unknown action.");
  let out = null;
  e.app.runInTransaction((t) => { out = B.view(t, action === "pay" ? B.pay(t, c, e.request.pathValue("id"), c.body) : B.voidDoc(t, c, e.request.pathValue("id"), c.body.reason)); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/bill-payments/{id}/void", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage");
  let out = null;
  e.app.runInTransaction((t) => { const B = require(`${__hooks}/lib/bills.js`); out = B.view(t, B.voidPayment(t, c, e.request.pathValue("id"))); });
  return e.json(200, out);
});
// Statement of account: ?from&to
routerAdd("GET", "/api/chedam/parties/{id}/statement", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage|purchasing.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/bills.js`).statement(e.app, e.request.pathValue("id"), { from: q.get("from"), to: q.get("to") }));
});

// Vendor returns (FR-8.05)
routerAdd("GET", "/api/chedam/vendor-returns", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.view|purchasing.manage|finance.manage");
  const B = require(`${__hooks}/lib/bills.js`);
  return e.json(200, { items: e.app.findRecordsByFilter("vendor_returns", "deleted_at = ''", "-created_at", 200, 0).map((r) => B.vrView(e.app, r)) });
});
// {vendor, po, reason, rma, lines: [{product, selling_unit, qty, reason}]}: the stock goes out now
routerAdd("POST", "/api/chedam/vendor-returns", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.manage");
  let out = null;
  e.app.runInTransaction((t) => { const B = require(`${__hooks}/lib/bills.js`); out = B.vrView(t, B.vendorReturn(t, c, c.body)); });
  return e.json(200, out);
});
// The vendor's credit: {amount_cents, party_ref, doc_date, taxes, notes}
routerAdd("POST", "/api/chedam/vendor-returns/{id}/credit", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.manage|finance.manage");
  let out = null;
  e.app.runInTransaction((t) => { const B = require(`${__hooks}/lib/bills.js`); out = B.vrView(t, B.creditReturn(t, c, e.request.pathValue("id"), c.body)); });
  return e.json(200, out);
});
// Vendor performance (FR-8.06)
routerAdd("GET", "/api/chedam/vendors/performance", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "purchasing.view|purchasing.manage");
  return e.json(200, require(`${__hooks}/lib/bills.js`).performance(e.app));
});

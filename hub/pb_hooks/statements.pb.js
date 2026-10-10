/// <reference path="../pb_data/types.d.ts" />
// Financial statements and tax returns (P4 step 9). Logic: lib/statements.js. books.manage.

routerAdd("GET", "/api/chedam/statements/{which}", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "books.manage");
  const S = require(`${__hooks}/lib/statements.js`);
  const q = e.request.url.query(), w = e.request.pathValue("which");
  const p = { from: q.get("from"), to: q.get("to"), compare: q.get("compare") === "1", instalments_cents: q.get("instalments_cents"), self_assessed_cents: q.get("self_assessed_cents") };
  const out = w === "pnl" ? S.pnl(e.app, p) : w === "balance" ? S.balanceSheet(e.app, p) : w === "cashflow" ? S.cashFlow(e.app, p) : w === "gst" ? S.gst(e.app, p) : w === "pst" ? S.pst(e.app, p) : null;
  if (!out) throw new NotFoundError("Unknown statement.");
  return e.json(200, out);
});
routerAdd("GET", "/api/chedam/tax-returns", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "books.manage");
  return e.json(200, require(`${__hooks}/lib/statements.js`).returns(e.app));
});
// Record a filed return: {kind, from, to, instalments_cents | self_assessed_cents, filed_on, confirmation, paid_on, note}
routerAdd("POST", "/api/chedam/tax-returns", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "books.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/statements.js`).file(t, c, c.body); });
  return e.json(200, out);
});

/// <reference path="../pb_data/types.d.ts" />
// The books and period close (P4 step 8). Logic: lib/books.js. books.manage; reopening: the owner.

// BR-34: records dated in a closed month cannot be added or changed (lib/books.js LOCK)
onRecordCreate((e) => {
  require(`${__hooks}/lib/books.js`).guard(e.app, e.record, true);
  e.next();
}, "bills", "bill_payments", "expenses", "payroll_runs", "bank_lines", "bank_deposits", "platform_payouts");
onRecordUpdate((e) => {
  require(`${__hooks}/lib/books.js`).guard(e.app, e.record, false);
  e.next();
}, "bills", "bill_payments", "expenses", "payroll_runs", "bank_lines", "bank_deposits", "platform_payouts");

routerAdd("GET", "/api/chedam/books/accounts", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "books.manage");
  e.app.runInTransaction((t) => { require(`${__hooks}/lib/books.js`).ensureAccounts(t); });
  return e.json(200, { items: require(`${__hooks}/lib/books.js`).chart(e.app) });
});
// Rename or map: {name, code, external_code, note}
routerAdd("POST", "/api/chedam/books/accounts/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "books.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/books.js`).saveAccount(t, c, e.request.pathValue("id"), c.body); });
  return e.json(200, out);
});
routerAdd("GET", "/api/chedam/books/journal", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "books.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/books.js`).entries(e.app, { from: q.get("from"), to: q.get("to"), account: q.get("account") }));
});
routerAdd("GET", "/api/chedam/books/trial", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "books.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/books.js`).trial(e.app, { from: q.get("from"), to: q.get("to") }));
});
routerAdd("GET", "/api/chedam/books/periods", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "books.manage");
  return e.json(200, require(`${__hooks}/lib/books.js`).periods(e.app));
});
routerAdd("GET", "/api/chedam/books/periods/{month}/checks", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "books.manage");
  return e.json(200, { warnings: require(`${__hooks}/lib/books.js`).checks(e.app, e.request.pathValue("month")) });
});
// close {month, confirm} | reopen {month, reason} (owner)
routerAdd("POST", "/api/chedam/books/periods/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "books.manage");
  const a = e.request.pathValue("action");
  if (a !== "close" && a !== "reopen") throw new NotFoundError("Unknown.");
  let out = null;
  e.app.runInTransaction((t) => { const B = require(`${__hooks}/lib/books.js`); out = a === "close" ? B.close(t, c, c.body) : B.reopen(t, c, c.body); });
  return e.json(200, out);
});

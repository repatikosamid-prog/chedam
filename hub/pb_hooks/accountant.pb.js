/// <reference path="../pb_data/types.d.ts" />
// Accountant exports (P4 step 10). Logic: lib/exports.js. books.manage.
// ?kind=journal|sales|payroll|expenses|bank&from=&to=&format=quickbooks|xero&dates=iso|dmy|mdy → {filename, rows, csv}
routerAdd("GET", "/api/chedam/exports/accountant", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "books.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/exports.js`).make(e.app, { kind: q.get("kind"), from: q.get("from"), to: q.get("to"), format: q.get("format"), dates: q.get("dates") }));
});

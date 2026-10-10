/// <reference path="../pb_data/types.d.ts" />
// Bank (P4 step 6). Logic: lib/bank.js. bank.manage throughout.

routerAdd("GET", "/api/chedam/bank", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "bank.manage");
  return e.json(200, require(`${__hooks}/lib/bank.js`).summary(e.app));
});
routerAdd("GET", "/api/chedam/bank/lines", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "bank.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/bank.js`).lines(e.app, { account: q.get("account"), status: q.get("status"), from: q.get("from"), to: q.get("to") }));
});
routerAdd("GET", "/api/chedam/bank/lines/{id}/candidates", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "bank.manage");
  const B = require(`${__hooks}/lib/bank.js`);
  return e.json(200, { items: B.candidates(e.app, e.app.findRecordById("bank_lines", e.request.pathValue("id"))) });
});
routerAdd("GET", "/api/chedam/bank/tills", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "bank.manage");
  return e.json(200, require(`${__hooks}/lib/bank.js`).tillsToDeposit(e.app));
});
// POST: accounts {id?, ...} | import {account, filename, text, date_format} | auto | deposits {...} | reconcile {...}
routerAdd("POST", "/api/chedam/bank/{what}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "bank.manage");
  const what = e.request.pathValue("what");
  if (["accounts", "import", "auto", "deposits", "reconcile"].indexOf(what) < 0) throw new NotFoundError("Unknown.");
  let out = null;
  e.app.runInTransaction((t) => {
    const B = require(`${__hooks}/lib/bank.js`);
    out = what === "accounts" ? B.saveAccount(t, c, c.body) : what === "import" ? B.importFile(t, c, c.body) : what === "auto" ? B.auto(t, c) : what === "deposits" ? B.deposit(t, c, c.body) : B.reconcile(t, c, c.body);
  });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/bank/deposits/{id}/cancel", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "bank.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/bank.js`).cancelDeposit(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});
// match {kind, refs | category | note} | unmatch
routerAdd("POST", "/api/chedam/bank/lines/{id}/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "bank.manage");
  const a = e.request.pathValue("action");
  if (a !== "match" && a !== "unmatch") throw new NotFoundError("Unknown.");
  let out = null;
  e.app.runInTransaction((t) => { const B = require(`${__hooks}/lib/bank.js`); out = a === "match" ? B.match(t, c, e.request.pathValue("id"), c.body) : B.unmatch(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});

/// <reference path="../pb_data/types.d.ts" />
// Card fees, platform payouts, vendor statements (P4 step 7). Logic: lib/recon.js. finance.manage.

routerAdd("GET", "/api/chedam/card-fees", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/recon.js`).cardFees(e.app, { from: q.get("from"), to: q.get("to") }));
});
routerAdd("GET", "/api/chedam/payouts", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage");
  return e.json(200, require(`${__hooks}/lib/recon.js`).payouts(e.app, { platform: e.request.url.query().get("platform") }));
});
routerAdd("POST", "/api/chedam/payouts", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/recon.js`).savePayout(t, c, c.body); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/payouts/{id}/cancel", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/recon.js`).cancelPayout(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});
routerAdd("GET", "/api/chedam/vendor-statements", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage");
  return e.json(200, require(`${__hooks}/lib/recon.js`).statements(e.app, { party: e.request.url.query().get("party") }));
});
routerAdd("POST", "/api/chedam/vendor-statements", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "finance.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/recon.js`).vendorStatement(t, c, c.body); });
  return e.json(200, out);
});

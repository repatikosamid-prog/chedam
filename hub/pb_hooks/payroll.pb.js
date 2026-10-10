/// <reference path="../pb_data/types.d.ts" />
// Payroll preparation (P4 step 5). Logic: lib/payroll.js.

routerAdd("GET", "/api/chedam/payroll", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payroll.manage");
  return e.json(200, require(`${__hooks}/lib/payroll.js`).list(e.app, c));
});
// A new run: {period (any day in it), pay_date, note}
routerAdd("POST", "/api/chedam/payroll", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payroll.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/payroll.js`).create(t, c, c.body); });
  return e.json(200, out);
});
routerAdd("GET", "/api/chedam/payroll/t4", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "payroll.manage");
  return e.json(200, require(`${__hooks}/lib/payroll.js`).t4(e.app, e.request.url.query().get("year")));
});
routerAdd("GET", "/api/chedam/payroll/roe/{employee}", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "payroll.manage");
  return e.json(200, require(`${__hooks}/lib/payroll.js`).roe(e.app, e.request.pathValue("employee")));
});
routerAdd("GET", "/api/chedam/payroll/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payroll.manage");
  return e.json(200, require(`${__hooks}/lib/payroll.js`).get(e.app, c, e.request.pathValue("id")));
});
// Entered amounts on a line: {stat_cents, other_earnings_cents, cpp_cents, cpp2_cents, ei_cents, tax_cents, other_deductions_cents, note}
routerAdd("POST", "/api/chedam/payroll/{id}/lines/{line}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payroll.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/payroll.js`).updateLine(t, c, e.request.pathValue("id"), e.request.pathValue("line"), c.body); });
  return e.json(200, out);
});
// finalize | paid {method, reference, day} | cancel
routerAdd("POST", "/api/chedam/payroll/{id}/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payroll.manage");
  const P = require(`${__hooks}/lib/payroll.js`);
  const a = e.request.pathValue("action"), id = e.request.pathValue("id");
  if (["finalize", "paid", "cancel"].indexOf(a) < 0) throw new BadRequestError("Finalize, paid or cancel.");
  let out = null;
  e.app.runInTransaction((t) => { const L = require(`${__hooks}/lib/payroll.js`); out = a === "finalize" ? L.finalize(t, c, id) : a === "paid" ? L.paid(t, c, id, c.body) : L.cancel(t, c, id); });
  return e.json(200, out);
});
// My pay stubs
routerAdd("GET", "/api/chedam/me/paystubs", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  if (!c.user) throw new BadRequestError("Sign in as a person.");
  return e.json(200, require(`${__hooks}/lib/payroll.js`).stubs(e.app, c.user.id));
});

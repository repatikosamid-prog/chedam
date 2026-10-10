/// <reference path="../pb_data/types.d.ts" />
// Employees and leave (P4 step 1). Logic: lib/hr.js.

// Monthly leave accruals and the yearly sick grant (daily at 02:10, once per month / year)
cronAdd("chedam_hr_accrue", "10 2 * * *", () => {
  try { $app.runInTransaction((tx) => { require(`${__hooks}/lib/hr.js`).accrue(tx); }); }
  catch (err) { console.log("hr accrue: " + err); }
});

routerAdd("GET", "/api/chedam/employees", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/hr.js`).list(e.app, c));
});
routerAdd("GET", "/api/chedam/me/employee", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, { employee: require(`${__hooks}/lib/hr.js`).mine(e.app, c) });
});
routerAdd("GET", "/api/chedam/employees/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/hr.js`).get(e.app, c, e.request.pathValue("id")));
});
routerAdd("GET", "/api/chedam/employees/{id}/leave", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/hr.js`).history(e.app, c, e.request.pathValue("id")));
});
// Create or change (owner): JSON, or a form with "data" = JSON and "documents" files
routerAdd("POST", "/api/chedam/employees", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "hr.manage");
  let b = c.body;
  if (typeof b.data === "string") { try { b = JSON.parse(b.data); } catch (_) { throw new BadRequestError("Unreadable record."); } }
  let files = [];
  try { files = e.findUploadedFiles("documents") || []; } catch (_) { files = []; }
  let out = null;
  e.app.runInTransaction((t) => { const H = require(`${__hooks}/lib/hr.js`); out = H.get(t, c, H.save(t, c, b, files).id); });
  return e.json(200, out);
});
// The owner sees the full SIN (logged)
routerAdd("POST", "/api/chedam/employees/{id}/sin", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "hr.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/hr.js`).revealSin(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});
// Leave taken or adjusted: {kind, hours, day, note, source: taken|adjust} (hr.manage; managers record time taken)
routerAdd("POST", "/api/chedam/employees/{id}/leave", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "hr.manage|hr.view");
  if (c.body.source === "adjust" && !c.can("hr.manage")) throw new ForbiddenError("Only the owner adjusts leave balances.");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/hr.js`).leave(t, c, e.request.pathValue("id"), c.body); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/hr/accrue", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "hr.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/hr.js`).accrue(t, e.request.url.query().get("day") || ""); });
  return e.json(200, out);
});

/// <reference path="../pb_data/types.d.ts" />
// Time sheets (P4 step 4). Logic: lib/timesheets.js.

// Managers: the pay period (?period=any day in it) by person
routerAdd("GET", "/api/chedam/timesheets", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "timeclock.manage");
  return e.json(200, require(`${__hooks}/lib/timesheets.js`).list(e.app, c, { period: e.request.url.query().get("period") }));
});
routerAdd("GET", "/api/chedam/timesheets/{user}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "timeclock.manage");
  return e.json(200, require(`${__hooks}/lib/timesheets.js`).detail(e.app, c, e.request.pathValue("user"), { period: e.request.url.query().get("period") }));
});
// {user, period, note}
routerAdd("POST", "/api/chedam/timesheets/approve", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "timeclock.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/timesheets.js`).approve(t, c, c.body); });
  return e.json(200, out);
});
// {user, period, reason}
routerAdd("POST", "/api/chedam/timesheets/reopen", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "timeclock.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/timesheets.js`).reopen(t, c, c.body); });
  return e.json(200, out);
});
// My own time sheet
routerAdd("GET", "/api/chedam/me/timesheet", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/timesheets.js`).mine(e.app, c, { period: e.request.url.query().get("period") }));
});

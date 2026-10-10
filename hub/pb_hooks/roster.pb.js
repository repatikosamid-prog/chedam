/// <reference path="../pb_data/types.d.ts" />
// Roster (P4 step 3). Logic: lib/roster.js.

routerAdd("GET", "/api/chedam/roster", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/roster.js`).week(e.app, c, { week: e.request.url.query().get("week") }));
});
// Plan or change a shift: {id?, user, day, start, end, break_min, position, note}
routerAdd("POST", "/api/chedam/roster", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "roster.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/roster.js`).save(t, c, c.body); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/roster/copy", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "roster.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/roster.js`).copy(t, c, c.body); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/roster/publish", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "roster.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/roster.js`).publish(t, c, c.body); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/roster/{id}/remove", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "roster.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/roster.js`).remove(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});
// Offer your shift: {to_user?, note}
routerAdd("POST", "/api/chedam/roster/{id}/swap", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/roster.js`).offer(t, c, e.request.pathValue("id"), c.body); });
  return e.json(200, out);
});
// accept | cancel | approve | decline
routerAdd("POST", "/api/chedam/swaps/{id}/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/roster.js`).act(t, c, e.request.pathValue("id"), e.request.pathValue("action")); });
  return e.json(200, out);
});

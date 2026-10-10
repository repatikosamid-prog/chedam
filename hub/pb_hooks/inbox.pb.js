/// <reference path="../pb_data/types.d.ts" />
// Inbox, end-of-day report, email fallback (P2 step 10). Logic: lib/inbox.js.

// The end-of-day report after its time; unread items past their deadline (every 10 minutes)
cronAdd("chedam_inbox", "*/10 * * * *", () => {
  try { $app.runInTransaction((tx) => { require(`${__hooks}/lib/inbox.js`).jobs(tx); }); }
  catch (err) { console.log("inbox: " + err); }
});

// ?unread=1
routerAdd("GET", "/api/chedam/inbox", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/inbox.js`).list(e.app, c, { unread: e.request.url.query().get("unread") === "1" }));
});
routerAdd("POST", "/api/chedam/inbox/read-all", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/inbox.js`).readAll(t, c); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/inbox/{id}/read", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/inbox.js`).read(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});
routerAdd("GET", "/api/chedam/inbox/settings", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/inbox.js`).settings(e.app, c));
});
// {mine: [{kind, in_app, email}], eod: {enabled, time, recipients, email_by} (settings.manage)}
routerAdd("POST", "/api/chedam/inbox/settings", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/inbox.js`).saveSettings(t, c, c.body); });
  return e.json(200, out);
});
// Make the end-of-day report now (for ?day=YYYY-MM-DD, default today): sales.view
routerAdd("POST", "/api/chedam/inbox/eod", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.view");
  const q = e.request.url.query().get("day");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q || "") ? q : require(`${__hooks}/lib/stock.js`).today();
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/inbox.js`).eod(t, day, true); });
  return e.json(200, out);
});
// Run the jobs now (managers)
routerAdd("POST", "/api/chedam/inbox/jobs", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "settings.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/inbox.js`).jobs(t); });
  return e.json(200, out);
});

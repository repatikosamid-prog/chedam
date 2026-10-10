/// <reference path="../pb_data/types.d.ts" />
// Time clock (P4 step 2). Logic: lib/timeclock.js. Times are the hub's clock; `at` (a test hook to replay
// a time) is honoured only for a superuser on punches, and on read-only views.

// Alerts before a meal break is missed or overtime starts, and forgotten punch-outs (every 5 minutes)
cronAdd("chedam_clock_check", "*/5 * * * *", () => {
  try { $app.runInTransaction((tx) => { require(`${__hooks}/lib/timeclock.js`).check(tx); }); }
  catch (err) { console.log("clock check: " + err); }
});

// Punch on any paired device with the name and PIN (the device's sign-in does not change):
// {user, pin, action: in|break|back|out|status}
routerAdd("POST", "/api/chedam/clock", (e) => {
  const auth = require(`${__hooks}/lib/auth.js`);
  const devices = require(`${__hooks}/lib/devices.js`);
  const dev = devices.current(e);
  if (!dev) throw new ForbiddenError("Pair this device with the hub first.", { device: "required" });
  const body = e.requestInfo().body || {};
  let user = null;
  try { user = e.app.findRecordById("users", String(body.user || "")); } catch (_) { /* unknown */ }
  if (!user || !auth.canSignIn(user) || !user.getBool("pin_set")) throw new BadRequestError("Wrong name or PIN.");
  const until = auth.lockedUntil(user);
  if (until) throw auth.lockedError(until);
  if (!auth.checkSecret(user, "pin", String(body.pin || ""))) auth.failAndThrow(e.app, user, e, new BadRequestError("Wrong name or PIN."));
  auth.registerSuccess(e.app, user, e);
  const T = require(`${__hooks}/lib/timeclock.js`);
  const at = e.hasSuperuserAuth() ? T.ms(e.request.url.query().get("at")) : 0;
  if (body.action === "status") return e.json(200, Object.assign(T.status(e.app, user.id, at), { name: user.getString("name") }));
  const c = { actor: "users:" + user.id, device: dev.id, user: user, can: () => false, body: body };
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/timeclock.js`).punch(t, c, user, String(body.action || ""), dev.getString("name"), at); });
  return e.json(200, Object.assign(out, { name: user.getString("name") }));
});

// The signed-in person's own clock
routerAdd("GET", "/api/chedam/me/clock", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  if (!c.user) throw new BadRequestError("Sign in as a person.");
  const T = require(`${__hooks}/lib/timeclock.js`);
  return e.json(200, T.status(e.app, c.user.id, T.ms(e.request.url.query().get("at"))));
});
routerAdd("POST", "/api/chedam/me/clock", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  if (!c.user) throw new BadRequestError("Sign in as a person.");
  const T = require(`${__hooks}/lib/timeclock.js`);
  const at = e.hasSuperuserAuth() ? T.ms(e.request.url.query().get("at")) : 0;
  let dn = "";
  try { dn = c.device ? e.app.findRecordById("devices", c.device).getString("name") : ""; } catch (_) { dn = ""; }
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/timeclock.js`).punch(t, c, c.user, String(c.body.action || ""), dn, at); });
  return e.json(200, out);
});

// Who is on the clock now (any paired device)
routerAdd("GET", "/api/chedam/clock/who", (e) => {
  const dev = require(`${__hooks}/lib/devices.js`).current(e);
  if (!dev && !e.hasSuperuserAuth()) throw new ForbiddenError("Pair this device with the hub first.", { device: "required" });
  return e.json(200, require(`${__hooks}/lib/timeclock.js`).who(e.app));
});

// Managers: shifts (?from=&to=&user=), fix one, add a missed one, run the alert check (?at=)
routerAdd("GET", "/api/chedam/shifts", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "timeclock.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/timeclock.js`).list(e.app, c, { from: q.get("from"), to: q.get("to"), user: q.get("user") }));
});
routerAdd("POST", "/api/chedam/shifts", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "timeclock.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/timeclock.js`).add(t, c, c.body); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/shifts/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "timeclock.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/timeclock.js`).edit(t, c, e.request.pathValue("id"), c.body); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/clock/check", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "timeclock.manage");
  const T = require(`${__hooks}/lib/timeclock.js`);
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/timeclock.js`).check(t, T.ms(e.request.url.query().get("at"))); });
  return e.json(200, out);
});

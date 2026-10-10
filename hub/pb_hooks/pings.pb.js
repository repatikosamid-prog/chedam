/// <reference path="../pb_data/types.d.ts" />
// Pings and the till overlay (P2 step 9). Logic: lib/pings.js. The app hears new pings through realtime.

// Urgent pings not confirmed in time go to the managers too (BR-42)
cronAdd("chedam_pings", "* * * * *", () => {
  try { $app.runInTransaction((tx) => { require(`${__hooks}/lib/pings.js`).escalate(tx); }); }
  catch (err) { console.log("pings: " + err); }
});

routerAdd("GET", "/api/chedam/pings/targets", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/pings.js`).targets(e.app, c));
});
routerAdd("GET", "/api/chedam/pings", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/pings.js`).mine(e.app, c));
});
// {target: device:<id> | till | phone | back_office | everyone, text, urgent}
routerAdd("POST", "/api/chedam/pings", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/pings.js`).send(t, c, c.body); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/pings/escalate", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "tasks.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/pings.js`).escalate(t); });
  return e.json(200, out);
});
// ack {reply} | withdraw
routerAdd("POST", "/api/chedam/pings/{id}/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  const P = require(`${__hooks}/lib/pings.js`);
  const action = e.request.pathValue("action");
  if (action !== "ack" && action !== "withdraw") throw new NotFoundError("Unknown ping action.");
  let out = null;
  e.app.runInTransaction((t) => { out = action === "ack" ? P.ack(t, c, e.request.pathValue("id"), c.body.reply) : P.withdraw(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});

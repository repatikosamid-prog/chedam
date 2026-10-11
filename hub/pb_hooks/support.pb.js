/// <reference path="../pb_data/types.d.ts" />
// Remote support session (P5 step 8). Logic: lib/support.js; privileged work: /opt/chedam/bin/chedam-support.
// support.manage (the owner).

cronAdd("chedam_support", "* * * * *", () => {
  try { require(`${__hooks}/lib/support.js`).expire($app); } catch (err) { console.log("support: " + err); }
});
routerAdd("GET", "/api/chedam/support", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "support.manage");
  return e.json(200, require(`${__hooks}/lib/support.js`).status(e.app, e.request.url.query().get("refresh") === "1"));
});
routerAdd("POST", "/api/chedam/support/keys", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "support.manage");
  return e.json(200, require(`${__hooks}/lib/support.js`).setKeys(e.app, c, c.body));
});
routerAdd("POST", "/api/chedam/support/start", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "support.manage");
  return e.json(200, require(`${__hooks}/lib/support.js`).start(e.app, c, c.body));
});
routerAdd("POST", "/api/chedam/support/stop", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "support.manage");
  return e.json(200, require(`${__hooks}/lib/support.js`).stop(e.app, c));
});

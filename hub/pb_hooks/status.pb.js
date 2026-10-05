/// <reference path="../pb_data/types.d.ts" />
// Connectivity status (FR-12.01). Logic: lib/net.js.

cronAdd("chedam_connectivity", "* * * * *", () => {
  require(`${__hooks}/lib/net.js`).check($app);
});

// The connectivity bar asks this every 30 s. Open to any device on the LAN (no personal data):
// internet = offline | router | hotspot, plus the hub clock for the time check.
routerAdd("GET", "/api/chedam/status", (e) => {
  const net = require(`${__hooks}/lib/net.js`);
  if (e.hasSuperuserAuth() && e.request.url.query().get("check") === "1") net.check(e.app);   // tests, health page
  return e.json(200, net.status(e.app));
});

/// <reference path="../pb_data/types.d.ts" />
// The owner's cloud drive (P5 step 4). Logic: lib/cloud.js. cloud.connect (the owner).

// The off-site backup copy: what the backup helper left in the outbox goes up (outbound only)
cronAdd("chedam_cloud_upload", "*/5 * * * *", () => {
  try { require(`${__hooks}/lib/cloud.js`).uploadOutbox($app); } catch (err) { console.log("cloud upload: " + err); }
});
routerAdd("GET", "/api/chedam/cloud", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "cloud.connect");
  return e.json(200, require(`${__hooks}/lib/cloud.js`).status(e.app));
});
routerAdd("POST", "/api/chedam/cloud/app", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "cloud.connect");
  return e.json(200, require(`${__hooks}/lib/cloud.js`).setApp(e.app, c, c.body));
});
routerAdd("POST", "/api/chedam/cloud/connect", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "cloud.connect");
  return e.json(200, require(`${__hooks}/lib/cloud.js`).connectStart(e.app, c, c.body));
});
routerAdd("POST", "/api/chedam/cloud/poll", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "cloud.connect");
  return e.json(200, require(`${__hooks}/lib/cloud.js`).connectPoll(e.app, c, c.body));
});
routerAdd("POST", "/api/chedam/cloud/disconnect", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "cloud.connect");
  return e.json(200, require(`${__hooks}/lib/cloud.js`).disconnect(e.app, c));
});
routerAdd("POST", "/api/chedam/cloud/upload-now", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "cloud.connect");
  const cl = require(`${__hooks}/lib/cloud.js`);
  return e.json(200, Object.assign(cl.uploadOutbox(e.app), { status: cl.status(e.app) }));
});

// ---- P5 step 5: the owner's remote view. Logic: lib/remote.js ------------------------------------------------
cronAdd("chedam_remote_view", "* * * * *", () => {
  try { require(`${__hooks}/lib/remote.js`).publish($app); } catch (err) { console.log("remote view: " + err); }
});
routerAdd("GET", "/api/chedam/remote", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "cloud.connect");
  const r = require(`${__hooks}/lib/remote.js`);
  return e.json(200, Object.assign(r.status(e.app), { summary: r.summary(e.app) }));
});
routerAdd("POST", "/api/chedam/remote/publish", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "cloud.connect");
  const r = require(`${__hooks}/lib/remote.js`);
  return e.json(200, Object.assign(r.publish(e.app, true), { status: r.status(e.app) }));
});
// This device gets the key and a read-only way to the summary (owner, at the store). Never logged.
routerAdd("POST", "/api/chedam/remote/enrol", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "cloud.connect");
  return e.json(200, require(`${__hooks}/lib/remote.js`).enrol(e.app));
});
routerAdd("POST", "/api/chedam/remote/forget", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "cloud.connect");
  return e.json(200, require(`${__hooks}/lib/remote.js`).forget(e.app));
});

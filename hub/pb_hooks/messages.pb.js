/// <reference path="../pb_data/types.d.ts" />
// Messages and announcements (P2 step 8). Logic: lib/messages.js. New messages reach the app through
// PocketBase realtime ("messages", "announcements"); these endpoints do every change.

routerAdd("GET", "/api/chedam/messages/channels", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/messages.js`).channels(e.app, c));
});
routerAdd("POST", "/api/chedam/messages/channels", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/messages.js`).createChannel(t, c, c.body); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/messages/channels/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/messages.js`).editChannel(t, c, e.request.pathValue("id"), c.body); });
  return e.json(200, out);
});
// ?before=<created_at>
routerAdd("GET", "/api/chedam/messages/channels/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/messages.js`).list(e.app, c, e.request.pathValue("id"), e.request.url.query().get("before")));
});
routerAdd("POST", "/api/chedam/messages/channels/{id}/read", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/messages.js`).markRead(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});
routerAdd("GET", "/api/chedam/messages/unread", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  const M = require(`${__hooks}/lib/messages.js`);
  const inbox = c.user ? e.app.countRecords("inbox_items", $dbx.exp("user = {:u} AND read_at = '' AND deleted_at = ''", { u: c.user.id })) : 0;
  return e.json(200, Object.assign(M.unread(e.app, c), { to_ack: M.toAck(e.app, c), inbox: inbox }));
});
// Send: JSON or a form with one file "attachment": {channel, text, mentions, link_collection, link_id}
routerAdd("POST", "/api/chedam/messages", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  let files = [];
  try { files = e.findUploadedFiles("attachment") || []; } catch (_) { files = []; }
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/messages.js`).send(t, c, c.body, files); });
  return e.json(200, out);
});
// react {emoji} | remove
routerAdd("POST", "/api/chedam/messages/{id}/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  const M = require(`${__hooks}/lib/messages.js`);
  const action = e.request.pathValue("action");
  if (action !== "react" && action !== "remove") throw new NotFoundError("Unknown message action.");
  let out = null;
  e.app.runInTransaction((t) => { out = action === "react" ? M.react(t, c, e.request.pathValue("id"), String(c.body.emoji || "")) : M.remove(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});

// Announcements (FR-2.05): ?all=1 (managers) includes ended ones
routerAdd("GET", "/api/chedam/announcements", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/messages.js`).announcements(e.app, c, e.request.url.query().get("all") === "1"));
});
routerAdd("POST", "/api/chedam/announcements", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "announcements.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/messages.js`).postAnn(t, c, c.body); });
  return e.json(200, out);
});
// ack (anyone) | end (managers)
routerAdd("POST", "/api/chedam/announcements/{id}/{action}", (e) => {
  const action = e.request.pathValue("action");
  if (action !== "ack" && action !== "end") throw new NotFoundError("Unknown announcement action.");
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, action === "end" ? "announcements.manage" : "");
  const M = require(`${__hooks}/lib/messages.js`);
  let out = null;
  e.app.runInTransaction((t) => { out = action === "ack" ? M.ack(t, c, e.request.pathValue("id")) : M.endAnn(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});

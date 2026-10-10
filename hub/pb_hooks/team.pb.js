/// <reference path="../pb_data/types.d.ts" />
// Tasks, checklists, handover notes, reminders (P2 step 7). Logic: lib/team.js.
// (Each handler runs on its own: helpers are required inside it.)

// Reminders: documents about to expire, wrong storage, late checklists (every 10 minutes)
cronAdd("chedam_reminders", "*/10 * * * *", () => {
  try { $app.runInTransaction((tx) => { require(`${__hooks}/lib/team.js`).reminders(tx); }); }
  catch (err) { console.log("reminders: " + err); }
});

// A checklist's items are checked however they are saved (managers set them up through the generic API)
onRecordCreateRequest((e) => { require(`${__hooks}/lib/team.js`).checkChecklist(e.record); e.next(); }, "checklists");
onRecordUpdateRequest((e) => { require(`${__hooks}/lib/team.js`).checkChecklist(e.record); e.next(); }, "checklists");

// Tasks (FR-2.03): ?status=open|done|all&mine=1
routerAdd("GET", "/api/chedam/tasks", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "tasks.view");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/team.js`).listTasks(e.app, c, { status: q.get("status"), mine: q.get("mine") === "1" }));
});
routerAdd("POST", "/api/chedam/tasks", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "tasks.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/team.js`).createTask(t, c, c.body); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/tasks/{id}/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "tasks.view");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/team.js`).actTask(t, c, e.request.pathValue("id"), e.request.pathValue("action"), c.body); });
  return e.json(200, out);
});

// Checklists (FR-2.11): today's, start, tick, finish, history
routerAdd("GET", "/api/chedam/checklists/today", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "tasks.view");
  return e.json(200, require(`${__hooks}/lib/team.js`).today(e.app));
});
routerAdd("GET", "/api/chedam/checklists/history", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "checklists.manage|tasks.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/team.js`).history(e.app, { from: q.get("from"), to: q.get("to") }));
});
routerAdd("POST", "/api/chedam/checklists/{id}/start", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "tasks.view");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/team.js`).start(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/checklist-runs/{id}/{action}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "tasks.view");
  const T = require(`${__hooks}/lib/team.js`);
  const action = e.request.pathValue("action");
  if (action !== "tick" && action !== "complete") throw new NotFoundError("Unknown checklist action.");
  let out = null;
  e.app.runInTransaction((t) => { out = action === "tick" ? T.tick(t, c, e.request.pathValue("id"), c.body) : T.complete(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});

// Shift handover notes (FR-2.12)
routerAdd("GET", "/api/chedam/handover", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "tasks.view");
  return e.json(200, require(`${__hooks}/lib/team.js`).handover(e.app, c));
});
routerAdd("POST", "/api/chedam/handover", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "tasks.view");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/team.js`).addHandover(t, c, c.body.text); });
  return e.json(200, out);
});
routerAdd("POST", "/api/chedam/handover/{id}/read", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "tasks.view");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/team.js`).readHandover(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});

// Run the reminders now (managers; the job also runs every 10 minutes)
routerAdd("POST", "/api/chedam/reminders/run", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "tasks.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/team.js`).reminders(t); });
  return e.json(200, out);
});

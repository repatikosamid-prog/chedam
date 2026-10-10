// Tasks, checklists, handover notes, reminders (P2 step 7; FR-2.03, 2.11, 2.12, 6.16).
// Tasks: manual ones (title, who, due date, priority, a link to a record) next to the rule tasks Chedam opens
//   and closes by itself (lib/tasks.js). Rule tasks close when the problem is fixed, so they cannot be ticked.
// Checklists: one run per checklist per store day, created when someone starts it; each item ticked with
//   who and when; finished when every required item is done. A checklist with a due time not finished by
//   then raises a task (closed when it is finished, or by the next day).
// Handover notes: written at the end of a shift, shown to the next people until they read them.
// Reminders (minute job): documents (licences, permits, insurance) from N days before they expire; products
//   kept (by default or by lot) in a storage area colder or warmer than their range (wrong storage).

const st = () => require(`${__hooks}/lib/stock.js`);
const syncTask = (...a) => require(`${__hooks}/lib/tasks.js`).syncRuleTask(...a);
function bad(msg) { throw new BadRequestError(msg); }
function userName(app, id) { if (!id) return ""; try { return app.findRecordById("users", String(id).replace(/^users:/, "")).getString("name"); } catch (_) { return ""; } }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
function me(c) { return c.user ? c.user.id : ""; }

// ---- Tasks (FR-2.03) -----------------------------------------------------------------------------------

const LINKS = { products: "name", customers: "first_name", sales: "number", returns: "number", stock_counts: "name", promotions: "name", documents: "name", tills: "number", checklist_runs: "name" };

function taskView(app, t) {
  const due = t.getString("due_at");
  const lc = t.getString("link_collection"), li = t.getString("link_id");
  let label = "";
  if (lc && li && LINKS[lc]) { try { label = String(app.findRecordById(lc, li).get(LINKS[lc])); } catch (_) { label = "(gone)"; } }
  return { id: t.id, title: t.getString("title"), kind: t.getString("kind"), source: t.getString("source"), status: t.getString("status"), priority: t.getString("priority") || "normal",
    owner: t.getString("owner") ? { id: t.getString("owner"), name: userName(app, t.getString("owner")) } : null,
    due_at: due, overdue: !!due && t.getString("status") === "open" && new Date(due.replace(" ", "T")).getTime() < Date.now(),
    link: lc ? { collection: lc, id: li, label: label } : null, note: t.getString("note"), created_at: t.getString("created_at"),
    created_by: userName(app, t.getString("created_by")), closed_at: t.getString("closed_at"), done_by: userName(app, t.getString("done_by")) };
}

function listTasks(app, c, q) {
  const status = ["open", "done", "all"].indexOf(q.status) >= 0 ? q.status : "open";
  const parts = ["deleted_at = ''"], params = {};
  if (status === "open") parts.push("status = 'open'");
  if (status === "done") parts.push("status != 'open'");
  if (q.mine) { parts.push("owner = {:me}"); params.me = me(c); }
  const list = app.findRecordsByFilter("tasks", parts.join(" && "), status === "open" ? "-priority,due_at,-created_at" : "-closed_at", 200, 0, params).map((t) => taskView(app, t));
  // Open: urgent and overdue first, then by due date (none last), then newest
  if (status === "open") list.sort((a, b) => (b.priority === "urgent") - (a.priority === "urgent") || b.overdue - a.overdue || (a.due_at || "9") .localeCompare(b.due_at || "9") || b.created_at.localeCompare(a.created_at));
  return { tasks: list, can_manage: c.can("tasks.manage") };
}

function fields(app, t, b) {
  if (b.title !== undefined) { const v = String(b.title || "").trim(); if (!v) bad("Say what needs doing."); t.set("title", v.substring(0, 200)); }
  if (b.note !== undefined) t.set("note", String(b.note || "").substring(0, 2000));
  if (b.priority !== undefined) t.set("priority", b.priority === "urgent" ? "urgent" : "normal");
  if (b.owner !== undefined) {
    const id = String(b.owner || "");
    if (id) { let u = null; try { u = app.findRecordById("users", id); } catch (_) { u = null; } if (!u || u.getString("status") !== "active" || u.getString("deleted_at")) bad("Choose someone on the team."); }
    t.set("owner", id);
  }
  if (b.due_at !== undefined) {
    const d = String(b.due_at || "");
    if (d && isNaN(new Date(d).getTime())) bad("The due date is not a date.");
    t.set("due_at", d ? new Date(d).toISOString().replace("T", " ") : "");
  }
  if (b.link_collection !== undefined) {
    const lc = String(b.link_collection || ""), li = String(b.link_id || "");
    if (lc) { if (!LINKS[lc]) bad("A task can link to a product, customer, sale, return, count, promotion, document or till."); try { app.findRecordById(lc, li); } catch (_) { bad("The linked record was not found."); } }
    t.set("link_collection", lc); t.set("link_id", lc ? li : "");
  }
}

function createTask(app, c, b) {
  const t = new Record(app.findCollectionByNameOrId("tasks"));
  t.load({ kind: "manual", source: "manual", status: "open", priority: "normal" });
  fields(app, t, b);
  if (!t.getString("title")) bad("Say what needs doing.");
  stamp(t, c);
  app.save(t);
  return taskView(app, t);
}

// done | reopen | edit
function actTask(app, c, id, action, b) {
  const t = app.findRecordById("tasks", id);
  const manage = c.can("tasks.manage"), mine = !!me(c) && t.getString("owner") === me(c);
  if (action === "edit") {
    if (!manage) throw new ForbiddenError("You do not have permission for this.");
    if (t.getString("source") === "rule") { b = { owner: b.owner, due_at: b.due_at, note: b.note, priority: b.priority }; Object.keys(b).forEach((k) => { if (b[k] === undefined) delete b[k]; }); }
    fields(app, t, b);
  } else if (action === "done" || action === "reopen") {
    if (!manage && !mine) throw new ForbiddenError("Only the person it is for, or a manager, can tick it.");
    if (t.getString("source") === "rule" && action === "done") bad("Chedam closes this task by itself when the problem is fixed.");
    if (action === "done") { if (t.getString("status") !== "open") bad("This task is already closed."); t.set("status", "done"); t.set("closed_at", new DateTime()); t.set("done_by", c.actor); if (b.note) t.set("note", (t.getString("note") ? t.getString("note") + "\n" : "") + String(b.note).substring(0, 500)); }
    else { if (t.getString("status") === "open") bad("This task is open."); t.set("status", "open"); t.set("closed_at", ""); t.set("done_by", ""); }
  } else throw new NotFoundError("Unknown task action.");
  stamp(t, c);
  app.save(t);
  return taskView(app, t);
}

// ---- Checklists (FR-2.11) --------------------------------------------------------------------------------

function cleanItems(items) {
  if (!Array.isArray(items) || !items.length) bad("Add at least one item.");
  if (items.length > 100) bad("At most 100 items.");
  return items.map((x) => {
    const text = String((x && x.text) || "").trim().substring(0, 200);
    if (!text) bad("An item has no text.");
    return { text: text, required: !(x && x.required === false) };
  });
}

// A checklist saved through the generic API: items cleaned, due time checked.
function checkChecklist(rec) {
  let items = [];
  try { items = JSON.parse(rec.getString("items") || "[]"); } catch (_) { items = []; }
  rec.set("items", cleanItems(items));
  const t = rec.getString("due_time");
  if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) bad("Due time as HH:MM, for example 21:30.");
}

function runView(app, r) {
  return { id: r.id, checklist: r.getString("checklist"), day: r.getString("day"), name: r.getString("name"), kind: r.getString("kind"), status: r.getString("status"),
    items: (() => { try { return JSON.parse(r.getString("items") || "[]"); } catch (_) { return []; } })(),
    started_by: userName(app, r.getString("started_by")), completed_by: userName(app, r.getString("completed_by")), completed_at: r.getString("completed_at") };
}

function today(app) {
  const day = st().today();
  const list = app.findRecordsByFilter("checklists", "active = true && deleted_at = ''", "sort,name", 0, 0);
  return { day: day, checklists: list.map((k) => {
    const runs = app.findRecordsByFilter("checklist_runs", "checklist = {:k} && day = {:d}", "", 1, 0, { k: k.id, d: day });
    let items = [];
    try { items = JSON.parse(k.getString("items") || "[]"); } catch (_) { items = []; }
    return { id: k.id, name: k.getString("name"), kind: k.getString("kind"), due_time: k.getString("due_time"), items: items.length, run: runs.length ? runView(app, runs[0]) : null };
  }) };
}

function start(app, c, checklistId) {
  const k = app.findRecordById("checklists", checklistId);
  if (!k.getBool("active") || k.getString("deleted_at")) bad("This checklist is not in use.");
  const day = st().today();
  const have = app.findRecordsByFilter("checklist_runs", "checklist = {:k} && day = {:d}", "", 1, 0, { k: k.id, d: day });
  if (have.length) return runView(app, have[0]);
  let items = [];
  try { items = JSON.parse(k.getString("items") || "[]"); } catch (_) { items = []; }
  const r = new Record(app.findCollectionByNameOrId("checklist_runs"));
  r.load({ checklist: k.id, day: day, name: k.getString("name"), kind: k.getString("kind"), status: "open", started_by: c.actor,
    items: items.map((x) => ({ text: x.text, required: x.required !== false, done: false, by: "", by_name: "", at: "", note: "" })) });
  stamp(r, c);
  app.save(r);
  return runView(app, r);
}

function tick(app, c, runId, b) {
  const r = app.findRecordById("checklist_runs", runId);
  if (r.getString("day") !== st().today()) bad("Only today's checklist can be ticked.");
  const items = runView(app, r).items;
  const i = Number(b.index);
  if (!(i >= 0 && i < items.length) || i !== Math.floor(i)) bad("Unknown item.");
  const x = items[i];
  x.done = !!b.done;
  x.by = x.done ? c.actor : ""; x.by_name = x.done ? userName(app, c.actor) : ""; x.at = x.done ? new Date().toISOString() : "";
  if (b.note !== undefined) x.note = String(b.note || "").substring(0, 300);
  r.set("items", items);
  // Unticking an item of a finished checklist opens it again
  if (!x.done && r.getString("status") === "done") { r.set("status", "open"); r.set("completed_by", ""); r.set("completed_at", ""); }
  stamp(r, c);
  app.save(r);
  return runView(app, r);
}

function complete(app, c, runId) {
  const r = app.findRecordById("checklist_runs", runId);
  const v = runView(app, r);
  const left = v.items.filter((x) => x.required && !x.done);
  if (left.length) bad(left.length + " required item(s) not done yet: " + left.slice(0, 3).map((x) => x.text).join(", ") + (left.length > 3 ? "…" : ""));
  r.set("status", "done"); r.set("completed_by", c.actor); r.set("completed_at", new DateTime());
  stamp(r, c);
  app.save(r);
  syncTask(app, "checklist:" + r.getString("checklist"), 0, "", null, c.actor);
  return runView(app, r);
}

function history(app, q) {
  const r = require(`${__hooks}/lib/reports.js`).range(q);
  return { from: r.from, to: r.to, runs: app.findRecordsByFilter("checklist_runs", "day >= {:f} && day <= {:t}", "-day,name", 500, 0, { f: r.from, t: r.to }).map((x) => runView(app, x)) };
}

// ---- Handover notes (FR-2.12) ----------------------------------------------------------------------------

function handover(app, c) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().replace("T", " ");
  return { notes: app.findRecordsByFilter("handover_notes", "created_at >= {:s} && deleted_at = ''", "-created_at", 50, 0, { s: since }).map((n) => {
    let read = [];
    try { read = JSON.parse(n.getString("read_by") || "[]"); } catch (_) { read = []; }
    return { id: n.id, text: n.getString("text"), author: n.getString("author_name"), mine: n.getString("author") === c.actor, created_at: n.getString("created_at"),
      read: read.indexOf(me(c)) >= 0 || n.getString("author") === c.actor, read_by: read.map((id) => userName(app, id)).filter(Boolean) };
  }) };
}

function addHandover(app, c, text) {
  const t = String(text || "").trim();
  if (!t) bad("Write the note first.");
  const n = new Record(app.findCollectionByNameOrId("handover_notes"));
  n.load({ text: t.substring(0, 2000), author: c.actor, author_name: userName(app, c.actor), read_by: [] });
  stamp(n, c);
  app.save(n);
  return { id: n.id };
}

function readHandover(app, c, id) {
  const n = app.findRecordById("handover_notes", id);
  let read = [];
  try { read = JSON.parse(n.getString("read_by") || "[]"); } catch (_) { read = []; }
  if (me(c) && read.indexOf(me(c)) < 0) { read.push(me(c)); n.set("read_by", read); stamp(n, c); app.save(n); }
  return { ok: true };
}

// ---- Reminders (FR-2.12 expiry, FR-6.16 wrong storage, overdue checklists) -------------------------------

const has = (a, b) => !(a === 0 && b === 0);        // a range of 0..0 means "not set"
const range = (a, b) => a + "–" + b + " °C";

function reminders(app) {
  const actor = "system:reminders";
  let opened = 0;
  // Only touch a rule task when the problem is there or its task is open (a few queries a run, not one per product)
  const openKeys = {};
  app.findRecordsByFilter("tasks", "status = 'open' && source = 'rule' && deleted_at = ''", "", 0, 0).forEach((t) => { openKeys[t.getString("rule_key")] = true; });
  const sync = (key, n, title, fields) => { if (!n && !openKeys[key]) return; syncTask(app, key, n, title, fields, actor); if (n) opened++; };
  // Documents
  const todayD = st().today();
  const days = (ymd) => Math.round((new Date(ymd.substring(0, 10) + "T00:00:00") - new Date(todayD + "T00:00:00")) / 86400000);
  app.findRecordsByFilter("documents", "deleted_at = ''", "", 0, 0).forEach((d) => {
    const exp = d.getString("expires_on");
    const left = exp ? days(exp) : null;
    const remind = d.getInt("remind_days") || 30;
    const due = !d.getBool("archived") && left !== null && left <= remind;
    sync("document:" + d.id, due ? 1 : 0, !due ? "" : left < 0 ? d.getString("name") + " expired on " + exp.substring(0, 10) : d.getString("name") + " expires on " + exp.substring(0, 10) + (left === 0 ? " (today)" : " (in " + left + " day" + (left === 1 ? "" : "s") + ")"),
      { kind: "document_expiry", priority: left !== null && left <= 7 ? "urgent" : "normal", link_collection: "documents", link_id: d.id });
  });
  // Wrong storage: the product's range against its default area and the areas its lots are in
  const areas = {};
  app.findRecordsByFilter("storage_areas", "id != ''", "", 0, 0).forEach((a) => { areas[a.id] = { name: a.getString("name"), min: a.getFloat("temp_min_c"), max: a.getFloat("temp_max_c") }; });
  const lotAreas = {};
  app.findRecordsByFilter("stock_lots", "qty > 0 && storage_area != '' && deleted_at = ''", "", 0, 0).forEach((l) => {
    const p = l.getString("product");
    (lotAreas[p] || (lotAreas[p] = {}))[l.getString("storage_area")] = true;
  });
  app.findRecordsByFilter("products", "deleted_at = '' && status != 'archived'", "", 0, 0).forEach((p) => {
    const pmin = p.getFloat("temp_min_c"), pmax = p.getFloat("temp_max_c");
    let wrong = null;
    if (has(pmin, pmax)) {
      const where = Object.keys(lotAreas[p.id] || {});
      if (p.getString("storage_area")) where.unshift(p.getString("storage_area"));
      where.some((id) => {
        const a = areas[id];
        if (!a || !has(a.min, a.max)) return false;
        if (a.min < pmin || a.max > pmax) { wrong = a; return true; }
        return false;
      });
    }
    sync("storage:" + p.id, wrong ? 1 : 0, wrong ? p.getString("name") + " needs " + range(pmin, pmax) + " but is kept in " + wrong.name + " (" + range(wrong.min, wrong.max) + ")" : "",
      { kind: "wrong_storage", priority: "urgent", link_collection: "products", link_id: p.id });
  });
  // Checklists not finished by their due time today
  const now = new Date(), hm = ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
  app.findRecordsByFilter("checklists", "active = true && deleted_at = '' && due_time != ''", "", 0, 0).forEach((k) => {
    const late = hm >= k.getString("due_time") && !app.findRecordsByFilter("checklist_runs", "checklist = {:k} && day = {:d} && status = 'done'", "", 1, 0, { k: k.id, d: todayD }).length;
    sync("checklist:" + k.id, late ? 1 : 0, late ? k.getString("name") + " not finished by " + k.getString("due_time") : "", { kind: "checklist_late", priority: "normal" });
  });
  return { open: opened };
}

module.exports = { listTasks, createTask, actTask, today, start, tick, complete, history, handover, addHandover, readHandover, reminders, cleanItems, checkChecklist };

/// <reference path="../../pb_data/types.d.ts" />
// P2 step 7: tasks, checklists, reminders (FR-2.03, 2.11, 2.12, 6.16).
// - tasks get who finished them (manual tasks: owner, due date, link to a record were already there)
// - checklists (opening, closing, other: the list of items, edited by managers) and checklist_runs (one per
//   checklist per day: who ticked what and when); changed through /api/chedam/checklists...
// - handover_notes: shift handover, read by the next people; through /api/chedam/handover
// - documents: licences, permits, insurance with expiry dates and a reminder (a task) before they expire
// - products: the temperature range they need; a product or lot kept in a storage area outside it raises a
//   task (wrong storage)
// Down drops exactly what up adds.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';
const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
function base(app, name, fields, indexes) {
  const c = new Collection({ type: "base", name: name, listRule: ACTIVE, viewRule: ACTIVE, createRule: ACTIVE, updateRule: ACTIVE, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [] });
  app.save(c);
  return c;
}

// [code, area, label, owner_only, sensitive]
const PERMS = [
  ["checklists.manage", "team", "Set up opening, closing and other checklists", false, false],
  ["documents.manage", "team", "Keep licences, permits and insurance with their expiry dates", false, true],
];
const GRANTS = { manager: ["checklists.manage", "documents.manage"] };

const ADD = {
  tasks: [{ name: "done_by", type: "text", max: 64 }],
  products: [{ name: "temp_min_c", type: "number", min: -60, max: 60 }, { name: "temp_max_c", type: "number", min: -60, max: 60 }],
};

migrate((app) => {
  const checklists = base(app, "checklists", [
    { name: "name", type: "text", required: true, max: 80 },
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["opening", "closing", "other"] },
    { name: "items", type: "json", maxSize: 20000 },                  // [{text, required}]
    { name: "due_time", type: "text", max: 5 },                       // "HH:MM" store time: a task when not done by then
    { name: "active", type: "bool" },
    { name: "sort", type: "number", onlyInt: true },
  ]);
  base(app, "checklist_runs", [
    { name: "checklist", type: "relation", required: true, collectionId: checklists.id, maxSelect: 1, cascadeDelete: false },
    { name: "day", type: "text", required: true, max: 10 },           // YYYY-MM-DD, store date
    { name: "name", type: "text", max: 80 },                          // as it was that day
    { name: "kind", type: "text", max: 20 },
    { name: "items", type: "json", maxSize: 40000 },                  // [{text, required, done, by, by_name, at, note}]
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "done"] },
    { name: "started_by", type: "text", max: 64 },
    { name: "completed_by", type: "text", max: 64 },
    { name: "completed_at", type: "date" },
  ], ["CREATE UNIQUE INDEX idx_checklist_runs_day ON checklist_runs (checklist, day)"]);
  base(app, "handover_notes", [
    { name: "text", type: "text", required: true, max: 2000 },
    { name: "author", type: "text", max: 64 },
    { name: "author_name", type: "text", max: 80 },
    { name: "read_by", type: "json", maxSize: 4000 },                 // [user id]
  ]);
  base(app, "documents", [
    { name: "name", type: "text", required: true, max: 120 },
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["licence", "permit", "insurance", "inspection", "other"] },
    { name: "number", type: "text", max: 80 },
    { name: "issuer", type: "text", max: 120 },
    { name: "expires_on", type: "date" },
    { name: "remind_days", type: "number", onlyInt: true, min: 0, max: 365 },
    { name: "note", type: "text", max: 1000 },
    { name: "file", type: "file", maxSelect: 1, maxSize: 10485760, mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"], protected: true },
    { name: "archived", type: "bool" },
  ]);
  Object.keys(ADD).forEach((name) => {
    const c = app.findCollectionByNameOrId(name);
    ADD[name].forEach((f) => c.fields.add(new Field(f)));
    app.save(c);
  });
  const ids = {};
  PERMS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    const p = new Record(app.findCollectionByNameOrId("permissions"));
    p.load({ code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive });
    p.set("created_by", "system"); p.set("updated_by", "system");
    app.save(p);
    ids[code] = p.id;
  });
  Object.keys(GRANTS).forEach((role) => {
    let r;
    try { r = app.findFirstRecordByData("roles", "code", role); } catch (_) { return; }
    r.set("permissions", r.get("permissions").concat(GRANTS[role].map((c) => ids[c])));
    r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  const ids = PERMS.map(([code]) => { try { return app.findFirstRecordByData("permissions", "code", code).id; } catch (_) { return ""; } }).filter(Boolean);
  Object.keys(GRANTS).forEach((role) => {
    let r;
    try { r = app.findFirstRecordByData("roles", "code", role); } catch (_) { return; }
    r.set("permissions", r.get("permissions").filter((x) => ids.indexOf(x) < 0));
    r.set("updated_by", "system");
    app.save(r);
  });
  ids.forEach((id) => app.delete(app.findRecordById("permissions", id)));
  Object.keys(ADD).forEach((name) => {
    const c = app.findCollectionByNameOrId(name);
    ADD[name].forEach((f) => c.fields.removeByName(f.name));
    app.save(c);
  });
  ["documents", "handover_notes", "checklist_runs", "checklists"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

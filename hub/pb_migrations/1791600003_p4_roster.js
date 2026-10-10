/// <reference path="../../pb_data/types.d.ts" />
// P4 step 3: roster (FR-9.07). Planned shifts per person and day (drafts until the week is published),
// swap requests between staff (a manager approves), and the inbox kind "schedule" (published weeks, swaps).
// Changed only through /api/chedam/roster and /api/chedam/swaps. Down drops exactly what up adds.

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
function base(app, name, fields, indexes) {
  const c = new Collection({ type: "base", name: name, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [] });
  app.save(c);
  return c;
}
const PERMS = [
  ["roster.manage", "people", "Make and publish the roster, approve swaps, see labour cost against sales", false, false],
];
const GRANTS = { manager: ["roster.manage"] };
const KINDS_BEFORE = ["eod_report", "alert", "report"];

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const rs = base(app, "roster_shifts", [
    { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "user_name", type: "text", max: 80 },
    { name: "week", type: "text", max: 10 },                                   // the week's first day
    { name: "day", type: "text", required: true, max: 10 },
    { name: "start", type: "text", required: true, max: 5 },                    // "HH:MM" store time
    { name: "end", type: "text", required: true, max: 5 },                      // earlier than start = the next day
    { name: "break_min", type: "number", onlyInt: true, min: 0, max: 240 },
    { name: "position", type: "text", max: 60 },                               // e.g. Till, Stock, Deli
    { name: "note", type: "text", max: 200 },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "published"] },
    { name: "changed", type: "bool" },                                          // changed since it was published
  ], ["CREATE INDEX idx_roster_week ON roster_shifts (week, day)", "CREATE INDEX idx_roster_user ON roster_shifts (user, day)"]);
  base(app, "roster_swaps", [
    { name: "shift", type: "relation", required: true, collectionId: rs.id, maxSelect: 1, cascadeDelete: false },
    { name: "from_user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "to_user", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },   // empty: anyone may take it
    { name: "taken_by", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["offered", "accepted", "approved", "declined", "cancelled"] },
    { name: "note", type: "text", max: 200 },
    { name: "decided_by", type: "text", max: 80 },
  ], ["CREATE INDEX idx_swaps_shift ON roster_swaps (shift)"]);
  const inbox = app.findCollectionByNameOrId("inbox_items");
  inbox.fields.getByName("kind").values = KINDS_BEFORE.concat(["schedule"]);
  app.save(inbox);
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
    r.set("permissions", r.get("permissions").concat(GRANTS[role].map((x) => ids[x])));
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
  app.findRecordsByFilter("inbox_items", "kind = 'schedule'", "", 0, 0).forEach((r) => app.delete(r));
  const inbox = app.findCollectionByNameOrId("inbox_items");
  inbox.fields.getByName("kind").values = KINDS_BEFORE;
  app.save(inbox);
  ["roster_swaps", "roster_shifts"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

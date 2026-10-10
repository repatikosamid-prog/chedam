/// <reference path="../../pb_data/types.d.ts" />
// P4 step 2: time clock (FR-9.04-9.06, BR-30-32). One shift per clock-in: the hub's clock for every time
// (BR-30, UTC, shown in the store's zone), breaks inside it, the device it was punched on. A punch edit keeps
// the original times, who changed them and why (FR-9.06). BC rules (P4-e, BR-31) in a setting: the meal break
// after 5 hours, daily overtime after 8 and 12 hours, weekly after 40, 8 hours off between shifts.
// Changed only through /api/chedam/clock and /api/chedam/shifts. Down drops exactly what up adds.

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
const PERMS = [
  ["timeclock.manage", "people", "See everyone's punches, fix them (with a reason), add a missed shift", false, false],
];
const GRANTS = { manager: ["timeclock.manage"] };
const SETTINGS = [
  ["timeclock.rules", { meal_after_hours: 5, meal_minutes: 30, meal_paid: false, daily_ot_hours: 8, daily_dt_hours: 12, weekly_ot_hours: 40, rest_hours: 8, warn_minutes: 30, week_starts: 0 },
    "Time clock rules (BR-31, BC Employment Standards): a 30-minute meal break before 5 hours of work; overtime (1.5×) after 8 hours a day or 40 a week, double after 12 a day; 8 hours off between shifts; warn this many minutes before; the week starts on day 0 = Sunday"],
];

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const c = new Collection({ type: "base", name: "shifts", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "user_name", type: "text", max: 80 },
      { name: "day", type: "text", max: 10 },                                   // the store-local day it started
      { name: "clock_in", type: "date", required: true },
      { name: "clock_out", type: "date" },
      { name: "breaks", type: "json", maxSize: 20000 },                         // [{start, end}]
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "on_break", "closed"] },
      { name: "in_device", type: "text", max: 80 },
      { name: "out_device", type: "text", max: 80 },
      { name: "original", type: "json", maxSize: 20000 },                       // the punched times before the first edit
      { name: "edits", type: "json", maxSize: 50000 },                          // [{at, by, reason, from, to}]
      { name: "added_by_manager", type: "bool" },
      { name: "alerts", type: "json", maxSize: 5000 },                          // alerts already sent for this shift
      { name: "note", type: "text", max: 300 },
    ].concat(COMMON()),
    indexes: ["CREATE INDEX idx_shifts_user_in ON shifts (user, clock_in)", "CREATE INDEX idx_shifts_day ON shifts (day)"] });
  app.save(c);
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
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
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  app.delete(app.findCollectionByNameOrId("shifts"));
});

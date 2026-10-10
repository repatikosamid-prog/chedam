/// <reference path="../../pb_data/types.d.ts" />
// P4 step 4: time sheets (FR-9.08). One per person per pay period, made when it is approved: the hours from
// the punches (regular, overtime, double), leave taken, the flags that were checked, and a snapshot of the
// shifts. While approved, those punches cannot be changed (reopen first, with a reason); payroll (step 5)
// marks it paid. The pay period comes from the setting payroll.period. Down drops exactly what up adds.

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
const SETTINGS = [
  ["payroll.period", { frequency: "biweekly", anchor: "2026-01-04" },
    "Pay periods (FR-9.08): weekly or biweekly from the anchor day (the first day of a period), semimonthly (1-15, 16-end) or monthly"],
];

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({ type: "base", name: "timesheets", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "user_name", type: "text", max: 80 },
      { name: "period_start", type: "text", required: true, max: 10 },
      { name: "period_end", type: "text", required: true, max: 10 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["approved", "reopened", "paid"] },
      { name: "paid_min", type: "number", onlyInt: true },
      { name: "regular_min", type: "number", onlyInt: true },
      { name: "overtime_min", type: "number", onlyInt: true },
      { name: "double_min", type: "number", onlyInt: true },
      { name: "leave", type: "json", maxSize: 2000 },                            // hours taken: {vacation, sick, unpaid}
      { name: "flags", type: "json", maxSize: 20000 },                           // what was flagged when approved
      { name: "snapshot", type: "json", maxSize: 200000 },                       // the shifts as approved
      { name: "note", type: "text", max: 500 },
      { name: "approved_by", type: "text", max: 80 },
      { name: "approved_at", type: "date" },
      { name: "reopen_reason", type: "text", max: 300 },
      { name: "payroll", type: "text", max: 40 },                                // the payroll run that paid it (step 5)
    ].concat(COMMON()),
    indexes: ["CREATE UNIQUE INDEX idx_timesheets_period ON timesheets (user, period_start)"] }));
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  app.delete(app.findCollectionByNameOrId("timesheets"));
});

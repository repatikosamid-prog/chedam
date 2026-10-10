/// <reference path="../../pb_data/types.d.ts" />
// P4 step 1: employees and leave (FR-9.09, 9.10). An employee record adds HR and pay details to a person who
// signs in (P4-a). SIN and bank details are encrypted (P4-b) with the hub's own key (a file next to the
// database, in the backups) and shown only to the owner. Leave (vacation, sick, unpaid) is a ledger of hours:
// accruals in, time taken out. Changed only through /api/chedam/employees. Down drops exactly what up adds.

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
  ["hr.view", "people", "See employee records (not pay, SIN or bank) and leave", false, false],
  ["hr.manage", "people", "Employee pay, SIN and bank details; leave adjustments", true, true],
];
const GRANTS = { manager: ["hr.view"] };
const SETTINGS = [
  ["hr.leave", { sick_days_bc: 5, sick_after_days: 90, vacation_pct_first: 4, vacation_pct_after_5y: 6 },
    "Leave rules (FR-9.10, BC Employment Standards): paid sick days a year after 90 days; vacation pay 4%, 6% after 5 years"],
];

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const emp = base(app, "employees", [
    { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "legal_name", type: "text", required: true, max: 120 },
    { name: "birth_date", type: "text", max: 10 },
    { name: "street", type: "text", max: 200 },
    { name: "city", type: "text", max: 80 },
    { name: "province", type: "text", max: 40 },
    { name: "postal_code", type: "text", max: 12 },
    { name: "personal_email", type: "text", max: 120 },
    { name: "personal_phone", type: "text", max: 40 },
    { name: "emergency_name", type: "text", max: 120 },
    { name: "emergency_phone", type: "text", max: 40 },
    { name: "emergency_relation", type: "text", max: 60 },
    { name: "job_title", type: "text", max: 80 },
    { name: "start_date", type: "text", max: 10 },
    { name: "end_date", type: "text", max: 10 },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["active", "on_leave", "ended"] },
    { name: "pay_type", type: "select", required: true, maxSelect: 1, values: ["hourly", "salary"] },
    { name: "pay_rate_cents", type: "number", onlyInt: true, min: 0 },         // hourly rate, or yearly salary
    { name: "pay_frequency", type: "select", maxSelect: 1, values: ["weekly", "biweekly", "semimonthly", "monthly"] },
    { name: "hours_per_week", type: "number", min: 0, max: 80 },              // salaried: for accruals and overtime
    { name: "overtime_eligible", type: "bool" },
    { name: "vacation_pct", type: "number", min: 0, max: 20 },                // vacation pay % of gross (BC: 4, 6 after 5 years)
    { name: "vacation_days_per_year", type: "number", min: 0, max: 60 },
    { name: "sick_days_per_year", type: "number", min: 0, max: 30 },
    { name: "sin_enc", type: "text", max: 400 },                              // encrypted
    { name: "sin_last3", type: "text", max: 3 },
    { name: "sin_viewed_by", type: "text", max: 80 },                         // the last time the full SIN was shown
    { name: "sin_viewed_at", type: "date" },
    { name: "bank_enc", type: "text", max: 1000 },                            // encrypted {institution, transit, account}
    { name: "td1_federal_cents", type: "number", onlyInt: true, min: 0 },     // TD1 claim amounts (for the CRA calculator)
    { name: "td1_provincial_cents", type: "number", onlyInt: true, min: 0 },
    { name: "documents", type: "file", maxSelect: 20, maxSize: 10485760, mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"], protected: true },
    { name: "notes", type: "text", max: 2000 },
  ], ["CREATE UNIQUE INDEX idx_employees_user ON employees (user)"]);
  base(app, "leave_ledger", [
    { name: "employee", type: "relation", required: true, collectionId: emp.id, maxSelect: 1, cascadeDelete: false },
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["vacation", "sick", "unpaid"] },
    { name: "hours", type: "number" },                                         // + accrued / granted, − taken / expired
    { name: "day", type: "text", max: 10 },
    { name: "source", type: "select", required: true, maxSelect: 1, values: ["accrual", "grant", "taken", "adjust", "expire", "payroll"] },
    { name: "ref", type: "text", max: 40 },                                    // e.g. "accrual:2026-10" (once)
    { name: "note", type: "text", max: 300 },
    { name: "by_name", type: "text", max: 80 },
  ], ["CREATE INDEX idx_leave_employee ON leave_ledger (employee, kind)", "CREATE UNIQUE INDEX idx_leave_ref ON leave_ledger (employee, kind, ref) WHERE ref != ''"]);
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
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  ["leave_ledger", "employees"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

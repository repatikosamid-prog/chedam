/// <reference path="../../pb_data/types.d.ts" />
// P4 step 5: payroll preparation (FR-9.11-9.13, P4-c). A payroll run per pay period: one line per person with
// the hours from the approved time sheet (or the salary), overtime, vacation pay, sick pay, extras and
// reimbursements (expenses paid back "with the next pay") → gross; deductions are ENTERED (CPP, CPP2, EI,
// income tax from the CRA calculator or the accountant), never calculated. Finalised lines are the pay stubs
// each person sees; the run's payment is recorded; T4 and ROE data come from the lines.
// Changed only through /api/chedam/payroll. Down drops exactly what up adds.

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
  ["payroll.manage", "people", "Prepare payroll: pay, deductions, pay stubs, T4 and ROE data", false, true],
];
const GRANTS = { accountant: ["payroll.manage"] };
const C = (name) => ({ name: name, type: "number", onlyInt: true });

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const emp = app.findCollectionByNameOrId("employees");
  const runs = base(app, "payroll_runs", [
    { name: "number", type: "text", max: 20 },
    { name: "period_start", type: "text", required: true, max: 10 },
    { name: "period_end", type: "text", required: true, max: 10 },
    { name: "pay_date", type: "text", required: true, max: 10 },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "finalized", "paid", "cancelled"] },
    C("gross_cents"), C("deductions_cents"), C("net_cents"), C("reimbursements_cents"), C("employer_cents"),
    { name: "finalized_by", type: "text", max: 80 },
    { name: "finalized_at", type: "date" },
    { name: "paid_method", type: "select", maxSelect: 1, values: ["direct_deposit", "e_transfer", "cheque", "cash"] },
    { name: "paid_ref", type: "text", max: 80 },
    { name: "paid_day", type: "text", max: 10 },
    { name: "note", type: "text", max: 500 },
  ], ["CREATE UNIQUE INDEX idx_payroll_number ON payroll_runs (number) WHERE number != ''", "CREATE INDEX idx_payroll_period ON payroll_runs (period_start)"]);
  base(app, "payroll_lines", [
    { name: "run", type: "relation", required: true, collectionId: runs.id, maxSelect: 1, cascadeDelete: false },
    { name: "employee", type: "relation", required: true, collectionId: emp.id, maxSelect: 1, cascadeDelete: false },
    { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "legal_name", type: "text", max: 120 },
    { name: "pay_type", type: "text", max: 10 },
    C("rate_cents"),
    C("regular_min"), C("overtime_min"), C("double_min"), C("sick_min"), C("unpaid_min"),
    C("regular_cents"), C("overtime_cents"), C("double_cents"), C("salary_cents"), C("sick_cents"), C("unpaid_cents"),
    C("stat_cents"), C("other_earnings_cents"), C("vacation_pay_cents"),
    { name: "vacation_pct", type: "number" },
    C("gross_cents"),                                                           // taxable earnings
    C("cpp_cents"), C("cpp2_cents"), C("ei_cents"), C("tax_cents"), C("other_deductions_cents"),
    { name: "deductions_entered", type: "bool" },
    C("reimbursements_cents"),
    { name: "reimbursed", type: "json", maxSize: 5000 },                       // expense numbers paid back here
    C("net_cents"),
    C("cpp_er_cents"), C("ei_er_cents"),                                        // employer's share
    { name: "insurable_min", type: "number", onlyInt: true },                  // for the ROE
    { name: "timesheet", type: "text", max: 15 },
    { name: "note", type: "text", max: 300 },
  ], ["CREATE INDEX idx_payroll_lines_run ON payroll_lines (run)", "CREATE INDEX idx_payroll_lines_user ON payroll_lines (user)"]);
  const ex = app.findCollectionByNameOrId("expenses");
  ex.fields.add(new Field({ name: "payroll", type: "text", max: 15 }));         // the payroll run that paid it back
  app.save(ex);
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
  const ex = app.findCollectionByNameOrId("expenses");
  ex.fields.removeByName("payroll");
  app.save(ex);
  ["payroll_lines", "payroll_runs"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

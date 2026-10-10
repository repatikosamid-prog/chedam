/// <reference path="../../pb_data/types.d.ts" />
// P4 step 6: bank (FR-10.02, 10.03). Bank accounts, statement imports (CSV, OFX, QFX), statement lines
// matched to what Chedam recorded (vendor and client payments, expenses paid back, payroll, cash deposits,
// card batches) or given a category (bank fees, owner draws, transfers...), and cash deposits from the tills to
// the bank. Changed only through /api/chedam/bank. Down drops exactly what up adds.

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
  ["bank.manage", "money", "Bank accounts, statement imports, matching and reconciliation, deposits", false, true],
];
const GRANTS = { accountant: ["bank.manage"] };
const SETTINGS = [
  ["bank.categories", ["Bank fees", "Interest", "Owner draw", "Owner deposit", "Transfer between accounts", "Loan payment", "Loan received", "Rent", "Utilities", "Insurance", "Taxes paid (CRA)", "Other"],
    "Categories for bank lines that are not a Chedam record (FR-10.03)"],
];

migrate((app) => {
  const acc = base(app, "bank_accounts", [
    { name: "name", type: "text", required: true, max: 80 },
    { name: "institution", type: "text", max: 80 },
    { name: "last4", type: "text", max: 4 },
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["chequing", "savings", "credit_card"] },
    { name: "currency", type: "text", max: 3 },
    { name: "opening_balance_cents", type: "number", onlyInt: true },
    { name: "opening_date", type: "text", max: 10 },
    { name: "reconciled_to", type: "text", max: 10 },
    { name: "reconciled_balance_cents", type: "number", onlyInt: true },
    { name: "active", type: "bool" },
  ]);
  const imp = base(app, "bank_imports", [
    { name: "account", type: "relation", required: true, collectionId: acc.id, maxSelect: 1, cascadeDelete: false },
    { name: "filename", type: "text", max: 200 },
    { name: "format", type: "text", max: 10 },
    { name: "added", type: "number", onlyInt: true },
    { name: "duplicates", type: "number", onlyInt: true },
    { name: "first_day", type: "text", max: 10 },
    { name: "last_day", type: "text", max: 10 },
    { name: "by_name", type: "text", max: 80 },
  ]);
  const lines = base(app, "bank_lines", [
    { name: "account", type: "relation", required: true, collectionId: acc.id, maxSelect: 1, cascadeDelete: false },
    { name: "import", type: "relation", collectionId: imp.id, maxSelect: 1, cascadeDelete: false },
    { name: "day", type: "text", required: true, max: 10 },
    { name: "description", type: "text", max: 300 },
    { name: "amount_cents", type: "number", onlyInt: true },                   // + money in, − money out
    { name: "balance_cents", type: "number", onlyInt: true },                  // as the bank printed it, when given
    { name: "has_balance", type: "bool" },
    { name: "fitid", type: "text", max: 120 },                                 // the bank's id (OFX) or a hash (CSV)
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["unmatched", "matched", "ignored"] },
    { name: "match_kind", type: "text", max: 30 },                             // bill_payment, expense, payroll, deposit, card_batch, category
    { name: "match_refs", type: "json", maxSize: 5000 },                       // [{kind, id, label, amount_cents}]
    { name: "category", type: "text", max: 60 },
    { name: "fee_cents", type: "number", onlyInt: true },                      // card batch: the processor kept this (step 7)
    { name: "auto", type: "bool" },
    { name: "note", type: "text", max: 300 },
    { name: "matched_by", type: "text", max: 80 },
  ], ["CREATE UNIQUE INDEX idx_bank_lines_fitid ON bank_lines (account, fitid)", "CREATE INDEX idx_bank_lines_day ON bank_lines (account, day)", "CREATE INDEX idx_bank_lines_status ON bank_lines (status)"]);
  base(app, "bank_deposits", [
    { name: "number", type: "text", max: 20 },
    { name: "account", type: "relation", required: true, collectionId: acc.id, maxSelect: 1, cascadeDelete: false },
    { name: "day", type: "text", required: true, max: 10 },
    { name: "amount_cents", type: "number", onlyInt: true, min: 1 },
    { name: "tills", type: "json", maxSize: 5000 },                             // the closed tills whose cash it is
    { name: "note", type: "text", max: 300 },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["in_transit", "matched", "cancelled"] },
    { name: "bank_line", type: "relation", collectionId: lines.id, maxSelect: 1, cascadeDelete: false },
    { name: "by_name", type: "text", max: 80 },
  ], ["CREATE UNIQUE INDEX idx_bank_deposits_number ON bank_deposits (number) WHERE number != ''"]);
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
  ["bank_deposits", "bank_lines", "bank_imports", "bank_accounts"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

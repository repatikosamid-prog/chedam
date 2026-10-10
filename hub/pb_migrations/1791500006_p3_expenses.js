/// <reference path="../../pb_data/types.d.ts" />
// P3 step 6: expenses and petty cash (FR-9.01-9.03). Anyone can claim an expense (with receipt photos);
// managers approve or reject it; it is reimbursed by till cash, cheque, e-transfer or the next pay. Possible
// duplicates and missing receipts are flagged. Petty cash: a float kept in a box, with every expense paid from
// it, top-ups and counts. Changed only through /api/chedam/expenses and /petty-cash. Down drops exactly what up
// adds.

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
  const c = new Collection({ type: "base", name: name, listRule: ACTIVE, viewRule: ACTIVE, createRule: null, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [] });
  app.save(c);
  return c;
}
const PERMS = [["expenses.approve", "money", "Approve, reject and reimburse expense claims; petty cash", false, true]];
const GRANTS = { manager: ["expenses.approve"], accountant: ["expenses.approve"] };
const SETTINGS = [
  ["expenses.categories", ["Supplies", "Cleaning", "Repairs and maintenance", "Fuel and travel", "Meals", "Office", "Shop equipment", "Bank fees", "Advertising", "Other"],
    "Expense categories (FR-9.01)"],
  ["expenses.receipt_over_cents", 0, "A receipt photo is expected for every expense over this amount (0: all of them, FR-9.02)"],
  ["petty_cash.float_cents", 20000, "The petty cash float to keep in the box (FR-9.03)"],
];

migrate((app) => {
  base(app, "expenses", [
    { name: "number", type: "text", max: 20 },                       // EX-000001
    { name: "claimant", type: "text", max: 15 },                     // user id
    { name: "claimant_name", type: "text", max: 80 },
    { name: "day", type: "text", max: 10 },
    { name: "vendor_name", type: "text", max: 120 },
    { name: "party", type: "text", max: 15 },                        // a known vendor, when chosen
    { name: "amount_cents", type: "number", onlyInt: true, min: 0 }, // total paid, with taxes
    { name: "gst_cents", type: "number", onlyInt: true, min: 0 },
    { name: "pst_cents", type: "number", onlyInt: true, min: 0 },
    { name: "category", type: "text", max: 60 },
    { name: "paid_with", type: "select", required: true, maxSelect: 1, values: ["own_money", "petty_cash", "company_card", "till_cash"] },
    { name: "note", type: "text", max: 1000 },
    { name: "receipts", type: "file", maxSelect: 5, maxSize: 10485760, mimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], protected: true },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["submitted", "approved", "rejected", "reimbursed"] },
    { name: "flags", type: "json", maxSize: 2000 },                  // ["duplicate:<number>", "missing_receipt"]
    { name: "decided_by", type: "text", max: 80 },
    { name: "decided_at", type: "date" },
    { name: "reject_reason", type: "text", max: 300 },
    { name: "reimbursed_with", type: "select", maxSelect: 1, values: ["till_cash", "petty_cash", "cheque", "e_transfer", "next_pay"] },
    { name: "reimbursed_ref", type: "text", max: 80 },
    { name: "reimbursed_at", type: "date" },
  ], ["CREATE UNIQUE INDEX idx_expenses_number ON expenses (number) WHERE number != ''", "CREATE INDEX idx_expenses_claimant ON expenses (claimant, status)"]);
  base(app, "petty_cash", [
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["top_up", "expense", "reimburse", "count", "adjust"] },
    { name: "amount_cents", type: "number", onlyInt: true },         // + into the box, − out of it
    { name: "balance_cents", type: "number", onlyInt: true },        // what should be in the box after it
    { name: "counted_cents", type: "number", onlyInt: true },        // count: what was there
    { name: "expense", type: "text", max: 15 },
    { name: "note", type: "text", max: 300 },
    { name: "by_name", type: "text", max: 80 },
  ], ["CREATE INDEX idx_petty_cash ON petty_cash (created_at)"]);
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
  ["petty_cash", "expenses"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

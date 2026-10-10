/// <reference path="../../pb_data/types.d.ts" />
// P4 step 8: the books and period close (FR-10.06, P4-d, BR-34). A small chart of accounts the accountant can
// rename and map to their own codes (QuickBooks/Xero); the journal itself is derived from Chedam's records
// by fixed rules (lib/books.js), never keyed. Months are closed (a snapshot of each account's activity) and
// then refuse changes dated in them; only the owner reopens, with a reason. Down drops exactly what up adds.

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
  ["books.manage", "money", "The books: chart of accounts, journal, closing months", false, true],
];
const GRANTS = { accountant: ["books.manage"] };
// [system_key, code, name, type]
const CHART = [
  ["cash", "1000", "Cash on hand (tills and safe)", "asset"], ["petty_cash", "1010", "Petty cash", "asset"], ["deposits_in_transit", "1020", "Cash deposits in transit", "asset"],
  ["bank_clearing", "1030", "Bank payments not yet on a statement", "asset"], ["card_clearing", "1100", "Card sales to be deposited", "asset"],
  ["platform_clearing", "1110", "Delivery platform sales to be paid out", "asset"], ["exchange_clearing", "1120", "Exchanges", "asset"], ["ar", "1200", "Accounts receivable", "asset"],
  ["inventory", "1300", "Inventory", "asset"], ["gst_receivable", "1400", "GST/HST paid (input tax credits)", "asset"], ["transfers", "1950", "Transfers between accounts", "asset"],
  ["bank_suspense", "1990", "Bank lines to match", "asset"],
  ["ap", "2000", "Accounts payable", "liability"], ["grni", "2010", "Goods received, not billed", "liability"], ["credit_card", "2050", "Store credit card", "liability"],
  ["gst_payable", "2100", "GST/HST collected", "liability"], ["pst_payable", "2110", "PST collected", "liability"], ["other_tax_payable", "2120", "Other taxes collected", "liability"],
  ["deposits_fees", "2150", "Container deposits and eco fees collected", "liability"], ["customer_deposits", "2200", "Customer deposits (layaways, orders)", "liability"],
  ["store_credit_liab", "2210", "Store credit owed", "liability"], ["wages_payable", "2300", "Wages payable", "liability"], ["source_deductions", "2310", "CPP, EI and income tax to remit", "liability"],
  ["other_deductions", "2320", "Other payroll deductions", "liability"], ["employee_payable", "2330", "Owed to employees (expenses)", "liability"], ["cra_payments", "2400", "CRA payments (to allocate)", "liability"],
  ["loans", "2500", "Loans", "liability"],
  ["owner_equity", "3000", "Owner's equity", "equity"], ["owner_draws", "3100", "Owner draws", "equity"],
  ["sales", "4000", "Sales", "income"], ["restocking_fees", "4010", "Restocking fees", "income"], ["interest_income", "4900", "Interest income", "income"],
  ["cogs", "5000", "Cost of goods sold", "cogs"], ["shrink", "5100", "Stock losses and adjustments", "cogs"],
  ["wages", "6000", "Wages", "expense"], ["employer_contrib", "6010", "Employer CPP and EI", "expense"], ["card_fees", "6100", "Card processing fees", "expense"],
  ["platform_commission", "6110", "Delivery platform commission and fees", "expense"], ["bank_fees", "6120", "Bank fees", "expense"], ["cash_over_short", "6130", "Cash over and short", "expense"],
  ["rounding", "6140", "Cash rounding", "expense"],
  ["exp:Supplies", "6200", "Supplies", "expense"], ["exp:Cleaning", "6210", "Cleaning", "expense"], ["exp:Repairs and maintenance", "6220", "Repairs and maintenance", "expense"],
  ["exp:Fuel and travel", "6230", "Fuel and travel", "expense"], ["exp:Meals", "6240", "Meals", "expense"], ["exp:Office", "6250", "Office", "expense"], ["exp:Shop equipment", "6260", "Shop equipment", "expense"],
  ["exp:Bank fees", "6270", "Bank fees (expense claims)", "expense"], ["exp:Advertising", "6280", "Advertising", "expense"], ["exp:Rent", "6300", "Rent", "expense"], ["exp:Utilities", "6310", "Utilities", "expense"],
  ["exp:Insurance", "6320", "Insurance", "expense"], ["exp:Other", "6900", "Other expenses", "expense"], ["exp:Uncategorized", "6990", "Uncategorized", "expense"],
];

migrate((app) => {
  base(app, "accounts", [
    { name: "system_key", type: "text", required: true, max: 60 },
    { name: "code", type: "text", required: true, max: 20 },
    { name: "name", type: "text", required: true, max: 120 },
    { name: "type", type: "select", required: true, maxSelect: 1, values: ["asset", "liability", "equity", "income", "cogs", "expense"] },
    { name: "external_code", type: "text", max: 40 },                         // the accountant's own account (QuickBooks/Xero)
    { name: "active", type: "bool" },
    { name: "note", type: "text", max: 300 },
  ], ["CREATE UNIQUE INDEX idx_accounts_key ON accounts (system_key)"]);
  base(app, "periods", [
    { name: "month", type: "text", required: true, max: 7 },                  // YYYY-MM
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "closed"] },
    { name: "snapshot", type: "json", maxSize: 200000 },                       // {key: {dr, cr}} activity of the month at close
    { name: "warnings", type: "json", maxSize: 20000 },                        // what was open when it was closed
    { name: "closed_by", type: "text", max: 80 },
    { name: "closed_at", type: "date" },
    { name: "reopened_by", type: "text", max: 80 },
    { name: "reopen_reason", type: "text", max: 300 },
  ], ["CREATE UNIQUE INDEX idx_periods_month ON periods (month)"]);
  const acc = app.findCollectionByNameOrId("accounts");
  CHART.forEach(([key, code, name, type]) => {
    const r = new Record(acc);
    r.load({ system_key: key, code: code, name: name, type: type, active: true });
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
  ["periods", "accounts"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

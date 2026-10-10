/// <reference path="../../pb_data/types.d.ts" />
// P2 step 3: customers and loyalty (FR-7.01-7.06, 7.08, 4.12, BR-24). Customers are identified, never
// contacted (DL-16): a first name and a phone number and/or a loyalty card. Points live on the customer;
// every change is a ledger row. The programme is off until the owner sets it (Q6, DL-116).
// All three tables change only through /api/chedam/customers... and the sale/return endpoints.
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
  const c = new Collection({ type: "base", name: name, listRule: ACTIVE, viewRule: ACTIVE, createRule: null, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [] });
  app.save(c);
  return c;
}

// [code, area, label, owner_only, sensitive]
const PERMS = [
  ["customers.view", "customers", "Find customers and join them at the till", false, false],
  ["customers.manage", "customers", "Edit customers, adjust points, cards, data requests", false, true],
  ["loyalty.manage", "customers", "Set the loyalty programme (points per dollar, value, rules)", true, true],
];
const GRANTS = { manager: ["customers.view", "customers.manage"], cashier: ["customers.view"], staff: ["customers.view"] };

const SETTINGS = [
  ["loyalty.program", { enabled: false, points_per_dollar: 1, points_per_dollar_off: 100, min_redeem: 500, earn_on_promotions: true,
    exclude_categories: [], expiry_months: 0, set_by_owner: false },
    "Loyalty programme (FR-7.03): off until the owner sets it. Points per $1 spent (after discounts, before tax), points for $1 off, minimum to redeem, points on deals, categories without points, expiry"],
  ["loyalty.next_card", 1, "Next loyalty card serial (cards are 13-digit numbers starting 29, with a check digit)"],
];

const SALE_FIELDS = [
  { name: "customer", type: "text", max: 15 },
  { name: "loyalty_earned", type: "number", onlyInt: true },
  { name: "loyalty_redeemed", type: "number", onlyInt: true },
  { name: "loyalty_redeem_cents", type: "number", onlyInt: true },
  { name: "loyalty_balance", type: "number", onlyInt: true },
];
const RETURN_FIELDS = [
  { name: "loyalty_reversed", type: "number", onlyInt: true },      // earned points taken back
  { name: "loyalty_returned", type: "number", onlyInt: true },      // redeemed points given back
];

migrate((app) => {
  const customers = base(app, "customers", [
    { name: "first_name", type: "text", required: true, max: 60 },
    { name: "phone", type: "text", max: 20 },                       // digits only
    { name: "phone_hash", type: "text", max: 64 },                  // for the till's offline lookup (no phone numbers on tills)
    { name: "card", type: "text", max: 20 },                        // the card in use
    { name: "points", type: "number", onlyInt: true },
    { name: "agreed", type: "bool" },                               // "customer agreed" at joining (FR-7.02)
    { name: "agreed_at", type: "date" },
    { name: "notes", type: "text", max: 500 },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["active", "erased"] },
    { name: "visits", type: "number", onlyInt: true },
    { name: "spent_cents", type: "number", onlyInt: true },
    { name: "last_visit_at", type: "date" },
  ], ["CREATE UNIQUE INDEX idx_customers_phone ON customers (phone) WHERE phone != '' AND status = 'active'",
      "CREATE INDEX idx_customers_card ON customers (card)", "CREATE INDEX idx_customers_hash ON customers (phone_hash)"]);
  base(app, "loyalty_cards", [
    { name: "number", type: "text", required: true, max: 20 },
    { name: "customer", type: "relation", collectionId: customers.id, maxSelect: 1, cascadeDelete: false },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["new", "active", "blocked"] },
    { name: "batch", type: "text", max: 20 },
  ], ["CREATE UNIQUE INDEX idx_loyalty_cards_number ON loyalty_cards (number)"]);
  base(app, "loyalty_ledger", [
    { name: "customer", type: "relation", required: true, collectionId: customers.id, maxSelect: 1, cascadeDelete: false },
    { name: "type", type: "select", required: true, maxSelect: 1, values: ["earn", "redeem", "reverse_earn", "return_redeem", "adjust", "move_in", "move_out", "expire"] },
    { name: "points", type: "number", onlyInt: true },               // + or -
    { name: "balance_after", type: "number", onlyInt: true },
    { name: "sale", type: "text", max: 15 },
    { name: "return_id", type: "text", max: 15 },
    { name: "note", type: "text", max: 200 },
  ], ["CREATE INDEX idx_loyalty_ledger_customer ON loyalty_ledger (customer, created_at)"]);

  const sales = app.findCollectionByNameOrId("sales");
  SALE_FIELDS.forEach((f) => sales.fields.add(new Field(f)));
  sales.addIndex("idx_sales_customer", false, "customer", "customer != ''");
  app.save(sales);
  const returns = app.findCollectionByNameOrId("returns");
  RETURN_FIELDS.forEach((f) => returns.fields.add(new Field(f)));
  app.save(returns);

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
  const returns = app.findCollectionByNameOrId("returns");
  RETURN_FIELDS.forEach((f) => returns.fields.removeByName(f.name));
  app.save(returns);
  const sales = app.findCollectionByNameOrId("sales");
  sales.removeIndex("idx_sales_customer");
  SALE_FIELDS.forEach((f) => sales.fields.removeByName(f.name));
  app.save(sales);
  ["loyalty_ledger", "loyalty_cards", "customers"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

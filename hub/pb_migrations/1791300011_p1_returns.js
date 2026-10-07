/// <reference path="../../pb_data/types.d.ts" />
// P1 step 6: returns and exchanges (FR-4.07-4.11, 4.13, 4.14; BR-17, BR-23) and store credit (FR-3.08).
// Everything changes only through /api/chedam/returns... (one transaction each), so the generic API is
// read-only. Return policy defaults follow Q2 (30 days, $50 cashier limit, store credit without receipt),
// owner-editable. Down drops exactly what up creates.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];

const TABLES = ["returns", "return_lines", "store_credits", "refunds"];

const SETTINGS = [
  ["returns.window_days", 30, "Days a sale can be returned (FR-4.07); a category can set its own (Q2)"],
  ["returns.cashier_limit_cents", 5000, "Refunds above this need a manager's PIN (BR-17, Q2)"],
  ["returns.lowest_price_days", 30, "No-receipt returns are credited at the lowest price in these days (FR-4.10)"],
  ["returns.restocking_fee_pct", 0, "Restocking fee (%) the cashier may apply to items going back to stock; 0 = none"],
];

const PERMISSIONS = [["sales.return", "sell", "Take returns and exchanges (within the store's limits)", false, false]];
const GRANTS = { manager: ["sales.return"], cashier: ["sales.return"] };

function base(app, name, fields, indexes) {
  const c = new Collection({
    type: "base", name: name,
    listRule: ACTIVE, viewRule: ACTIVE, createRule: null, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [],
  });
  app.save(c);
  return c;
}

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const sales = app.findCollectionByNameOrId("sales");
  const lines = app.findCollectionByNameOrId("sale_lines");
  const tills = app.findCollectionByNameOrId("tills");
  const products = app.findCollectionByNameOrId("products");
  const units = app.findCollectionByNameOrId("selling_units");

  const returns = base(app, "returns", [
    { name: "number", type: "text", required: true, max: 20 },               // R-000001
    { name: "sale", type: "relation", collectionId: sales.id, maxSelect: 1, cascadeDelete: false },   // empty: no receipt
    { name: "till", type: "relation", collectionId: tills.id, maxSelect: 1, cascadeDelete: false },
    { name: "cashier", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["completed"] },
    { name: "receipt", type: "bool" },                                         // the sale was found
    { name: "reason", type: "text", max: 300 },
    { name: "tax_mode", type: "text", max: 20 },
    { name: "net_cents", type: "number", onlyInt: true },                     // goods, after discounts
    { name: "tax_cents", type: "number", onlyInt: true },
    { name: "deposit_cents", type: "number", onlyInt: true },
    { name: "fee_cents", type: "number", onlyInt: true },                     // restocking fee kept
    { name: "refund_cents", type: "number", onlyInt: true },                  // owed to the customer
    { name: "rounding_cents", type: "number", onlyInt: true },                // cash refund to 5 cents (BR-16)
    { name: "paid_cents", type: "number", onlyInt: true },                    // refunded, incl. rounding
    { name: "taxes", type: "json", maxSize: 4000 },                           // [{code, label, rate, tax_cents}]
    { name: "approvals", type: "json", maxSize: 4000 },
    { name: "exchange_sale", type: "relation", collectionId: sales.id, maxSelect: 1, cascadeDelete: false },
    { name: "cost_cents", type: "number", onlyInt: true },
    { name: "reprints", type: "number", onlyInt: true, min: 0 },
    { name: "drawer_opened", type: "bool" },
    { name: "completed_at", type: "date" },
    { name: "device_time", type: "text", max: 40 },
  ], ["CREATE UNIQUE INDEX idx_returns_number ON returns (number)", "CREATE INDEX idx_returns_sale ON returns (sale)",
      "CREATE INDEX idx_returns_till ON returns (till)"]);

  base(app, "return_lines", [
    { name: "return", type: "relation", required: true, collectionId: returns.id, maxSelect: 1, cascadeDelete: false },
    { name: "line_no", type: "number", onlyInt: true },
    { name: "sale_line", type: "relation", collectionId: lines.id, maxSelect: 1, cascadeDelete: false },
    { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "selling_unit", type: "relation", collectionId: units.id, maxSelect: 1, cascadeDelete: false },
    { name: "name", type: "text", max: 200 },
    { name: "qty", type: "number" },
    { name: "base_qty", type: "number" },
    { name: "price_cents", type: "number", onlyInt: true },                   // no receipt: the lowest price used
    { name: "net_cents", type: "number", onlyInt: true },
    { name: "taxes", type: "json", maxSize: 2000 },                           // [{code, rate, tax_cents}]
    { name: "tax_cents", type: "number", onlyInt: true },
    { name: "deposit_cents", type: "number", onlyInt: true },
    { name: "fee_cents", type: "number", onlyInt: true },
    { name: "disposition", type: "select", required: true, maxSelect: 1, values: ["restock", "damaged", "vendor", "dispose"] },
    { name: "cost_cents", type: "number", onlyInt: true },
    { name: "lot", type: "text", max: 20 },
  ], ["CREATE INDEX idx_return_lines_return ON return_lines (return)", "CREATE INDEX idx_return_lines_sale_line ON return_lines (sale_line)"]);

  // Store credit (FR-3.08, FR-4.10): a code printed on the return slip, spent at the till.
  const credits = base(app, "store_credits", [
    { name: "code", type: "text", required: true, max: 20 },                  // SC-7KQ2-M9XD
    { name: "issued_cents", type: "number", onlyInt: true, min: 0 },
    { name: "balance_cents", type: "number", onlyInt: true, min: 0 },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["active", "used", "void"] },
    { name: "source_return", type: "relation", collectionId: returns.id, maxSelect: 1, cascadeDelete: false },
    { name: "note", type: "text", max: 300 },
  ], ["CREATE UNIQUE INDEX idx_store_credits_code ON store_credits (code)"]);

  base(app, "refunds", [
    { name: "return", type: "relation", required: true, collectionId: returns.id, maxSelect: 1, cascadeDelete: false },
    { name: "method", type: "select", required: true, maxSelect: 1, values: ["cash", "card", "store_credit", "exchange"] },
    { name: "amount_cents", type: "number", onlyInt: true },                  // given back, CAD (cash: after rounding)
    { name: "reference", type: "text", max: 60 },
    { name: "last4", type: "text", max: 4, pattern: "^([0-9]{4})?$" },
    { name: "credit", type: "relation", collectionId: credits.id, maxSelect: 1, cascadeDelete: false },
  ], ["CREATE INDEX idx_refunds_return ON refunds (return)"]);

  // An exchange pays the new sale with the returned goods' value.
  const pay = app.findCollectionByNameOrId("payments");
  const m = pay.fields.getByName("method");
  m.values = ["cash", "card", "usd_cash", "store_credit", "platform", "exchange"];
  app.save(pay);

  const ids = {};
  PERMISSIONS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    const p = new Record(app.findCollectionByNameOrId("permissions"));
    p.load({ code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive });
    p.set("created_by", "system"); p.set("updated_by", "system");
    app.save(p);
    ids[code] = p.id;
  });
  Object.keys(GRANTS).forEach((roleCode) => {
    const role = app.findFirstRecordByData("roles", "code", roleCode);
    role.set("permissions", role.get("permissions").concat(GRANTS[roleCode].map((c) => ids[c])));
    role.set("updated_by", "system");
    app.save(role);
  });
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => {
    try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* already gone */ }
  });
  const ids = PERMISSIONS.map(([code]) => {
    try { return app.findFirstRecordByData("permissions", "code", code).id; } catch (_) { return ""; }
  });
  Object.keys(GRANTS).forEach((roleCode) => {
    const role = app.findFirstRecordByData("roles", "code", roleCode);
    role.set("permissions", role.get("permissions").filter((id) => ids.indexOf(id) < 0));
    role.set("updated_by", "system");
    app.save(role);
  });
  ids.forEach((id) => { if (id) app.delete(app.findRecordById("permissions", id)); });
  const pay = app.findCollectionByNameOrId("payments");
  pay.fields.getByName("method").values = ["cash", "card", "usd_cash", "store_credit", "platform"];
  app.save(pay);
  TABLES.slice().reverse().forEach((name) => app.delete(app.findCollectionByNameOrId(name)));
});

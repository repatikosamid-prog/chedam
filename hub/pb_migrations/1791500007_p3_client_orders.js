/// <reference path="../../pb_data/types.d.ts" />
// P3 step 7: layaway, special orders, quotes, house accounts (FR-3.18-3.20, 6.10). client_orders: a layaway
// (stock reserved, deposit, balance, pickup), a special order (ordered from a vendor, reserved when it arrives)
// or a quote (prices agreed until a date; becomes an order, a sale or an invoice). Deposits and refunds are
// money at a till (client_order_payments). At pickup the till applies the deposit as a payment ("deposit");
// a client with a house account can charge a sale to it ("house_account": an invoice is made). Down drops
// exactly what up adds.

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
const SETTINGS = [
  ["orders.layaway", { min_deposit_pct: 20, days: 30 }, "Layaway (FR-3.18): the smallest deposit (% of the total) and how many days the goods are kept"],
  ["orders.quote_days", 14, "Quotes are valid for this many days (FR-3.19)"],
];

migrate((app) => {
  const orders = base(app, "client_orders", [
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["layaway", "special_order", "quote"] },
    { name: "number", type: "text", max: 20 },                       // LA-…, SO-…, QT-…
    { name: "party", type: "text", max: 15 },                        // a client (house account), or
    { name: "customer", type: "text", max: 15 },                     // a loyalty member, or
    { name: "name", type: "text", max: 80 },                         // a first name and a phone for anyone else
    { name: "phone", type: "text", max: 30 },
    { name: "lines", type: "json", maxSize: 60000 },                 // [{product, selling_unit, name, qty, base, price_cents, total_cents}]
    { name: "total_cents", type: "number", onlyInt: true },          // before tax
    { name: "deposit_required_cents", type: "number", onlyInt: true },
    { name: "paid_cents", type: "number", onlyInt: true },           // deposits taken, less refunds
    { name: "applied_cents", type: "number", onlyInt: true },        // used at the till
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "ordered", "ready", "picked_up", "cancelled", "expired", "converted"] },
    { name: "reserved", type: "bool" },
    { name: "due_date", type: "text", max: 10 },                     // layaway: picked up by; quote: valid until
    { name: "po", type: "text", max: 15 },                           // special order: the purchase order
    { name: "sale", type: "text", max: 15 },                         // the sale at pickup
    { name: "converted_to", type: "text", max: 40 },                 // quote: "order:<id>" | "invoice:<id>" | "sale"
    { name: "notes", type: "text", max: 1000 },
  ], ["CREATE UNIQUE INDEX idx_client_orders_number ON client_orders (number) WHERE number != ''", "CREATE INDEX idx_client_orders_status ON client_orders (kind, status)"]);
  base(app, "client_order_payments", [
    { name: "order", type: "relation", required: true, collectionId: orders.id, maxSelect: 1, cascadeDelete: false },
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["deposit", "refund"] },
    { name: "method", type: "select", required: true, maxSelect: 1, values: ["cash", "card"] },
    { name: "amount_cents", type: "number", onlyInt: true },
    { name: "till", type: "text", max: 15 },
    { name: "by_name", type: "text", max: 80 },
  ], ["CREATE INDEX idx_cop_till ON client_order_payments (till)"]);
  // Payments of a sale can now be a deposit applied or a charge to a house account
  const pay = app.findCollectionByNameOrId("payments");
  const m = pay.fields.getByName("method");
  m.values = m.values.concat(["deposit", "house_account"]);
  app.save(pay);
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  const pay = app.findCollectionByNameOrId("payments");
  const m = pay.fields.getByName("method");
  m.values = m.values.filter((v) => v !== "deposit" && v !== "house_account");
  app.save(pay);
  ["client_order_payments", "client_orders"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

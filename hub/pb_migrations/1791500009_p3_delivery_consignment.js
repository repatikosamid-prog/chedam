/// <reference path="../../pb_data/types.d.ts" />
// P3 step 9: delivery-app orders (manual mode) and consignment stock (FR-8.09, 6.14). Delivery orders are typed
// in from the platform's tablet: accepted (stock reserved) → preparing → picked up (a sale at the platform's
// prices, paid by the platform) or cancelled (released). Platform prices per product. Consignment: products
// owned by a vendor until sold; each sale (less returns) is owed to the vendor and billed from the list.
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
const SETTINGS = [["delivery.platforms", ["Uber Eats", "DoorDash", "SkipTheDishes"], "Delivery platforms the store takes orders from (FR-8.09)"]];

migrate((app) => {
  base(app, "delivery_orders", [
    { name: "platform", type: "text", required: true, max: 40 },
    { name: "number", type: "text", required: true, max: 40 },        // the platform's order number
    { name: "customer_name", type: "text", max: 80 },
    { name: "lines", type: "json", maxSize: 30000 },                  // [{product, selling_unit, name, qty, base, price_cents, total_cents}]
    { name: "total_cents", type: "number", onlyInt: true },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["accepted", "preparing", "picked_up", "cancelled"] },
    { name: "sale", type: "text", max: 15 },
    { name: "notes", type: "text", max: 500 },
    { name: "picked_up_at", type: "date" },
  ], ["CREATE UNIQUE INDEX idx_delivery_orders ON delivery_orders (platform, number)"]);
  base(app, "platform_prices", [
    { name: "platform", type: "text", required: true, max: 40 },
    { name: "selling_unit", type: "relation", required: true, collectionId: app.findCollectionByNameOrId("selling_units").id, maxSelect: 1, cascadeDelete: false },
    { name: "product", type: "relation", required: true, collectionId: app.findCollectionByNameOrId("products").id, maxSelect: 1, cascadeDelete: false },
    { name: "price_cents", type: "number", onlyInt: true, min: 0 },
    { name: "available", type: "bool" },
  ], ["CREATE UNIQUE INDEX idx_platform_prices ON platform_prices (platform, selling_unit)"]);
  base(app, "consignment_sales", [
    { name: "vendor", type: "text", required: true, max: 15 },
    { name: "product", type: "text", required: true, max: 15 },
    { name: "sale", type: "text", max: 15 },
    { name: "return_id", type: "text", max: 15 },
    { name: "qty_base", type: "number" },                              // − for a return
    { name: "amount_cents", type: "number", onlyInt: true },           // owed to the vendor (− for a return)
    { name: "bill", type: "text", max: 15 },                           // the vendor bill it went on
  ], ["CREATE INDEX idx_consignment_sales ON consignment_sales (vendor, bill)"]);
  const p = app.findCollectionByNameOrId("products");
  p.fields.add(new Field({ name: "consignment_vendor", type: "text", max: 15 }));
  p.fields.add(new Field({ name: "consignment_cost_cents", type: "number", onlyInt: true, min: 0 }));   // owed per base unit sold
  app.save(p);
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  const p = app.findCollectionByNameOrId("products");
  p.fields.removeByName("consignment_vendor"); p.fields.removeByName("consignment_cost_cents");
  app.save(p);
  ["consignment_sales", "platform_prices", "delivery_orders"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

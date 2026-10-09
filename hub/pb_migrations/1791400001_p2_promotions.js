/// <reference path="../../pb_data/types.d.ts" />
// P2 step 1: promotions and scheduled prices (FR-5.06-5.10, BR-20, 21, 25). Rules: lib/promotions_core.js
// (shared with the offline till) and lib/promotions.js. Both tables change only through
// /api/chedam/promotions and /api/chedam/scheduled-prices (checks and labels in one transaction), so the
// generic API is read-only. Sale lines keep which deal they got. Permission promotions.manage (managers;
// the owner has every permission). Down drops exactly what up adds.

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
  const c = new Collection({
    type: "base", name: name,
    listRule: ACTIVE, viewRule: ACTIVE, createRule: null, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [],
  });
  app.save(c);
  return c;
}

const PERM = ["promotions.manage", "promotions", "Create, change and end promotions and scheduled prices", false, true];
const GRANTS = ["manager"];

const SALE_LINE_FIELDS = [
  { name: "promo_cents", type: "number", onlyInt: true },          // part of line_discount_cents that came from promotions
  { name: "promo_label", type: "text", max: 200 },                  // the deal, as shown on the receipt
  { name: "promotions", type: "json", maxSize: 2000 },              // ids of the promotions applied
];
const SALE_FIELDS = [
  { name: "promotions", type: "json", maxSize: 8000 },              // [{id, name, times, saving_cents}]
  { name: "coupons", type: "json", maxSize: 1000 },                 // codes entered
];

migrate((app) => {
  const products = app.findCollectionByNameOrId("products");
  const categories = app.findCollectionByNameOrId("categories");
  const units = app.findCollectionByNameOrId("selling_units");

  base(app, "promotions", [
    { name: "name", type: "text", required: true, max: 80 },
    { name: "type", type: "select", required: true, maxSelect: 1, values: ["pct_off", "amount_off", "fixed_price", "buy_get", "multi_price", "mix_match", "spend"] },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "active", "ended"] },
    { name: "pct", type: "number", min: 0, max: 100 },
    { name: "amount_cents", type: "number", onlyInt: true, min: 0 },
    { name: "price_cents", type: "number", onlyInt: true, min: 0 },
    { name: "buy_qty", type: "number", onlyInt: true, min: 0 },
    { name: "get_qty", type: "number", onlyInt: true, min: 0 },
    { name: "reward", type: "select", maxSelect: 1, values: ["pct", "amount", "free"] },
    { name: "threshold_cents", type: "number", onlyInt: true, min: 0 },
    { name: "products", type: "relation", collectionId: products.id, maxSelect: 2000, cascadeDelete: false },
    { name: "categories", type: "relation", collectionId: categories.id, maxSelect: 200, cascadeDelete: false },
    { name: "exclude", type: "relation", collectionId: products.id, maxSelect: 2000, cascadeDelete: false },
    { name: "starts_at", type: "date" },
    { name: "ends_at", type: "date" },
    { name: "days", type: "json", maxSize: 200 },                  // [0-6], Sunday 0; empty = every day
    { name: "hours_from", type: "text", max: 5 },                   // "HH:MM", store time
    { name: "hours_to", type: "text", max: 5 },
    { name: "coupon_code", type: "text", max: 30 },
    { name: "stackable", type: "bool" },
    { name: "per_transaction", type: "number", onlyInt: true, min: 0 },   // 0 = no limit
    { name: "per_customer", type: "number", onlyInt: true, min: 0 },      // used once customers arrive (P2 step 3)
    { name: "max_uses", type: "number", onlyInt: true, min: 0 },
    { name: "uses", type: "number", onlyInt: true, min: 0 },
    { name: "labels", type: "bool" },                               // queue shelf labels when it starts and ends (BR-25)
    { name: "labels_started", type: "bool" },                       // done by the minute job
    { name: "labels_ended", type: "bool" },
    { name: "note", type: "text", max: 500 },
  ], ["CREATE INDEX idx_promotions_status ON promotions (status, starts_at, ends_at)",
      "CREATE UNIQUE INDEX idx_promotions_coupon ON promotions (coupon_code) WHERE coupon_code != '' AND deleted_at = ''"]);

  base(app, "scheduled_prices", [
    { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "selling_unit", type: "relation", required: true, collectionId: units.id, maxSelect: 1, cascadeDelete: false },
    { name: "price_cents", type: "number", onlyInt: true, min: 1 },
    { name: "starts_at", type: "date", required: true },
    { name: "ends_at", type: "date" },                             // empty: until changed
    { name: "note", type: "text", max: 200 },
    { name: "labels_started", type: "bool" },
    { name: "labels_ended", type: "bool" },
  ], ["CREATE INDEX idx_scheduled_prices_unit ON scheduled_prices (selling_unit, starts_at)"]);

  const lines = app.findCollectionByNameOrId("sale_lines");
  SALE_LINE_FIELDS.forEach((f) => lines.fields.add(new Field(f)));
  app.save(lines);
  const sales = app.findCollectionByNameOrId("sales");
  SALE_FIELDS.forEach((f) => sales.fields.add(new Field(f)));
  app.save(sales);

  const p = new Record(app.findCollectionByNameOrId("permissions"));
  p.load({ code: PERM[0], area: PERM[1], label: PERM[2], owner_only: PERM[3], sensitive: PERM[4] });
  p.set("created_by", "system"); p.set("updated_by", "system");
  app.save(p);
  GRANTS.forEach((code) => {
    const role = app.findFirstRecordByData("roles", "code", code);
    role.set("permissions", role.get("permissions").concat([p.id]));
    role.set("updated_by", "system");
    app.save(role);
  });
}, (app) => {
  let id = "";
  try { id = app.findFirstRecordByData("permissions", "code", PERM[0]).id; } catch (_) { id = ""; }
  if (id) {
    GRANTS.forEach((code) => {
      const role = app.findFirstRecordByData("roles", "code", code);
      role.set("permissions", role.get("permissions").filter((x) => x !== id));
      role.set("updated_by", "system");
      app.save(role);
    });
    app.delete(app.findRecordById("permissions", id));
  }
  const sales = app.findCollectionByNameOrId("sales");
  SALE_FIELDS.forEach((f) => sales.fields.removeByName(f.name));
  app.save(sales);
  const lines = app.findCollectionByNameOrId("sale_lines");
  SALE_LINE_FIELDS.forEach((f) => lines.fields.removeByName(f.name));
  app.save(lines);
  app.delete(app.findCollectionByNameOrId("scheduled_prices"));
  app.delete(app.findCollectionByNameOrId("promotions"));
});

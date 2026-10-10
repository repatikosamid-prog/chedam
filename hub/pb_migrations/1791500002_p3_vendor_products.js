/// <reference path="../../pb_data/types.d.ts" />
// P3 step 2: vendor products and price lists (FR-8.02). What each vendor sells the store: their code (SKU),
// the unit it comes in (one of the product's selling units, e.g. a case of 24), its cost in the vendor's
// currency, minimum order, lead time, preferred vendor. Price lists are imported (CSV/Excel) and matched by
// barcode or the vendor's code. Purchasing permissions for this step and the next ones. Down drops exactly
// what up adds.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';
const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
const PERMS = [
  ["purchasing.view", "buying", "See vendor prices, purchase orders and bills", false, false],
  ["purchasing.manage", "buying", "Vendor prices, purchase orders, receiving against them, vendor returns", false, true],
];
const GRANTS = { manager: ["purchasing.view", "purchasing.manage"], accountant: ["purchasing.view"], staff: ["purchasing.view"] };

migrate((app) => {
  const parties = app.findCollectionByNameOrId("parties");
  app.save(new Collection({ type: "base", name: "vendor_products", listRule: ACTIVE, viewRule: ACTIVE, createRule: ACTIVE, updateRule: ACTIVE, deleteRule: null,
    fields: [
      { name: "vendor", type: "relation", required: true, collectionId: parties.id, maxSelect: 1, cascadeDelete: false },
      { name: "product", type: "relation", required: true, collectionId: app.findCollectionByNameOrId("products").id, maxSelect: 1, cascadeDelete: false },
      { name: "selling_unit", type: "relation", collectionId: app.findCollectionByNameOrId("selling_units").id, maxSelect: 1, cascadeDelete: false },
      { name: "vendor_sku", type: "text", max: 60 },
      { name: "description", type: "text", max: 200 },               // the vendor's own name for it
      { name: "pack_qty", type: "number", min: 0 },                   // base units in one order unit
      { name: "cost_cents", type: "number", onlyInt: true, min: 0 },  // per order unit, vendor's currency
      { name: "currency", type: "text", max: 3 },
      { name: "min_order_qty", type: "number", min: 0 },
      { name: "lead_days", type: "number", onlyInt: true, min: 0, max: 365 },
      { name: "preferred", type: "bool" },
      { name: "price_at", type: "date" },                             // when the cost was last set
      { name: "previous_cost_cents", type: "number", onlyInt: true, min: 0 },
      { name: "active", type: "bool" },
    ].concat(COMMON()),
    indexes: ["CREATE INDEX idx_vendor_products_vendor ON vendor_products (vendor)", "CREATE INDEX idx_vendor_products_product ON vendor_products (product)",
      "CREATE UNIQUE INDEX idx_vendor_products_sku ON vendor_products (vendor, vendor_sku) WHERE vendor_sku != '' AND deleted_at = ''"] }));
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
  app.delete(app.findCollectionByNameOrId("vendor_products"));
});

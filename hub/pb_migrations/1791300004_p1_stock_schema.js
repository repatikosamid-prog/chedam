/// <reference path="../../pb_data/types.d.ts" />
// P1 step 2: stock tables (Master Spec Section 10; FR-6.01-6.08). Quantities are in the product's base
// unit (DL-64). Stock changes only through /api/chedam/stock/... endpoints (one transaction each,
// BR-10), so every table is read-only through the generic API. Down drops exactly what up creates.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];

const TABLES = ["stock_levels", "stock_lots", "stock_movements", "stock_counts", "stock_count_lines"];

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
  const products = app.findCollectionByNameOrId("products");
  const units = app.findCollectionByNameOrId("selling_units");
  const areas = app.findCollectionByNameOrId("storage_areas");

  // One row per product (FR-6.01). on_hand = loose + sum(sealed[unit] x unit.base_qty); may go negative
  // only through offline sales (BR-12).
  base(app, "stock_levels", [
    { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "loose_qty", type: "number" },
    { name: "sealed", type: "json", maxSize: 4000 },          // {selling_unit_id: count of sealed packs/cases}
    { name: "on_hand", type: "number" },
    { name: "reserved", type: "number", min: 0 },             // P3 orders
    { name: "incoming", type: "number", min: 0 },             // P3 purchase orders
    { name: "last_received_at", type: "date" },
    { name: "last_counted_at", type: "date" },
  ], ["CREATE UNIQUE INDEX idx_stock_levels_product ON stock_levels (product)"]);

  // A batch received together: expiry and cost per base unit (cents, may have decimals: a case of 24
  // at $20.00 is 83.33 cents each; DL-73). qty = what is left of it.
  const lots = base(app, "stock_lots", [
    { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "lot_code", type: "text", max: 60 },
    { name: "expiry_date", type: "date" },
    { name: "received_qty", type: "number", min: 0 },
    { name: "qty", type: "number", min: 0 },
    { name: "cost_cents", type: "number", min: 0 },
    { name: "storage_area", type: "relation", collectionId: areas.id, maxSelect: 1, cascadeDelete: false },
    { name: "source", type: "select", required: true, maxSelect: 1, values: ["receive", "adjust", "count", "pack", "return"] },
    { name: "received_at", type: "date" },
  ], ["CREATE INDEX idx_stock_lots_product ON stock_lots (product, qty)"]);

  // Every change to stock (Section 10 stock_movements). qty_base is signed. Pending movements (write-offs
  // above the approval value, FR-6.06) change nothing until approved.
  const counts = base(app, "stock_counts", [
    { name: "name", type: "text", required: true, max: 120 },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "submitted", "approved", "cancelled"] },
    { name: "category", type: "relation", collectionId: app.findCollectionByNameOrId("categories").id, maxSelect: 1, cascadeDelete: false },
    { name: "storage_area", type: "relation", collectionId: areas.id, maxSelect: 1, cascadeDelete: false },
    { name: "note", type: "text", max: 1000 },
    { name: "submitted_by", type: "text", max: 64 },
    { name: "submitted_at", type: "date" },
    { name: "approved_by", type: "text", max: 64 },
    { name: "approved_at", type: "date" },
  ]);

  base(app, "stock_count_lines", [
    { name: "count", type: "relation", required: true, collectionId: counts.id, maxSelect: 1, cascadeDelete: false },
    { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "expected_base", type: "number" },                // on hand when this line was counted
    { name: "counted_base", type: "number", min: 0 },
    { name: "counted_detail", type: "json", maxSize: 4000 },  // {loose, sealed: {unit: n}} as counted
    { name: "counted_by", type: "text", max: 64 },
    { name: "counted_at", type: "date" },
  ], ["CREATE UNIQUE INDEX idx_count_lines ON stock_count_lines (count, product)"]);

  base(app, "stock_movements", [
    { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "type", type: "select", required: true, maxSelect: 1,
      values: ["receive", "adjust", "damage", "loss", "count", "pack_break", "pack_make", "sale", "return", "transfer"] },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["posted", "pending", "rejected"] },
    { name: "qty_base", type: "number" },                     // signed, base units
    { name: "selling_unit", type: "relation", collectionId: units.id, maxSelect: 1, cascadeDelete: false },
    { name: "unit_qty", type: "number" },                     // how many of that unit
    { name: "lot", type: "relation", collectionId: lots.id, maxSelect: 1, cascadeDelete: false },
    { name: "lots_taken", type: "json", maxSize: 8000 },      // [{lot, qty, cost_cents}] for decreases (FEFO)
    { name: "cost_cents", type: "number", min: 0 },           // per base unit
    { name: "value_cents", type: "number", onlyInt: true },   // signed value of the change at cost
    { name: "reason", type: "text", max: 80 },
    { name: "note", type: "text", max: 1000 },
    { name: "photo", type: "file", maxSelect: 1, maxSize: 5242880, mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["320x320"] },
    { name: "ref_collection", type: "text", max: 60 },
    { name: "ref_id", type: "text", max: 64 },
    { name: "op_id", type: "text", max: 40 },                 // idempotency (BR-10)
    { name: "op_line", type: "number", onlyInt: true, min: 0 },
    { name: "approved_by", type: "text", max: 64 },
    { name: "approved_at", type: "date" },
  ], [
    "CREATE INDEX idx_movements_product ON stock_movements (product, created_at)",
    "CREATE INDEX idx_movements_type ON stock_movements (type, created_at)",
    "CREATE UNIQUE INDEX idx_movements_op ON stock_movements (op_id, op_line) WHERE op_id != ''",
  ]);
}, (app) => {
  TABLES.slice().reverse().forEach((name) => app.delete(app.findCollectionByNameOrId(name)));
});

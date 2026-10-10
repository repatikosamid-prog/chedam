/// <reference path="../../pb_data/types.d.ts" />
// P3 step 3: purchase orders and min/max reorder (FR-8.03, 6.13). A PO is drafted (by hand or by the reorder
// rules), sent (PDF or print; the store emails or phones it), then received against, partly or in full, with
// the differences flagged; receiving goes through the P1 receive action (P3-c). Sent POs count as incoming
// stock. Products get a "max" next to their reorder point (min). Changed only through
// /api/chedam/purchase-orders. Down drops exactly what up adds.

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

migrate((app) => {
  const products = app.findCollectionByNameOrId("products");
  products.fields.add(new Field({ name: "reorder_max", type: "number", min: 0 }));   // order up to this (base units)
  app.save(products);
  const pos = base(app, "purchase_orders", [
    { name: "number", type: "text", max: 20 },                       // PO-000001
    { name: "vendor", type: "relation", required: true, collectionId: app.findCollectionByNameOrId("parties").id, maxSelect: 1, cascadeDelete: false },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "sent", "partial", "received", "closed", "cancelled"] },
    { name: "source", type: "select", maxSelect: 1, values: ["manual", "reorder"] },
    { name: "currency", type: "text", max: 3 },
    { name: "fx_rate", type: "number", min: 0 },                     // CAD for one unit, on the order date
    { name: "order_date", type: "text", max: 10 },
    { name: "expected_date", type: "text", max: 10 },
    { name: "notes", type: "text", max: 2000 },
    { name: "total_cents", type: "number", onlyInt: true },          // vendor currency
    { name: "total_cad_cents", type: "number", onlyInt: true },
    { name: "sent_at", type: "date" },
    { name: "sent_by", type: "text", max: 64 },
    { name: "received_at", type: "date" },
    { name: "differences", type: "bool" },                           // a receipt did not match the order
  ], ["CREATE UNIQUE INDEX idx_po_number ON purchase_orders (number) WHERE number != ''", "CREATE INDEX idx_po_vendor ON purchase_orders (vendor, status)"]);
  base(app, "po_lines", [
    { name: "po", type: "relation", required: true, collectionId: pos.id, maxSelect: 1, cascadeDelete: false },
    { name: "line_no", type: "number", onlyInt: true, min: 0 },
    { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "selling_unit", type: "relation", required: true, collectionId: app.findCollectionByNameOrId("selling_units").id, maxSelect: 1, cascadeDelete: false },
    { name: "vendor_sku", type: "text", max: 60 },
    { name: "description", type: "text", max: 200 },
    { name: "pack_qty", type: "number", min: 0 },                    // base units in one ordered unit
    { name: "qty", type: "number", min: 0 },                         // ordered units
    { name: "cost_cents", type: "number", onlyInt: true, min: 0 },   // per ordered unit, vendor currency
    { name: "received_qty", type: "number", min: 0 },
    { name: "line_total_cents", type: "number", onlyInt: true },
  ], ["CREATE INDEX idx_po_lines_po ON po_lines (po, line_no)"]);
  base(app, "po_receipts", [
    { name: "po", type: "relation", required: true, collectionId: pos.id, maxSelect: 1, cascadeDelete: false },
    { name: "op_id", type: "text", max: 40 },
    { name: "by_name", type: "text", max: 80 },
    { name: "lines", type: "json", maxSize: 40000 },                 // [{po_line, product, qty, cost_cents, movement}]
    { name: "differences", type: "json", maxSize: 20000 },           // [{po_line, product, kind: short|over|cost|extra, ordered, received, ...}]
    { name: "note", type: "text", max: 1000 },
  ], ["CREATE UNIQUE INDEX idx_po_receipts_op ON po_receipts (op_id) WHERE op_id != ''"]);
}, (app) => {
  ["po_receipts", "po_lines", "purchase_orders"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
  const products = app.findCollectionByNameOrId("products");
  products.fields.removeByName("reorder_max");
  app.save(products);
});

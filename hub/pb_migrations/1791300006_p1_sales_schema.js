/// <reference path="../../pb_data/types.d.ts" />
// P1 step 3: till and checkout tables (Master Spec Section 10; FR-3.01-3.17, FR-4.03-4.06). Money in
// integer cents (BR-01). Everything changes only through /api/chedam/tills/... and /api/chedam/sales/...
// (one transaction each, BR-10), so the generic API is read-only. Down drops exactly what up creates.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];

const TABLES = ["tills", "cash_movements", "sales", "sale_lines", "payments", "tax_exemptions", "holds", "soft_holds"];

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
  const devices = app.findCollectionByNameOrId("devices");
  const products = app.findCollectionByNameOrId("products");
  const units = app.findCollectionByNameOrId("selling_units");

  // A till session: one open per device (FR-3.01).
  const tills = base(app, "tills", [
    { name: "number", type: "number", onlyInt: true, min: 0 },
    { name: "device", type: "relation", required: true, collectionId: devices.id, maxSelect: 1, cascadeDelete: false },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "closed"] },
    { name: "opened_by", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "opened_at", type: "date" },
    { name: "float_cents", type: "number", onlyInt: true, min: 0 },
    { name: "float_detail", type: "json", maxSize: 2000 },        // {denomination_cents: count}
    { name: "closed_by", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "closed_at", type: "date" },
    { name: "counted_cents", type: "number", onlyInt: true },
    { name: "counted_detail", type: "json", maxSize: 2000 },
    { name: "expected_cents", type: "number", onlyInt: true },
    { name: "variance_cents", type: "number", onlyInt: true },
    { name: "z_report", type: "json", maxSize: 20000 },
  ], ["CREATE INDEX idx_tills_device ON tills (device, status)"]);

  // Cash in and out of a drawer that is not a sale: drops to the safe, pay-outs, no-sale opens.
  base(app, "cash_movements", [
    { name: "till", type: "relation", required: true, collectionId: tills.id, maxSelect: 1, cascadeDelete: false },
    { name: "type", type: "select", required: true, maxSelect: 1, values: ["drop", "payout", "float_add", "no_sale"] },
    { name: "amount_cents", type: "number", onlyInt: true, min: 0 },
    { name: "reason", type: "text", max: 200 },
    { name: "by", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
  ], ["CREATE INDEX idx_cash_movements_till ON cash_movements (till)"]);

  const sales = base(app, "sales", [
    { name: "number", type: "text", max: 20 },                    // S-000123, training T-000045
    { name: "till", type: "relation", collectionId: tills.id, maxSelect: 1, cascadeDelete: false },
    { name: "cashier", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["completed", "voided"] },
    { name: "training", type: "bool" },
    { name: "offline", type: "bool" },                             // step 4
    { name: "tax_mode", type: "select", maxSelect: 1, values: ["tax_added", "tax_included"] },
    { name: "subtotal_cents", type: "number", onlyInt: true },     // after line discounts, before cart discount
    { name: "discount_cents", type: "number", onlyInt: true },     // line + cart discounts
    { name: "tax_cents", type: "number", onlyInt: true },
    { name: "deposit_cents", type: "number", onlyInt: true },      // deposits and eco fees (with their tax)
    { name: "total_cents", type: "number", onlyInt: true },        // before cash rounding
    { name: "rounding_cents", type: "number", onlyInt: true },     // BR-16, cash only
    { name: "paid_cents", type: "number", onlyInt: true },
    { name: "change_cents", type: "number", onlyInt: true },
    { name: "taxes", type: "json", maxSize: 4000 },                // [{code, label, rate, base_cents, tax_cents}]
    { name: "exempt", type: "json", maxSize: 1000 },               // {reason, label, reference, types}
    { name: "approvals", type: "json", maxSize: 4000 },            // [{what, by, at}]
    { name: "note", type: "text", max: 500 },
    { name: "items", type: "number" },
    { name: "cost_cents", type: "number", onlyInt: true },
    { name: "completed_at", type: "date" },
    { name: "device_time", type: "text", max: 40 },                // the till's clock (Section 8.2)
    { name: "voided_by", type: "text", max: 64 },
    { name: "voided_at", type: "date" },
    { name: "void_reason", type: "text", max: 300 },
  ], ["CREATE UNIQUE INDEX idx_sales_number ON sales (number)", "CREATE INDEX idx_sales_completed ON sales (completed_at)",
      "CREATE INDEX idx_sales_till ON sales (till)"]);

  base(app, "sale_lines", [
    { name: "sale", type: "relation", required: true, collectionId: sales.id, maxSelect: 1, cascadeDelete: false },
    { name: "line_no", type: "number", onlyInt: true, min: 0 },
    { name: "product", type: "relation", collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "selling_unit", type: "relation", collectionId: units.id, maxSelect: 1, cascadeDelete: false },
    { name: "name", type: "text", max: 200 },                      // as sold
    { name: "qty", type: "number" },                               // units, or weight
    { name: "base_qty", type: "number" },
    { name: "regular_price_cents", type: "number", onlyInt: true },
    { name: "price_cents", type: "number", onlyInt: true },         // per unit (or per kg/lb) charged
    { name: "override_reason", type: "text", max: 200 },
    { name: "gross_cents", type: "number", onlyInt: true },         // price x qty
    { name: "line_discount_cents", type: "number", onlyInt: true },
    { name: "cart_discount_cents", type: "number", onlyInt: true }, // share of the cart discount (BR-21)
    { name: "net_cents", type: "number", onlyInt: true },           // before tax (tax_added) / including tax (tax_included)
    { name: "tax_class", type: "text", max: 40 },
    { name: "taxes", type: "json", maxSize: 2000 },                 // [{code, rate, tax_cents}] this line's share (FR-4.06)
    { name: "deposit_cents", type: "number", onlyInt: true },
    { name: "lots", type: "json", maxSize: 4000 },                  // FEFO lots taken [{lot, qty, cost_cents}]
    { name: "cost_cents", type: "number", onlyInt: true },          // cost of goods at sale
    { name: "age_checked", type: "bool" },
    { name: "voided", type: "bool" },                               // removed from the cart before payment (FR-3.11)
    { name: "tare", type: "number" },
  ], ["CREATE INDEX idx_sale_lines_sale ON sale_lines (sale)", "CREATE INDEX idx_sale_lines_product ON sale_lines (product)"]);

  base(app, "payments", [
    { name: "sale", type: "relation", required: true, collectionId: sales.id, maxSelect: 1, cascadeDelete: false },
    { name: "method", type: "select", required: true, maxSelect: 1, values: ["cash", "card", "usd_cash", "store_credit", "platform"] },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["approved", "declined", "voided"] },
    { name: "amount_cents", type: "number", onlyInt: true },        // CAD applied to the sale
    { name: "tendered_cents", type: "number", onlyInt: true },      // in the tendered currency
    { name: "currency", type: "text", max: 3 },
    { name: "fx_rate", type: "number" },                            // CAD per unit of currency
    { name: "change_cents", type: "number", onlyInt: true },        // CAD
    { name: "reference", type: "text", max: 60 },
    { name: "last4", type: "text", max: 4, pattern: "^([0-9]{4})?$" },
    { name: "processor", type: "text", max: 40 },
  ], ["CREATE INDEX idx_payments_sale ON payments (sale)"]);

  base(app, "tax_exemptions", [
    { name: "sale", type: "relation", required: true, collectionId: sales.id, maxSelect: 1, cascadeDelete: false },
    { name: "reason", type: "text", max: 40 },
    { name: "reference", type: "text", max: 60 },
    { name: "exempt_cents", type: "number", onlyInt: true },        // tax not charged
  ]);

  // Held carts (FR-3.10): recalled on any till.
  base(app, "holds", [
    { name: "label", type: "text", max: 80 },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["held", "recalled", "cancelled"] },
    { name: "cart", type: "json", maxSize: 100000 },
    { name: "total_cents", type: "number", onlyInt: true },
    { name: "items", type: "number" },
    { name: "held_by", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "recalled_by", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "recalled_at", type: "date" },
  ]);

  // Soft holds (BR-13): low-stock items in an open cart, released on sale, removal or expiry.
  base(app, "soft_holds", [
    { name: "cart_id", type: "text", required: true, max: 40 },
    { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "qty_base", type: "number", min: 0 },
    { name: "expires_at", type: "date" },
  ], ["CREATE INDEX idx_soft_holds_product ON soft_holds (product, expires_at)", "CREATE INDEX idx_soft_holds_cart ON soft_holds (cart_id)"]);
}, (app) => {
  TABLES.slice().reverse().forEach((name) => app.delete(app.findCollectionByNameOrId(name)));
});

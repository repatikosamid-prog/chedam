/// <reference path="../../pb_data/types.d.ts" />
// P1 step 1: catalogue and tax tables (Master Spec Section 10; FR-5.01-5.05, FR-4.01, 4.02).
// Common fields on every table, as in P0. Money in integer cents (BR-01); quantities in the product's
// base unit (each, kg or lb, DL-64). API rules: an active Chedam user; lib/access.js decides the rest.
// Down drops exactly what up creates (NFR-20).

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];

// Creation order matters for relations; drop order is the reverse.
const TABLES = ["tax_types", "tax_rates", "tax_classes", "deposits_fees", "categories", "products",
  "selling_units", "price_history"];

// [list, view, create, update, delete]: true = ACTIVE (the hook decides), false = never (null)
const RULES = {
  tax_types:     [true, true, true, true, false],
  tax_rates:     [true, true, true, true, false],
  tax_classes:   [true, true, true, true, false],
  deposits_fees: [true, true, true, true, false],
  categories:    [true, true, true, true, false],
  products:      [true, true, true, true, false],
  selling_units: [true, true, true, true, false],
  price_history: [true, true, false, false, false],
};

function base(app, name, fields, indexes) {
  const r = RULES[name];
  const c = new Collection({
    type: "base",
    name: name,
    listRule: r[0] ? ACTIVE : null, viewRule: r[1] ? ACTIVE : null, createRule: r[2] ? ACTIVE : null,
    updateRule: r[3] ? ACTIVE : null, deleteRule: r[4] ? ACTIVE : null,
    fields: fields.concat(COMMON()),
    indexes: indexes || [],
  });
  app.save(c);
  return c;
}

migrate((app) => {
  // ---- Tax (FR-4.01, 4.02; DL-68) -------------------------------------------------------------
  const taxTypes = base(app, "tax_types", [
    { name: "code", type: "text", required: true, max: 20, pattern: "^[A-Z0-9_]+$" },   // GST, PST, HST
    { name: "name", type: "text", required: true, max: 80 },
    { name: "level", type: "select", required: true, maxSelect: 1, values: ["federal", "provincial", "harmonized"] },
    { name: "receipt_label", type: "text", max: 20 },
    { name: "sort", type: "number", onlyInt: true },
  ], ["CREATE UNIQUE INDEX idx_tax_types_code ON tax_types (code)"]);

  base(app, "tax_rates", [
    { name: "tax_type", type: "relation", required: true, collectionId: taxTypes.id, maxSelect: 1, cascadeDelete: false },
    { name: "province", type: "text", max: 2, pattern: "^([A-Z]{2})?$" },   // "" = everywhere (federal)
    { name: "rate", type: "number", required: true, min: 0, max: 100 },     // percent, up to 3 decimals (BR-04)
    { name: "effective_from", type: "date", required: true },
    { name: "effective_to", type: "date" },                                 // "" = open-ended
    { name: "source", type: "text", max: 200 },                             // where the rate came from
    { name: "pending_review", type: "bool" },                               // Q1: accountant to confirm
  ], ["CREATE INDEX idx_tax_rates_type ON tax_rates (tax_type, province)"]);

  const taxClasses = base(app, "tax_classes", [
    { name: "code", type: "text", required: true, max: 40, pattern: "^[a-z0-9_]+$" },
    { name: "name", type: "text", required: true, max: 80 },
    { name: "treatment", type: "select", required: true, maxSelect: 1, values: ["taxable", "zero_rated", "exempt"] },
    { name: "tax_types", type: "relation", collectionId: taxTypes.id, maxSelect: 10, cascadeDelete: false },
    { name: "is_custom", type: "bool" },
    { name: "description", type: "text", max: 300 },
    { name: "pending_review", type: "bool" },
    { name: "sort", type: "number", onlyInt: true },
  ], ["CREATE UNIQUE INDEX idx_tax_classes_code ON tax_classes (code)"]);

  // ---- Deposits and eco fees (FR-3.07; tax treatment pending Q1) -------------------------------
  const depositsFees = base(app, "deposits_fees", [
    { name: "name", type: "text", required: true, max: 120 },
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["deposit", "eco_fee"] },
    { name: "amount_cents", type: "number", required: true, onlyInt: true, min: 1 },
    { name: "tax_class", type: "relation", required: true, collectionId: taxClasses.id, maxSelect: 1, cascadeDelete: false },
    { name: "refundable", type: "bool" },                 // deposits come back on return of the container
    { name: "province", type: "text", max: 2, pattern: "^([A-Z]{2})?$" },
    { name: "active", type: "bool" },
  ]);

  // ---- Catalogue (FR-5.01-5.03) ---------------------------------------------------------------
  const categories = base(app, "categories", [
    { name: "name", type: "text", required: true, max: 80 },
    { name: "colour", type: "text", max: 7, pattern: "^(#[0-9a-fA-F]{6})?$" },
    { name: "sort", type: "number", onlyInt: true },
    { name: "pos_visible", type: "bool" },                // shown on the till's category grid
    { name: "return_window_days", type: "number", onlyInt: true, min: 0, max: 3650 },   // FR-4.07, 0 = store default
    { name: "non_returnable", type: "bool" },
  ]);
  categories.fields.add(new Field({ name: "parent", type: "relation", collectionId: categories.id, maxSelect: 1, cascadeDelete: false }));
  app.save(categories);

  const products = base(app, "products", [
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "active", "archived"] },
    { name: "name", type: "text", required: true, max: 160 },
    { name: "name_fr", type: "text", max: 160 },          // bilingual name for labels
    { name: "category", type: "relation", collectionId: categories.id, maxSelect: 1, cascadeDelete: false },
    { name: "base_unit", type: "select", required: true, maxSelect: 1, values: ["each", "kg", "lb"] },
    { name: "tax_class", type: "relation", collectionId: taxClasses.id, maxSelect: 1, cascadeDelete: false },
    { name: "cost_cents", type: "number", onlyInt: true, min: 0 },          // last cost per base unit (DL-64)
    { name: "plu", type: "text", max: 10, pattern: "^([0-9]{4,6})?$" },    // produce PLU (4011)
    { name: "pos_button", type: "bool" },                                   // has a button on the till grid
    { name: "image", type: "file", maxSelect: 1, maxSize: 1048576, mimeTypes: ["image/png", "image/jpeg", "image/webp"],
      thumbs: ["160x160"] },
    { name: "reorder_point", type: "number", min: 0 },
    { name: "description", type: "text", max: 1000 },
    // Weighed goods (FR-3.04, BR-07)
    { name: "tare", type: "number", min: 0 },                               // in the base unit, up to 3 decimals
    { name: "scale_code", type: "text", max: 10 },
    { name: "scale_ack", type: "bool" },                                    // "sold on a Measurement Canada approved scale"
    // Perishables (BR-07)
    { name: "perishable", type: "bool" },
    { name: "shelf_life_days", type: "number", onlyInt: true, min: 0, max: 3650 },
    { name: "expiry_at_receiving", type: "bool" },                          // expiry is entered per lot instead
    { name: "storage_area", type: "relation", collectionId: app.findCollectionByNameOrId("storage_areas").id, maxSelect: 1, cascadeDelete: false },
    // Regulated items (FR-3.06, 3.07)
    { name: "age_restricted", type: "bool" },
    { name: "min_age", type: "number", onlyInt: true, min: 0, max: 99 },
    { name: "deposits_fees", type: "relation", collectionId: depositsFees.id, maxSelect: 10, cascadeDelete: false },  // per base unit
    // Imports (BR-07)
    { name: "imported", type: "bool" },
    { name: "hs_code", type: "text", max: 14, pattern: "^([0-9.]{4,14})?$" },
    { name: "origin_country", type: "text", max: 2, pattern: "^([A-Z]{2})?$" },
    // Returns (FR-4.07)
    { name: "non_returnable", type: "bool" },
    // Computed by the hub (DL-66)
    { name: "draft_reasons", type: "json", maxSize: 4000 },
  ], [
    "CREATE INDEX idx_products_status ON products (status)",
    "CREATE INDEX idx_products_plu ON products (plu)",
    "CREATE INDEX idx_products_category ON products (category)",
  ]);

  const units = base(app, "selling_units", [
    { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "name", type: "text", required: true, max: 80 },                 // "Single", "6-pack", "Case of 24", "per kg"
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["single", "pack", "case", "weight"] },
    { name: "contains_qty", type: "number", min: 0 },                       // pack/case: how many of contains_unit
    { name: "base_qty", type: "number", min: 0 },                           // computed by the hub (DL-64)
    { name: "barcodes", type: "json", maxSize: 2000 },                      // ["0628..."], DL-65
    { name: "price_cents", type: "number", onlyInt: true, min: 0 },
    { name: "sell_at_pos", type: "bool" },
    { name: "is_default", type: "bool" },
    { name: "sort", type: "number", onlyInt: true },
  ], ["CREATE INDEX idx_selling_units_product ON selling_units (product)"]);
  // Nesting: a case contains packs, a pack contains singles. Empty = contains base units.
  units.fields.add(new Field({ name: "contains_unit", type: "relation", collectionId: units.id, maxSelect: 1, cascadeDelete: false }));
  app.save(units);

  base(app, "price_history", [
    { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "selling_unit", type: "relation", collectionId: units.id, maxSelect: 1, cascadeDelete: false },
    { name: "field", type: "select", required: true, maxSelect: 1, values: ["price", "cost"] },
    { name: "old_cents", type: "number", onlyInt: true, min: 0 },
    { name: "new_cents", type: "number", onlyInt: true, min: 0 },
    { name: "changed_by", type: "text", max: 100 },
    { name: "reason", type: "text", max: 300 },
  ], ["CREATE INDEX idx_price_history_product ON price_history (product, created_at)"]);
}, (app) => {
  TABLES.slice().reverse().forEach((name) => {
    const c = app.findCollectionByNameOrId(name);
    // self-relations must go before the table can be dropped cleanly
    if (name === "selling_units") { c.fields.removeByName("contains_unit"); app.save(c); }
    if (name === "categories") { c.fields.removeByName("parent"); app.save(c); }
    app.delete(c);
  });
});

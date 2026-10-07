/// <reference path="../../pb_data/types.d.ts" />
// P1 step 7: shelf labels (FR-5.13-5.16, BR-25, DL-18). The label batch (what waits to be printed),
// printed batches (kept for reprinting), templates (what a label shows) and layouts (the sheet or roll).
// Products get a size (e.g. 200 g, 1.5 L) for the unit price on labels (FR-5.14). Layout presets follow
// common label sheets; all sizes are millimetres. Down drops exactly what up creates.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];

const TABLES = ["label_layouts", "label_templates", "label_batches", "label_batch_items"];

const IN = 25.4;
// [name, paper, page w, page h, cols, rows, label w, label h, top, left, gap x, gap y, cut lines]
const LAYOUTS = [
  ["Letter 3 × 10 (address labels, 2⅝ × 1 in)", "letter", 8.5 * IN, 11 * IN, 3, 10, 2.625 * IN, 1 * IN, 0.5 * IN, 0.1875 * IN, 0.125 * IN, 0, false],
  ["Letter 2 × 5 (shipping labels, 4 × 2 in)", "letter", 8.5 * IN, 11 * IN, 2, 5, 4 * IN, 2 * IN, 0.5 * IN, 0.15625 * IN, 0.1875 * IN, 0, false],
  ["A4 3 × 8 (63.5 × 33.9 mm)", "a4", 210, 297, 3, 8, 63.5, 33.9, 12.9, 7.2, 2.5, 0, false],
  ["Plain Letter, 3 × 8 with cut lines", "letter", 8.5 * IN, 11 * IN, 3, 8, 65, 32, 11.7, 10.45, 0, 0, true],
  ["Plain A4, 3 × 8 with cut lines", "a4", 210, 297, 3, 8, 65, 34, 12.5, 7.5, 0, 0, true],
  ["Thermal roll 2 × 1 in", "roll", 2 * IN, 1 * IN, 1, 1, 2 * IN, 1 * IN, 0, 0, 0, 0, false],
];

const TEMPLATE_FIELDS = { name: true, name_fr: false, price: true, unit_price: true, unit_price_basis: "auto", barcode: true, plu: true,
  origin: false, logo: false, promo: true };

const PERMISSIONS = [["labels.manage", "stock", "Shelf labels: batch, print, templates and layouts", false, false]];
const GRANTS = { manager: ["labels.manage"], staff: ["labels.manage"] };

function base(app, name, fields, indexes, rules) {
  const c = new Collection({
    type: "base", name: name,
    listRule: ACTIVE, viewRule: ACTIVE, createRule: rules ? ACTIVE : null, updateRule: rules ? ACTIVE : null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [],
  });
  app.save(c);
  return c;
}

migrate((app) => {
  const products = app.findCollectionByNameOrId("products");
  const units = app.findCollectionByNameOrId("selling_units");

  // Templates and layouts: edited in the app (the access hook checks labels.manage).
  const layouts = base(app, "label_layouts", [
    { name: "name", type: "text", required: true, max: 80 },
    { name: "paper", type: "select", required: true, maxSelect: 1, values: ["letter", "a4", "roll", "custom"] },
    { name: "page_w_mm", type: "number", min: 10, max: 500 },
    { name: "page_h_mm", type: "number", min: 10, max: 500 },
    { name: "cols", type: "number", onlyInt: true, min: 1, max: 20 },
    { name: "rows", type: "number", onlyInt: true, min: 1, max: 40 },
    { name: "label_w_mm", type: "number", min: 5, max: 500 },
    { name: "label_h_mm", type: "number", min: 5, max: 500 },
    { name: "margin_top_mm", type: "number", min: 0, max: 200 },
    { name: "margin_left_mm", type: "number", min: 0, max: 200 },
    { name: "gap_x_mm", type: "number", min: 0, max: 100 },
    { name: "gap_y_mm", type: "number", min: 0, max: 100 },
    { name: "cut_lines", type: "bool" },
    { name: "offset_x_mm", type: "number", min: -20, max: 20 },      // printer alignment correction
    { name: "offset_y_mm", type: "number", min: -20, max: 20 },
    { name: "preset", type: "bool" },
    { name: "sort", type: "number", onlyInt: true },
  ], [], true);
  const templates = base(app, "label_templates", [
    { name: "name", type: "text", required: true, max: 80 },
    { name: "fields", type: "json", maxSize: 2000 },                   // which parts show (FR-5.14)
    { name: "is_default", type: "bool" },
    { name: "sort", type: "number", onlyInt: true },
  ], [], true);

  // Printed (or being printed) batches: a snapshot of exactly what went on the labels, for reprints.
  const batches = base(app, "label_batches", [
    { name: "number", type: "number", onlyInt: true, min: 1 },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["made", "printed"] },
    { name: "layout", type: "json", maxSize: 4000 },
    { name: "template", type: "json", maxSize: 4000 },
    { name: "items", type: "json", maxSize: 400000 },                  // [{item, version, qty, label data}]
    { name: "labels", type: "number", onlyInt: true, min: 0 },
    { name: "start", type: "number", onlyInt: true, min: 1 },
    { name: "printed_at", type: "date" },
    { name: "printed_by", type: "text", max: 64 },
  ], ["CREATE INDEX idx_label_batches_status ON label_batches (status, created_at)"]);

  base(app, "label_batch_items", [
    { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: false },
    { name: "selling_unit", type: "relation", required: true, collectionId: units.id, maxSelect: 1, cascadeDelete: false },
    { name: "qty", type: "number", onlyInt: true, min: 1, max: 999 },  // how many labels
    { name: "reasons", type: "json", maxSize: 1000 },                  // ["price_change", "new_product", "manual"]
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "printed", "removed"] },
    { name: "batch", type: "relation", collectionId: batches.id, maxSelect: 1, cascadeDelete: false },
  ], ["CREATE INDEX idx_label_items_pending ON label_batch_items (status, product, selling_unit)"]);

  // Size of one base unit, for the unit price (FR-5.14): 200 g chips, 1.5 L juice, 12 eggs.
  products.fields.add(new Field({ name: "size_qty", type: "number", min: 0 }));
  products.fields.add(new Field({ name: "size_unit", type: "select", maxSelect: 1, values: ["g", "kg", "ml", "l", "each"] }));
  app.save(products);

  LAYOUTS.forEach((l, i) => {
    const r = new Record(layouts);
    r.load({ name: l[0], paper: l[1], page_w_mm: Math.round(l[2] * 100) / 100, page_h_mm: Math.round(l[3] * 100) / 100, cols: l[4], rows: l[5],
      label_w_mm: Math.round(l[6] * 100) / 100, label_h_mm: Math.round(l[7] * 100) / 100, margin_top_mm: Math.round(l[8] * 100) / 100,
      margin_left_mm: Math.round(l[9] * 100) / 100, gap_x_mm: Math.round(l[10] * 100) / 100, gap_y_mm: l[11], cut_lines: l[12],
      offset_x_mm: 0, offset_y_mm: 0, preset: true, sort: i + 1 });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
  const t = new Record(templates);
  t.load({ name: "Shelf label", fields: TEMPLATE_FIELDS, is_default: true, sort: 1 });
  t.set("created_by", "system"); t.set("updated_by", "system");
  app.save(t);
  const t2 = new Record(templates);
  t2.load({ name: "Bilingual shelf label", fields: Object.assign({}, TEMPLATE_FIELDS, { name_fr: true, origin: true }), is_default: false, sort: 2 });
  t2.set("created_by", "system"); t2.set("updated_by", "system");
  app.save(t2);

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
}, (app) => {
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
  const products = app.findCollectionByNameOrId("products");
  products.fields.removeByName("size_qty");
  products.fields.removeByName("size_unit");
  app.save(products);
  TABLES.slice().reverse().forEach((name) => app.delete(app.findCollectionByNameOrId(name)));
});

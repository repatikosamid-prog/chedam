/// <reference path="../../pb_data/types.d.ts" />
// P3 step 8: product variety (FR-5.17-5.19). Variants (a parent product with axes such as size and colour, each
// variant its own product), bundles and kits (a product made of stocked items: no stock of its own), serial
// numbers / IMEI (one per unit at the sale, kept on the sale line; warranty days). Down drops exactly what up adds.

const P_FIELDS = [
  { name: "parent", type: "text", max: 15 },                          // a variant: its parent product
  { name: "variant", type: "json", maxSize: 1000 },                   // {Size: "M", Colour: "Red"}
  { name: "variant_axes", type: "json", maxSize: 500 },               // a parent: ["Size", "Colour"]
  { name: "is_bundle", type: "bool" },
  { name: "components", type: "json", maxSize: 8000 },                // [{product, selling_unit, qty, name}]
  { name: "serial_tracked", type: "bool" },
  { name: "warranty_days", type: "number", onlyInt: true, min: 0, max: 3650 },
];

migrate((app) => {
  const p = app.findCollectionByNameOrId("products");
  P_FIELDS.forEach((f) => p.fields.add(new Field(f)));
  p.addIndex("idx_products_parent", false, "parent", "parent != ''");
  app.save(p);
  const l = app.findCollectionByNameOrId("sale_lines");
  l.fields.add(new Field({ name: "serials", type: "json", maxSize: 4000 }));   // ["IMEI…"]
  app.save(l);
}, (app) => {
  const l = app.findCollectionByNameOrId("sale_lines");
  l.fields.removeByName("serials");
  app.save(l);
  const p = app.findCollectionByNameOrId("products");
  p.removeIndex("idx_products_parent");
  P_FIELDS.forEach((f) => p.fields.removeByName(f.name));
  app.save(p);
});

/// <reference path="../../pb_data/types.d.ts" />
// Testing round 3 (2026-10-11): a product's brand and its usual supplier (a vendor). Down removes them.

migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.add(new Field({ name: "brand", type: "text", max: 80 }));
  c.fields.add(new Field({ name: "vendor", type: "relation", collectionId: app.findCollectionByNameOrId("parties").id, maxSelect: 1, cascadeDelete: false }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("brand");
  c.fields.removeByName("vendor");
  app.save(c);
});

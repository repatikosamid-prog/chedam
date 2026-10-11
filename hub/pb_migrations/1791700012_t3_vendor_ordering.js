/// <reference path="../../pb_data/types.d.ts" />
// Testing round 3 (2026-10-11): how to order from a vendor: the method, the order email, their portal's address,
// the store's account number and user name there (never a password), the cut-off and the minimum order.

const FIELDS = [
  { name: "order_method", type: "select", maxSelect: 1, values: ["email", "portal", "phone", "rep", "edi", "other"] },
  { name: "order_email", type: "text", max: 120 },
  { name: "portal_url", type: "text", max: 300 },
  { name: "portal_account", type: "text", max: 80 },
  { name: "portal_user", type: "text", max: 120 },
  { name: "order_cutoff", type: "text", max: 120 },                  // e.g. "Tuesday 2 pm for Thursday delivery"
  { name: "min_order_cents", type: "number", onlyInt: true, min: 0 },
];

migrate((app) => {
  const c = app.findCollectionByNameOrId("parties");
  FIELDS.forEach((f) => c.fields.add(new Field(f)));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("parties");
  FIELDS.forEach((f) => c.fields.removeByName(f.name));
  app.save(c);
});

/// <reference path="../pb_data/types.d.ts" />
// Sreya, 2026-10-11 (DL-247): owners and managers set up how the store orders from each vendor whenever they want,
// starting from a known supplier (Coke Canada, PepsiCo Beverages, Frito-Lay) if they like: the phone for orders,
// notes (rep visit days, delivery days, who to ask), which known supplier it came from, and "api" as a method.

const FIELDS = [
  { name: "order_phone", type: "text", max: 40 },
  { name: "order_notes", type: "text", max: 1500 },
  { name: "supplier_preset", type: "text", max: 60 },
];

migrate((app) => {
  const c = app.findCollectionByNameOrId("parties");
  FIELDS.forEach((f) => c.fields.add(new Field(f)));
  const m = c.fields.getByName("order_method");
  m.values = ["email", "portal", "phone", "rep", "edi", "api", "other"];
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("parties");
  FIELDS.forEach((f) => c.fields.removeByName(f.name));
  const m = c.fields.getByName("order_method");
  m.values = ["email", "portal", "phone", "rep", "edi", "other"];
  app.save(c);
});

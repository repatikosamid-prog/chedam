/// <reference path="../../pb_data/types.d.ts" />
// P1 step 5: receipt printers and the cash drawer (FR-1.11, FR-3.11, FR-3.13, NFR-14).
// Printers are a store setting; each device may be given one (devices.assigned_printer = printer id,
// "none" for no printer). Reprints are counted on the sale; the drawer opens once per cash sale or no-sale.

const SETTINGS = [
  ["printing.printers", [], "Network receipt printers: [{id, name, host, port, chars, drawer}] (FR-1.11)"],
  ["printing.receipt", { auto_print: true, full_receipt_cents: 15000 },
    "Print the receipt when a sale is paid; from this total (cents) the buyer's name can go on the receipt (full GST/HST receipt, NFR-14)"],
];

migrate((app) => {
  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.add(new Field({ name: "reprints", type: "number", onlyInt: true, min: 0 }));
  sales.fields.add(new Field({ name: "drawer_opened", type: "bool" }));
  app.save(sales);
  const cm = app.findCollectionByNameOrId("cash_movements");
  cm.fields.add(new Field({ name: "drawer_opened", type: "bool" }));
  app.save(cm);
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => {
    try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* already gone */ }
  });
  const cm = app.findCollectionByNameOrId("cash_movements");
  cm.fields.removeByName("drawer_opened");
  app.save(cm);
  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.removeByName("reprints");
  sales.fields.removeByName("drawer_opened");
  app.save(sales);
});

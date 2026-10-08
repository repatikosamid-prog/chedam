/// <reference path="../../pb_data/types.d.ts" />
// P1 step 9: money and audit reports (FR-10.01, 10.09, 10.11, 10.13, BR-34). A closed till is reconciled
// with the card terminal's settlement for it; record retention (6 years at least); loss-prevention flags.
// Down drops exactly what up creates.

const FIELDS = [
  { name: "card_settlement_cents", type: "number", onlyInt: true },   // the card terminal's batch total for this till
  { name: "settlement_ref", type: "text", max: 60 },                   // batch number on the terminal's report
  { name: "reconciled_at", type: "date" },
  { name: "reconciled_by", type: "text", max: 64 },
  { name: "reconcile_note", type: "text", max: 500 },
];

const SETTINGS = [
  ["retention.years", 6, "Business records (sales, payments, returns, stock, the audit log...) cannot be deleted for this many years; at least 6 (BR-34, CRA)"],
  ["reports.flags", { multiple: 2, min_count: 3 }, "Loss prevention: flag a cashier whose rate is this many times the store's, with at least this many events (FR-10.11)"],
];

migrate((app) => {
  const tills = app.findCollectionByNameOrId("tills");
  FIELDS.forEach((f) => tills.fields.add(new Field(f)));
  app.save(tills);
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
  const tills = app.findCollectionByNameOrId("tills");
  FIELDS.forEach((f) => tills.fields.removeByName(f.name));
  app.save(tills);
});

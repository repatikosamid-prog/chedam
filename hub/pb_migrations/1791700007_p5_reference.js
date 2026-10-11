/// <reference path="../../pb_data/types.d.ts" />
// P5 step 7: reference data (FR-11.10, 11.11). The datasets ship with the hub's code (pb_hooks/reference), not in
// the database; this only adds setting reference.online: which public services may be asked when the hub is online.
// Down removes it.

migrate((app) => {
  const r = new Record(app.findCollectionByNameOrId("settings"));
  r.load({ key: "reference.online", value: { open_food_facts: true, bank_of_canada: true },
    description: "Reference data (FR-11.10): ask Open Food Facts for a scanned barcode and the Bank of Canada for an exchange rate when the hub is online (suggestions only)" });
  r.set("created_by", "system"); r.set("updated_by", "system");
  app.save(r);
}, (app) => {
  try { app.delete(app.findFirstRecordByData("settings", "key", "reference.online")); } catch (_) { /* gone */ }
});

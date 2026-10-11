/// <reference path="../../pb_data/types.d.ts" />
// Testing round 3 (2026-10-11): a scale connected to the tills for products sold by weight (optional for the
// store). Each till connects its own scale (kept on that device). Setting scale.enabled.

migrate((app) => {
  const r = new Record(app.findCollectionByNameOrId("settings"));
  r.load({ key: "scale.enabled", value: false,
    description: "Weighed goods: tills read the weight from a connected scale (Measurement Canada approved); off = the weight is typed in" });
  r.set("created_by", "system"); r.set("updated_by", "system");
  app.save(r);
}, (app) => {
  try { app.delete(app.findFirstRecordByData("settings", "key", "scale.enabled")); } catch (_) { /* gone */ }
});

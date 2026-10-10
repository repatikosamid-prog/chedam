/// <reference path="../../pb_data/types.d.ts" />
// P3 step 10: recall trace and customer feedback (FR-6.15, 7.09). Recalls: which lots of a product, where they
// came from, which sales took them, when and to which members; recalled lots are blocked (never sold again)
// and what is left is written off. Feedback: a rating and a comment from a kiosk tablet (a device paired as a
// kiosk, no sign-in) or from the link on the receipt (on the store's Wi-Fi); a report. Down drops exactly what
// up adds.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';
const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
function base(app, name, fields, indexes) {
  const c = new Collection({ type: "base", name: name, listRule: ACTIVE, viewRule: ACTIVE, createRule: null, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [] });
  app.save(c);
  return c;
}
const SETTINGS = [
  ["feedback", { receipt_link: false, question: "How was your visit today?" }, "Customer feedback (FR-7.09): a link on the receipt (works on the store's Wi-Fi) and the kiosk's question"],
];

migrate((app) => {
  const lots = app.findCollectionByNameOrId("stock_lots");
  lots.fields.add(new Field({ name: "recalled", type: "bool" }));
  lots.fields.add(new Field({ name: "recall", type: "text", max: 15 }));
  app.save(lots);
  base(app, "recalls", [
    { name: "number", type: "text", max: 20 },                         // RC-000001
    { name: "product", type: "relation", required: true, collectionId: app.findCollectionByNameOrId("products").id, maxSelect: 1, cascadeDelete: false },
    { name: "lots", type: "json", maxSize: 20000 },                    // [lot id]
    { name: "reason", type: "text", max: 500 },
    { name: "source", type: "text", max: 200 },                        // e.g. "CFIA notice 2026-123"
    { name: "written_off", type: "json", maxSize: 8000 },              // [{lot, qty, movement}] or [{lot, qty, task}]
    { name: "by_name", type: "text", max: 80 },
  ]);
  base(app, "feedback", [
    { name: "rating", type: "number", onlyInt: true, min: 1, max: 5 },
    { name: "comment", type: "text", max: 1000 },
    { name: "source", type: "select", required: true, maxSelect: 1, values: ["kiosk", "receipt"] },
    { name: "sale", type: "text", max: 15 },
    { name: "read", type: "bool" },
  ], ["CREATE INDEX idx_feedback_created ON feedback (created_at)"]);
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
  try {
    const r = app.findFirstRecordByData("settings", "key", "stock.reasons");
    const v = JSON.parse(r.getString("value") || "{}") || {};
    v.loss = v.loss || [];
    if (v.loss.indexOf("Recall") < 0) v.loss.push("Recall");
    r.set("value", v); r.set("updated_by", "system"); app.save(r);
  } catch (_) { /* no reasons yet */ }
}, (app) => {
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  ["feedback", "recalls"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
  const lots = app.findCollectionByNameOrId("stock_lots");
  lots.fields.removeByName("recalled"); lots.fields.removeByName("recall");
  app.save(lots);
});

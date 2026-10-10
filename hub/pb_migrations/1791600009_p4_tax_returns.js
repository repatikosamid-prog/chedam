/// <reference path="../../pb_data/types.d.ts" />
// P4 step 9: statements and tax returns (FR-10.07, 10.08, 4.15). The statements are worked out from the books
// (lib/statements.js); a GST/HST or PST return, once filed, is kept with its figures and the confirmation
// number. Setting tax.pst_return: BC's commission on PST collected. Down drops exactly what up adds.

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
const SETTINGS = [
  ["tax.pst_return", { commission_pct: 3.3, commission_max_cents: 19800, frequency: "monthly" },
    "BC PST return (FR-4.15): the collector's commission (% of PST collected, up to a maximum per return) and how often the store files"],
  ["tax.gst_return", { frequency: "quarterly", method: "regular" },
    "GST/HST return (FR-10.08): how often the store files (monthly, quarterly, annual); the regular method (the quick method is not worked out)"],
];

migrate((app) => {
  app.save(new Collection({ type: "base", name: "tax_returns", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "kind", type: "select", required: true, maxSelect: 1, values: ["gst", "pst"] },
      { name: "period_from", type: "text", required: true, max: 10 },
      { name: "period_to", type: "text", required: true, max: 10 },
      { name: "figures", type: "json", maxSize: 20000 },
      { name: "net_cents", type: "number", onlyInt: true },                      // owed (+) or refund (−)
      { name: "filed_on", type: "text", max: 10 },
      { name: "confirmation", type: "text", max: 60 },
      { name: "paid_on", type: "text", max: 10 },
      { name: "note", type: "text", max: 300 },
      { name: "by_name", type: "text", max: 80 },
    ].concat(COMMON()),
    indexes: ["CREATE UNIQUE INDEX idx_tax_returns ON tax_returns (kind, period_from) WHERE deleted_at = ''"] }));
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  app.delete(app.findCollectionByNameOrId("tax_returns"));
});

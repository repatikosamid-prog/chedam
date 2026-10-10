/// <reference path="../../pb_data/types.d.ts" />
// P2 step 9: pings and the till overlay (FR-2.06, 2.07, BR-42). A ping goes from a person on one device to
// devices: one device, all tills, all phones and tablets, all back-office PCs, or everyone. Normal pings show
// as a banner, urgent ones fill the screen and repeat until a recipient confirms; an urgent ping nobody
// confirmed in 5 minutes goes to the managers' devices too (and becomes a task). Pings are never emailed.
// The recipients are worked out when it is sent (devices). Down drops exactly what up adds.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';
const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
const SETTINGS = [
  ["pings.templates", ["Need help at the till", "Price check, please", "Manager to the front", "Back-up to the tills", "Spill to clean up", "Phone call for you", "Delivery at the back door"],
    "Ready-made ping texts (FR-2.07)"],
  ["pings.escalate_minutes", 5, "An urgent ping nobody confirmed after this many minutes also goes to the managers (BR-42)"],
];

migrate((app) => {
  app.save(new Collection({ type: "base", name: "pings", listRule: ACTIVE, viewRule: ACTIVE, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "from_user", type: "text", max: 64 },
      { name: "from_name", type: "text", max: 80 },
      { name: "from_device", type: "text", max: 15 },
      { name: "from_device_name", type: "text", max: 80 },
      { name: "target", type: "text", max: 40 },                     // device:<id> | till | phone | back_office | everyone
      { name: "target_label", type: "text", max: 80 },
      { name: "recipients", type: "json", maxSize: 4000 },           // [device id]
      { name: "text", type: "text", required: true, max: 300 },
      { name: "urgent", type: "bool" },
      { name: "acks", type: "json", maxSize: 8000 },                 // [{device, device_name, user, name, at, reply}]
      { name: "escalated_at", type: "date" },
      { name: "closed", type: "bool" },                              // confirmed (urgent) or withdrawn
    ].concat(COMMON()),
    indexes: ["CREATE INDEX idx_pings_created ON pings (created_at)"] }));
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  app.delete(app.findCollectionByNameOrId("pings"));
});

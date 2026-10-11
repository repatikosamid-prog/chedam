/// <reference path="../../pb_data/types.d.ts" />
// P5 step 1: payment processors and linked card terminals (FR-3.21, 3.22; DL-114, P5-a..d). The store's own
// processor account (Square first) with its access token encrypted on the hub (never in the API, the event log
// or exports); the processor's terminals, each paired with a code and linked to one till (a Chedam device).
// Permission payments.connect: the owner (sensitive). Down drops exactly what up adds.

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
function base(app, name, fields, indexes) {
  const c = new Collection({ type: "base", name: name, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [] });
  app.save(c);
  return c;
}
const PERMS = [["payments.connect", "money", "Connect the card processor and pair card terminals", true, true]];
const SETTINGS = [
  ["payments.linked", { enabled: true, poll_seconds: 2, wait_seconds: 300 },
    "Linked card terminal (FR-3.21): on = Card sends the amount to the till's terminal when the hub is online; how often the till asks for the result and how long a checkout may wait"],
];

migrate((app) => {
  const procs = base(app, "payment_processors", [
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["square"] },
    { name: "environment", type: "select", required: true, maxSelect: 1, values: ["sandbox", "production"] },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["connected", "disconnected"] },
    { name: "token_enc", type: "text", max: 2000, hidden: true },               // encrypted with the hub's secrets key
    { name: "merchant_id", type: "text", max: 80 },
    { name: "account_name", type: "text", max: 120 },
    { name: "currency", type: "text", max: 3 },
    { name: "location_id", type: "text", max: 80 },
    { name: "location_name", type: "text", max: 120 },
    { name: "locations", type: "json", maxSize: 20000 },                        // [{id, name}] when connected
    { name: "connected_at", type: "date" },
    { name: "connected_by", type: "text", max: 80 },
    { name: "last_ok_at", type: "date" },
    { name: "last_error", type: "text", max: 300 },
  ]);
  base(app, "card_terminals", [
    { name: "processor", type: "relation", required: true, collectionId: procs.id, maxSelect: 1, cascadeDelete: false },
    { name: "name", type: "text", required: true, max: 60 },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["pairing", "paired", "expired", "removed"] },
    { name: "code_id", type: "text", max: 80 },                                  // the processor's pairing code record
    { name: "code", type: "text", max: 20 },                                     // typed into the terminal
    { name: "pair_by", type: "date" },
    { name: "terminal_id", type: "text", max: 120 },                             // the processor's device id once paired
    { name: "till_device", type: "text", max: 15 },                              // the Chedam device (till) it serves
    { name: "paired_at", type: "date" },
  ], ["CREATE INDEX idx_card_terminals_till ON card_terminals (till_device, status)"]);

  PERMS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    const r = new Record(app.findCollectionByNameOrId("permissions"));
    r.load({ code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  PERMS.forEach(([code]) => { try { app.delete(app.findFirstRecordByData("permissions", "code", code)); } catch (_) { /* gone */ } });
  ["card_terminals", "payment_processors"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

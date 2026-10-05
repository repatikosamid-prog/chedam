/// <reference path="../../pb_data/types.d.ts" />
// P0 step 4, Devices (FR-1.07, 1.08).
// - A device is paired once and then proves itself on every request with its id + key
//   (X-Chedam-Device, X-Chedam-Device-Key). The key is stored as a SHA-256 hash in the hidden key_hash
//   field: it is a long random secret, so a fast hash is enough and keeps every request quick on the Pi.
// - Pairing codes (hidden pairing_code_hash) are short, used once and expire after a few minutes.
// - Devices are created only by the pairing endpoints, never through the generic API.

const SETTINGS = [
  ["devices.pairing_code_minutes", 10, "A pairing code works for this many minutes (FR-1.07)"],
  ["devices.online_seconds", 120, "A device counts as online if it reached the hub this recently (FR-1.08)"],
  ["devices.max_pending_requests", 10, "Open 'please approve me' requests allowed at once"],
];

migrate((app) => {
  const devices = app.findCollectionByNameOrId("devices");
  devices.fields.add(new Field({ name: "paired_via", type: "select", maxSelect: 1, values: ["code", "request"] }));
  devices.fields.add(new Field({ name: "paired_at", type: "date" }));
  devices.createRule = null;
  app.save(devices);

  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => {
    try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* already gone */ }
  });
  const devices = app.findCollectionByNameOrId("devices");
  devices.fields.removeByName("paired_via");
  devices.fields.removeByName("paired_at");
  devices.createRule = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';
  app.save(devices);
});

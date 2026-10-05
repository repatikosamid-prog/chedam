/// <reference path="../../pb_data/types.d.ts" />
// Forgot PIN (decided by Sreya, 2026-10-05): a manager sets a TEMPORARY PIN. It works for
// security.temp_pin_hours, only to sign in; the person must then choose their own new PIN before doing
// anything else (enforced on the hub, lib/auth.js pinChangeGate).

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new Field({ name: "pin_must_change", type: "bool" }));
  users.fields.add(new Field({ name: "pin_temp_expires_at", type: "date" }));
  app.save(users);

  const r = new Record(app.findCollectionByNameOrId("settings"));
  r.load({ key: "security.temp_pin_hours", value: 24, description: "A temporary PIN set by a manager works for this many hours" });
  r.set("created_by", "system");
  app.save(r);
}, (app) => {
  try { app.delete(app.findFirstRecordByData("settings", "key", "security.temp_pin_hours")); } catch (_) { /* already gone */ }
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("pin_must_change");
  users.fields.removeByName("pin_temp_expires_at");
  app.save(users);
});

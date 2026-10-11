/// <reference path="../../pb_data/types.d.ts" />
// P5 step 8: remote support sessions (FR-12.10): each time the owner lets support in, for how long, the address,
// who switched it on and off and the support logins seen. Permission support.manage: the owner. Setting
// support.keys: the public SSH keys of the people allowed in. Down drops exactly what up adds.

const PERMS = [["support.manage", "system", "Let remote support into the hub for a few hours", true, true]];

migrate((app) => {
  app.save(new Collection({ type: "base", name: "support_sessions", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["starting", "active", "ended", "failed"] },
      { name: "hours", type: "number", onlyInt: true, min: 1, max: 8 },
      { name: "until", type: "date" },
      { name: "started_at", type: "text", max: 30 },
      { name: "host", type: "text", max: 120 },
      { name: "command", type: "text", max: 300 },
      { name: "keys", type: "json", maxSize: 2000 },                         // the names of the keys let in
      { name: "logins", type: "json", maxSize: 20000 },
      { name: "started_by", type: "text", max: 80 },
      { name: "ended_by", type: "text", max: 80 },
      { name: "ended_at", type: "date" },
      { name: "error", type: "text", max: 300 },
      { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      { name: "created_by", type: "text", max: 64 },
      { name: "updated_by", type: "text", max: 64 },
      { name: "device_id", type: "text", max: 64 },
      { name: "deleted_at", type: "date" },
    ] }));
  PERMS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    const r = new Record(app.findCollectionByNameOrId("permissions"));
    r.load({ code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
  const s = new Record(app.findCollectionByNameOrId("settings"));
  s.load({ key: "support.keys", value: [], description: "Remote support (FR-12.10): public SSH keys of the people the owner lets in during a support session" });
  s.set("created_by", "system"); s.set("updated_by", "system");
  app.save(s);
}, (app) => {
  try { app.delete(app.findFirstRecordByData("settings", "key", "support.keys")); } catch (_) { /* gone */ }
  PERMS.forEach(([code]) => { try { app.delete(app.findFirstRecordByData("permissions", "code", code)); } catch (_) { /* gone */ } });
  app.delete(app.findCollectionByNameOrId("support_sessions"));
});

/// <reference path="../../pb_data/types.d.ts" />
// P0 step 7, backups (FR-1.14, NFR-03/04/12). backups.job_id links a record to the root helper's job;
// backup.drive is the chosen USB drive; backup.last_restore_test keeps the latest restore test result.

const SETTINGS = [
  ["backup.drive", {}, "USB drive for backups: {uuid, label, fstype, size_bytes}"],
  ["backup.last_restore_test", {}, "Latest restore test: {at, ok, file_name, consistent, seconds, error}"],
];

migrate((app) => {
  const backups = app.findCollectionByNameOrId("backups");
  backups.fields.add(new Field({ name: "job_id", type: "text", max: 40 }));
  backups.fields.add(new Field({ name: "free_bytes", type: "number", onlyInt: true, min: 0 }));
  app.save(backups);
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
  const backups = app.findCollectionByNameOrId("backups");
  backups.fields.removeByName("job_id");
  backups.fields.removeByName("free_bytes");
  app.save(backups);
});

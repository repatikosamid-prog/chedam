/// <reference path="../../pb_data/types.d.ts" />
// P0 step 9, updates (FR-12.02, FR-12.04, NFR-20). updates.job_id links a record to the root helper's
// job; file_name/size_bytes/notes/error describe the package and its outcome.

const SETTINGS = [
  ["updates.channel_url", "https://raw.githubusercontent.com/repatikosamid-prog/chedam-releases/main", "Where the hub looks for signed updates (DL-54)"],
  ["updates.auto_check", true, "Look for updates once a day when the internet is available"],
  ["updates.last_check", {}, "Latest update check: {at, ok, latest, error}"],
];

migrate((app) => {
  const c = app.findCollectionByNameOrId("updates");
  [
    { name: "job_id", type: "text", max: 40 },
    { name: "file_name", type: "text", max: 200 },
    { name: "size_bytes", type: "number", onlyInt: true, min: 0 },
    { name: "notes", type: "text", max: 4000 },
    { name: "error", type: "text", max: 2000 },
    { name: "from_version", type: "text", max: 40 },
  ].forEach((f) => c.fields.add(new Field(f)));
  app.save(c);
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
  const c = app.findCollectionByNameOrId("updates");
  ["job_id", "file_name", "size_bytes", "notes", "error", "from_version"].forEach((f) => c.fields.removeByName(f));
  app.save(c);
});

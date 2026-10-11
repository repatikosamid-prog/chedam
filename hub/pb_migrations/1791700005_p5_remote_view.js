/// <reference path="../../pb_data/types.d.ts" />
// P5 step 5: the owner's remote view (FR-12.05): when the summary last went to the cloud drive (and its
// problem), and setting remote.view (on, every how many minutes). Down drops exactly what up adds.

const SETTINGS = [
  ["remote.view", { enabled: true, minutes: 15 }, "Owner's remote view (FR-12.05): an encrypted summary of the store is put on the owner's cloud drive every so many minutes, for the owner's enrolled devices to read away from the store"],
];

migrate((app) => {
  const c = app.findCollectionByNameOrId("cloud_links");
  c.fields.add(new Field({ name: "summary_at", type: "date" }));
  c.fields.add(new Field({ name: "summary_error", type: "text", max: 300 }));
  app.save(c);
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  const c = app.findCollectionByNameOrId("cloud_links");
  c.fields.removeByName("summary_at");
  c.fields.removeByName("summary_error");
  app.save(c);
});

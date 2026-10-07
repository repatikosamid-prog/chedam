/// <reference path="../../pb_data/types.d.ts" />
// P1 step 4 (DL-90): a till opened while the hub was unreachable. The till makes its id and counts the
// float; the hub numbers it when it arrives, before that till's offline sales.

const FIELDS = [
  { name: "offline", type: "bool" },
  { name: "device_time", type: "text", max: 40 },    // when the till says it was opened
  { name: "synced_at", type: "date" },
  { name: "sync_note", type: "text", max: 500 },     // e.g. another till was still open on this device
];

migrate((app) => {
  const c = app.findCollectionByNameOrId("tills");
  FIELDS.forEach((f) => c.fields.add(new Field(f)));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("tills");
  FIELDS.forEach((f) => c.fields.removeByName(f.name));
  app.save(c);
});

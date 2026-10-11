/// <reference path="../../pb_data/types.d.ts" />
// Testing round 3 (2026-10-11): a ping taken back keeps who took it back and when, so the devices it went to can
// say "called off" on screen instead of the ping just vanishing. Down removes the fields.

migrate((app) => {
  const c = app.findCollectionByNameOrId("pings");
  c.fields.add(new Field({ name: "withdrawn_at", type: "date" }));
  c.fields.add(new Field({ name: "withdrawn_by", type: "text", max: 80 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("pings");
  c.fields.removeByName("withdrawn_at");
  c.fields.removeByName("withdrawn_by");
  app.save(c);
});

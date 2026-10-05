/// <reference path="../../pb_data/types.d.ts" />
// P0 step 6, setup wizard (FR-1.01-1.06, 1.13, 1.15). The first device of a new store pairs itself
// during setup (with the hub's one-time setup code), so devices.paired_via gains "setup".

migrate((app) => {
  const devices = app.findCollectionByNameOrId("devices");
  devices.fields.getByName("paired_via").values = ["code", "request", "setup"];
  app.save(devices);
}, (app) => {
  const devices = app.findCollectionByNameOrId("devices");
  devices.fields.getByName("paired_via").values = ["code", "request"];
  app.save(devices);
});

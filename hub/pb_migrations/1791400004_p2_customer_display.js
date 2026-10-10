/// <reference path="../../pb_data/types.d.ts" />
// P2 step 5: customer-facing display (FR-3.14). A device paired as "customer_display" is linked to one till
// (display_for = the till device's id) by a manager in the device manager. Nothing else is stored: the
// sale on the display lives in the hub's memory only (lib/display.js). Down drops exactly what up adds.

migrate((app) => {
  const devices = app.findCollectionByNameOrId("devices");
  devices.fields.add(new Field({ name: "display_for", type: "text", max: 15 }));
  app.save(devices);
}, (app) => {
  const devices = app.findCollectionByNameOrId("devices");
  devices.fields.removeByName("display_for");
  app.save(devices);
});

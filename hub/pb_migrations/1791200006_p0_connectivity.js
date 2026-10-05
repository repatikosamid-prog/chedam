/// <reference path="../../pb_data/types.d.ts" />
// P0 step 5, connectivity status (FR-12.01): the hub checks the internet once a minute and reports
// Offline / Online (router) / Online (hotspot). "Hotspot" = the hub's current Wi-Fi network is one of
// network.hotspot_ssids (a phone hotspot the owner named). Nothing personal is sent by the check.

const SETTINGS = [
  ["network.check_url", "http://cp.cloudflare.com/generate_204", "Address the hub calls to see if the internet works (expects 204 or 200)"],
  ["network.hotspot_ssids", [], "Wi-Fi names that are phone hotspots (shown as Online (hotspot))"],
];

migrate((app) => {
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
});

/// <reference path="../../pb_data/types.d.ts" />
// DEV ONLY (sample data): opening and closing checklists, temperature ranges for the chilled and frozen
// sample products, and a business licence (P2 step 7).

const TAG = "sample";
const LISTS = [
  ["Opening", "opening", "09:30", ["Unlock the doors and switch off the alarm", "Lights and coolers on; check the cooler and freezer temperatures", "Count the till float",
    "Check the near-expiry shelf", { text: "Wipe the counter and the card terminal", required: false }]],
  ["Closing", "closing", "22:30", ["Close the till and count the cash", "Bring in the outside display", "Cooler and freezer doors shut",
    "Lock the back door", "Leave a handover note if anything is pending", { text: "Take out the garbage", required: false }]],
];
const TEMPS = { "Milk 2% 4 L": [0, 4], "Frozen peas 750 g": [-25, -15] };

migrate((app) => {
  LISTS.forEach(([name, kind, due, items], i) => {
    const r = new Record(app.findCollectionByNameOrId("checklists"));
    r.load({ name: name, kind: kind, due_time: due, active: true, sort: i + 1,
      items: items.map((x) => (typeof x === "string" ? { text: x, required: true } : x)) });
    r.set("created_by", "system:" + TAG); r.set("updated_by", "system:" + TAG);
    app.save(r);
  });
  Object.keys(TEMPS).forEach((name) => {
    app.findRecordsByFilter("products", "name = {:n} && deleted_at = ''", "", 0, 0, { n: name }).forEach((p) => {
      p.set("temp_min_c", TEMPS[name][0]); p.set("temp_max_c", TEMPS[name][1]);
      p.set("updated_by", "system:" + TAG);
      app.save(p);
    });
  });
  const d = new Record(app.findCollectionByNameOrId("documents"));
  d.load({ name: "Business licence", kind: "licence", number: "BL-2026-0412", issuer: "City of Vancouver", remind_days: 30,
    expires_on: new Date(Date.now() + 45 * 86400000).toISOString().replace("T", " ") });
  d.set("created_by", "system:" + TAG); d.set("updated_by", "system:" + TAG);
  app.save(d);
}, (app) => {
  ["checklists", "documents"].forEach((n) => app.findRecordsByFilter(n, "created_by = 'system:sample'", "", 0, 0).forEach((r) => app.delete(r)));
});

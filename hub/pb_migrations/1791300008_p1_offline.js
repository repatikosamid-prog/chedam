/// <reference path="../../pb_data/types.d.ts" />
// P1 step 4: offline selling (FR-3.16, BR-12, Section 8.2). Sales made while the hub was unreachable
// keep the till's receipt number (offline_ref) and when they reached the hub (synced_at).

const FIELDS = [
  { name: "offline_ref", type: "text", max: 40 },    // receipt number the till printed, e.g. OFF-K3F2-0007
  { name: "synced_at", type: "date" },
  { name: "sync_note", type: "text", max: 500 },      // e.g. sold after its till was closed
];

migrate((app) => {
  const c = app.findCollectionByNameOrId("sales");
  FIELDS.forEach((f) => c.fields.add(new Field(f)));
  c.indexes.push("CREATE INDEX idx_sales_offline_ref ON sales (offline_ref)");
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("sales");
  c.indexes = c.indexes.filter((i) => i.indexOf("idx_sales_offline_ref") < 0);
  FIELDS.forEach((f) => c.fields.removeByName(f.name));
  app.save(c);
});

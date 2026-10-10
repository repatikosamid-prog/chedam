/// <reference path="../../pb_data/types.d.ts" />
// P3 step 5: receiving from a bill photo, landed cost (FR-6.11, 6.12). scan_matches: what a vendor's bill line
// (their code, or their wording) turned out to be, so the next bill from them matches by itself (learns
// matches). po_receipts.landed: freight, duty and brokerage spread over a receipt's lines. Down drops exactly
// what up adds.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';

migrate((app) => {
  app.save(new Collection({ type: "base", name: "scan_matches", listRule: ACTIVE, viewRule: ACTIVE, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "vendor", type: "relation", required: true, collectionId: app.findCollectionByNameOrId("parties").id, maxSelect: 1, cascadeDelete: false },
      { name: "key", type: "text", required: true, max: 100 },        // "code:ABC-12" or "text:organic bananas 18kg"
      { name: "product", type: "relation", required: true, collectionId: app.findCollectionByNameOrId("products").id, maxSelect: 1, cascadeDelete: false },
      { name: "selling_unit", type: "relation", collectionId: app.findCollectionByNameOrId("selling_units").id, maxSelect: 1, cascadeDelete: false },
      { name: "uses", type: "number", onlyInt: true, min: 0 },
      { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      { name: "created_by", type: "text", max: 64 },
      { name: "updated_by", type: "text", max: 64 },
      { name: "device_id", type: "text", max: 64 },
      { name: "deleted_at", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_scan_matches ON scan_matches (vendor, key)"] }));
  const r = app.findCollectionByNameOrId("po_receipts");
  r.fields.add(new Field({ name: "landed", type: "json", maxSize: 2000 }));    // {freight_cents, duty_cents, brokerage_cents} CAD
  r.fields.add(new Field({ name: "source", type: "text", max: 20 }));          // "manual" | "bill_scan"
  app.save(r);
}, (app) => {
  const r = app.findCollectionByNameOrId("po_receipts");
  r.fields.removeByName("landed"); r.fields.removeByName("source");
  app.save(r);
  app.delete(app.findCollectionByNameOrId("scan_matches"));
});

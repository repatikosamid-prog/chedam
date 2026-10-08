/// <reference path="../../pb_data/types.d.ts" />
// P1 step 8: product import and data export (FR-11.01-11.07, 11.09, NFR-22). The import job log, and the
// owner's right to take a full copy of the store's data. Down drops exactly what up creates.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';

const PERMISSIONS = [["data.export", "setup", "Full business export (every table, CSV + JSON + data dictionary)", true, true]];

migrate((app) => {
  const c = new Collection({
    type: "base", name: "import_jobs",
    listRule: ACTIVE, viewRule: ACTIVE, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "kind", type: "select", required: true, maxSelect: 1, values: ["products"] },
      { name: "file_name", type: "text", max: 200 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["completed", "failed"] },
      { name: "rows", type: "number", onlyInt: true, min: 0 },
      { name: "created", type: "number", onlyInt: true, min: 0 },
      { name: "updated", type: "number", onlyInt: true, min: 0 },
      { name: "drafts", type: "number", onlyInt: true, min: 0 },            // created, but not complete (DL-66)
      { name: "skipped", type: "number", onlyInt: true, min: 0 },           // already in the catalogue, left alone
      { name: "excluded", type: "number", onlyInt: true, min: 0 },          // taken out by the person importing
      { name: "categories_created", type: "number", onlyInt: true, min: 0 },
      { name: "mapping", type: "json", maxSize: 20000 },                     // file column -> field, and the options
      { name: "result", type: "json", maxSize: 400000 },                     // per line: action, product, reasons
      { name: "error", type: "text", max: 2000 },                            // why a failed job was rolled back
      { name: "seconds", type: "number", min: 0 },
      { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      { name: "created_by", type: "text", max: 64 },
      { name: "updated_by", type: "text", max: 64 },
      { name: "device_id", type: "text", max: 64 },
      { name: "deleted_at", type: "date" },
    ],
    indexes: ["CREATE INDEX idx_import_jobs_created ON import_jobs (created_at)"],
  });
  app.save(c);

  PERMISSIONS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    const p = new Record(app.findCollectionByNameOrId("permissions"));
    p.load({ code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive });
    p.set("created_by", "system"); p.set("updated_by", "system");
    app.save(p);
  });
}, (app) => {
  PERMISSIONS.forEach(([code]) => {
    try { app.delete(app.findFirstRecordByData("permissions", "code", code)); } catch (_) { /* already gone */ }
  });
  app.delete(app.findCollectionByNameOrId("import_jobs"));
});

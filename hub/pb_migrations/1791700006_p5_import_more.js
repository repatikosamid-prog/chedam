/// <reference path="../../pb_data/types.d.ts" />
// P5 step 6: imports of every kind of record (FR-11.01) and saved mapping templates (FR-11.08). The import log
// takes the new kinds; a template keeps the file's column names and the field each goes to. Down drops what
// up adds (and puts the import log's kinds back).

const KINDS = ["products", "customers", "parties", "opening_stock", "open_bills", "staff"];

migrate((app) => {
  const j = app.findCollectionByNameOrId("import_jobs");
  j.fields.getByName("kind").values = KINDS;
  app.save(j);
  app.save(new Collection({ type: "base", name: "import_templates", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "target", type: "select", required: true, maxSelect: 1, values: KINDS },
      { name: "name", type: "text", required: true, max: 80 },
      { name: "columns", type: "json", maxSize: 20000 },                       // {file column name: field}
      { name: "by_name", type: "text", max: 80 },
      { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      { name: "created_by", type: "text", max: 64 },
      { name: "updated_by", type: "text", max: 64 },
      { name: "device_id", type: "text", max: 64 },
      { name: "deleted_at", type: "date" },
    ],
    indexes: ["CREATE INDEX idx_import_templates ON import_templates (target, name)"] }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("import_templates"));
  const j = app.findCollectionByNameOrId("import_jobs");
  j.fields.getByName("kind").values = ["products"];
  app.save(j);
});

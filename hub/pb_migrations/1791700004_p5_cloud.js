/// <reference path="../../pb_data/types.d.ts" />
// P5 step 4: the owner's cloud drive (FR-12.08, P5-e): Google Drive or OneDrive, signed in by device code; the
// app registration (client id; Google's secret sealed) and the tokens (sealed, hidden) per provider. Permission
// cloud.connect: the owner. Setting cloud.backup_keep: backup sets kept in the cloud. Down drops what up adds.

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
const PERMS = [["cloud.connect", "system", "Connect the owner's cloud drive (off-site backup, remote view)", true, true]];
const SETTINGS = [
  ["cloud.backup_keep", 14, "Off-site backup (FR-12.08): how many nightly backups are kept on the owner's cloud drive (older ones are removed there)"],
];

migrate((app) => {
  app.save(new Collection({ type: "base", name: "cloud_links", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "provider", type: "select", required: true, maxSelect: 1, values: ["google", "microsoft"] },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["disconnected", "waiting", "connected"] },
      { name: "client_id", type: "text", max: 200 },
      { name: "client_secret_enc", type: "text", max: 1000, hidden: true },
      { name: "device_code_enc", type: "text", max: 2000, hidden: true },
      { name: "user_code", type: "text", max: 20 },
      { name: "verify_url", type: "text", max: 200 },
      { name: "code_expires", type: "date" },
      { name: "refresh_enc", type: "text", max: 5000, hidden: true },
      { name: "access_enc", type: "text", max: 10000, hidden: true },
      { name: "access_expires", type: "date" },
      { name: "account", type: "text", max: 120 },
      { name: "folder_id", type: "text", max: 200 },
      { name: "connected_at", type: "date" },
      { name: "connected_by", type: "text", max: 80 },
      { name: "last_upload_at", type: "date" },
      { name: "last_upload_name", type: "text", max: 200 },
      { name: "last_error", type: "text", max: 300 },
    ].concat(COMMON()),
    indexes: ["CREATE UNIQUE INDEX idx_cloud_links_provider ON cloud_links (provider) WHERE deleted_at = ''"] }));
  PERMS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    const r = new Record(app.findCollectionByNameOrId("permissions"));
    r.load({ code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  PERMS.forEach(([code]) => { try { app.delete(app.findFirstRecordByData("permissions", "code", code)); } catch (_) { /* gone */ } });
  app.delete(app.findCollectionByNameOrId("cloud_links"));
});

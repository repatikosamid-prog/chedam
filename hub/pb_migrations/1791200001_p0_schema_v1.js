/// <reference path="../../pb_data/types.d.ts" />
// P0 schema v1 (Master Spec Section 10, P0 tables).
// Every table carries the common fields: id (may be created on the device), created_at, updated_at,
// created_by, updated_by, device_id, deleted_at (soft delete). Times are UTC (BR-30).
// API rules are all null (superuser only) until P0 step 3 (Access) defines them.
// Down migration drops exactly what up creates (NFR-20: reversible migrations).

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];

const USER_FIELDS = ["role", "phone", "pin_hash", "pin_failed_count", "pin_locked_until",
  "recovery_code_hash", "status", "language", "large_text", "high_contrast",
  "created_at", "updated_at", "created_by", "updated_by", "device_id", "deleted_at"];

// Creation order matters for relations; drop order is the reverse.
const TABLES = ["business", "locations", "settings", "modules", "permissions", "roles",
  "permission_overrides", "devices", "storage_areas", "tasks", "events", "backups", "updates"];

function base(app, name, fields, indexes) {
  const c = new Collection({
    type: "base",
    name: name,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()),
    indexes: indexes || [],
  });
  app.save(c);
  return c;
}

migrate((app) => {
  // ---- Business (FR-1.01, 1.02, 1.13) --------------------------------------------------------
  base(app, "business", [
    { name: "legal_name", type: "text", max: 200 },
    { name: "trade_name", type: "text", max: 200 },
    { name: "shop_type", type: "select", maxSelect: 1,
      values: ["grocery", "convenience", "clothing_gifts", "food_takeout", "general_retail"] },
    { name: "address", type: "json", maxSize: 4000 },          // {line1,line2,city,province,postal,country}
    { name: "phone", type: "text", max: 40 },
    { name: "email", type: "email" },
    { name: "gst_number", type: "text", max: 40 },
    { name: "pst_number", type: "text", max: 40 },
    { name: "business_number", type: "text", max: 40 },
    { name: "currency", type: "text", max: 3 },               // ISO 4217, CAD in pilot
    { name: "time_zone", type: "text", max: 64 },             // IANA, America/Vancouver
    { name: "fiscal_year_start", type: "text", max: 5, pattern: "^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$" },
    { name: "tax_display_mode", type: "select", maxSelect: 1, values: ["tax_added", "tax_included"] },
    { name: "language", type: "text", max: 10 },
    { name: "logo", type: "file", maxSelect: 1, maxSize: 2097152,
      mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] },
    { name: "colours", type: "json", maxSize: 2000 },          // {primary, secondary, accent, from_logo}
    { name: "receipt_header", type: "text", max: 500 },
    { name: "receipt_footer", type: "text", max: 500 },
    { name: "external_refs", type: "json", maxSize: 4000 },    // FR-1.13 non-sensitive refs only
    { name: "setup_state", type: "json", maxSize: 8000 },      // FR-1.15 wizard steps: done/skipped
  ]);

  base(app, "locations", [
    { name: "name", type: "text", required: true, max: 120 },
    { name: "address", type: "json", maxSize: 4000 },
    { name: "is_primary", type: "bool" },
  ]);

  // ---- Settings (key/value) and modules (FR-1.06) ---------------------------------------------
  base(app, "settings", [
    { name: "key", type: "text", required: true, max: 100, pattern: "^[a-z0-9_.]+$" },
    { name: "value", type: "json", maxSize: 20000 },
    { name: "description", type: "text", max: 300 },
  ], ["CREATE UNIQUE INDEX idx_settings_key ON settings (key)"]);

  base(app, "modules", [
    { name: "module", type: "text", required: true, max: 60, pattern: "^[a-z0-9_]+$" },
    { name: "label", type: "text", required: true, max: 80 },
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["core", "switchable", "later"] },
    { name: "enabled", type: "bool" },
    { name: "enabled_by", type: "text", max: 64 },
    { name: "enabled_at", type: "date" },
    { name: "sort", type: "number", onlyInt: true },
  ], ["CREATE UNIQUE INDEX idx_modules_module ON modules (module)"]);

  // ---- People and access (FR-1.03, 1.04, 1.10) ------------------------------------------------
  const permissions = base(app, "permissions", [
    { name: "code", type: "text", required: true, max: 80, pattern: "^[a-z0-9_]+\\.[a-z0-9_]+$" },
    { name: "area", type: "text", required: true, max: 40 },
    { name: "label", type: "text", required: true, max: 120 },
    { name: "owner_only", type: "bool" },                      // never grantable by managers (BR-33)
    { name: "sensitive", type: "bool" },                       // money, HR, pay: shown with a warning
  ], ["CREATE UNIQUE INDEX idx_permissions_code ON permissions (code)"]);

  const roles = base(app, "roles", [
    { name: "code", type: "text", required: true, max: 40, pattern: "^[a-z0-9_]+$" },
    { name: "name", type: "text", required: true, max: 60 },
    { name: "level", type: "number", required: true, onlyInt: true, min: 0, max: 100 },
    { name: "is_template", type: "bool" },
    { name: "permissions", type: "relation", collectionId: permissions.id, maxSelect: 999, cascadeDelete: false },
    { name: "description", type: "text", max: 300 },
  ], ["CREATE UNIQUE INDEX idx_roles_code ON roles (code)"]);

  // PocketBase ships a "users" auth collection; extend it rather than replace it.
  const users = app.findCollectionByNameOrId("users");
  users.listRule = null; users.viewRule = null; users.createRule = null;
  users.updateRule = null; users.deleteRule = null;
  users.fields.getByName("email").required = false;            // staff may have no email
  [
    { name: "role", type: "relation", collectionId: roles.id, maxSelect: 1, cascadeDelete: false },
    { name: "phone", type: "text", max: 40 },
    { name: "pin_hash", type: "text", max: 200, hidden: true },
    { name: "pin_failed_count", type: "number", onlyInt: true, min: 0 },
    { name: "pin_locked_until", type: "date" },
    { name: "recovery_code_hash", type: "text", max: 200, hidden: true },
    { name: "status", type: "select", maxSelect: 1, values: ["active", "suspended", "left"] },
    { name: "language", type: "text", max: 10 },
    { name: "large_text", type: "bool" },
    { name: "high_contrast", type: "bool" },
  ].concat(COMMON()).forEach((f) => users.fields.add(new Field(f)));
  app.save(users);

  base(app, "permission_overrides", [
    { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "permission", type: "relation", required: true, collectionId: permissions.id, maxSelect: 1, cascadeDelete: false },
    { name: "effect", type: "select", required: true, maxSelect: 1, values: ["allow", "deny"] },
    { name: "expires_at", type: "date" },
    { name: "granted_by", type: "text", max: 64 },
    { name: "reason", type: "text", max: 300 },
  ], ["CREATE INDEX idx_overrides_user ON permission_overrides (user)"]);

  // ---- Devices (FR-1.07, 1.08) ----------------------------------------------------------------
  base(app, "devices", [
    { name: "name", type: "text", required: true, max: 80 },
    { name: "type", type: "select", required: true, maxSelect: 1,
      values: ["till", "back_office_pc", "phone", "tablet", "customer_display", "kiosk"] },
    { name: "status", type: "select", required: true, maxSelect: 1,
      values: ["pending", "approved", "locked", "revoked"] },
    { name: "key_hash", type: "text", max: 200, hidden: true },
    { name: "pairing_code_hash", type: "text", max: 200, hidden: true },
    { name: "pairing_expires_at", type: "date" },
    { name: "assigned_user", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "assigned_printer", type: "text", max: 120 },
    { name: "current_user", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "last_seen_at", type: "date" },
    { name: "app_version", type: "text", max: 40 },
    { name: "user_agent", type: "text", max: 400 },
    { name: "approved_by", type: "text", max: 64 },
    { name: "approved_at", type: "date" },
    { name: "revoked_at", type: "date" },
  ]);

  // ---- Storage areas (FR-1.05) ----------------------------------------------------------------
  base(app, "storage_areas", [
    { name: "name", type: "text", required: true, max: 80 },
    { name: "kind", type: "select", required: true, maxSelect: 1,
      values: ["shelf", "cooler", "freezer", "dry_store", "other"] },
    { name: "temp_min_c", type: "number" },
    { name: "temp_max_c", type: "number" },
    { name: "active", type: "bool" },
    { name: "sort", type: "number", onlyInt: true },
  ]);

  // ---- Tasks (FR-1.15 skipped steps; full rules engine is P2) --------------------------------
  base(app, "tasks", [
    { name: "title", type: "text", required: true, max: 200 },
    { name: "kind", type: "text", required: true, max: 60 },   // e.g. setup_incomplete, backup_failed, manual
    { name: "source", type: "select", required: true, maxSelect: 1, values: ["rule", "manual"] },
    { name: "rule_key", type: "text", max: 200 },              // dedupe key for rule tasks
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "done", "dismissed"] },
    { name: "priority", type: "select", maxSelect: 1, values: ["normal", "urgent"] },
    { name: "owner", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    { name: "due_at", type: "date" },
    { name: "link_collection", type: "text", max: 60 },
    { name: "link_id", type: "text", max: 64 },
    { name: "note", type: "text", max: 2000 },
    { name: "closed_at", type: "date" },
  ], ["CREATE INDEX idx_tasks_status ON tasks (status)",
      "CREATE INDEX idx_tasks_rule_key ON tasks (rule_key)"]);

  // ---- Event log (Section 10: every create, update, delete) ----------------------------------
  // Written only by the event-log hook, inside the same transaction as the change. Immutable.
  const events = new Collection({
    type: "base",
    name: "events",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "at", type: "autodate", onCreate: true, onUpdate: false },
      { name: "table_name", type: "text", required: true, max: 60 },
      { name: "record_id", type: "text", required: true, max: 64 },
      { name: "action", type: "select", required: true, maxSelect: 1, values: ["create", "update", "delete"] },
      { name: "actor", type: "text", max: 100 },                // "<collection>:<id>" or "system"
      { name: "device_id", type: "text", max: 64 },
      { name: "before", type: "json", maxSize: 200000 },
      { name: "after", type: "json", maxSize: 200000 },
      { name: "changed", type: "json", maxSize: 20000 },        // list of changed field names (updates)
    ],
    indexes: [
      "CREATE INDEX idx_events_at ON events (at)",
      "CREATE INDEX idx_events_record ON events (table_name, record_id)",
    ],
  });
  app.save(events);

  // ---- Backups and updates (FR-1.14, 12.02-12.04, 12.08) -------------------------------------
  base(app, "backups", [
    { name: "kind", type: "select", required: true, maxSelect: 1,
      values: ["scheduled", "manual", "pre_update", "first_backup"] },
    { name: "target", type: "select", required: true, maxSelect: 1, values: ["usb", "local", "cloud"] },
    { name: "status", type: "select", required: true, maxSelect: 1,
      values: ["running", "ok", "verified", "failed"] },
    { name: "started_at", type: "date" },
    { name: "finished_at", type: "date" },
    { name: "file_name", type: "text", max: 300 },
    { name: "size_bytes", type: "number", onlyInt: true, min: 0 },
    { name: "sha256", type: "text", max: 64 },
    { name: "encrypted", type: "bool" },
    { name: "verified_at", type: "date" },
    { name: "error", type: "text", max: 2000 },
  ]);

  base(app, "updates", [
    { name: "package", type: "text", required: true, max: 120 },
    { name: "kind", type: "select", required: true, maxSelect: 1,
      values: ["app", "schema", "tax_tables", "datasets", "os"] },
    { name: "version", type: "text", required: true, max: 40 },
    { name: "source", type: "select", required: true, maxSelect: 1, values: ["online", "usb"] },
    { name: "status", type: "select", required: true, maxSelect: 1,
      values: ["available", "downloaded", "verified", "scheduled", "installing", "installed", "failed", "rolled_back"] },
    { name: "sha256", type: "text", max: 64 },
    { name: "signature_ok", type: "bool" },
    { name: "effective_at", type: "date" },                   // FR-12.03 tax tables switch on at this date
    { name: "scheduled_for", type: "date" },
    { name: "installed_at", type: "date" },
    { name: "rolled_back_at", type: "date" },
    { name: "backup", type: "text", max: 64 },                 // backups.id taken before install
    { name: "notes", type: "text", max: 4000 },
    { name: "error", type: "text", max: 2000 },
  ]);
}, (app) => {
  for (const name of TABLES.slice().reverse()) {
    if (name === "roles") {
      // users.role points at roles: remove the user fields first
      const users = app.findCollectionByNameOrId("users");
      USER_FIELDS.forEach((f) => users.fields.removeByName(f));
      users.fields.getByName("email").required = true;
      app.save(users);
    }
    app.delete(app.findCollectionByNameOrId(name));
  }
});

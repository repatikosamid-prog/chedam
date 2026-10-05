/// <reference path="../../pb_data/types.d.ts" />
// P0 reference data every store needs: modules (Section 6), shop-type presets, the P0 permission
// catalogue, role templates (Section 4) and default settings. Later phases add their own
// permissions and settings in their own migrations. Down removes exactly these rows.

const MODULES = [
  // [code, label, kind]
  ["sell", "Sell (till, receipts, returns, tax)", "core"],
  ["stock", "Stock (products, packs, receiving)", "core"],
  ["team", "Team (users, messages, pings, tasks)", "core"],
  ["promotions", "Promotions", "switchable"],
  ["labels", "Labels", "switchable"],
  ["customers_loyalty", "Customers and Loyalty", "switchable"],
  ["orders_layaway", "Orders and Layaway", "switchable"],
  ["vendors_purchasing", "Vendors and Purchasing", "switchable"],
  ["delivery_apps", "Delivery Apps", "switchable"],
  ["weighed_goods", "Weighed Goods", "switchable"],
  ["regulated_items", "Regulated Items", "switchable"],
  ["product_variety", "Product Variety", "switchable"],
  ["expenses", "Expenses", "switchable"],
  ["time_schedules", "Time and Schedules", "switchable"],
  ["hr_payroll", "HR and Payroll", "switchable"],
  ["finance", "Finance", "switchable"],
  ["operations", "Operations", "switchable"],
  ["connected_services", "Connected Services", "switchable"],
  ["monitoring", "Monitoring sensors", "later"],
  ["multi_location", "Multi-location", "later"],
  ["online_store", "Online store", "later"],
  ["ai_camera", "AI and camera (premium)", "later"],
];

const PRESETS = {
  grocery: ["promotions", "labels", "customers_loyalty", "vendors_purchasing", "weighed_goods",
    "regulated_items", "operations"],
  convenience: ["promotions", "labels", "regulated_items", "vendors_purchasing", "operations"],
  clothing_gifts: ["promotions", "labels", "customers_loyalty", "product_variety", "orders_layaway"],
  food_takeout: ["delivery_apps", "promotions", "customers_loyalty", "operations"],
  general_retail: ["promotions", "labels", "customers_loyalty", "vendors_purchasing"],
};

// [code, area, label, owner_only, sensitive]
const PERMISSIONS = [
  ["business.edit", "setup", "Edit business profile and branding", false, false],
  ["settings.manage", "setup", "Change store settings", false, false],
  ["modules.manage", "setup", "Switch modules on or off", true, false],
  ["setup.run", "setup", "Run or resume the setup wizard", true, false],
  ["users.view", "people", "See people and their roles", false, false],
  ["users.manage", "people", "Add and edit people (not the owner)", false, false],
  ["access.manage", "people", "Change roles and permission overrides", false, true],
  ["owner.manage", "people", "Edit the owner account and other owners", true, true],
  ["devices.view", "devices", "See devices", false, false],
  ["devices.manage", "devices", "Pair, approve, lock, rename, revoke devices", false, false],
  ["storage.manage", "stock", "Manage storage areas", false, false],
  ["tasks.view", "team", "See tasks", false, false],
  ["tasks.manage", "team", "Create, assign and close tasks", false, false],
  ["events.view", "system", "View the audit log", false, true],
  ["backups.view", "system", "See backups", false, false],
  ["backups.run", "system", "Start a backup", false, false],
  ["backups.restore", "system", "Restore from a backup", true, true],
  ["updates.view", "system", "See available updates", false, false],
  ["updates.install", "system", "Install or roll back updates", true, true],
  ["health.view", "system", "See the hub health page", false, false],
];

// Role templates (Section 4). Owner gets every permission, including future ones (checked in code).
const ROLES = [
  ["owner", "Owner", 100, "Full control; logs in on any device; manages all devices and access", "*"],
  ["manager", "Manager", 80, "Runs daily operations; edits access of non-owners up to their own level",
    ["business.edit", "settings.manage", "users.view", "users.manage", "access.manage", "devices.view",
     "devices.manage", "storage.manage", "tasks.view", "tasks.manage", "events.view", "backups.view",
     "backups.run", "updates.view", "health.view"]],
  ["accountant", "Accountant", 50, "Reads finance and reports, exports, reconciles",
    ["events.view", "backups.view", "tasks.view"]],
  ["cashier", "Cashier", 40, "Sells, returns within limits, opens and closes the till",
    ["tasks.view"]],
  ["staff", "Staff", 30, "Receives stock, counts, labels, tasks",
    ["tasks.view", "storage.manage"]],
];

// Owner-editable defaults (the * values in Section 9 arrive with their phases).
const SETTINGS = [
  ["store.country", "CA", "Country (ISO 3166)"],
  ["store.province", "BC", "Province or territory for tax tables"],
  ["store.currency", "CAD", "Store currency"],
  ["store.time_zone", "America/Vancouver", "Store time zone (times stored in UTC, BR-30)"],
  ["store.language", "en", "Interface language"],
  ["shop_presets", PRESETS, "Modules switched on by each shop-type preset (Section 6)"],
  ["security.pin_max_attempts", 5, "PIN lockout after this many wrong tries (NFR-11)"],
  ["security.pin_lockout_minutes", 15, "How long a locked PIN stays locked"],
  ["security.auto_lock_minutes", 5, "Lock an idle device after this many minutes (NFR-11)"],
  ["backup.schedule", "02:30", "Nightly backup time, store time"],
  ["backup.retention", { daily: 14, weekly: 8, monthly: 12 }, "Backups kept (NFR-04)"],
  ["updates.install_window", { start: "02:00", end: "05:00" }, "Install updates outside trading hours (FR-12.02)"],
];

function col(app, name) { return app.findCollectionByNameOrId(name); }

function put(app, name, data) {
  const r = new Record(col(app, name));
  r.load(data);
  r.set("created_by", "system");
  app.save(r);
  return r;
}

migrate((app) => {
  MODULES.forEach(([code, label, kind], i) => {
    put(app, "modules", { module: code, label: label, kind: kind, enabled: kind === "core", sort: i + 1 });
  });

  const permIds = {};
  PERMISSIONS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    permIds[code] = put(app, "permissions",
      { code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive }).id;
  });

  ROLES.forEach(([code, name, level, description, perms]) => {
    const list = perms === "*" ? Object.keys(permIds) : perms;
    put(app, "roles", { code: code, name: name, level: level, is_template: true,
      description: description, permissions: list.map((p) => permIds[p]) });
  });

  SETTINGS.forEach(([key, value, description]) => {
    put(app, "settings", { key: key, value: value, description: description });
  });
}, (app) => {
  const del = (name, field, values) => values.forEach((v) => {
    try { app.delete(app.findFirstRecordByData(name, field, v)); } catch (_) { /* already gone */ }
  });
  del("settings", "key", SETTINGS.map((s) => s[0]));
  del("roles", "code", ROLES.map((r) => r[0]));
  del("permissions", "code", PERMISSIONS.map((p) => p[0]));
  del("modules", "module", MODULES.map((m) => m[0]));
});

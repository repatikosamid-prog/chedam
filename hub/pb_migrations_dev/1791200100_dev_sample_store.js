/// <reference path="../../pb_data/types.d.ts" />
// DEV ONLY sample store (Master Spec Section 13: "schema migrations and sample data first").
// Deployed only to development hubs (deploy-hub.sh --sample-data). Never shipped to a store.
// Users get random, unknown passwords; real logins (PIN / owner password) arrive in P0 step 3.

const TAG = "sample";

function put(app, name, data) {
  const r = new Record(app.findCollectionByNameOrId(name));
  r.load(data);
  r.set("created_by", "system:" + TAG);
  r.set("updated_by", "system:" + TAG);
  app.save(r);
  return r;
}

function roleId(app, code) {
  return app.findFirstRecordByData("roles", "code", code).id;
}

migrate((app) => {
  put(app, "business", {
    legal_name: "Chedam Demo Grocery Ltd.",
    trade_name: "Demo Grocery",
    shop_type: "grocery",
    address: { line1: "100 Sample St", city: "Vancouver", province: "BC", postal: "V5K 0A1", country: "CA" },
    phone: "604-555-0100",
    currency: "CAD",
    time_zone: "America/Vancouver",
    fiscal_year_start: "01-01",
    tax_display_mode: "tax_added",
    language: "en",
    colours: { primary: "#1f6f43", secondary: "#f2b134", accent: "#0b5394", from_logo: false },
    receipt_header: "Demo Grocery\n100 Sample St, Vancouver",
    receipt_footer: "Thank you! Returns within 30 days with receipt.",
    setup_state: { sample: true, steps: {} },
  });

  put(app, "locations", { name: "Main store", is_primary: true,
    address: { line1: "100 Sample St", city: "Vancouver", province: "BC", postal: "V5K 0A1", country: "CA" } });

  // Grocery preset modules on (Section 6)
  const presets = JSON.parse(app.findFirstRecordByData("settings", "key", "shop_presets").getString("value"));
  const grocery = presets.grocery;
  grocery.forEach((code) => {
    const m = app.findFirstRecordByData("modules", "module", code);
    m.set("enabled", true);
    m.set("enabled_by", "system:" + TAG);
    m.set("enabled_at", new DateTime());
    m.set("updated_by", "system:" + TAG);
    app.save(m);
  });

  [
    ["Shelf", "shelf", null, null],
    ["Cooler", "cooler", 0, 4],
    ["Freezer", "freezer", -25, -15],
    ["Dry store", "dry_store", 10, 25],
  ].forEach(([name, kind, min, max], i) =>
    put(app, "storage_areas", { name: name, kind: kind, temp_min_c: min, temp_max_c: max, active: true, sort: i + 1 }));

  [
    ["Demo Owner", "owner", "demo-owner@chedam.test"],
    ["Mira Manager", "manager", "demo-manager@chedam.test"],
    ["Cal Cashier", "cashier", ""],
    ["Sam Staff", "staff", ""],
    ["Ana Accountant", "accountant", "demo-accountant@chedam.test"],
  ].forEach(([name, role, email]) => {
    const pw = $security.randomString(32);
    put(app, "users", { name: name, role: roleId(app, role), email: email, status: "active",
      password: pw, passwordConfirm: pw, language: "en" });
  });

  put(app, "tasks", { title: "Finish setup: choose a backup USB drive", kind: "setup_incomplete",
    source: "rule", rule_key: "setup:backup", status: "open", priority: "normal",
    link_collection: "business" });
}, (app) => {
  const mine = (name) => app.findRecordsByFilter(name, "created_by = 'system:sample'", "", 0, 0);
  ["tasks", "users", "storage_areas", "locations", "business"].forEach((name) =>
    mine(name).forEach((r) => app.delete(r)));
  app.findRecordsByFilter("modules", "enabled_by = 'system:sample'", "", 0, 0).forEach((m) => {
    m.set("enabled", false);
    m.set("enabled_by", "");
    m.set("enabled_at", "");
    m.set("updated_by", "system:sample");
    app.save(m);
  });
});

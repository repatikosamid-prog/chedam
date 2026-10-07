/// <reference path="../../pb_data/types.d.ts" />
// P1 step 2 reference data: stock permissions (given to the role templates) and stock settings:
// reason codes (BR-05, FR-6.06) and the write-off value above which a manager approves (BR-18).

// [code, area, label, owner_only, sensitive]
const PERMISSIONS = [
  ["stock.receive", "stock", "Receive stock (add stock by phone, bulk add)", false, false],
  ["stock.adjust", "stock", "Adjust stock, record damage and loss, break or make packs", false, false],
  ["stock.count", "stock", "Count stock", false, false],
  ["stock.approve", "stock", "Approve write-offs and count variances", false, true],
];

const GRANTS = {
  manager: ["stock.receive", "stock.adjust", "stock.count", "stock.approve"],
  staff: ["stock.receive", "stock.adjust", "stock.count"],
};

const SETTINGS = [
  ["stock.reasons", {
    damage: ["Damaged in store", "Damaged on delivery", "Expired", "Spoiled", "Damaged when opening a pack"],
    loss: ["Theft", "Unknown loss", "Staff use", "Sample or tasting", "Donated"],
    adjust: ["Found stock", "Correction", "Wrong item received", "Other"],
  }, "Reason codes for stock changes (BR-05, FR-6.06)"],
  ["stock.approval_value_cents", 2500, "Write-offs above this value at cost need a manager (BR-18); 0 = always"],
];

migrate((app) => {
  const ids = {};
  PERMISSIONS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    const p = new Record(app.findCollectionByNameOrId("permissions"));
    p.load({ code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive });
    p.set("created_by", "system"); p.set("updated_by", "system");
    app.save(p);
    ids[code] = p.id;
  });
  Object.keys(GRANTS).forEach((roleCode) => {
    const role = app.findFirstRecordByData("roles", "code", roleCode);
    role.set("permissions", role.get("permissions").concat(GRANTS[roleCode].map((c) => ids[c])));
    role.set("updated_by", "system");
    app.save(role);
  });
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => {
    try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* already gone */ }
  });
  const ids = PERMISSIONS.map(([code]) => {
    try { return app.findFirstRecordByData("permissions", "code", code).id; } catch (_) { return ""; }
  });
  Object.keys(GRANTS).forEach((roleCode) => {
    const role = app.findFirstRecordByData("roles", "code", roleCode);
    role.set("permissions", role.get("permissions").filter((id) => ids.indexOf(id) < 0));
    role.set("updated_by", "system");
    app.save(role);
  });
  ids.forEach((id) => { if (id) app.delete(app.findRecordById("permissions", id)); });
});

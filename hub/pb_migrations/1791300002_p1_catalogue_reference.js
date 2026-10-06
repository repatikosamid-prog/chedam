/// <reference path="../../pb_data/types.d.ts" />
// P1 step 1 reference data: catalogue and tax permissions (given to the role templates), the federal
// GST and BC PST rates and the four standard tax classes (DL-68). Every tax row is marked
// pending_review until the accountant confirms the rules (open question Q1). Down removes exactly these.

// [code, area, label, owner_only, sensitive]
const PERMISSIONS = [
  ["catalogue.edit", "catalogue", "Add and edit products, packs and categories", false, false],
  ["prices.edit", "catalogue", "Change selling prices of active products", false, true],
  ["tax.manage", "catalogue", "Change tax rates, tax classes, deposits and fees", false, true],
];

const GRANTS = {
  manager: ["catalogue.edit", "prices.edit", "tax.manage"],
  staff: ["catalogue.edit"],
};

const TAX_TYPES = [
  // [code, name, level, receipt label, sort]
  ["GST", "Goods and Services Tax", "federal", "GST", 1],
  ["PST", "BC Provincial Sales Tax", "provincial", "PST", 2],
  ["HST", "Harmonized Sales Tax", "harmonized", "HST", 3],
];

const TAX_RATES = [
  // [type, province, rate, effective_from, source]
  ["GST", "", 5, "2008-01-01 00:00:00.000Z", "Excise Tax Act, GST 5% since 2008-01-01"],
  ["PST", "BC", 7, "2013-04-01 00:00:00.000Z", "BC Provincial Sales Tax Act, PST 7% since 2013-04-01"],
];

const TAX_CLASSES = [
  // [code, name, treatment, types, description]
  ["standard", "Standard (GST + PST)", "taxable", ["GST", "PST"], "Most goods"],
  ["gst_only", "GST only", "taxable", ["GST"], "PST-exempt goods, for example children's clothing"],
  ["zero_rated", "Zero-rated", "zero_rated", [], "Taxable at 0%, for example basic groceries"],
  ["exempt", "Exempt", "exempt", [], "Not taxable"],
];

function put(app, name, data) {
  const r = new Record(app.findCollectionByNameOrId(name));
  r.load(data);
  r.set("created_by", "system");
  r.set("updated_by", "system");
  app.save(r);
  return r;
}

function del(app, name, field, values) {
  values.forEach((v) => {
    try { app.delete(app.findFirstRecordByData(name, field, v)); } catch (_) { /* already gone */ }
  });
}

migrate((app) => {
  const permIds = {};
  PERMISSIONS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    permIds[code] = put(app, "permissions", { code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive }).id;
  });
  Object.keys(GRANTS).forEach((roleCode) => {
    const role = app.findFirstRecordByData("roles", "code", roleCode);
    role.set("permissions", role.get("permissions").concat(GRANTS[roleCode].map((c) => permIds[c])));
    role.set("updated_by", "system");
    app.save(role);
  });

  const typeIds = {};
  TAX_TYPES.forEach(([code, name, level, label, sort]) => {
    typeIds[code] = put(app, "tax_types", { code: code, name: name, level: level, receipt_label: label, sort: sort }).id;
  });
  TAX_RATES.forEach(([type, province, rate, from, source]) => {
    put(app, "tax_rates", { tax_type: typeIds[type], province: province, rate: rate, effective_from: from, source: source, pending_review: true });
  });
  TAX_CLASSES.forEach(([code, name, treatment, types, description], i) => {
    put(app, "tax_classes", { code: code, name: name, treatment: treatment, tax_types: types.map((t) => typeIds[t]),
      is_custom: false, description: description, pending_review: true, sort: i + 1 });
  });
}, (app) => {
  del(app, "tax_classes", "code", TAX_CLASSES.map((c) => c[0]));
  TAX_TYPES.forEach(([code]) => {
    try {
      const t = app.findFirstRecordByData("tax_types", "code", code);
      app.findRecordsByFilter("tax_rates", "tax_type = {:t}", "", 0, 0, { t: t.id }).forEach((r) => app.delete(r));
      app.delete(t);
    } catch (_) { /* already gone */ }
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
  del(app, "permissions", "code", PERMISSIONS.map((p) => p[0]));
});

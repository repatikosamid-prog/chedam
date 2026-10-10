/// <reference path="../../pb_data/types.d.ts" />
// P3 step 1: parties (FR-8.01, 8.07, 8.08). Vendors and clients in one table (a record can be both, P3-a):
// contacts, addresses, payment terms, currency, tax ID, importer/exporter details, documents, notes; a
// communication log per party with follow-up reminders (tasks); exchange rates by date for documents in
// other currencies (P3-b). Down drops exactly what up adds.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';
const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
function base(app, name, fields, indexes) {
  const c = new Collection({ type: "base", name: name, listRule: ACTIVE, viewRule: ACTIVE, createRule: ACTIVE, updateRule: ACTIVE, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [] });
  app.save(c);
  return c;
}

const PERMS = [
  ["parties.view", "buying", "See vendors and clients", false, false],
  ["parties.manage", "buying", "Add and change vendors and clients", false, false],
];
const GRANTS = { manager: ["parties.view", "parties.manage"], accountant: ["parties.view"], staff: ["parties.view"] };

migrate((app) => {
  const parties = base(app, "parties", [
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["vendor", "client", "both"] },
    { name: "name", type: "text", required: true, max: 120 },
    { name: "legal_name", type: "text", max: 160 },
    { name: "code", type: "text", max: 20 },                         // short code, e.g. "SYSCO"
    { name: "tax_id", type: "text", max: 40 },                       // GST/HST number
    { name: "pst_number", type: "text", max: 40 },
    { name: "business_number", type: "text", max: 40 },              // CRA BN (importer/exporter account RM)
    { name: "importer", type: "bool" },
    { name: "exporter", type: "bool" },
    { name: "currency", type: "text", max: 3 },                      // ISO code; CAD by default
    { name: "payment_terms_days", type: "number", onlyInt: true, min: 0, max: 365 },
    { name: "terms_text", type: "text", max: 200 },                  // e.g. "2% 10, net 30"
    { name: "credit_limit_cents", type: "number", onlyInt: true, min: 0 },
    { name: "email", type: "text", max: 120 },
    { name: "phone", type: "text", max: 40 },
    { name: "website", type: "text", max: 200 },
    { name: "street", type: "text", max: 200 },
    { name: "city", type: "text", max: 80 },
    { name: "province", type: "text", max: 40 },
    { name: "postal_code", type: "text", max: 12 },
    { name: "country", type: "text", max: 2 },
    { name: "notes", type: "text", max: 4000 },
    { name: "documents", type: "file", maxSelect: 20, maxSize: 10485760, mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"], protected: true },
    { name: "active", type: "bool" },
  ], ["CREATE INDEX idx_parties_name ON parties (name)", "CREATE UNIQUE INDEX idx_parties_code ON parties (code) WHERE code != ''"]);
  base(app, "party_contacts", [
    { name: "party", type: "relation", required: true, collectionId: parties.id, maxSelect: 1, cascadeDelete: false },
    { name: "name", type: "text", required: true, max: 100 },
    { name: "role", type: "text", max: 80 },                         // e.g. "Sales rep", "Accounts payable"
    { name: "email", type: "text", max: 120 },
    { name: "phone", type: "text", max: 40 },
    { name: "primary", type: "bool" },
  ]);
  base(app, "party_logs", [
    { name: "party", type: "relation", required: true, collectionId: parties.id, maxSelect: 1, cascadeDelete: false },
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["call", "email", "visit", "meeting", "note", "order"] },
    { name: "text", type: "text", required: true, max: 4000 },
    { name: "contact", type: "text", max: 100 },
    { name: "by", type: "text", max: 64 },
    { name: "by_name", type: "text", max: 80 },
    { name: "follow_up_at", type: "date" },
    { name: "follow_up_task", type: "text", max: 15 },
  ], ["CREATE INDEX idx_party_logs ON party_logs (party, created_at)"]);
  base(app, "fx_rates", [
    { name: "currency", type: "text", required: true, max: 3 },
    { name: "day", type: "text", required: true, max: 10 },          // YYYY-MM-DD
    { name: "rate", type: "number", required: true, min: 0 },        // CAD for one unit of the currency
    { name: "source", type: "text", max: 80 },                       // e.g. "Bank of Canada", "manual"
  ], ["CREATE UNIQUE INDEX idx_fx_rates ON fx_rates (currency, day)"]);

  const ids = {};
  PERMS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    const p = new Record(app.findCollectionByNameOrId("permissions"));
    p.load({ code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive });
    p.set("created_by", "system"); p.set("updated_by", "system");
    app.save(p);
    ids[code] = p.id;
  });
  Object.keys(GRANTS).forEach((role) => {
    let r;
    try { r = app.findFirstRecordByData("roles", "code", role); } catch (_) { return; }
    r.set("permissions", r.get("permissions").concat(GRANTS[role].map((c) => ids[c])));
    r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  const ids = PERMS.map(([code]) => { try { return app.findFirstRecordByData("permissions", "code", code).id; } catch (_) { return ""; } }).filter(Boolean);
  Object.keys(GRANTS).forEach((role) => {
    let r;
    try { r = app.findFirstRecordByData("roles", "code", role); } catch (_) { return; }
    r.set("permissions", r.get("permissions").filter((x) => ids.indexOf(x) < 0));
    r.set("updated_by", "system");
    app.save(r);
  });
  ids.forEach((id) => app.delete(app.findRecordById("permissions", id)));
  ["fx_rates", "party_logs", "party_contacts", "parties"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

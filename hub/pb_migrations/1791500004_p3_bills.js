/// <reference path="../../pb_data/types.d.ts" />
// P3 step 4: bills, invoices, payments, statements, vendor returns (FR-8.04, 8.05, 8.06). Money documents
// with a party: vendor bills and vendor credits (payables), client invoices and client credits (receivables),
// each in its currency with the rate on its date (P3-b) and the CAD total. Payments against them (cash, cheque,
// e-transfer, card, bank transfer, or a credit applied). Vendor returns take stock out and wait for the vendor's
// credit. Changed only through /api/chedam/bills, /payments, /vendor-returns. finance.manage: managers and the
// accountant. Down drops exactly what up adds.

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
  const c = new Collection({ type: "base", name: name, listRule: ACTIVE, viewRule: ACTIVE, createRule: ACTIVE, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [] });
  app.save(c);
  return c;
}
const PERMS = [["finance.manage", "money", "Bills, invoices, payments and statements", false, true]];
const GRANTS = { manager: ["finance.manage"], accountant: ["finance.manage"] };

migrate((app) => {
  const parties = app.findCollectionByNameOrId("parties"), pos = app.findCollectionByNameOrId("purchase_orders");
  const bills = base(app, "bills", [
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["bill", "vendor_credit", "invoice", "client_credit"] },
    { name: "number", type: "text", max: 20 },                       // B-000001, VC-…, INV-…, CC-…
    { name: "party", type: "relation", required: true, collectionId: parties.id, maxSelect: 1, cascadeDelete: false },
    { name: "party_ref", type: "text", max: 60 },                    // the vendor's invoice number
    { name: "po", type: "relation", collectionId: pos.id, maxSelect: 1, cascadeDelete: false },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "partial", "paid", "void"] },
    { name: "doc_date", type: "text", max: 10 },
    { name: "due_date", type: "text", max: 10 },
    { name: "currency", type: "text", max: 3 },
    { name: "fx_rate", type: "number", min: 0 },
    { name: "lines", type: "json", maxSize: 60000 },                 // [{description, product, qty, unit_cents, total_cents, category}]
    { name: "taxes", type: "json", maxSize: 4000 },                  // [{code, label, cents}]
    { name: "subtotal_cents", type: "number", onlyInt: true },
    { name: "tax_cents", type: "number", onlyInt: true },
    { name: "total_cents", type: "number", onlyInt: true },
    { name: "total_cad_cents", type: "number", onlyInt: true },
    { name: "paid_cents", type: "number", onlyInt: true },
    { name: "notes", type: "text", max: 2000 },
    { name: "attachment", type: "file", maxSelect: 3, maxSize: 10485760, mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"], protected: true },
    { name: "match_note", type: "text", max: 300 },                  // bill vs what was received on the PO
    { name: "void_reason", type: "text", max: 300 },
  ], ["CREATE UNIQUE INDEX idx_bills_number ON bills (number) WHERE number != ''", "CREATE INDEX idx_bills_party ON bills (party, status)",
      "CREATE INDEX idx_bills_due ON bills (kind, status, due_date)"]);
  base(app, "bill_payments", [
    { name: "bill", type: "relation", required: true, collectionId: bills.id, maxSelect: 1, cascadeDelete: false },
    { name: "day", type: "text", max: 10 },
    { name: "amount_cents", type: "number", onlyInt: true },         // in the document's currency
    { name: "cad_cents", type: "number", onlyInt: true },
    { name: "method", type: "select", required: true, maxSelect: 1, values: ["cash", "cheque", "e_transfer", "card", "bank_transfer", "credit", "till_cash"] },
    { name: "reference", type: "text", max: 80 },                    // cheque number, transfer reference
    { name: "credit_doc", type: "text", max: 15 },                   // the credit applied (method credit)
    { name: "by_name", type: "text", max: 80 },
    { name: "voided", type: "bool" },
  ], ["CREATE INDEX idx_bill_payments ON bill_payments (bill)"]);
  base(app, "vendor_returns", [
    { name: "number", type: "text", max: 20 },                       // VR-000001
    { name: "vendor", type: "relation", required: true, collectionId: parties.id, maxSelect: 1, cascadeDelete: false },
    { name: "po", type: "relation", collectionId: pos.id, maxSelect: 1, cascadeDelete: false },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "shipped", "credited", "cancelled"] },
    { name: "lines", type: "json", maxSize: 20000 },                 // [{product, selling_unit, qty, cost_cents, reason, movement}]
    { name: "reason", type: "text", max: 200 },
    { name: "rma", type: "text", max: 60 },                          // the vendor's return authorisation
    { name: "credit", type: "text", max: 15 },                       // the vendor credit (bills id)
    { name: "value_cad_cents", type: "number", onlyInt: true },
  ], ["CREATE UNIQUE INDEX idx_vendor_returns_number ON vendor_returns (number) WHERE number != ''"]);

  // A stock reason for goods going back to the vendor
  try {
    const r = app.findFirstRecordByData("settings", "key", "stock.reasons");
    const v = JSON.parse(r.getString("value") || "{}") || {};
    v.adjust = v.adjust || [];
    if (v.adjust.indexOf("Returned to vendor") < 0) v.adjust.push("Returned to vendor");
    r.set("value", v); r.set("updated_by", "system"); app.save(r);
  } catch (_) { /* no reasons yet */ }

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
  try {
    const r = app.findFirstRecordByData("settings", "key", "stock.reasons");
    const v = JSON.parse(r.getString("value") || "{}") || {};
    v.adjust = (v.adjust || []).filter((x) => x !== "Returned to vendor");
    r.set("value", v); app.save(r);
  } catch (_) { /* none */ }
  ["vendor_returns", "bill_payments", "bills"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

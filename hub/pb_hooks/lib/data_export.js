// Full business export (P1 step 8; FR-11.09, NFR-22: the store's data is the owner's). The owner's
// browser asks for the data dictionary, then every table page by page, and makes the zip (CSV + JSON +
// dictionary). Hidden fields (password and PIN hashes, device keys, tokens) are never sent; PocketBase's
// own system tables are left out.

const NOTES = {
  business: "The store: names, address, tax numbers, receipt texts", users: "People who use Chedam (no passwords or PINs)",
  roles: "Role templates and their permissions", permissions: "What can be allowed", settings: "Store settings", modules: "Switchable modules",
  devices: "Paired tills, phones and computers (no keys)", events: "Audit log: every create, change and delete",
  tasks: "Tasks and reminders", categories: "Product categories", products: "Products", selling_units: "How products are sold: singles, packs, weight",
  price_history: "Price and cost changes", tax_types: "Tax types (GST, PST)", tax_rates: "Tax rates over time", tax_classes: "Tax classes",
  deposits_fees: "Deposits and eco fees", stock_levels: "Stock on hand", stock_lots: "Stock lots (cost, expiry)", stock_movements: "Every stock change",
  stock_counts: "Stock counts", stock_count_lines: "Counted lines", tills: "Till sessions and Z reports", cash_movements: "Cash drops, pay-outs, no-sales",
  sales: "Sales", sale_lines: "Sale lines", payments: "Payments", tax_exemptions: "Tax-exempt sales", returns: "Returns", return_lines: "Returned lines",
  refunds: "Refunds", store_credits: "Store credit codes and balances", label_batch_items: "Labels to print", label_batches: "Printed label batches",
  label_layouts: "Label sheet layouts", label_templates: "Label templates", import_jobs: "Import job log", backups: "Backup runs",
};
const NEVER = ["password", "tokenKey", "pin", "pin_hash", "key_hash", "pairing_code_hash", "recovery_hash", "temp_pin_hash"];

function exportable(app) {
  return app.findAllCollections().filter((c) => !c.system && c.name.indexOf("_") !== 0 && (c.type === "base" || c.type === "auth"));
}

function fieldsOf(c) {
  const out = [];
  c.fields.forEach((f) => {
    if (f.hidden || NEVER.indexOf(f.name) >= 0 || f.system && f.name !== "id") return;
    out.push(f);
  });
  return out;
}

function dictionary(app) {
  const names = {};
  app.findAllCollections().forEach((c) => { names[c.id] = c.name; });
  return exportable(app).map((c) => ({
    table: c.name, description: NOTES[c.name] || "", rows: app.countRecords(c.name),
    fields: fieldsOf(c).map((f) => {
      const d = { name: f.name, type: f.type(), required: !!f.required };
      if (f.type() === "select") d.values = f.values;
      if (f.type() === "relation") d.links_to = names[f.collectionId] || "";
      if (f.name.slice(-6) === "_cents") d.note = "money in cents";
      return d;
    }),
  }));
}

function table(app, name, page, perPage) {
  const c = exportable(app).find((x) => x.name === name);
  if (!c) throw new NotFoundError("No such table.");
  const fields = fieldsOf(c);
  const n = Math.min(Math.max(Number(perPage) || 500, 1), 1000);
  const p = Math.max(Number(page) || 1, 1);
  const rows = app.findRecordsByFilter(name, "id != ''", "id", n, (p - 1) * n).map((r) => {
    const o = {};
    fields.forEach((f) => {
      const t = f.type();
      if (t === "json") { try { o[f.name] = JSON.parse(r.getString(f.name) || "null"); } catch (_) { o[f.name] = r.getString(f.name); } }
      else if (t === "bool") o[f.name] = r.getBool(f.name);
      else if (t === "number") o[f.name] = r.getFloat(f.name);
      else if (t === "relation" || t === "select" || t === "file") { const v = r.get(f.name); o[f.name] = Array.isArray(v) ? v.slice() : (v === null || v === undefined ? "" : String(v)); }
      else o[f.name] = r.getString(f.name);
    });
    return o;
  });
  const total = app.countRecords(name);
  return { table: name, page: p, per_page: n, total: total, pages: Math.max(1, Math.ceil(total / n)), rows: rows };
}

module.exports = { dictionary, table, NEVER };

// Record retention (P1 step 9; FR-10.09, BR-34): business records cannot be deleted for `retention.years`
// (at least 6, as the CRA requires). In the app nothing is ever hard-deleted (records are marked deleted);
// this stops hard deletes through the API, including the admin dashboard (superusers). Records older than
// the window may be deleted. The event log can never be deleted (event_log.pb.js).
// Hub code that deletes on purpose (soft holds, sample data, migrations) does not go through the API.

const MIN_YEARS = 6;

// Record types kept for the retention window (everything money, stock, tax or audit touches)
const RETAINED = {
  sales: "Sales", sale_lines: "Sale lines", payments: "Payments", tax_exemptions: "Tax-exempt sales", tills: "Tills and Z reports",
  cash_movements: "Cash drops, pay-outs, no-sales", returns: "Returns", return_lines: "Returned lines", refunds: "Refunds",
  store_credits: "Store credit", stock_movements: "Stock movements", stock_lots: "Stock lots", stock_levels: "Stock levels",
  stock_counts: "Stock counts", stock_count_lines: "Counted lines", price_history: "Price and cost history", products: "Products",
  selling_units: "Selling units", categories: "Categories", tax_types: "Tax types", tax_rates: "Tax rates", tax_classes: "Tax classes",
  deposits_fees: "Deposits and fees", users: "People", devices: "Devices", business: "The business", import_jobs: "Import log",
  backups: "Backup runs", label_batches: "Printed label batches", promotions: "Promotions (sales refer to them)", scheduled_prices: "Scheduled prices",
  loyalty_ledger: "Loyalty points (a liability)", customers: "Customers (deleted on request: details removed, record kept)",
  events: "Audit log (never deleted)",
};

function years(app) {
  const y = Number(require(`${__hooks}/lib/auth.js`).setting(app, "retention.years", MIN_YEARS));
  return Math.max(MIN_YEARS, isFinite(y) ? Math.floor(y) : MIN_YEARS);
}

// Throws when the record is still inside its window.
function guardDelete(app, record) {
  const name = record.collection().name;
  if (!RETAINED[name]) return;
  if (name === "events") throw new BadRequestError("The audit log is never deleted.");
  const y = years(app);
  const created = new Date(String(record.getString("created_at") || record.getString("created") || record.getString("at") || "").replace(" ", "T"));
  const until = isNaN(created.getTime()) ? null : new Date(created.getTime());
  if (until) until.setFullYear(until.getFullYear() + y);
  if (!until || until.getTime() > Date.now()) {
    throw new BadRequestError(RETAINED[name] + " are kept for " + y + " years (CRA). This record can be deleted after "
      + (until ? until.toISOString().substring(0, 10) : "its window") + ". Mark it deleted or archived instead.");
  }
}

function rules(app) {
  const y = years(app);
  return { years: y, minimum: MIN_YEARS, tables: Object.keys(RETAINED).map((k) => ({ table: k, label: RETAINED[k], years: k === "events" ? null : y,
    rows: (() => { try { return app.countRecords(k); } catch (_) { return 0; } })() })) };
}

module.exports = { guardDelete, rules, years, RETAINED, MIN_YEARS };

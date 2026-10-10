// Card fees, platform payouts, vendor statements (P4 step 7; FR-10.05, 8.10, 10.04). finance.manage.
// Card fees: card payments by card type (chosen at the till; "not given" uses the "other" rate) with the
// estimated fee from the processor's rates (setting cards.fees: % + fixed per payment), and the actual fee
// where the bank's card deposits were matched (step 6: the day's card sales less the deposit). The P&L
// (step 9) uses the actual fee where known, else the estimate.
// Platform payouts (FR-8.10): a delivery platform's payout statement (period, gross, commission, fees,
// adjustments, payout, optionally its order list) checked against the orders Chedam recorded as picked up:
// totals and orders missing on either side; commission %. Expected until the bank line is matched.
// Vendor statements (FR-10.04): the vendor's statement (date, closing balance, its invoices and credits by
// their number) against the bills in Chedam: agreed, different amounts, missing in Chedam (record them),
// open in Chedam but not on the statement, and the balance difference.

const T = () => require(`${__hooks}/lib/timeclock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) { r.set("created_by", c.actor); if (c.device) r.set("device_id", c.device); } }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const who = (c) => (c.user ? c.user.getString("name") : c.actor);
const int = (v) => { const n = Math.round(Number(v)); return isFinite(n) ? n : 0; };
const norm = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");
const TYPES = ["visa", "mastercard", "amex", "interac", "discover", "other"];

// ---- Card fees ------------------------------------------------------------------------------------------------
function cardFees(app, q) {
  const R = require(`${__hooks}/lib/reports.js`);
  const today = T().localDay(Date.now());
  const from = ymdOk(q.from) ? q.from : today.substring(0, 8) + "01", to = ymdOk(q.to) ? q.to : today;
  const rates = setting(app, "cards.fees", {}) || {};
  const rate = (t) => rates[t] || rates.other || { pct: 0, fixed_cents: 0 };
  const by = {};
  TYPES.concat([""]).forEach((t) => { by[t] = { card_type: t || "not_given", payments: 0, amount_cents: 0, est_fee_cents: 0 }; });
  const perDay = {};
  app.findRecordsByFilter("payments", "method = 'card' && status = 'approved' && sale.status = 'completed' && sale.training = false && sale.completed_at >= {:f} && sale.completed_at < {:t}", "", 0, 0, { f: R.dayStart(from), t: R.dayStart(to, 1) })
    .forEach((p) => {
      const t = TYPES.indexOf(p.getString("card_type")) >= 0 ? p.getString("card_type") : "";
      const r = rate(t || "other"), amt = p.getInt("amount_cents");
      const fee = Math.round((amt * (Number(r.pct) || 0)) / 100) + (Number(r.fixed_cents) || 0);
      by[t].payments++; by[t].amount_cents += amt; by[t].est_fee_cents += fee;
      let day = "";
      try { day = T().localDay(T().ms(app.findRecordById("sales", p.getString("sale")).getString("completed_at"))); } catch (_) { day = ""; }
      const d = perDay[day] || (perDay[day] = { day: day, amount_cents: 0, est_fee_cents: 0, actual_fee_cents: null });
      d.amount_cents += amt; d.est_fee_cents += fee;
    });
  app.findRecordsByFilter("bank_lines", "status = 'matched' && match_kind = 'card_batch' && deleted_at = ''", "", 0, 0).forEach((l) => {
    const refs = j(l, "match_refs", []);
    const inRange = refs.filter((x) => x.id >= from && x.id <= to);
    if (!inRange.length) return;
    const share = Math.round(l.getInt("fee_cents") / refs.length);
    inRange.forEach((x) => { const d = perDay[x.id] || (perDay[x.id] = { day: x.id, amount_cents: 0, est_fee_cents: 0, actual_fee_cents: null }); d.actual_fee_cents = (d.actual_fee_cents || 0) + share; });
  });
  const days = Object.keys(perDay).sort().map((k) => perDay[k]);
  const known = days.filter((d) => d.actual_fee_cents !== null);
  const types = Object.keys(by).map((k) => by[k]).filter((x) => x.payments).map((x) => Object.assign(x, { est_rate_pct: x.amount_cents ? Math.round((x.est_fee_cents * 10000) / x.amount_cents) / 100 : 0 }));
  const tot = { payments: types.reduce((a, x) => a + x.payments, 0), amount_cents: types.reduce((a, x) => a + x.amount_cents, 0), est_fee_cents: types.reduce((a, x) => a + x.est_fee_cents, 0),
    actual_fee_cents: known.reduce((a, d) => a + d.actual_fee_cents, 0), actual_days: known.length, actual_amount_cents: known.reduce((a, d) => a + d.amount_cents, 0) };
  tot.actual_rate_pct = tot.actual_amount_cents ? Math.round((tot.actual_fee_cents * 10000) / tot.actual_amount_cents) / 100 : null;
  // The fee for the period: actual where the bank showed it, else the estimate
  tot.fee_cents = days.reduce((a, d) => a + (d.actual_fee_cents !== null ? d.actual_fee_cents : d.est_fee_cents), 0);
  return { from: from, to: to, types: types, days: days, total: tot, rates: rates };
}

// ---- Platform payouts -------------------------------------------------------------------------------------------
function chedamOrders(app, platform, from, to) {
  const R = require(`${__hooks}/lib/reports.js`);
  return app.findRecordsByFilter("delivery_orders", "platform = {:p} && status = 'picked_up' && picked_up_at >= {:f} && picked_up_at < {:t} && deleted_at = ''", "picked_up_at", 0, 0, { p: platform, f: R.dayStart(from), t: R.dayStart(to, 1) })
    .map((o) => ({ number: o.getString("number"), total_cents: o.getInt("total_cents"), day: T().localDay(T().ms(o.getString("picked_up_at"))) }));
}
function payoutView(r) {
  return { id: r.id, platform: r.getString("platform"), period_from: r.getString("period_from"), period_to: r.getString("period_to"), day: r.getString("day"), gross_cents: r.getInt("gross_cents"),
    commission_cents: r.getInt("commission_cents"), fees_cents: r.getInt("fees_cents"), adjustments_cents: r.getInt("adjustments_cents"), payout_cents: r.getInt("payout_cents"),
    commission_pct: r.getInt("gross_cents") ? Math.round((r.getInt("commission_cents") * 10000) / r.getInt("gross_cents")) / 100 : 0, check: j(r, "check", {}), status: r.getString("status"),
    bank_line: r.getString("bank_line"), note: r.getString("note"), orders: j(r, "orders", []).length };
}
// {platform, period_from, period_to, day, gross_cents, commission_cents, fees_cents, adjustments_cents, payout_cents, orders: [{number, amount_cents}], note}
function savePayout(app, c, b) {
  const platform = String(b.platform || "").trim();
  if (!platform) bad("Which platform?");
  if (!ymdOk(b.period_from) || !ymdOk(b.period_to) || b.period_to < b.period_from) bad("The statement's period: from and to.");
  const g = int(b.gross_cents), cm = int(b.commission_cents), fe = int(b.fees_cents), ad = int(b.adjustments_cents), po = int(b.payout_cents);
  if (g < 0 || cm < 0 || fe < 0) bad("Amounts are 0 or more (adjustments can be negative).");
  if (g - cm - fe + ad !== po) bad("The payout should be gross − commission − fees + adjustments = " + ((g - cm - fe + ad) / 100).toFixed(2) + ".");
  const orders = (Array.isArray(b.orders) ? b.orders : []).map((o) => ({ number: String(o.number || "").trim(), amount_cents: int(o.amount_cents) })).filter((o) => o.number);
  const mine = chedamOrders(app, platform, b.period_from, b.period_to);
  const chedamTotal = mine.reduce((a, o) => a + o.total_cents, 0);
  const chk = { chedam_orders: mine.length, chedam_total_cents: chedamTotal, gross_difference_cents: g - chedamTotal, missing_on_statement: [], not_in_chedam: [], amount_differences: [] };
  if (orders.length) {
    const sm = {};
    orders.forEach((o) => { sm[norm(o.number)] = o; });
    const cm2 = {};
    mine.forEach((o) => { cm2[norm(o.number)] = o; if (!sm[norm(o.number)]) chk.missing_on_statement.push(o); else if (sm[norm(o.number)].amount_cents !== o.total_cents) chk.amount_differences.push({ number: o.number, chedam_cents: o.total_cents, statement_cents: sm[norm(o.number)].amount_cents }); });
    orders.forEach((o) => { if (!cm2[norm(o.number)]) chk.not_in_chedam.push(o); });
  }
  const r = new Record(app.findCollectionByNameOrId("platform_payouts"));
  r.load({ platform: platform, period_from: b.period_from, period_to: b.period_to, day: ymdOk(b.day) ? b.day : b.period_to, gross_cents: g, commission_cents: cm, fees_cents: fe, adjustments_cents: ad,
    payout_cents: po, orders: orders, check: chk, status: "expected", note: String(b.note || "").substring(0, 300) });
  stamp(r, c); app.save(r);
  return payoutView(r);
}
function cancelPayout(app, c, id) {
  const r = app.findRecordById("platform_payouts", id);
  if (r.getString("status") !== "expected") bad("Only one not yet matched to the bank.");
  r.set("status", "cancelled"); stamp(r, c); app.save(r);
  return payoutView(r);
}
function payouts(app, q) {
  const items = app.findRecordsByFilter("platform_payouts", "status != 'cancelled' && deleted_at = ''", "-period_from", 200, 0).map(payoutView).filter((x) => !q.platform || x.platform === q.platform);
  const by = {};
  items.forEach((x) => {
    const p = by[x.platform] || (by[x.platform] = { platform: x.platform, statements: 0, gross_cents: 0, commission_cents: 0, fees_cents: 0, adjustments_cents: 0, payout_cents: 0 });
    p.statements++; ["gross_cents", "commission_cents", "fees_cents", "adjustments_cents", "payout_cents"].forEach((k) => { p[k] += x[k]; });
  });
  return { items: items, platforms: Object.keys(by).map((k) => Object.assign(by[k], { commission_pct: by[k].gross_cents ? Math.round((by[k].commission_cents * 10000) / by[k].gross_cents) / 100 : 0 })),
    names: setting(app, "delivery.platforms", []) || [] };
}

// ---- Vendor statements ------------------------------------------------------------------------------------------
function asOf(app, b, date) {
  const paid = app.findRecordsByFilter("bill_payments", "bill = {:b} && voided = false && day <= {:d} && deleted_at = ''", "", 0, 0, { b: b.id, d: date }).reduce((a, p) => a + p.getInt("amount_cents"), 0);
  return b.getInt("total_cents") - paid;
}
// {party, statement_date, closing_balance_cents, lines: [{ref, day, amount_cents, kind: invoice|credit|payment}], note}
function vendorStatement(app, c, b) {
  const party = app.findRecordById("parties", String(b.party || ""));
  if (!ymdOk(b.statement_date)) bad("The statement's date.");
  const lines = (Array.isArray(b.lines) ? b.lines : []).map((x) => ({ ref: String(x.ref || "").trim(), day: ymdOk(x.day) ? x.day : "", amount_cents: Math.abs(int(x.amount_cents)), kind: ["invoice", "credit", "payment"].indexOf(x.kind) >= 0 ? x.kind : "invoice" }));
  const docs = app.findRecordsByFilter("bills", "party = {:p} && (kind = 'bill' || kind = 'vendor_credit') && status != 'void' && doc_date <= {:d} && deleted_at = ''", "doc_date", 0, 0, { p: party.id, d: b.statement_date });
  let chedam = 0;
  const byRef = {};
  const info = docs.map((d) => {
    const bal = asOf(app, d, b.statement_date), sign = d.getString("kind") === "vendor_credit" ? -1 : 1;
    chedam += sign * bal;
    const o = { id: d.id, number: d.getString("number"), party_ref: d.getString("party_ref"), kind: d.getString("kind"), doc_date: d.getString("doc_date"), total_cents: d.getInt("total_cents"), balance_cents: sign * bal, seen: false };
    [norm(o.party_ref), norm(o.number)].filter(Boolean).forEach((k) => { byRef[k] = o; });
    return o;
  });
  const chk = { agreed: [], amount_differences: [], missing_in_chedam: [], not_on_statement: [] };
  lines.filter((x) => x.kind !== "payment").forEach((x) => {
    const d = byRef[norm(x.ref)];
    if (!d) { chk.missing_in_chedam.push(x); return; }
    d.seen = true;
    if (d.total_cents === x.amount_cents) chk.agreed.push({ ref: x.ref, number: d.number, amount_cents: x.amount_cents });
    else chk.amount_differences.push({ ref: x.ref, number: d.number, chedam_cents: d.total_cents, statement_cents: x.amount_cents });
  });
  info.filter((d) => !d.seen && d.balance_cents !== 0).forEach((d) => chk.not_on_statement.push({ number: d.number, party_ref: d.party_ref, doc_date: d.doc_date, balance_cents: d.balance_cents }));
  const close = int(b.closing_balance_cents);
  const diff = close - chedam;
  const r = new Record(app.findCollectionByNameOrId("vendor_statements"));
  r.load({ party: party.id, statement_date: b.statement_date, closing_balance_cents: close, lines: lines, check: Object.assign(chk, { chedam_balance_cents: chedam }), difference_cents: diff,
    status: diff === 0 && !chk.amount_differences.length && !chk.missing_in_chedam.length ? "agreed" : "differences", note: String(b.note || "").substring(0, 300), by_name: who(c) });
  stamp(r, c); app.save(r);
  return statementView(app, r);
}
function statementView(app, r) {
  let name = "";
  try { name = app.findRecordById("parties", r.getString("party")).getString("name"); } catch (_) { name = ""; }
  return { id: r.id, party: r.getString("party"), party_name: name, statement_date: r.getString("statement_date"), closing_balance_cents: r.getInt("closing_balance_cents"), check: j(r, "check", {}),
    difference_cents: r.getInt("difference_cents"), status: r.getString("status"), note: r.getString("note"), by_name: r.getString("by_name"), lines: j(r, "lines", []).length };
}
function statements(app, q) {
  let f = "deleted_at = ''";
  if (q.party) f += " && party = {:p}";
  return { items: app.findRecordsByFilter("vendor_statements", f, "-statement_date,-created_at", 100, 0, { p: q.party || "" }).map((r) => statementView(app, r)) };
}

module.exports = { cardFees, savePayout, cancelPayout, payouts, vendorStatement, statements, chedamOrders };

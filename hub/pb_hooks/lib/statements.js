// Financial statements and tax returns (P4 step 9; FR-10.07, 10.08, 4.15). books.manage (the accountant; the
// owner). All from the books (lib/books.js), so they agree with the trial balance:
//   Profit and loss for a period (and the period before, same length): revenue, cost of sales, gross profit,
//     expenses by account, operating income, other income, net income; card fees not yet seen in the bank are
//     shown as an estimate beside it (step 7).
//   Balance sheet on a day: assets, liabilities, equity and the earnings to date; assets = liabilities + equity.
//   Cash flow for a period: opening cash (tills, safe, petty cash, bank accounts, deposits in transit, payments
//     not yet on a statement), money in and out by what it was for (operating; financing: loans, owner), closing.
//   GST/HST return (regular method): line 101 sales and other revenue, 103 GST/HST collected, 106 input tax
//     credits, 108, 109 net tax, 110 instalments paid, 113A balance; a negative balance is a refund.
//   BC PST return: sales subject to PST, PST collected, the collector's commission (setting tax.pst_return),
//     PST due on purchases (entered), the net to remit.
// A filed return is kept with its figures, the filing day and the confirmation number.

const BK = () => require(`${__hooks}/lib/books.js`);
const T = () => require(`${__hooks}/lib/timeclock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) { r.set("created_by", c.actor); if (c.device) r.set("device_id", c.device); } }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const who = (c) => (c.user ? c.user.getString("name") : c.actor);
const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
function range(q) {
  const today = T().localDay(Date.now());
  const to = ymdOk(q.to) ? q.to : today, from = ymdOk(q.from) ? q.from : to.substring(0, 8) + "01";
  if (from > to) bad("From must be before to.");
  return { from: from, to: to };
}
const CASH = (k) => ["cash", "petty_cash", "deposits_in_transit", "bank_clearing"].indexOf(k) >= 0 || k.indexOf("bank:") === 0;

function pnlOf(app, from, to) {
  const act = BK().activity(app, from, to), nm = BK().names(app);
  const line = (k) => { const a = act[k] || { dr: 0, cr: 0 }; const t = (nm[k] || {}).type || (k.indexOf("exp:") === 0 ? "expense" : ""); return { key: k, code: (nm[k] || {}).code || "", name: (nm[k] || {}).name || k, type: t, cents: t === "income" ? a.cr - a.dr : a.dr - a.cr }; };
  const keys = Object.keys(act);
  const pick = (types, filt) => keys.map(line).filter((l) => types.indexOf(l.type) >= 0 && l.cents && (!filt || filt(l))).sort((a, b) => (a.code < b.code ? -1 : 1));
  const revenue = pick(["income"], (l) => l.key !== "interest_income"), cost = pick(["cogs"]), expenses = pick(["expense"]), other = pick(["income"], (l) => l.key === "interest_income");
  const sum = (ls) => ls.reduce((a, l) => a + l.cents, 0);
  const o = { from: from, to: to, revenue: revenue, revenue_cents: sum(revenue), cost: cost, cost_cents: sum(cost), expenses: expenses, expenses_cents: sum(expenses), other: other, other_cents: sum(other) };
  o.gross_profit_cents = o.revenue_cents - o.cost_cents;
  o.gross_margin_pct = o.revenue_cents ? Math.round((o.gross_profit_cents * 1000) / o.revenue_cents) / 10 : null;
  o.operating_cents = o.gross_profit_cents - o.expenses_cents;
  o.net_income_cents = o.operating_cents + o.other_cents;
  // Card fees not yet in the bank (estimated from the rates, step 7)
  let est = 0;
  try { const f = require(`${__hooks}/lib/recon.js`).cardFees(app, { from: from, to: to }); const booked = act.card_fees ? act.card_fees.dr - act.card_fees.cr : 0; est = Math.max(0, f.total.fee_cents - booked); } catch (_) { est = 0; }
  o.card_fees_estimate_cents = est;
  o.net_income_with_estimates_cents = o.net_income_cents - est;
  return o;
}
function pnl(app, q) {
  const r = range(q);
  const o = pnlOf(app, r.from, r.to);
  if (q.compare) {
    const n = days(r.from, r.to);
    const pto = T().addDays(r.from, -1), pfrom = T().addDays(pto, -n);
    o.previous = pnlOf(app, pfrom, pto);
  }
  return o;
}

function balanceSheet(app, q) {
  const to = ymdOk(q.to) ? q.to : T().localDay(Date.now());
  const bal = BK().balances(app, to), nm = BK().names(app);
  const rows = Object.keys(bal).map((k) => {
    const a = nm[k] || { code: "", name: k, type: k.indexOf("bank:") === 0 ? "asset" : k.indexOf("exp:") === 0 ? "expense" : "" };
    const b = bal[k].dr - bal[k].cr;
    return { key: k, code: a.code, name: a.name, type: a.type, cents: a.type === "asset" ? b : -b };
  }).filter((r) => r.cents);
  const of = (t) => rows.filter((r) => r.type === t).sort((a, b) => (a.code < b.code ? -1 : 1));
  const sum = (ls) => ls.reduce((a, l) => a + l.cents, 0);
  const assets = of("asset"), liabilities = of("liability"), equity = of("equity");
  // Earnings to date: income less cost of sales and expenses, all time to the day (P&L accounts' balances)
  const earnings = rows.filter((r) => r.type === "income").reduce((a, r) => a + r.cents, 0) + rows.filter((r) => r.type === "cogs" || r.type === "expense").reduce((a, r) => a + r.cents, 0);
  const o = { to: to, assets: assets, assets_cents: sum(assets), liabilities: liabilities, liabilities_cents: sum(liabilities), equity: equity, equity_cents: sum(equity), earnings_cents: earnings };
  o.balanced = o.assets_cents === o.liabilities_cents + o.equity_cents + o.earnings_cents;
  return o;
}

const SRC = { sale: "From customers (sales)", "return": "Refunds to customers", order_deposit: "Customer order deposits", expense: "Expenses", expense_back: "Expenses paid back", payroll_paid: "Wages paid",
  payout: "Till pay-outs", till: "Till over/short", petty_cash: "Petty cash", deposit: "Cash deposits", opening: "Opening balances" };
function cashFlow(app, q) {
  const r = range(q);
  const sumCash = (bal) => Object.keys(bal).filter(CASH).reduce((a, k) => a + bal[k].dr - bal[k].cr, 0);
  const opening = sumCash(BK().balances(app, T().addDays(r.from, -1))), closing = sumCash(BK().balances(app, r.to));
  const groups = {};
  const nm = BK().names(app);
  BK().journal(app, r.from, r.to).forEach((e) => {
    const delta = e.lines.filter((l) => CASH(l[0])).reduce((a, l) => a + l[1], 0);
    if (!delta) return;
    const others = e.lines.filter((l) => !CASH(l[0])).map((l) => l[0]);
    const fin = others.some((k) => ["loans", "owner_equity", "owner_draws"].indexOf(k) >= 0);
    let label = SRC[e.source] || "";
    if (e.source === "bill_payment") label = others.indexOf("ap") >= 0 ? "To vendors (bills)" : "From clients (invoices)";
    if (e.source === "bank") {
      const o = others[0] || "";
      label = o === "card_clearing" || o === "card_fees" ? "Card sales deposited (less fees)" : o === "platform_clearing" || o === "platform_commission" ? "Delivery platform payouts" : o === "bank_suspense" ? "Bank lines not matched yet" : (nm[o] ? nm[o].name : o);
    }
    if (e.source === "opening") label = "Opening balances";
    const k = (fin ? "financing" : "operating") + "|" + (label || e.source);
    groups[k] = (groups[k] || 0) + delta;
  });
  const list = (sec) => Object.keys(groups).filter((k) => k.indexOf(sec + "|") === 0).map((k) => ({ label: k.split("|")[1], cents: groups[k] })).sort((a, b) => b.cents - a.cents);
  const op = list("operating"), fi = list("financing");
  const tot = (ls) => ls.reduce((a, x) => a + x.cents, 0);
  return { from: r.from, to: r.to, opening_cents: opening, operating: op, operating_cents: tot(op), financing: fi, financing_cents: tot(fi), closing_cents: closing,
    balanced: opening + tot(op) + tot(fi) === closing };
}

// ---- Tax returns --------------------------------------------------------------------------------------------------
function gst(app, q) {
  const r = range(q);
  const act = BK().activity(app, r.from, r.to);
  const cr = (k) => (act[k] ? act[k].cr - act[k].dr : 0), dr = (k) => (act[k] ? act[k].dr - act[k].cr : 0);
  const inst = Math.max(0, Math.round(Number(q.instalments_cents) || 0));
  const l101 = cr("sales") + cr("restocking_fees") + cr("interest_income"), l103 = cr("gst_payable"), l106 = dr("gst_receivable");
  const l109 = l103 - l106;
  return { kind: "gst", from: r.from, to: r.to, method: ((setting(app, "tax.gst_return", {}) || {}).method) || "regular",
    line101_cents: l101, line103_cents: l103, line104_cents: 0, line105_cents: l103, line106_cents: l106, line107_cents: 0, line108_cents: l106, line109_cents: l109, line110_cents: inst, line111_cents: 0,
    line112_cents: inst, line113a_cents: l109 - inst, refund: l109 - inst < 0 };
}
function pst(app, q) {
  const r = range(q);
  const R = require(`${__hooks}/lib/reports.js`);
  const act = BK().activity(app, r.from, r.to);
  const collected = act.pst_payable ? act.pst_payable.cr - act.pst_payable.dr : 0;
  let base = 0;
  app.findRecordsByFilter("sales", "status = 'completed' && training = false && completed_at >= {:f} && completed_at < {:t}", "", 0, 0, { f: R.dayStart(r.from), t: R.dayStart(r.to, 1) })
    .forEach((s) => j(s, "taxes", []).forEach((x) => { if (String(x.code || "").toUpperCase().indexOf("PST") >= 0) base += Math.round(Number(x.base_cents) || 0); }));
  app.findRecordsByFilter("returns", "created_at >= {:f} && created_at < {:t}", "", 0, 0, { f: R.dayStart(r.from), t: R.dayStart(r.to, 1) })
    .forEach((s) => j(s, "taxes", []).forEach((x) => { if (String(x.code || "").toUpperCase().indexOf("PST") >= 0) base -= Math.round(Number(x.base_cents) || (Number(x.rate) ? (Number(x.tax_cents) || 0) / (Number(x.rate) > 1 ? Number(x.rate) / 100 : Number(x.rate)) : 0)); }));
  const set = setting(app, "tax.pst_return", {}) || {};
  const commission = Math.min(Math.max(0, Math.round((collected * (Number(set.commission_pct) || 0)) / 100)), Number(set.commission_max_cents) || 0);
  const self = Math.max(0, Math.round(Number(q.self_assessed_cents) || 0));
  return { kind: "pst", from: r.from, to: r.to, sales_subject_cents: base, collected_cents: collected, commission_cents: commission, purchases_pst_cents: self, net_cents: collected - commission + self, commission_pct: set.commission_pct || 0 };
}
function returnView(r) {
  return { id: r.id, kind: r.getString("kind"), period_from: r.getString("period_from"), period_to: r.getString("period_to"), figures: j(r, "figures", {}), net_cents: r.getInt("net_cents"), filed_on: r.getString("filed_on"),
    confirmation: r.getString("confirmation"), paid_on: r.getString("paid_on"), note: r.getString("note"), by_name: r.getString("by_name") };
}
// {kind, from, to, instalments_cents | self_assessed_cents, filed_on, confirmation, paid_on, note}
function file(app, c, b) {
  if (["gst", "pst"].indexOf(b.kind) < 0) bad("GST/HST or PST?");
  const fig = b.kind === "gst" ? gst(app, b) : pst(app, b);
  if (fig.to >= T().localDay(Date.now())) bad("The return's period has not ended.");
  if (!ymdOk(b.filed_on)) bad("The day it was filed.");
  if (app.findRecordsByFilter("tax_returns", "kind = {:k} && period_from = {:f} && deleted_at = ''", "", 1, 0, { k: b.kind, f: fig.from }).length) bad("That return is already recorded.");
  const r = new Record(app.findCollectionByNameOrId("tax_returns"));
  r.load({ kind: b.kind, period_from: fig.from, period_to: fig.to, figures: fig, net_cents: b.kind === "gst" ? fig.line113a_cents : fig.net_cents, filed_on: b.filed_on,
    confirmation: String(b.confirmation || "").substring(0, 60), paid_on: ymdOk(b.paid_on) ? b.paid_on : "", note: String(b.note || "").substring(0, 300), by_name: who(c) });
  stamp(r, c); app.save(r);
  return returnView(r);
}
function returns(app) { return { items: app.findRecordsByFilter("tax_returns", "deleted_at = ''", "-period_from", 100, 0).map(returnView), settings: { gst: setting(app, "tax.gst_return", {}), pst: setting(app, "tax.pst_return", {}) } }; }

module.exports = { pnl, balanceSheet, cashFlow, gst, pst, file, returns };

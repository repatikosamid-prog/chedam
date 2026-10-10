// The books (P4 step 8; FR-10.06, P4-d, BR-34). books.manage (the accountant; the owner).
// The journal is DERIVED from Chedam's records by fixed rules (each entry balanced; debits +, credits −):
//   Sale: payments by method (cash, card, platform, store credit, deposit, house account, exchange) against
//     sales (the rest), taxes by code (GST/HST, PST, other), deposits and eco fees, cash rounding.
//   Return: the reverse, refunds by method, a restocking fee kept.
//   Stock (stock_movements at cost): received → inventory / goods received not billed; sold → cost of goods
//     sold / inventory; returned → back; damage, loss, counts, adjustments → stock losses. Consignment goods
//     sold → cost of goods sold / goods received not billed (the vendor's bill clears it).
//   Bills: goods received not billed (+ PST) and GST/HST paid / accounts payable; vendor credits reversed;
//     invoices: receivable / sales and taxes; payments by method (cash, bank, card; credits applied are internal).
//   Expenses (approved, on their day): the category + GST/HST paid / who paid (employee, petty cash, store card,
//     till); paid back later from the till, petty cash or the bank (with the next pay: in payroll).
//   Payroll (finalised, on the pay date): wages, employer CPP and EI / deductions to remit, net wages payable;
//     expenses paid back with the pay; paid → wages payable / bank or cash.
//   Cash: customer order deposits and refunds, till pay-outs (other than expenses), till over/short at close,
//     petty cash top-ups and counts, cash deposits to the bank (in transit until on the statement).
//   Bank lines: the opening balance (owner's equity); matched to a Chedam payment → moves it from "bank payments
//     not yet on a statement" to the bank account; card batches → card sales / bank + card fees; platform
//     payouts → platform sales / bank + commission; deposits; categories (fees, interest, owner, transfers,
//     loans, rent, utilities, insurance, CRA); not matched yet → "bank lines to match".
// Months are closed in order after they end: a snapshot of each account's activity is kept and changes dated
// in a closed month are refused (lib/books.js LOCK, hooked in books.pb.js); the owner reopens with a reason.

const T = () => require(`${__hooks}/lib/timeclock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) { r.set("created_by", c.actor); if (c.device) r.set("device_id", c.device); } }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const who = (c) => (c.user ? c.user.getString("name") : c.actor);
const dayOf = (s) => (s ? T().localDay(T().ms(s)) : "");
const PAY = { cash: "cash", usd_cash: "cash", card: "card_clearing", platform: "platform_clearing", store_credit: "store_credit_liab", deposit: "customer_deposits", house_account: "ar", exchange: "exchange_clearing" };
const REFUND = { cash: "cash", card: "card_clearing", store_credit: "store_credit_liab", exchange: "exchange_clearing" };
const BILLPAY = { cash: "cash", till_cash: "cash", cheque: "bank_clearing", e_transfer: "bank_clearing", bank_transfer: "bank_clearing", card: "credit_card" };
const PAIDWITH = { own_money: "employee_payable", petty_cash: "petty_cash", company_card: "credit_card", till_cash: "cash" };
const BACK = { till_cash: "cash", petty_cash: "petty_cash", cheque: "bank_clearing", e_transfer: "bank_clearing" };
const CATEGORY = { "Bank fees": "bank_fees", "Interest": "interest_income", "Owner draw": "owner_draws", "Owner deposit": "owner_equity", "Transfer between accounts": "transfers",
  "Loan payment": "loans", "Loan received": "loans", "Rent": "exp:Rent", "Utilities": "exp:Utilities", "Insurance": "exp:Insurance", "Taxes paid (CRA)": "cra_payments", "Other": "exp:Uncategorized" };
function taxKey(code, collected) {
  const c = String(code || "").toUpperCase();
  if (c.indexOf("GST") >= 0 || c.indexOf("HST") >= 0) return collected ? "gst_payable" : "gst_receivable";
  if (c.indexOf("PST") >= 0) return collected ? "pst_payable" : "grni";            // PST paid on purchases is part of the cost
  return collected ? "other_tax_payable" : "grni";
}

// All entries dated from..to (store days). Each: {day, source, ref, memo, lines: [[key, cents]]} with Σ = 0.
function journal(app, from, to) {
  const R = require(`${__hooks}/lib/reports.js`);
  const f = R.dayStart(from), t = R.dayStart(to, 1);
  const out = [];
  const add = (day, source, ref, memo, lines) => {
    const ls = lines.filter((x) => x[1]);
    if (!ls.length) return;
    const sum = ls.reduce((a, x) => a + x[1], 0);
    if (sum !== 0) ls.push(["rounding", -sum]);                                   // never expected; kept visible
    out.push({ day: day, source: source, ref: ref, memo: memo, lines: ls, plug: sum });
  };
  const inDays = (d) => d >= from && d <= to;

  // Sales
  const sales = app.findRecordsByFilter("sales", "status = 'completed' && training = false && completed_at >= {:f} && completed_at < {:t}", "completed_at", 0, 0, { f: f, t: t });
  const pays = {};
  if (sales.length) app.findRecordsByFilter("payments", "status = 'approved' && sale.status = 'completed' && sale.training = false && sale.completed_at >= {:f} && sale.completed_at < {:t}", "", 0, 0, { f: f, t: t })
    .forEach((p) => { (pays[p.getString("sale")] = pays[p.getString("sale")] || []).push(p); });
  sales.forEach((s) => {
    const L = [];
    let paid = 0;
    (pays[s.id] || []).forEach((p) => { paid += p.getInt("amount_cents"); L.push([PAY[p.getString("method")] || "cash", p.getInt("amount_cents")]); });
    let taxes = 0;
    j(s, "taxes", []).forEach((x) => { const v = Math.round(Number(x.tax_cents) || 0); taxes += v; L.push([taxKey(x.code, true), -v]); });
    const dep = s.getInt("deposit_cents"), rnd = s.getInt("rounding_cents");
    L.push(["deposits_fees", -dep]); L.push(["rounding", -rnd]);
    L.push(["sales", -(paid - taxes - dep - rnd)]);
    add(dayOf(s.getString("completed_at")), "sale", s.id, "Sale " + s.getString("number"), L);
  });
  // Returns and refunds
  const rets = app.findRecordsByFilter("returns", "created_at >= {:f} && created_at < {:t}", "created_at", 0, 0, { f: f, t: t });
  const refs = {};
  if (rets.length) app.findRecordsByFilter("refunds", "return.created_at >= {:f} && return.created_at < {:t}", "", 0, 0, { f: f, t: t }).forEach((x) => { (refs[x.getString("return")] = refs[x.getString("return")] || []).push(x); });
  rets.forEach((r) => {
    const L = [];
    let taxes = 0;
    j(r, "taxes", []).forEach((x) => { const v = Math.round(Number(x.tax_cents) || 0); taxes += v; L.push([taxKey(x.code, true), v]); });
    const goods = r.getString("tax_mode") === "tax_included" ? r.getInt("net_cents") - taxes : r.getInt("net_cents");
    L.push(["sales", goods]); L.push(["deposits_fees", r.getInt("deposit_cents")]); L.push(["restocking_fees", -r.getInt("fee_cents")]);
    let back = 0;
    (refs[r.id] || []).forEach((x) => { back += x.getInt("amount_cents"); L.push([REFUND[x.getString("method")] || "cash", -x.getInt("amount_cents")]); });
    const rest = goods + taxes + r.getInt("deposit_cents") - r.getInt("fee_cents") - back;
    L.push(["rounding", -rest]);
    add(dayOf(r.getString("created_at")), "return", r.id, "Return " + r.getString("number"), L);
  });
  // Stock at cost
  app.findRecordsByFilter("stock_movements", "status = 'posted' && created_at >= {:f} && created_at < {:t} && value_cents != 0", "created_at", 0, 0, { f: f, t: t }).forEach((m) => {
    const v = m.getInt("value_cents"), ty = m.getString("type");
    const other = ty === "receive" ? "grni" : ty === "sale" || ty === "return" ? "cogs" : ty === "pack_break" || ty === "pack_make" || ty === "transfer" ? "inventory" : "shrink";
    if (other === "inventory") return;
    add(dayOf(m.getString("created_at")), "stock", m.id, ty + (m.getString("reason") ? " (" + m.getString("reason") + ")" : ""), [["inventory", v], [other, -v]]);
  });
  app.findRecordsByFilter("consignment_sales", "created_at >= {:f} && created_at < {:t}", "", 0, 0, { f: f, t: t }).forEach((x) => {
    add(dayOf(x.getString("created_at")), "consignment", x.id, "Consignment goods sold", [["cogs", x.getInt("amount_cents")], ["grni", -x.getInt("amount_cents")]]);
  });
  // Bills, credits, invoices and their payments
  app.findRecordsByFilter("bills", "status != 'void' && doc_date >= {:f} && doc_date <= {:t} && deleted_at = ''", "doc_date", 0, 0, { f: from, t: to }).forEach((b) => {
    const k = b.getString("kind"), fx = b.getFloat("fx_rate") || 1, total = b.getInt("total_cad_cents");
    const L = [];
    let taxes = 0;
    const collected = k === "invoice" || k === "client_credit";
    j(b, "taxes", []).forEach((x) => { const v = Math.round((Number(x.cents) || Number(x.tax_cents) || 0) * fx); taxes += v; L.push([taxKey(x.code, collected), collected ? -v : v]); });
    if (k === "bill") { L.push(["grni", total - taxes]); L.push(["ap", -total]); }
    else if (k === "vendor_credit") { L.forEach((x) => { x[1] = -x[1]; }); L.push(["grni", -(total - taxes)]); L.push(["ap", total]); }
    else if (k === "invoice") { L.push(["sales", -(total - taxes)]); L.push(["ar", total]); }
    else { L.forEach((x) => { x[1] = -x[1]; }); L.push(["sales", total - taxes]); L.push(["ar", -total]); }
    add(b.getString("doc_date"), "bill", b.id, { bill: "Bill", vendor_credit: "Vendor credit", invoice: "Invoice", client_credit: "Client credit" }[k] + " " + b.getString("number"), L);
  });
  app.findRecordsByFilter("bill_payments", "voided = false && method != 'credit' && day >= {:f} && day <= {:t} && deleted_at = ''", "day", 0, 0, { f: from, t: to }).forEach((p) => {
    let b = null;
    try { b = app.findRecordById("bills", p.getString("bill")); } catch (_) { return; }
    const k = b.getString("kind"), v = p.getInt("cad_cents"), m = BILLPAY[p.getString("method")] || "bank_clearing";
    const L = k === "bill" ? [["ap", v], [m, -v]] : k === "vendor_credit" ? [[m, v], ["ap", -v]] : k === "invoice" ? [[m, v], ["ar", -v]] : [["ar", v], [m, -v]];
    add(p.getString("day"), "bill_payment", p.id, "Payment " + b.getString("number"), L);
  });
  // Expenses
  app.findRecordsByFilter("expenses", "(status = 'approved' || status = 'reimbursed') && day >= {:f} && day <= {:t} && deleted_at = ''", "day", 0, 0, { f: from, t: to }).forEach((x) => {
    const amt = x.getInt("amount_cents"), gst = x.getInt("gst_cents");
    const cat = "exp:" + (x.getString("category") || "Other");
    add(x.getString("day"), "expense", x.id, "Expense " + x.getString("number") + " " + x.getString("vendor_name"), [[cat, amt - gst], ["gst_receivable", gst], [PAIDWITH[x.getString("paid_with")] || "employee_payable", -amt]]);
  });
  app.findRecordsByFilter("expenses", "status = 'reimbursed' && paid_with = 'own_money' && reimbursed_with != 'next_pay' && reimbursed_at >= {:f} && reimbursed_at < {:t} && deleted_at = ''", "", 0, 0, { f: f, t: t }).forEach((x) => {
    add(dayOf(x.getString("reimbursed_at")), "expense_back", x.id, "Paid back " + x.getString("number") + " to " + x.getString("claimant_name"), [["employee_payable", x.getInt("amount_cents")], [BACK[x.getString("reimbursed_with")] || "cash", -x.getInt("amount_cents")]]);
  });
  // Payroll
  app.findRecordsByFilter("payroll_runs", "(status = 'finalized' || status = 'paid') && deleted_at = ''", "pay_date", 0, 0).forEach((r) => {
    if (inDays(r.getString("pay_date"))) {
      const L = [];
      app.findRecordsByFilter("payroll_lines", "run = {:r} && deleted_at = ''", "", 0, 0, { r: r.id }).forEach((l) => {
        const er = l.getInt("cpp_er_cents") + l.getInt("ei_er_cents");
        L.push(["wages", l.getInt("gross_cents")], ["employer_contrib", er], ["employee_payable", l.getInt("reimbursements_cents")],
          ["source_deductions", -(l.getInt("cpp_cents") + l.getInt("cpp2_cents") + l.getInt("ei_cents") + l.getInt("tax_cents") + er)], ["other_deductions", -l.getInt("other_deductions_cents")], ["wages_payable", -l.getInt("net_cents")]);
      });
      add(r.getString("pay_date"), "payroll", r.id, "Payroll " + r.getString("number"), L);
    }
    const pd = r.getString("paid_day") || r.getString("pay_date");
    if (r.getString("status") === "paid" && inDays(pd)) add(pd, "payroll_paid", r.id, "Payroll " + r.getString("number") + " paid", [["wages_payable", r.getInt("net_cents")], [r.getString("paid_method") === "cash" ? "cash" : "bank_clearing", -r.getInt("net_cents")]]);
  });
  // Cash
  app.findRecordsByFilter("client_order_payments", "created_at >= {:f} && created_at < {:t}", "", 0, 0, { f: f, t: t }).forEach((p) => {
    const v = p.getInt("amount_cents") * (p.getString("kind") === "refund" ? -1 : 1), m = p.getString("method") === "card" ? "card_clearing" : "cash";
    add(dayOf(p.getString("created_at")), "order_deposit", p.id, "Customer order " + p.getString("kind"), [[m, v], ["customer_deposits", -v]]);
  });
  app.findRecordsByFilter("cash_movements", "type = 'payout' && created_at >= {:f} && created_at < {:t}", "", 0, 0, { f: f, t: t }).forEach((p) => {
    if (/^Expense /.test(p.getString("reason"))) return;                       // posted with the expense
    add(dayOf(p.getString("created_at")), "payout", p.id, "Till pay-out: " + p.getString("reason"), [["exp:Uncategorized", p.getInt("amount_cents")], ["cash", -p.getInt("amount_cents")]]);
  });
  app.findRecordsByFilter("tills", "status = 'closed' && closed_at >= {:f} && closed_at < {:t} && variance_cents != 0", "", 0, 0, { f: f, t: t }).forEach((x) => {
    add(dayOf(x.getString("closed_at")), "till", x.id, "Till " + x.getInt("number") + " over/short", [["cash", x.getInt("variance_cents")], ["cash_over_short", -x.getInt("variance_cents")]]);
  });
  app.findRecordsByFilter("petty_cash", "created_at >= {:f} && created_at < {:t} && (kind = 'top_up' || kind = 'count' || kind = 'adjust')", "", 0, 0, { f: f, t: t }).forEach((p) => {
    const v = p.getInt("amount_cents");
    add(dayOf(p.getString("created_at")), "petty_cash", p.id, "Petty cash " + p.getString("kind"), p.getString("kind") === "top_up" ? [["petty_cash", v], ["cash", -v]] : [["petty_cash", v], ["cash_over_short", -v]]);
  });
  app.findRecordsByFilter("bank_deposits", "status != 'cancelled' && day >= {:f} && day <= {:t} && deleted_at = ''", "", 0, 0, { f: from, t: to }).forEach((d) => {
    add(d.getString("day"), "deposit", d.id, "Cash deposit " + d.getString("number"), [["deposits_in_transit", d.getInt("amount_cents")], ["cash", -d.getInt("amount_cents")]]);
  });
  // Bank
  app.findRecordsByFilter("bank_accounts", "deleted_at = '' && opening_date >= {:f} && opening_date <= {:t}", "", 0, 0, { f: from, t: to }).forEach((a) => {
    const v = a.getInt("opening_balance_cents");
    add(a.getString("opening_date"), "opening", a.id, "Opening balance " + a.getString("name"), [["bank:" + a.id, v], ["owner_equity", -v]]);
  });
  app.findRecordsByFilter("bank_lines", "status != 'ignored' && day >= {:f} && day <= {:t} && deleted_at = ''", "day", 0, 0, { f: from, t: to }).forEach((l) => {
    const v = l.getInt("amount_cents"), bank = "bank:" + l.getString("account"), k = l.getString("match_kind");
    let other = [];
    if (l.getString("status") === "unmatched") other = [["bank_suspense", -v]];
    else if (k === "card_batch") other = [["card_fees", l.getInt("fee_cents")], ["card_clearing", -(v + l.getInt("fee_cents"))]];
    else if (k === "platform_payout") {
      const ref = j(l, "match_refs", [])[0];
      let p = null;
      try { p = ref ? app.findRecordById("platform_payouts", ref.id) : null; } catch (_) { p = null; }
      const gross = p ? p.getInt("gross_cents") : v;
      other = [["platform_commission", gross - v], ["platform_clearing", -gross]];
    } else if (k === "deposit") other = [["deposits_in_transit", -v]];
    else if (k === "category") other = [[CATEGORY[l.getString("category")] || "exp:Uncategorized", -v]];
    else other = [["bank_clearing", -v]];                                         // a Chedam payment now on the statement
    add(l.getString("day"), "bank", l.id, l.getString("description"), [[bank, v]].concat(other));
  });
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

function activity(app, from, to) {
  const act = {};
  journal(app, from, to).forEach((e) => e.lines.forEach(([k, v]) => { const a = act[k] || (act[k] = { dr: 0, cr: 0 }); if (v > 0) a.dr += v; else a.cr -= v; }));
  return act;
}

// ---- Chart ------------------------------------------------------------------------------------------------------
function ensureAccounts(app) {
  const have = {};
  app.findRecordsByFilter("accounts", "id != ''", "", 0, 0).forEach((a) => { have[a.getString("system_key")] = a; });
  const mk = (key, code, name, type) => {
    if (have[key]) return;
    const r = new Record(app.findCollectionByNameOrId("accounts"));
    r.load({ system_key: key, code: code, name: name, type: type, active: true });
    r.set("created_by", "system:books"); r.set("updated_by", "system:books"); r.set("@actor", "system:books");
    app.save(r); have[key] = r;
  };
  app.findRecordsByFilter("bank_accounts", "deleted_at = ''", "created_at", 0, 0).forEach((b, i) => mk("bank:" + b.id, String(1050 + i), b.getString("name") + (b.getString("last4") ? " ••" + b.getString("last4") : ""), "asset"));
  (setting(app, "expenses.categories", []) || []).forEach((c, i) => mk("exp:" + c, String(6400 + i), c, "expense"));
}
function chart(app) {
  const rows = app.findRecordsByFilter("accounts", "deleted_at = ''", "code", 0, 0).map((a) => ({ id: a.id, key: a.getString("system_key"), code: a.getString("code"), name: a.getString("name"), type: a.getString("type"),
    external_code: a.getString("external_code"), active: a.getBool("active"), note: a.getString("note") }));
  return rows;
}
function names(app) { const m = {}; chart(app).forEach((a) => { m[a.key] = a; }); return m; }
function saveAccount(app, c, id, b) {
  const r = app.findRecordById("accounts", id);
  if (b.name !== undefined) { if (!String(b.name).trim()) bad("A name is needed."); r.set("name", String(b.name).trim().substring(0, 120)); }
  if (b.code !== undefined) { if (!String(b.code).trim()) bad("A code is needed."); r.set("code", String(b.code).trim().substring(0, 20)); }
  if (b.external_code !== undefined) r.set("external_code", String(b.external_code).trim().substring(0, 40));
  if (b.note !== undefined) r.set("note", String(b.note).substring(0, 300));
  stamp(r, c); app.save(r);
  return chart(app).find((a) => a.id === r.id);
}

// ---- Months ----------------------------------------------------------------------------------------------------
const monthOf = (d) => String(d).substring(0, 7);
function monthEnd(m) { const [y, mo] = m.split("-").map(Number); return m + "-" + String(new Date(y, mo, 0).getDate()).padStart(2, "0"); }
function closedMonths(app) { const s = {}; app.findRecordsByFilter("periods", "status = 'closed'", "", 0, 0).forEach((p) => { s[p.getString("month")] = p; }); return s; }
function isClosed(app, day) { return !!(day && app.findRecordsByFilter("periods", "month = {:m} && status = 'closed'", "", 1, 0, { m: monthOf(day) }).length); }
function firstMonth(app) {
  const c = [];
  const pick = (col, field, f) => { const r = app.findRecordsByFilter(col, f || "id != ''", field, 1, 0)[0]; if (r && r.getString(field)) c.push(field.indexOf("_at") > 0 ? dayOf(r.getString(field)) : r.getString(field)); };
  pick("sales", "completed_at", "status = 'completed'"); pick("stock_movements", "created_at"); pick("bills", "doc_date", "doc_date != ''"); pick("bank_accounts", "opening_date", "opening_date != ''"); pick("expenses", "day", "day != ''");
  const p = app.findRecordsByFilter("periods", "id != ''", "month", 1, 0)[0];
  if (p) c.push(p.getString("month") + "-01");
  return c.length ? monthOf(c.sort()[0]) : monthOf(T().localDay(Date.now()));
}
function nextMonth(m) { const [y, mo] = m.split("-").map(Number); return mo === 12 ? (y + 1) + "-01" : y + "-" + String(mo + 1).padStart(2, "0"); }

// Balances as of a day: closed months from their snapshot, the rest worked out
function balances(app, to) {
  const closed = closedMonths(app), out = {};
  const addAct = (act) => Object.keys(act).forEach((k) => { const a = out[k] || (out[k] = { dr: 0, cr: 0 }); a.dr += act[k].dr; a.cr += act[k].cr; });
  for (let m = firstMonth(app); m <= monthOf(to); m = nextMonth(m)) {
    const end = monthEnd(m) < to ? monthEnd(m) : to;
    if (closed[m] && end === monthEnd(m)) addAct(j(closed[m], "snapshot", {}));
    else addAct(activity(app, m + "-01", end));
  }
  return out;
}
function trial(app, q) {
  const today = T().localDay(Date.now());
  const to = ymdOk(q.to) ? q.to : today, from = ymdOk(q.from) ? q.from : to.substring(0, 8) + "01";
  const nm = names(app), bal = balances(app, to), act = activity(app, from, to);
  const keys = Object.keys(nm).concat(Object.keys(bal)).filter((k, i, a) => a.indexOf(k) === i);
  const rows = keys.map((k) => {
    const a = nm[k] || { key: k, code: "?", name: k, type: k.indexOf("bank:") === 0 ? "asset" : "expense" };
    const b = bal[k] || { dr: 0, cr: 0 }, p = act[k] || { dr: 0, cr: 0 };
    return { key: k, code: a.code, name: a.name, type: a.type, external_code: a.external_code || "", period_dr: p.dr, period_cr: p.cr, balance_cents: b.dr - b.cr };
  }).filter((r) => r.period_dr || r.period_cr || r.balance_cents).sort((x, y) => (x.code < y.code ? -1 : 1));
  const t = rows.reduce((a, r) => ({ dr: a.dr + (r.balance_cents > 0 ? r.balance_cents : 0), cr: a.cr + (r.balance_cents < 0 ? -r.balance_cents : 0) }), { dr: 0, cr: 0 });
  return { from: from, to: to, rows: rows, total_dr: t.dr, total_cr: t.cr, balanced: t.dr === t.cr };
}
function entries(app, q) {
  const today = T().localDay(Date.now());
  const to = ymdOk(q.to) ? q.to : today, from = ymdOk(q.from) ? q.from : to.substring(0, 8) + "01";
  const nm = names(app);
  let list = journal(app, from, to);
  if (q.account) list = list.filter((e) => e.lines.some((l) => l[0] === q.account));
  return { from: from, to: to, items: list.slice(0, 2000).map((e) => Object.assign(e, { lines: e.lines.map(([k, v]) => ({ key: k, code: nm[k] ? nm[k].code : "?", name: nm[k] ? nm[k].name : k, dr: v > 0 ? v : 0, cr: v < 0 ? -v : 0 })) })), more: list.length > 2000 };
}

function periods(app) {
  const today = T().localDay(Date.now()), closed = {};
  app.findRecordsByFilter("periods", "id != ''", "month", 0, 0).forEach((p) => { closed[p.getString("month")] = p; });
  const out = [];
  for (let m = firstMonth(app); m <= monthOf(today); m = nextMonth(m)) {
    const p = closed[m];
    out.push({ month: m, status: p ? p.getString("status") : "open", ended: monthEnd(m) < today, closed_by: p ? p.getString("closed_by") : "", closed_at: p ? p.getString("closed_at") : "",
      reopened_by: p ? p.getString("reopened_by") : "", reopen_reason: p ? p.getString("reopen_reason") : "", warnings: p ? j(p, "warnings", []) : [] });
  }
  return { items: out.reverse() };
}
// What is still open in a month (shown before closing)
function checks(app, m) {
  const R = require(`${__hooks}/lib/reports.js`);
  const from = m + "-01", to = monthEnd(m), w = [];
  const n = (col, f, p) => app.findRecordsByFilter(col, f, "", 0, 0, p).length;
  const um = n("bank_lines", "status = 'unmatched' && day >= {:f} && day <= {:t} && deleted_at = ''", { f: from, t: to });
  if (um) w.push(um + " bank lines not matched");
  app.findRecordsByFilter("bank_accounts", "deleted_at = '' && active = true", "", 0, 0).forEach((a) => { if ((a.getString("reconciled_to") || "") < to) w.push(a.getString("name") + " is reconciled only to " + (a.getString("reconciled_to") || "never")); });
  const ex = n("expenses", "status = 'submitted' && day >= {:f} && day <= {:t} && deleted_at = ''", { f: from, t: to });
  if (ex) w.push(ex + " expense claims not decided");
  const tl = n("tills", "status = 'open' && opened_at < {:t}", { t: R.dayStart(to, 1) });
  if (tl) w.push(tl + " tills still open");
  const pr = n("payroll_runs", "status = 'draft' && pay_date >= {:f} && pay_date <= {:t} && deleted_at = ''", { f: from, t: to });
  if (pr) w.push(pr + " payroll runs still drafts");
  const dp = n("bank_deposits", "status = 'in_transit' && day <= {:t} && deleted_at = ''", { t: to });
  if (dp) w.push(dp + " cash deposits not yet on a statement");
  const tb = trial(app, { from: from, to: to });
  if (!tb.balanced) w.push("The trial balance does not balance");
  return w;
}
function close(app, c, b) {
  const m = String(b.month || "");
  if (!/^\d{4}-\d{2}$/.test(m)) bad("Which month?");
  if (monthEnd(m) >= T().localDay(Date.now())) bad("The month has not ended yet.");
  let p = app.findRecordsByFilter("periods", "month = {:m}", "", 1, 0, { m: m })[0] || null;
  if (p && p.getString("status") === "closed") bad("Already closed.");
  const before = periods(app).items.filter((x) => x.month < m && x.status !== "closed");
  if (before.length) bad("Close " + before[before.length - 1].month + " first (months close in order).");
  const w = checks(app, m);
  if (w.length && !b.confirm) return { month: m, closed: false, warnings: w };
  if (!p) { p = new Record(app.findCollectionByNameOrId("periods")); p.set("month", m); }
  p.set("status", "closed"); p.set("snapshot", activity(app, m + "-01", monthEnd(m))); p.set("warnings", w); p.set("closed_by", who(c)); p.set("closed_at", new DateTime());
  stamp(p, c); app.save(p);
  return { month: m, closed: true, warnings: w };
}
function reopen(app, c, b) {
  const access = require(`${__hooks}/lib/access.js`);
  if (!c.user || !access.isOwner(app, c.user)) throw new ForbiddenError("Only the owner reopens a closed month.");
  const p = app.findRecordsByFilter("periods", "month = {:m} && status = 'closed'", "", 1, 0, { m: String(b.month || "") })[0];
  if (!p) bad("That month is not closed.");
  if (!String(b.reason || "").trim()) bad("Say why it is reopened.");
  const later = app.findRecordsByFilter("periods", "month > {:m} && status = 'closed'", "", 1, 0, { m: p.getString("month") });
  if (later.length) bad("Reopen the later months first.");
  p.set("status", "open"); p.set("reopened_by", who(c)); p.set("reopen_reason", String(b.reason).substring(0, 300));
  stamp(p, c); app.save(p);
  return { month: p.getString("month"), status: "open" };
}

// ---- The lock (BR-34): changes dated in a closed month are refused ----------------------------------------------
const LOCK = {
  bills: { date: "doc_date", fields: ["kind", "party", "currency", "fx_rate", "subtotal_cents", "tax_cents", "total_cents", "total_cad_cents", "taxes", "doc_date"], voidable: true },
  bill_payments: { date: "day", fields: ["amount_cents", "cad_cents", "method", "voided", "day", "bill"] },
  expenses: { date: "day", fields: ["amount_cents", "gst_cents", "pst_cents", "category", "paid_with", "day"], decided: true },
  payroll_runs: { date: "pay_date", fields: ["gross_cents", "net_cents", "deductions_cents", "pay_date"], finalize: true },
  bank_lines: { date: "day", fields: ["status", "match_kind", "category", "fee_cents", "amount_cents", "day"] },
  bank_deposits: { date: "day", fields: ["amount_cents", "day", "account"], cancel: true },
  platform_payouts: { date: "day", fields: ["gross_cents", "commission_cents", "fees_cents", "adjustments_cents", "payout_cents", "day"] },
};
function guard(app, r, isNew) {
  const L = LOCK[r.collection().name];
  if (!L) return;
  if (!app.findRecordsByFilter("periods", "status = 'closed'", "", 1, 0).length) return;
  const day = r.getString(L.date);
  const msg = (d) => new BadRequestError(String(d).substring(0, 7) + " is closed in the books: date it in an open month, or ask the owner to reopen it.");
  if (isNew) { if (isClosed(app, day)) throw msg(day); return; }
  const o = r.original();
  const was = o.getString(L.date);
  const changed = L.fields.filter((f) => JSON.stringify(o.get(f)) !== JSON.stringify(r.get(f)));
  const st = o.getString("status") !== r.getString("status") ? [o.getString("status"), r.getString("status")] : null;
  let touches = changed.length > 0;
  if (st && L.voidable && st[1] === "void") touches = true;
  if (st && L.decided && st[0] === "submitted") touches = true;
  if (st && L.finalize && !(st[0] === "finalized" && st[1] === "paid")) touches = true;
  if (st && L.cancel && st[1] === "cancelled") touches = true;
  if (!touches) return;
  if (isClosed(app, was)) throw msg(was);
  if (isClosed(app, day)) throw msg(day);
}

module.exports = { journal, activity, balances, trial, entries, chart, ensureAccounts, saveAccount, periods, checks, close, reopen, guard, isClosed, names, monthEnd, LOCK };

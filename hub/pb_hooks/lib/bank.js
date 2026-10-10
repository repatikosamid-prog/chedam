// Bank (P4 step 6; FR-10.02, 10.03). bank.manage (the accountant; the owner).
// Import a statement: OFX/QFX (each transaction's FITID) or CSV (a header with date, description, amount or
// debit/credit, balance, as the big Canadian banks give it; TD's file without a header; dates Y-M-D, M/D/Y or
// D/M/Y). Lines already imported are skipped (OFX: the FITID; CSV: day, amount, description and its count
// in the file). Each new line is matched when exactly one Chedam record has the same amount near that day:
//   money out: payments of vendor bills (cheque, e-transfer, bank transfer), expenses paid back by cheque or
//   e-transfer, payroll runs paid (the run's net) or one person's pay (cheque, e-transfer);
//   money in: cash deposits from the tills (DP-…, within 7 days), clients paying invoices, delivery-platform payouts.
// Card batches (the day's card sales less the processor's fee, 1-5 days later, up to 5% less) are offered for
// a manual match, which records the fee (step 7 uses it). Lines that are not a Chedam record get a category
// (bank fees, owner draw, transfer...) or are ignored with a note. Reconcile: the statement's balance on a day
// against the opening balance plus the lines; with no difference and nothing unmatched it is marked reconciled.

const T = () => require(`${__hooks}/lib/timeclock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) { r.set("created_by", c.actor); if (c.device) r.set("device_id", c.device); } }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const money = (c) => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toFixed(2);
function pn(app, b) { try { return app.findRecordById("parties", b.getString("party")).getString("name"); } catch (_) { return ""; } }
const who = (c) => (c.user ? c.user.getString("name") : c.actor);

// ---- Parsing -------------------------------------------------------------------------------------------------
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function pad(n) { return (n < 10 ? "0" : "") + Number(n); }
function parseDay(s, fmt) {
  s = String(s || "").trim().replace(/^"|"$/g, "");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return m[1] + "-" + pad(m[2]) + "-" + pad(m[3]);
  m = s.match(/^(\d{8})/);
  if (m) return m[1].substring(0, 4) + "-" + m[1].substring(4, 6) + "-" + m[1].substring(6, 8);
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ,]+(\d{4})/);
  if (m && MON[m[2].toLowerCase()]) return m[3] + "-" + pad(MON[m[2].toLowerCase()]) + "-" + pad(m[1]);
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*[ .]+(\d{1,2}),?\s+(\d{4})/);
  if (m && MON[m[1].toLowerCase()]) return m[3] + "-" + pad(MON[m[1].toLowerCase()]) + "-" + pad(m[2]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    let mo = Number(m[1]), d = Number(m[2]);
    if (fmt === "dmy" || mo > 12) { mo = Number(m[2]); d = Number(m[1]); }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
    return y + "-" + pad(mo) + "-" + pad(d);
  }
  return "";
}
function cents(s) {
  let x = String(s == null ? "" : s).trim().replace(/^"|"$/g, "");
  if (!x) return null;
  let neg = false;
  if (/^\(.*\)$/.test(x)) { neg = true; x = x.slice(1, -1); }
  if (/-$/.test(x)) { neg = true; x = x.slice(0, -1); }
  x = x.replace(/[$\s,]|CAD|USD/gi, "");
  if (x.indexOf("-") === 0) { neg = !neg; x = x.substring(1); }
  if (!/^\d*\.?\d+$/.test(x)) return null;
  const v = Math.round(Number(x) * 100);
  return neg ? -v : v;
}
function csvRows(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === "," || ch === ";" || ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some((x) => String(x).trim())) rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell); if (row.some((x) => String(x).trim())) rows.push(row);
  return rows;
}
const find = (hdr, names) => hdr.findIndex((h) => names.some((n) => h === n || h.indexOf(n) === 0));
function parseCsv(text, fmt) {
  const rows = csvRows(text);
  if (!rows.length) bad("The file is empty.");
  const hdr = rows[0].map((h) => String(h).trim().toLowerCase());
  let out = [];
  if (parseDay(rows[0][0], fmt)) {
    // No header (TD): date, description, withdrawal, deposit, balance
    out = rows.map((r) => { const dr = cents(r[2]), cr = cents(r[3]); return { day: parseDay(r[0], fmt), description: String(r[1] || "").trim(), amount_cents: (cr || 0) - (dr || 0), balance_cents: cents(r[4]) }; });
  } else {
    const di = find(hdr, ["transaction date", "date", "posted date", "posting date", "trans. date"]);
    const ds = hdr.map((h, i) => (/^(description|payee|memo|details|name|transaction|narrative)/.test(h) ? i : -1)).filter((i) => i >= 0 && i !== di);
    const ai = find(hdr, ["amount", "cad$", "cad", "transaction amount"]);
    const wi = find(hdr, ["debit", "withdrawal", "withdrawals", "money out", "paid out"]);
    const ci = find(hdr, ["credit", "deposit", "deposits", "money in", "paid in"]);
    const bi = find(hdr, ["balance", "running balance"]);
    if (di < 0 || (ai < 0 && wi < 0 && ci < 0)) bad("Could not find the date and amount columns in this CSV.");
    out = rows.slice(1).map((r) => {
      let amt = ai >= 0 ? cents(r[ai]) : null;
      if (amt === null && (wi >= 0 || ci >= 0)) { const dr = wi >= 0 ? cents(r[wi]) : null, cr = ci >= 0 ? cents(r[ci]) : null; if (dr !== null || cr !== null) amt = (cr || 0) - Math.abs(dr || 0); }
      return { day: parseDay(r[di], fmt), description: ds.map((i) => String(r[i] || "").trim()).filter(Boolean).join(" "), amount_cents: amt, balance_cents: bi >= 0 ? cents(r[bi]) : null };
    });
  }
  out = out.filter((x) => x.day && x.amount_cents !== null && x.amount_cents !== 0);
  const seen = {};
  out.forEach((x) => { const k = x.day + "|" + x.amount_cents + "|" + x.description.toLowerCase(); seen[k] = (seen[k] || 0) + 1; x.fitid = "csv:" + $security.sha256(k + "|" + seen[k]).substring(0, 40); });
  return out;
}
function parseOfx(text) {
  const tag = (b, n) => { const m = b.match(new RegExp("<" + n + ">([^<\\r\\n]*)", "i")); return m ? m[1].trim() : ""; };
  const parts = text.split(/<STMTTRN>/i).slice(1).map((p) => p.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  return parts.map((b) => ({ day: parseDay(tag(b, "DTPOSTED")), description: [tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).join(" ").replace(/&amp;/g, "&"),
    amount_cents: cents(tag(b, "TRNAMT")), balance_cents: null, fitid: "ofx:" + (tag(b, "FITID") || $security.sha256(b).substring(0, 40)) }))
    .filter((x) => x.day && x.amount_cents);
}
function parse(text, filename, fmt) {
  const t = String(text || "");
  if (/<OFX>|<STMTTRN>/i.test(t)) return { format: /\.qfx$/i.test(filename || "") ? "qfx" : "ofx", rows: parseOfx(t) };
  return { format: "csv", rows: parseCsv(t, fmt) };
}

// ---- Views ----------------------------------------------------------------------------------------------------
function lineView(r) {
  return { id: r.id, account: r.getString("account"), day: r.getString("day"), description: r.getString("description"), amount_cents: r.getInt("amount_cents"),
    balance_cents: r.getBool("has_balance") ? r.getInt("balance_cents") : null, status: r.getString("status"), match_kind: r.getString("match_kind"), match_refs: j(r, "match_refs", []),
    category: r.getString("category"), fee_cents: r.getInt("fee_cents"), auto: r.getBool("auto"), note: r.getString("note"), matched_by: r.getString("matched_by") };
}
function accountView(app, a) {
  const lines = app.findRecordsByFilter("bank_lines", "account = {:a} && deleted_at = ''", "day", 0, 0, { a: a.id });
  return { id: a.id, name: a.getString("name"), institution: a.getString("institution"), last4: a.getString("last4"), kind: a.getString("kind"), currency: a.getString("currency") || "CAD",
    opening_balance_cents: a.getInt("opening_balance_cents"), opening_date: a.getString("opening_date"), reconciled_to: a.getString("reconciled_to"), reconciled_balance_cents: a.getInt("reconciled_balance_cents"),
    balance_cents: a.getInt("opening_balance_cents") + lines.reduce((s, l) => s + l.getInt("amount_cents"), 0), last_day: lines.length ? lines[lines.length - 1].getString("day") : "",
    unmatched: lines.filter((l) => l.getString("status") === "unmatched").length, lines: lines.length, active: a.getBool("active") };
}
function depositView(r) {
  return { id: r.id, number: r.getString("number"), account: r.getString("account"), day: r.getString("day"), amount_cents: r.getInt("amount_cents"), tills: j(r, "tills", []), note: r.getString("note"),
    status: r.getString("status"), bank_line: r.getString("bank_line"), by_name: r.getString("by_name") };
}

function summary(app) {
  return { accounts: app.findRecordsByFilter("bank_accounts", "deleted_at = ''", "name", 0, 0).map((a) => accountView(app, a)),
    deposits: app.findRecordsByFilter("bank_deposits", "deleted_at = '' && status != 'cancelled'", "-day", 50, 0).map(depositView), categories: setting(app, "bank.categories", []) || [] };
}

function saveAccount(app, c, b) {
  const r = b.id ? app.findRecordById("bank_accounts", b.id) : new Record(app.findCollectionByNameOrId("bank_accounts"));
  if (!String(b.name || r.getString("name")).trim()) bad("Name the account.");
  if (["chequing", "savings", "credit_card"].indexOf(b.kind || r.getString("kind") || "chequing") < 0) bad("Chequing, savings or credit card.");
  if (b.last4 && !/^\d{4}$/.test(b.last4)) bad("The last 4 digits only.");
  if (b.opening_date && !ymdOk(b.opening_date)) bad("The opening date as YYYY-MM-DD.");
  ["name", "institution", "last4", "opening_date"].forEach((k) => { if (b[k] !== undefined) r.set(k, String(b[k]).trim()); });
  if (b.kind !== undefined || r.isNew()) r.set("kind", b.kind || "chequing");
  if (b.opening_balance_cents !== undefined) r.set("opening_balance_cents", Math.round(Number(b.opening_balance_cents) || 0));
  r.set("currency", String(b.currency || r.getString("currency") || "CAD").toUpperCase().substring(0, 3));
  r.set("active", b.active === undefined ? (r.isNew() ? true : r.getBool("active")) : !!b.active);
  stamp(r, c); app.save(r);
  return accountView(app, r);
}

// ---- Matching -------------------------------------------------------------------------------------------------
function usedRefs(app) {
  const used = {};
  app.findRecordsByFilter("bank_lines", "status = 'matched' && deleted_at = ''", "", 0, 0).forEach((l) => j(l, "match_refs", []).forEach((x) => { used[x.kind + ":" + x.id] = l.id; }));
  return used;
}
function cardTotal(app, day) {
  const R = require(`${__hooks}/lib/reports.js`);
  const f = R.dayStart(day), t = R.dayStart(day, 1);
  const paid = app.findRecordsByFilter("payments", "method = 'card' && status = 'approved' && sale.status = 'completed' && sale.training = false && sale.completed_at >= {:f} && sale.completed_at < {:t}", "", 0, 0, { f: f, t: t })
    .reduce((a, p) => a + p.getInt("amount_cents"), 0);
  const back = app.findRecordsByFilter("refunds", "method = 'card' && created_at >= {:f} && created_at < {:t}", "", 0, 0, { f: f, t: t }).reduce((a, p) => a + p.getInt("amount_cents"), 0);
  return paid - back;
}
function candidates(app, line, used) {
  used = used || usedRefs(app);
  const amt = line.getInt("amount_cents"), day = line.getString("day"), out = [];
  const near = (d, before, after) => { if (!d) return false; const n = days(d, day); return n >= -before && n <= after; };
  const add = (kind, id, label, amount, d, extra) => { if (!used[kind + ":" + id]) out.push(Object.assign({ kind: kind, id: id, label: label, amount_cents: amount, day: d, exact: amount === Math.abs(amt), gap: Math.abs(days(d || day, day)) }, extra || {})); };
  const from = T().addDays(day, -15), to = T().addDays(day, 10);
  if (amt < 0) {
    app.findRecordsByFilter("bill_payments", "voided = false && deleted_at = '' && day >= {:f} && day <= {:t} && (method = 'cheque' || method = 'e_transfer' || method = 'bank_transfer') && bill.kind = 'bill'", "", 0, 0, { f: from, t: to })
      .forEach((p) => { if (p.getInt("cad_cents") === -amt && near(p.getString("day"), 3, 10)) { const b = app.findRecordById("bills", p.getString("bill")); add("bill_payment", p.id, "Payment of " + b.getString("number") + " " + pn(app, b) + (p.getString("reference") ? " (" + p.getString("reference") + ")" : ""), p.getInt("cad_cents"), p.getString("day")); } });
    app.findRecordsByFilter("expenses", "status = 'reimbursed' && (reimbursed_with = 'cheque' || reimbursed_with = 'e_transfer') && amount_cents = {:a} && deleted_at = ''", "", 0, 0, { a: -amt })
      .forEach((x) => { const d = x.getString("reimbursed_at").substring(0, 10); if (near(d, 3, 10)) add("expense", x.id, "Expense " + x.getString("number") + " paid back to " + x.getString("claimant_name"), x.getInt("amount_cents"), d); });
    app.findRecordsByFilter("payroll_runs", "status = 'paid' && deleted_at = ''", "-pay_date", 30, 0).forEach((r) => {
      const d = r.getString("paid_day") || r.getString("pay_date");
      if (!near(d, 3, 7)) return;
      if (r.getInt("net_cents") === -amt) add("payroll", r.id, "Payroll " + r.getString("number") + " (" + r.getString("period_start") + " to " + r.getString("period_end") + ")", r.getInt("net_cents"), d);
      if (["cheque", "e_transfer"].indexOf(r.getString("paid_method")) >= 0) app.findRecordsByFilter("payroll_lines", "run = {:r} && net_cents = {:a} && deleted_at = ''", "", 0, 0, { r: r.id, a: -amt })
        .forEach((l) => add("pay", l.id, "Pay of " + l.getString("legal_name") + " (" + r.getString("number") + ")", l.getInt("net_cents"), d));
    });
  } else {
    app.findRecordsByFilter("bank_deposits", "account = {:a} && status = 'in_transit' && deleted_at = ''", "", 0, 0, { a: line.getString("account") })
      .forEach((x) => { if (x.getInt("amount_cents") === amt && near(x.getString("day"), 0, 7) && days(x.getString("day"), day) >= 0) add("deposit", x.id, "Cash deposit " + x.getString("number"), amt, x.getString("day")); });
    app.findRecordsByFilter("bill_payments", "voided = false && deleted_at = '' && day >= {:f} && day <= {:t} && (method = 'cheque' || method = 'e_transfer' || method = 'bank_transfer') && bill.kind = 'invoice'", "", 0, 0, { f: from, t: to })
      .forEach((p) => { if (p.getInt("cad_cents") === amt && near(p.getString("day"), 3, 10)) { const b = app.findRecordById("bills", p.getString("bill")); add("invoice_payment", p.id, "Client paid " + b.getString("number") + " " + pn(app, b), amt, p.getString("day")); } });
    app.findRecordsByFilter("platform_payouts", "status = 'expected' && payout_cents = {:a} && deleted_at = ''", "", 0, 0, { a: amt })
      .forEach((x) => { if (near(x.getString("day"), 7, 7)) add("platform_payout", x.id, x.getString("platform") + " payout " + x.getString("period_from") + " to " + x.getString("period_to"), amt, x.getString("day")); });
    for (let k = 1; k <= 5; k++) {
      const d = T().addDays(day, -k);
      const tot = cardTotal(app, d);
      if (tot > 0 && amt <= tot && amt >= Math.floor(tot * 0.95)) add("card_batch", d, "Card sales of " + d + " (" + money(tot) + ", fee " + money(tot - amt) + ")", tot, d, { exact: false, fee_cents: tot - amt });
    }
  }
  return out.sort((a, b) => (b.exact - a.exact) || (a.gap - b.gap));
}

function setMatch(app, c, line, kind, refs, auto) {
  line.set("status", "matched"); line.set("match_kind", kind); line.set("match_refs", refs.map((x) => ({ kind: x.kind, id: x.id, label: x.label, amount_cents: x.amount_cents })));
  line.set("fee_cents", kind === "card_batch" ? refs.reduce((a, x) => a + (x.fee_cents || 0), 0) : 0);
  line.set("auto", !!auto); line.set("matched_by", auto ? "Chedam" : who(c));
  stamp(line, c); app.save(line);
  refs.filter((x) => x.kind === "deposit").forEach((x) => { const d = app.findRecordById("bank_deposits", x.id); d.set("status", "matched"); d.set("bank_line", line.id); stamp(d, c); app.save(d); });
  refs.filter((x) => x.kind === "platform_payout").forEach((x) => { const d = app.findRecordById("platform_payouts", x.id); d.set("status", "matched"); d.set("bank_line", line.id); stamp(d, c); app.save(d); });
}
function auto(app, c, ids) {
  let n = 0;
  const used = usedRefs(app);
  const lines = ids ? ids.map((id) => app.findRecordById("bank_lines", id)) : app.findRecordsByFilter("bank_lines", "status = 'unmatched' && deleted_at = ''", "day", 0, 0);
  lines.forEach((l) => {
    if (l.getString("status") !== "unmatched") return;
    const ex = candidates(app, l, used).filter((x) => x.exact);
    if (ex.length !== 1) return;
    setMatch(app, c, l, ex[0].kind, [ex[0]], true);
    used[ex[0].kind + ":" + ex[0].id] = l.id;
    n++;
  });
  return { matched: n };
}

function importFile(app, c, b) {
  const acc = app.findRecordById("bank_accounts", String(b.account || ""));
  const p = parse(b.text, b.filename, b.date_format);
  if (!p.rows.length) bad("No transactions found in the file.");
  const imp = new Record(app.findCollectionByNameOrId("bank_imports"));
  imp.load({ account: acc.id, filename: String(b.filename || "").substring(0, 200), format: p.format, by_name: who(c) });
  stamp(imp, c); app.save(imp);
  let added = 0, dup = 0, closed = 0;
  const ids = [];
  const B = require(`${__hooks}/lib/books.js`);
  p.rows.forEach((x) => {
    if (app.findRecordsByFilter("bank_lines", "account = {:a} && fitid = {:f}", "", 1, 0, { a: acc.id, f: x.fitid }).length) { dup++; return; }
    if (B.isClosed(app, x.day)) { closed++; return; }                           // a month closed in the books (step 8)
    const r = new Record(app.findCollectionByNameOrId("bank_lines"));
    r.load({ account: acc.id, import: imp.id, day: x.day, description: x.description.substring(0, 300), amount_cents: x.amount_cents, balance_cents: x.balance_cents || 0, has_balance: x.balance_cents !== null && x.balance_cents !== undefined,
      fitid: x.fitid, status: "unmatched", match_refs: [] });
    stamp(r, c); app.save(r); ids.push(r.id); added++;
  });
  const ds = p.rows.map((x) => x.day).sort();
  imp.set("added", added); imp.set("duplicates", dup); imp.set("first_day", ds[0]); imp.set("last_day", ds[ds.length - 1]); app.save(imp);
  const m = auto(app, c, ids);
  return { format: p.format, added: added, duplicates: dup, in_closed_months: closed, matched: m.matched, first_day: ds[0], last_day: ds[ds.length - 1] };
}

function lines(app, q) {
  let f = "deleted_at = ''";
  const P = {};
  if (q.account) { f += " && account = {:a}"; P.a = q.account; }
  if (q.status) { f += " && status = {:s}"; P.s = q.status; }
  if (ymdOk(q.from)) { f += " && day >= {:f}"; P.f = q.from; }
  if (ymdOk(q.to)) { f += " && day <= {:t}"; P.t = q.to; }
  return { items: app.findRecordsByFilter("bank_lines", f, "-day,-created_at", 500, 0, P).map(lineView) };
}

// {kind: <a candidate kind>, refs: [ids]} | {kind: "category", category, note} | {kind: "ignore", note}
function match(app, c, id, b) {
  const l = app.findRecordById("bank_lines", id);
  if (l.getString("status") !== "unmatched") bad("It is already " + l.getString("status") + ": unmatch it first.");
  if (b.kind === "category") {
    const cats = setting(app, "bank.categories", []) || [];
    if (cats.indexOf(b.category) < 0) bad("Choose a category from the list.");
    l.set("status", "matched"); l.set("match_kind", "category"); l.set("category", b.category); l.set("match_refs", []); l.set("note", String(b.note || "").substring(0, 300)); l.set("matched_by", who(c)); l.set("auto", false);
    stamp(l, c); app.save(l);
    return lineView(l);
  }
  if (b.kind === "ignore") {
    if (!String(b.note || "").trim()) bad("Say why it is ignored.");
    l.set("status", "ignored"); l.set("note", String(b.note).substring(0, 300)); l.set("matched_by", who(c));
    stamp(l, c); app.save(l);
    return lineView(l);
  }
  const want = Array.isArray(b.refs) ? b.refs.map(String) : [];
  if (!want.length) bad("Choose what it matches.");
  const cands = candidates(app, l);
  const chosen = want.map((x) => cands.find((y) => y.kind === b.kind && y.id === x));
  if (chosen.some((x) => !x)) bad("That is not a possible match for this line (amount, day, or already matched).");
  if (b.kind !== "card_batch") {
    const sum = chosen.reduce((a, x) => a + x.amount_cents, 0);
    if (sum !== Math.abs(l.getInt("amount_cents"))) bad("The chosen records add up to " + money(sum) + ", not " + money(Math.abs(l.getInt("amount_cents"))) + ".");
  }
  setMatch(app, c, l, b.kind, chosen, false);
  return lineView(l);
}
function unmatch(app, c, id) {
  const l = app.findRecordById("bank_lines", id);
  if (l.getString("status") === "unmatched") bad("It is not matched.");
  const acc = app.findRecordById("bank_accounts", l.getString("account"));
  if (acc.getString("reconciled_to") && l.getString("day") <= acc.getString("reconciled_to")) bad("This line is in a reconciled period (to " + acc.getString("reconciled_to") + ").");
  j(l, "match_refs", []).filter((x) => x.kind === "deposit").forEach((x) => { try { const d = app.findRecordById("bank_deposits", x.id); d.set("status", "in_transit"); d.set("bank_line", ""); stamp(d, c); app.save(d); } catch (_) { /* gone */ } });
  j(l, "match_refs", []).filter((x) => x.kind === "platform_payout").forEach((x) => { try { const d = app.findRecordById("platform_payouts", x.id); d.set("status", "expected"); d.set("bank_line", ""); stamp(d, c); app.save(d); } catch (_) { /* gone */ } });
  l.set("status", "unmatched"); l.set("match_kind", ""); l.set("match_refs", []); l.set("category", ""); l.set("fee_cents", 0); l.set("auto", false); l.set("matched_by", ""); l.set("note", "");
  stamp(l, c); app.save(l);
  return lineView(l);
}

// Cash taken from the tills to the bank: {account, day, amount_cents, tills: [ids], note}
function deposit(app, c, b) {
  const acc = app.findRecordById("bank_accounts", String(b.account || ""));
  const amt = Math.round(Number(b.amount_cents) || 0);
  if (amt <= 0) bad("How much cash is deposited?");
  const tills = (Array.isArray(b.tills) ? b.tills : []).map((id) => {
    const t = app.findRecordById("tills", String(id));
    if (t.getString("status") !== "closed") bad("Only closed tills.");
    return { id: t.id, number: t.getInt("number"), closed_at: t.getString("closed_at"), counted_cents: t.getInt("counted_cents") };
  });
  const r = new Record(app.findCollectionByNameOrId("bank_deposits"));
  r.load({ number: "DP-" + ("000000" + require(`${__hooks}/lib/sales.js`).nextNumber(app, "dp", c)).slice(-6), account: acc.id, day: ymdOk(b.day) ? b.day : T().localDay(Date.now()), amount_cents: amt,
    tills: tills, note: String(b.note || "").substring(0, 300), status: "in_transit", by_name: who(c) });
  stamp(r, c); app.save(r);
  return depositView(r);
}
function cancelDeposit(app, c, id) {
  const r = app.findRecordById("bank_deposits", id);
  if (r.getString("status") !== "in_transit") bad("Only a deposit not yet on the statement.");
  r.set("status", "cancelled"); stamp(r, c); app.save(r);
  return depositView(r);
}
// Closed tills of the last 14 days with their counted cash, and whether a deposit took them
function tillsToDeposit(app) {
  const since = new Date(Date.now() - 14 * 86400000).toISOString().replace("T", " ");
  const inDep = {};
  app.findRecordsByFilter("bank_deposits", "status != 'cancelled' && deleted_at = ''", "", 0, 0).forEach((d) => j(d, "tills", []).forEach((t) => { inDep[t.id] = d.getString("number"); }));
  return { items: app.findRecordsByFilter("tills", "status = 'closed' && closed_at >= {:s}", "-closed_at", 100, 0, { s: since }).map((t) => ({ id: t.id, number: t.getInt("number"), closed_at: t.getString("closed_at"),
    counted_cents: t.getInt("counted_cents"), float_cents: t.getInt("float_cents"), deposit: inDep[t.id] || "" })) };
}

// {account, to, statement_balance_cents}
function reconcile(app, c, b) {
  const acc = app.findRecordById("bank_accounts", String(b.account || ""));
  if (!ymdOk(b.to)) bad("The statement's end date.");
  const ls = app.findRecordsByFilter("bank_lines", "account = {:a} && day <= {:t} && deleted_at = ''", "", 0, 0, { a: acc.id, t: b.to });
  const bal = acc.getInt("opening_balance_cents") + ls.reduce((a, l) => a + l.getInt("amount_cents"), 0);
  const stmt = Math.round(Number(b.statement_balance_cents));
  if (!isFinite(stmt)) bad("The statement's balance on that day.");
  const unmatched = ls.filter((l) => l.getString("status") === "unmatched").length;
  const out = { account: acc.id, to: b.to, chedam_balance_cents: bal, statement_balance_cents: stmt, difference_cents: stmt - bal, unmatched: unmatched, reconciled: false };
  if (out.difference_cents === 0 && unmatched === 0) {
    acc.set("reconciled_to", b.to); acc.set("reconciled_balance_cents", stmt); stamp(acc, c); app.save(acc);
    out.reconciled = true;
  }
  return out;
}

module.exports = { parse, summary, saveAccount, importFile, lines, candidates, match, unmatch, auto, deposit, cancelDeposit, tillsToDeposit, reconcile, cardTotal, lineView };

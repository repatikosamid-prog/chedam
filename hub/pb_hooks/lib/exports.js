// Accountant exports (P4 step 10; FR-10.12). books.manage. CSV files the accountant imports into QuickBooks
// Online or Xero, from the books (lib/books.js) so they agree with the trial balance:
//   journal  every entry; sales, returns and stock summarised to one journal per day (QuickBooks: "Journal
//            No., Journal Date, Account Name, Debits, Credits, Description, Name"; Xero manual journals:
//            "*Narration, *Date, Description, *AccountCode, *TaxRate, *Amount", debits +, credits −)
//   sales    the sales journal only (sales, returns, cost of goods sold), one per day
//   payroll  the payroll journal (wages, deductions, payments) and a register of each pay stub
//   expenses each approved expense claim (day, number, vendor, category, amount, GST/HST, PST, paid with)
//   bank     each bank line with what it was matched to (the reconciliation)
// Accounts go out by the accountant's own code when set (Chart of accounts → Your code), else Chedam's
// (Xero: the code; QuickBooks: the name). Dates as YYYY-MM-DD, or DD/MM/YYYY or MM/DD/YYYY when asked.

const BK = () => require(`${__hooks}/lib/books.js`);
const T = () => require(`${__hooks}/lib/timeclock.js`);
function bad(msg) { throw new BadRequestError(msg); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const cell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (rows) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
const amt = (c) => (c / 100).toFixed(2);
function fmtDate(d, f) { const [y, m, dd] = d.split("-"); return f === "dmy" ? dd + "/" + m + "/" + y : f === "mdy" ? m + "/" + dd + "/" + y : d; }
const DAILY = ["sale", "return", "stock", "consignment"];

// Entries with the per-day summary for sales and stock
function entries(app, from, to, only) {
  const out = [], daily = {};
  BK().journal(app, from, to).forEach((e) => {
    if (only && only.indexOf(e.source) < 0) return;
    if (DAILY.indexOf(e.source) < 0) { out.push(e); return; }
    const d = daily[e.day] || (daily[e.day] = { day: e.day, source: "daily", memo: "Sales, returns and stock " + e.day, sums: {}, n: 0 });
    d.n++;
    e.lines.forEach(([k, v]) => { d.sums[k] = (d.sums[k] || 0) + v; });
  });
  Object.keys(daily).forEach((d) => { const x = daily[d]; out.push({ day: x.day, source: "daily", ref: "D" + d.replace(/-/g, ""), memo: x.memo + " (" + x.n + " records)", lines: Object.keys(x.sums).map((k) => [k, x.sums[k]]).filter((l) => l[1]) }); });
  return out.filter((e) => e.lines.length).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
function journalCsv(app, list, fmt, df) {
  const nm = BK().names(app);
  const acct = (k) => { const a = nm[k] || { code: "", name: k }; return fmt === "xero" ? (a.external_code || a.code) : (a.external_code || a.name); };
  if (fmt === "xero") {
    const rows = [["*Narration", "*Date", "Description", "*AccountCode", "*TaxRate", "*Amount"]];
    list.forEach((e) => e.lines.forEach(([k, v]) => rows.push([e.memo, fmtDate(e.day, df), e.memo, acct(k), "Tax Exempt", amt(v)])));
    return csv(rows);
  }
  const rows = [["Journal No.", "Journal Date", "Account Name", "Debits", "Credits", "Description", "Name"]];
  list.forEach((e, i) => e.lines.forEach(([k, v]) => rows.push(["CH" + String(i + 1).padStart(5, "0"), fmtDate(e.day, df), acct(k), v > 0 ? amt(v) : "", v < 0 ? amt(-v) : "", e.memo, ""])));
  return csv(rows);
}

function make(app, q) {
  const today = T().localDay(Date.now());
  const to = ymdOk(q.to) ? q.to : today, from = ymdOk(q.from) ? q.from : to.substring(0, 8) + "01";
  if (from > to) bad("From must be before to.");
  const fmt = q.format === "xero" ? "xero" : "quickbooks", df = ["dmy", "mdy"].indexOf(q.dates) >= 0 ? q.dates : "iso";
  const kind = String(q.kind || "journal");
  const name = (k) => "chedam-" + k + "-" + from + "-to-" + to + (k === "journal" || k === "sales" || k === "payroll" ? "-" + fmt : "") + ".csv";
  if (kind === "journal") { const l = entries(app, from, to); return { filename: name(kind), rows: l.length, csv: journalCsv(app, l, fmt, df) }; }
  if (kind === "sales") { const l = entries(app, from, to, DAILY); return { filename: name(kind), rows: l.length, csv: journalCsv(app, l, fmt, df) }; }
  if (kind === "payroll") {
    const l = entries(app, from, to, ["payroll", "payroll_paid"]);
    const reg = [["Pay date", "Run", "Employee", "Regular h", "Overtime h", "Gross", "Vacation pay", "CPP", "CPP2", "EI", "Income tax", "Other deductions", "Reimbursed", "Net", "Employer CPP", "Employer EI"]];
    app.findRecordsByFilter("payroll_runs", "(status = 'finalized' || status = 'paid') && pay_date >= {:f} && pay_date <= {:t} && deleted_at = ''", "pay_date", 0, 0, { f: from, t: to }).forEach((r) => {
      app.findRecordsByFilter("payroll_lines", "run = {:r} && deleted_at = ''", "legal_name", 0, 0, { r: r.id }).forEach((x) => reg.push([fmtDate(r.getString("pay_date"), df), r.getString("number"), x.getString("legal_name"),
        (x.getInt("regular_min") / 60).toFixed(2), ((x.getInt("overtime_min") + x.getInt("double_min")) / 60).toFixed(2), amt(x.getInt("gross_cents")), amt(x.getInt("vacation_pay_cents")), amt(x.getInt("cpp_cents")), amt(x.getInt("cpp2_cents")),
        amt(x.getInt("ei_cents")), amt(x.getInt("tax_cents")), amt(x.getInt("other_deductions_cents")), amt(x.getInt("reimbursements_cents")), amt(x.getInt("net_cents")), amt(x.getInt("cpp_er_cents")), amt(x.getInt("ei_er_cents"))]));
    });
    return { filename: name(kind), rows: l.length, csv: journalCsv(app, l, fmt, df), register: { filename: "chedam-payroll-register-" + from + "-to-" + to + ".csv", rows: reg.length - 1, csv: csv(reg) } };
  }
  if (kind === "expenses") {
    const rows = [["Date", "Number", "Vendor", "Category", "Account", "Amount", "GST/HST", "PST", "Paid with", "Claimant", "Status", "Paid back", "Note"]];
    const nm = BK().names(app);
    app.findRecordsByFilter("expenses", "(status = 'approved' || status = 'reimbursed') && day >= {:f} && day <= {:t} && deleted_at = ''", "day,number", 0, 0, { f: from, t: to }).forEach((x) => {
      const a = nm["exp:" + x.getString("category")] || {};
      rows.push([fmtDate(x.getString("day"), df), x.getString("number"), x.getString("vendor_name"), x.getString("category"), a.external_code || a.code || "", amt(x.getInt("amount_cents")), amt(x.getInt("gst_cents")), amt(x.getInt("pst_cents")),
        x.getString("paid_with"), x.getString("claimant_name"), x.getString("status"), x.getString("reimbursed_with"), x.getString("note")]);
    });
    return { filename: name(kind), rows: rows.length - 1, csv: csv(rows) };
  }
  if (kind === "bank") {
    const rows = [["Account", "Date", "Description", "Amount", "Status", "Matched to", "Category", "Card fee", "Matched by", "Note"]];
    const accs = {};
    app.findRecordsByFilter("bank_accounts", "id != ''", "", 0, 0).forEach((a) => { accs[a.id] = a.getString("name"); });
    app.findRecordsByFilter("bank_lines", "day >= {:f} && day <= {:t} && deleted_at = ''", "account,day", 0, 0, { f: from, t: to }).forEach((l) => {
      rows.push([accs[l.getString("account")] || "", fmtDate(l.getString("day"), df), l.getString("description"), amt(l.getInt("amount_cents")), l.getString("status"),
        j(l, "match_refs", []).map((x) => x.label).join("; "), l.getString("category"), l.getInt("fee_cents") ? amt(l.getInt("fee_cents")) : "", l.getString("matched_by"), l.getString("note")]);
    });
    return { filename: name(kind), rows: rows.length - 1, csv: csv(rows) };
  }
  bad("Journal, sales, payroll, expenses or bank.");
}

module.exports = { make, entries };

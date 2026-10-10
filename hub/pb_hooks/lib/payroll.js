// Payroll preparation (P4 step 5; FR-9.11-9.13, P4-c). payroll.manage (the accountant; the owner has all).
// A run per pay period (the pay date chosen): one line per employee with pay.
//   Hourly: approved time sheet hours × rate (overtime 1.5×, double 2×), sick hours taken × rate, vacation
//   pay (the employee's %, BC 4% / 6% after 5 years) on all of it. People with hours but no approved time
//   sheet are listed as waiting, not paid.
//   Salary: a year / pay periods a year; overtime from the time sheet at the hourly equivalent (a year / 52 /
//   hours a week); unpaid leave taken is taken off at that rate.
//   Extras entered per line: stat holiday pay, other earnings (bonus). Reimbursements: expenses paid back
//   "with the next pay" (not taxable).
// Deductions are ENTERED (CPP, CPP2, EI, income tax, other) from the CRA payroll calculator (PDOC) or the
// accountant, per line; Chedam never calculates them (Master Specification R4). Employer's share: CPP = the
// employee's, EI = 1.4 × the employee's. Finalising needs every line's deductions entered (0 is an answer),
// marks the time sheets paid and gives each person their pay stub (inbox). Then the payment is recorded.
// T4 boxes and ROE data come from finalised lines.

const TS = () => require(`${__hooks}/lib/timesheets.js`);
const T = () => require(`${__hooks}/lib/timeclock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) { r.set("created_by", c.actor); if (c.device) r.set("device_id", c.device); } }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
const EARN = ["regular_cents", "overtime_cents", "double_cents", "salary_cents", "sick_cents", "stat_cents", "other_earnings_cents", "vacation_pay_cents"];
const DED = ["cpp_cents", "cpp2_cents", "ei_cents", "tax_cents", "other_deductions_cents"];
const LINE_NUM = ["rate_cents", "regular_min", "overtime_min", "double_min", "sick_min", "unpaid_min", "regular_cents", "overtime_cents", "double_cents", "salary_cents", "sick_cents", "unpaid_cents",
  "stat_cents", "other_earnings_cents", "vacation_pay_cents", "gross_cents", "cpp_cents", "cpp2_cents", "ei_cents", "tax_cents", "other_deductions_cents", "reimbursements_cents", "net_cents", "cpp_er_cents", "ei_er_cents", "insurable_min"];

function lineView(r) {
  const o = { id: r.id, run: r.getString("run"), employee: r.getString("employee"), user: r.getString("user"), legal_name: r.getString("legal_name"), pay_type: r.getString("pay_type"),
    vacation_pct: r.getFloat("vacation_pct"), deductions_entered: r.getBool("deductions_entered"), reimbursed: j(r, "reimbursed", []), timesheet: r.getString("timesheet"), note: r.getString("note") };
  LINE_NUM.forEach((k) => { o[k] = r.getInt(k); });
  o.deductions_cents = DED.reduce((a, k) => a + o[k], 0);
  return o;
}
function runView(r) {
  return { id: r.id, number: r.getString("number"), period_start: r.getString("period_start"), period_end: r.getString("period_end"), pay_date: r.getString("pay_date"), status: r.getString("status"),
    gross_cents: r.getInt("gross_cents"), deductions_cents: r.getInt("deductions_cents"), net_cents: r.getInt("net_cents"), reimbursements_cents: r.getInt("reimbursements_cents"), employer_cents: r.getInt("employer_cents"),
    finalized_by: r.getString("finalized_by"), finalized_at: r.getString("finalized_at"), paid_method: r.getString("paid_method"), paid_ref: r.getString("paid_ref"), paid_day: r.getString("paid_day"), note: r.getString("note") };
}
const linesOf = (app, runId) => app.findRecordsByFilter("payroll_lines", "run = {:r} && deleted_at = ''", "legal_name", 0, 0, { r: runId });

// Earnings, gross and net of a line from its hours, rate and what was entered
function recompute(r) {
  const rate = r.getInt("rate_cents"), salary = r.getString("pay_type") === "salary";
  if (!salary) {
    const base = r.getInt("regular_cents") + r.getInt("overtime_cents") + r.getInt("double_cents") + r.getInt("sick_cents") + r.getInt("stat_cents") + r.getInt("other_earnings_cents");
    r.set("vacation_pay_cents", Math.round((base * r.getFloat("vacation_pct")) / 100));
  }
  const gross = EARN.reduce((a, k) => a + r.getInt(k), 0) - r.getInt("unpaid_cents");
  const ded = DED.reduce((a, k) => a + r.getInt(k), 0);
  r.set("gross_cents", gross);
  r.set("net_cents", gross - ded + r.getInt("reimbursements_cents"));
  r.set("cpp_er_cents", r.getInt("cpp_cents") + r.getInt("cpp2_cents"));
  r.set("ei_er_cents", Math.round(r.getInt("ei_cents") * 1.4));
  return rate;
}
function totals(app, run) {
  const t = { gross_cents: 0, deductions_cents: 0, net_cents: 0, reimbursements_cents: 0, employer_cents: 0 };
  linesOf(app, run.id).forEach((l) => {
    t.gross_cents += l.getInt("gross_cents"); t.net_cents += l.getInt("net_cents"); t.reimbursements_cents += l.getInt("reimbursements_cents");
    t.deductions_cents += DED.reduce((a, k) => a + l.getInt(k), 0); t.employer_cents += l.getInt("cpp_er_cents") + l.getInt("ei_er_cents");
  });
  Object.keys(t).forEach((k) => run.set(k, t[k]));
}

// Hourly people with hours in the period but no approved time sheet
function waiting(app, P) {
  const out = [];
  app.findRecordsByFilter("employees", "status != 'ended' && pay_type = 'hourly' && deleted_at = ''", "legal_name", 0, 0).forEach((e) => {
    const ts = app.findRecordsByFilter("timesheets", "user = {:u} && period_start = {:s} && deleted_at = ''", "", 1, 0, { u: e.getString("user"), s: P.start })[0];
    if (ts && ts.getString("status") === "approved") return;
    if (app.findRecordsByFilter("shifts", "user = {:u} && day >= {:f} && day <= {:t} && deleted_at = ''", "", 1, 0, { u: e.getString("user"), f: P.start, t: P.end }).length) out.push({ user: e.getString("user"), legal_name: e.getString("legal_name"), status: ts ? ts.getString("status") : "to_approve" });
  });
  return out;
}

function create(app, c, b) {
  const P = TS().period(app, b.period);
  if (!ymdOk(b.pay_date)) bad("Choose the pay date.");
  if (P.end > T().localDay(Date.now())) bad("The pay period ends on " + P.end + ".");
  if (app.findRecordsByFilter("payroll_runs", "period_start = {:s} && status != 'cancelled' && deleted_at = ''", "", 1, 0, { s: P.start }).length) bad("There is already a payroll for " + P.start + " to " + P.end + ".");
  const run = new Record(app.findCollectionByNameOrId("payroll_runs"));
  run.load({ number: "PR-" + ("000000" + require(`${__hooks}/lib/sales.js`).nextNumber(app, "pr", c)).slice(-6), period_start: P.start, period_end: P.end, pay_date: b.pay_date, status: "draft", note: String(b.note || "").substring(0, 500) });
  stamp(run, c); app.save(run);
  const perYear = PER_YEAR[P.frequency] || 26;
  const weeks = (Date.parse(P.end + "T00:00:00Z") - Date.parse(P.start + "T00:00:00Z")) / 86400000 / 7 + 1 / 7;
  let n = 0;
  app.findRecordsByFilter("employees", "deleted_at = ''", "legal_name", 0, 0).forEach((e) => {
    if (e.getString("status") === "ended" && (!e.getString("end_date") || e.getString("end_date") < P.start)) return;
    if (e.getString("start_date") && e.getString("start_date") > P.end) return;
    const user = e.getString("user"), rate = e.getInt("pay_rate_cents"), salary = e.getString("pay_type") === "salary";
    const ts = app.findRecordsByFilter("timesheets", "user = {:u} && period_start = {:s} && status = 'approved' && deleted_at = ''", "", 1, 0, { u: user, s: P.start })[0] || null;
    const leave = { vacation: 0, sick: 0, unpaid: 0 };
    app.findRecordsByFilter("leave_ledger", "employee = {:e} && source = 'taken' && day >= {:f} && day <= {:t} && deleted_at = ''", "", 0, 0, { e: e.id, f: P.start, t: P.end })
      .forEach((l) => { leave[l.getString("kind")] -= l.getFloat("hours"); });
    const L = new Record(app.findCollectionByNameOrId("payroll_lines"));
    L.load({ run: run.id, employee: e.id, user: user, legal_name: e.getString("legal_name"), pay_type: e.getString("pay_type"), rate_cents: rate, vacation_pct: salary ? 0 : e.getFloat("vacation_pct"),
      regular_min: ts ? ts.getInt("regular_min") : 0, overtime_min: ts ? ts.getInt("overtime_min") : 0, double_min: ts ? ts.getInt("double_min") : 0, sick_min: Math.round(leave.sick * 60), unpaid_min: Math.round(leave.unpaid * 60),
      timesheet: ts ? ts.id : "", deductions_entered: false, reimbursed: [] });
    const hourly = salary ? rate / 52 / (e.getFloat("hours_per_week") || 40) : rate;
    if (salary) {
      L.set("salary_cents", Math.round(rate / perYear));
      L.set("unpaid_cents", Math.round(hourly * leave.unpaid));
      L.set("insurable_min", Math.round((e.getFloat("hours_per_week") || 40) * weeks * 60) + L.getInt("overtime_min") + L.getInt("double_min") - L.getInt("unpaid_min"));
    } else {
      L.set("regular_cents", Math.round((rate * L.getInt("regular_min")) / 60));
      L.set("sick_cents", Math.round(rate * leave.sick));
      L.set("insurable_min", L.getInt("regular_min") + L.getInt("overtime_min") + L.getInt("double_min") + L.getInt("sick_min"));
    }
    L.set("overtime_cents", Math.round((hourly * 1.5 * L.getInt("overtime_min")) / 60));
    L.set("double_cents", Math.round((hourly * 2 * L.getInt("double_min")) / 60));
    // Expenses paid back with the next pay, not yet in a payroll
    const ex = app.findRecordsByFilter("expenses", "claimant = {:u} && status = 'reimbursed' && reimbursed_with = 'next_pay' && payroll = '' && deleted_at = ''", "number", 0, 0, { u: user });
    L.set("reimbursements_cents", ex.reduce((a, x) => a + x.getInt("amount_cents"), 0));
    L.set("reimbursed", ex.map((x) => x.getString("number")));
    recompute(L);
    if (!L.getInt("gross_cents") && !L.getInt("reimbursements_cents")) return;
    stamp(L, c); app.save(L); n++;
    ex.forEach((x) => { x.set("payroll", run.id); stamp(x, c); app.save(x); });
  });
  if (!n) bad("Nobody to pay for " + P.start + " to " + P.end + " (time sheets approved? employee records with pay?).");
  totals(app, run); stamp(run, c); app.save(run);
  return get(app, c, run.id);
}

function get(app, c, id) {
  const run = app.findRecordById("payroll_runs", id);
  const v = runView(run);
  v.lines = linesOf(app, run.id).map(lineView);
  if (v.status === "draft") v.waiting = waiting(app, { start: v.period_start, end: v.period_end });
  return v;
}
function list(app, c) {
  const cur = TS().period(app, ""), today = T().localDay(Date.now());
  const P = cur.end <= today ? cur : TS().period(app, T().addDays(cur.start, -1));          // the last period that has ended
  return { items: app.findRecordsByFilter("payroll_runs", "deleted_at = ''", "-period_start", 100, 0).map(runView), last_period: P, waiting: waiting(app, P),
    employees: app.findRecordsByFilter("employees", "deleted_at = ''", "legal_name", 0, 0).map((e) => ({ id: e.id, legal_name: e.getString("legal_name"), status: e.getString("status"), end_date: e.getString("end_date") })) };
}

const ENTERED = ["stat_cents", "other_earnings_cents", "cpp_cents", "cpp2_cents", "ei_cents", "tax_cents", "other_deductions_cents"];
function updateLine(app, c, runId, lineId, b) {
  const run = app.findRecordById("payroll_runs", runId);
  if (run.getString("status") !== "draft") bad("This payroll is " + run.getString("status") + ": no more changes.");
  const L = app.findRecordById("payroll_lines", lineId);
  if (L.getString("run") !== run.id) bad("Not a line of this payroll.");
  ENTERED.forEach((k) => {
    if (b[k] === undefined || b[k] === null || b[k] === "") return;
    const v = Math.round(Number(b[k]));
    if (!isFinite(v) || v < 0) bad("Amounts are 0 or more.");
    L.set(k, v);
  });
  if (DED.some((k) => b[k] !== undefined && b[k] !== null && b[k] !== "")) L.set("deductions_entered", true);
  if (b.note !== undefined) L.set("note", String(b.note).substring(0, 300));
  recompute(L);
  if (L.getInt("net_cents") < 0) bad("The deductions are more than the pay.");
  stamp(L, c); app.save(L);
  totals(app, run); stamp(run, c); app.save(run);
  return get(app, c, run.id);
}

function finalize(app, c, id) {
  const run = app.findRecordById("payroll_runs", id);
  if (run.getString("status") !== "draft") bad("It is " + run.getString("status") + ".");
  const lines = linesOf(app, run.id);
  const missing = lines.filter((l) => !l.getBool("deductions_entered")).map((l) => l.getString("legal_name"));
  if (missing.length) bad("Enter the deductions for " + missing.join(", ") + " (from the CRA payroll calculator; 0 when there are none).");
  run.set("status", "finalized"); run.set("finalized_by", c.user ? c.user.getString("name") : c.actor); run.set("finalized_at", new DateTime());
  stamp(run, c); app.save(run);
  const I = require(`${__hooks}/lib/inbox.js`);
  const money = (x) => "$" + (x / 100).toFixed(2);
  lines.forEach((l) => {
    if (l.getString("timesheet")) { try { const ts = app.findRecordById("timesheets", l.getString("timesheet")); ts.set("status", "paid"); ts.set("payroll", run.id); stamp(ts, c); app.save(ts); } catch (_) { /* gone */ } }
    I.deliver(app, l.getString("user"), "report", "paystub:" + l.id, "Your pay stub for " + run.getString("period_start") + " to " + run.getString("period_end"),
      "Gross " + money(l.getInt("gross_cents")) + ", net " + money(l.getInt("net_cents")) + ", paid on " + run.getString("pay_date") + ". Home → People → Me → Pay stubs.", { run: run.id }, "people");
  });
  return get(app, c, run.id);
}

function paid(app, c, id, b) {
  const run = app.findRecordById("payroll_runs", id);
  if (run.getString("status") !== "finalized") bad(run.getString("status") === "paid" ? "Already recorded as paid." : "Finalise it first.");
  if (["direct_deposit", "e_transfer", "cheque", "cash"].indexOf(b.method) < 0) bad("How was it paid?");
  run.set("status", "paid"); run.set("paid_method", b.method); run.set("paid_ref", String(b.reference || "").substring(0, 80)); run.set("paid_day", ymdOk(b.day) ? b.day : run.getString("pay_date"));
  stamp(run, c); app.save(run);
  return get(app, c, run.id);
}

function cancel(app, c, id) {
  const run = app.findRecordById("payroll_runs", id);
  if (run.getString("status") !== "draft") bad("Only a draft can be cancelled.");
  linesOf(app, run.id).forEach((l) => { l.set("deleted_at", new DateTime()); stamp(l, c); app.save(l); });
  app.findRecordsByFilter("expenses", "payroll = {:r}", "", 0, 0, { r: run.id }).forEach((x) => { x.set("payroll", ""); stamp(x, c); app.save(x); });
  run.set("status", "cancelled"); stamp(run, c); app.save(run);
  return runView(run);
}

// The person's pay stubs (finalised or paid), with year-to-date by pay date
function stubs(app, user) {
  const lines = app.findRecordsByFilter("payroll_lines", "user = {:u} && deleted_at = '' && (run.status = 'finalized' || run.status = 'paid')", "", 0, 0, { u: user }).map((l) => {
    const run = app.findRecordById("payroll_runs", l.getString("run"));
    return Object.assign(lineView(l), { number: run.getString("number"), period_start: run.getString("period_start"), period_end: run.getString("period_end"), pay_date: run.getString("pay_date"), run_status: run.getString("status") });
  }).sort((a, b) => (a.pay_date < b.pay_date ? -1 : 1));
  const ytd = {};
  lines.forEach((l) => {
    const y = l.pay_date.substring(0, 4);
    const t = ytd[y] || (ytd[y] = { gross_cents: 0, cpp_cents: 0, cpp2_cents: 0, ei_cents: 0, tax_cents: 0, net_cents: 0, vacation_pay_cents: 0 });
    Object.keys(t).forEach((k) => { t[k] += l[k]; });
    l.ytd = Object.assign({}, t);
  });
  return { items: lines.reverse() };
}

// T4 (by pay date in the year): box 14 income, 16 CPP, 16A CPP2, 18 EI, 22 tax, 24 EI insurable, 26 CPP pensionable
function t4(app, year) {
  const y = /^\d{4}$/.test(String(year || "")) ? String(year) : String(new Date().getFullYear() - 1);
  const by = {};
  app.findRecordsByFilter("payroll_lines", "deleted_at = '' && (run.status = 'finalized' || run.status = 'paid') && run.pay_date >= {:f} && run.pay_date <= {:t}", "", 0, 0, { f: y + "-01-01", t: y + "-12-31" }).forEach((l) => {
    const k = l.getString("employee");
    const x = by[k] || (by[k] = { employee: k, legal_name: l.getString("legal_name"), box14: 0, box16: 0, box16a: 0, box18: 0, box22: 0, box24: 0, box26: 0, pays: 0 });
    x.box14 += l.getInt("gross_cents"); x.box16 += l.getInt("cpp_cents"); x.box16a += l.getInt("cpp2_cents"); x.box18 += l.getInt("ei_cents"); x.box22 += l.getInt("tax_cents");
    x.box24 += l.getInt("gross_cents"); x.box26 += l.getInt("gross_cents"); x.pays++;
  });
  const items = Object.keys(by).map((k) => {
    const x = by[k];
    try {
      const e = app.findRecordById("employees", k);
      Object.assign(x, { sin: e.getString("sin_last3") ? "•••-•••-" + e.getString("sin_last3") : "", address: [e.getString("street"), e.getString("city"), e.getString("province"), e.getString("postal_code")].filter(Boolean).join(", ") });
    } catch (_) { /* gone */ }
    return x;
  }).sort((a, b) => a.legal_name.localeCompare(b.legal_name));
  return { year: y, items: items, note: "Box 24 and 26 are shown uncapped: the CRA maximums for the year apply (the accountant checks them). The full SIN: People → the person → Show." };
}

// ROE data (Record of Employment) for an employee who left: block 10 first day, 11 last day paid, 12 final pay
// period end, 15A insurable hours and 15B/15C insurable earnings by pay period (latest first), 17A vacation pay
function roe(app, employeeId) {
  const e = app.findRecordById("employees", employeeId);
  const lines = app.findRecordsByFilter("payroll_lines", "employee = {:e} && deleted_at = '' && (run.status = 'finalized' || run.status = 'paid')", "", 0, 0, { e: e.id })
    .map((l) => { const run = app.findRecordById("payroll_runs", l.getString("run")); return { end: run.getString("period_end"), start: run.getString("period_start"), l: l }; })
    .sort((a, b) => (a.end < b.end ? 1 : -1));
  if (!lines.length) bad("No pay recorded for " + e.getString("legal_name") + ".");
  const last = lines[0].end;
  const since = T().addDays(last, -53 * 7);
  const recent = lines.filter((x) => x.end > since);
  const freq = (require(`${__hooks}/lib/auth.js`).setting(app, "payroll.period", {}) || {}).frequency || "biweekly";
  const n = { weekly: 53, biweekly: 27, semimonthly: 25, monthly: 13 }[freq] || 27;
  return { legal_name: e.getString("legal_name"), sin: e.getString("sin_last3") ? "•••-•••-" + e.getString("sin_last3") : "", job_title: e.getString("job_title"), pay_period_type: freq,
    block10_first_day: e.getString("start_date"), block11_last_day_paid: e.getString("end_date") || last, block12_final_period_end: last,
    block15a_insurable_hours: Math.round(recent.reduce((a, x) => a + x.l.getInt("insurable_min"), 0) / 60),
    block15c_earnings: lines.slice(0, n).map((x, i) => ({ period: i + 1, period_end: x.end, insurable_cents: x.l.getInt("gross_cents") })),
    block15b_total_cents: lines.slice(0, n).reduce((a, x) => a + x.l.getInt("gross_cents"), 0),
    block17a_vacation_pay_cents: lines[0].l.getInt("vacation_pay_cents"), status: e.getString("status") };
}

module.exports = { create, get, list, updateLine, finalize, paid, cancel, stubs, t4, roe, PER_YEAR };

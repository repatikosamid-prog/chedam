// Time sheets (P4 step 4; FR-9.08). Per person per pay period (setting payroll.period): the paid hours from
// the punches split into regular, overtime and double time (BC daily 8/12 and weekly 40, by whole weeks, so
// a week across two periods is split right), leave taken, and flags to check: no punch-out, no meal break,
// short rest, overtime, fixed or added punches, shifts not on the roster, late starts (over 10 minutes),
// rostered shifts with no punches (no-show). Managers (timeclock.manage) approve after the period ends
// (a note is needed when anything is flagged; never with a shift still open; not their own unless owner).
// An approved time sheet keeps a snapshot and locks those punches; reopening needs a reason and is refused
// once payroll (step 5) has paid it.

const T = () => require(`${__hooks}/lib/timeclock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) { r.set("created_by", c.actor); if (c.device) r.set("device_id", c.device); } }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const utc = (d) => Date.parse(d + "T00:00:00Z");
const FLAG_TEXT = { no_out: "No punch-out", no_meal: "No meal break", short_rest: "Less than 8 hours off", edited: "Punches fixed", added: "Added by a manager",
  overtime: "Overtime", unscheduled: "Not on the roster", late: "Started late", no_show: "On the roster, no punches" };

function period(app, day) {
  const p = setting(app, "payroll.period", {}) || {};
  const d = ymdOk(day) ? day : T().localDay(Date.now());
  const [y, m, dd] = d.split("-").map(Number);
  const freq = p.frequency || "biweekly";
  if (freq === "semimonthly") {
    const last = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, "0");
    return dd <= 15 ? { start: y + "-" + mm + "-01", end: y + "-" + mm + "-15", frequency: freq } : { start: y + "-" + mm + "-16", end: y + "-" + mm + "-" + last, frequency: freq };
  }
  if (freq === "monthly") { const mm = String(m).padStart(2, "0"); return { start: y + "-" + mm + "-01", end: y + "-" + mm + "-" + new Date(y, m, 0).getDate(), frequency: freq }; }
  const n = freq === "weekly" ? 7 : 14;
  const anchor = ymdOk(p.anchor) ? p.anchor : "2026-01-04";
  const diff = Math.round((utc(d) - utc(anchor)) / 86400000);
  const k = Math.floor(diff / n);
  const start = T().addDays(anchor, k * n);
  return { start: start, end: T().addDays(start, n - 1), frequency: freq };
}

function employeeOf(app, user) { return app.findRecordsByFilter("employees", "user = {:u} && deleted_at = ''", "", 1, 0, { u: user })[0] || null; }

// The live time sheet of one person for a period
function compute(app, user, P, now) {
  now = now || Date.now();
  const R = T().rules(app), today = T().localDay(now);
  const w0 = T().weekStart(P.start, R.week_starts), w1 = T().addDays(T().weekStart(P.end, R.week_starts), 6);
  const all = T().shiftsOf(app, user, w0, w1);
  const eligible = T().otEligible(app, user);
  const days = {};
  const weeks = {};
  all.forEach((s) => { const w = T().weekStart(s.day, R.week_starts); (weeks[w] = weeks[w] || []).push(s); });
  Object.keys(weeks).forEach((w) => { const sp = T().split(weeks[w], now, R); Object.keys(sp.days).forEach((d) => { if (d >= P.start && d <= P.end) days[d] = sp.days[d]; }); });
  const out = { user: user, period_start: P.start, period_end: P.end, paid_min: 0, regular_min: 0, overtime_min: 0, double_min: 0, flags: [], shifts: [], days: days, blocking: false };
  Object.keys(days).forEach((d) => {
    const x = days[d];
    out.paid_min += x.paid_min;
    if (eligible) { out.regular_min += x.regular_min; out.overtime_min += x.overtime_min; out.double_min += x.double_min; if (x.overtime_min + x.double_min) out.flags.push({ day: d, kind: "overtime", text: FLAG_TEXT.overtime + " " + Math.round((x.overtime_min + x.double_min) / 6) / 10 + " h" }); }
    else out.regular_min += x.paid_min;
  });
  const roster = app.findRecordsByFilter("roster_shifts", "user = {:u} && day >= {:f} && day <= {:t} && status = 'published' && deleted_at = ''", "day,start", 0, 0, { u: user, f: P.start, t: P.end })
    .map((r) => ({ day: r.getString("day"), start: r.getString("start"), end: r.getString("end") }));
  const mine = all.filter((s) => s.day >= P.start && s.day <= P.end);
  mine.forEach((s) => {
    s.calc = T().calc(s, now, R);
    const f = [];
    if (s.status !== "closed") { f.push("no_out"); out.blocking = true; }
    if (s.calc.missed_meal) f.push("no_meal");
    if ((s.alerts || []).some((a) => a.kind === "short_rest")) f.push("short_rest");
    if (s.edits.length && !s.added_by_manager) f.push("edited");
    if (s.added_by_manager) f.push("added");
    const plan = roster.filter((r) => r.day === s.day);
    if (!plan.length) f.push("unscheduled");
    else {
      const tin = new Date(T().ms(s.clock_in)), mins = tin.getHours() * 60 + tin.getMinutes();
      const near = plan.map((r) => { const [h, m] = r.start.split(":").map(Number); return h * 60 + m; }).sort((a, b) => Math.abs(a - mins) - Math.abs(b - mins))[0];
      if (mins - near > 10) f.push("late");
    }
    s.flags = f;
    f.forEach((k) => out.flags.push({ day: s.day, kind: k, shift: s.id, text: FLAG_TEXT[k] }));
    out.shifts.push(s);
  });
  roster.forEach((r) => { if (r.day < today && !mine.some((s) => s.day === r.day)) out.flags.push({ day: r.day, kind: "no_show", text: FLAG_TEXT.no_show + " (" + r.start + "-" + r.end + ")" }); });
  out.flags.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  out.roster = roster;
  const e = employeeOf(app, user);
  out.leave = { vacation: 0, sick: 0, unpaid: 0 };
  if (e) app.findRecordsByFilter("leave_ledger", "employee = {:e} && source = 'taken' && day >= {:f} && day <= {:t} && deleted_at = ''", "", 0, 0, { e: e.id, f: P.start, t: P.end })
    .forEach((l) => { out.leave[l.getString("kind")] = Math.round((out.leave[l.getString("kind")] - l.getFloat("hours")) * 100) / 100; });
  out.overtime_eligible = eligible;
  return out;
}

function stored(app, user, start) { return app.findRecordsByFilter("timesheets", "user = {:u} && period_start = {:s} && deleted_at = ''", "", 1, 0, { u: user, s: start })[0] || null; }
function storedView(r) {
  return { id: r.id, user: r.getString("user"), user_name: r.getString("user_name"), period_start: r.getString("period_start"), period_end: r.getString("period_end"), status: r.getString("status"),
    paid_min: r.getInt("paid_min"), regular_min: r.getInt("regular_min"), overtime_min: r.getInt("overtime_min"), double_min: r.getInt("double_min"), leave: j(r, "leave", {}), flags: j(r, "flags", []),
    note: r.getString("note"), approved_by: r.getString("approved_by"), approved_at: r.getString("approved_at"), reopen_reason: r.getString("reopen_reason"), payroll: r.getString("payroll") };
}
function nameOf(app, id) { try { return app.findRecordById("users", id).getString("name"); } catch (_) { return ""; } }

// One person: the stored (approved/paid) sheet or the live one
function one(app, user, P) {
  const r = stored(app, user, P.start);
  if (r && r.getString("status") !== "reopened") {
    const v = storedView(r);
    v.shifts = j(r, "snapshot", []);
    return v;
  }
  const v = compute(app, user, P);
  v.user_name = nameOf(app, user);
  v.status = r ? "reopened" : "to_approve";
  if (r) { v.reopen_reason = r.getString("reopen_reason"); v.id = r.id; }
  return v;
}

function list(app, c, q) {
  const P = period(app, q.period);
  const ids = {};
  app.findRecordsByFilter("shifts", "day >= {:f} && day <= {:t} && deleted_at = ''", "", 0, 0, { f: P.start, t: P.end }).forEach((s) => { ids[s.getString("user")] = true; });
  app.findRecordsByFilter("timesheets", "period_start = {:s} && deleted_at = ''", "", 0, 0, { s: P.start }).forEach((s) => { ids[s.getString("user")] = true; });
  app.findRecordsByFilter("roster_shifts", "day >= {:f} && day <= {:t} && status = 'published' && deleted_at = ''", "", 0, 0, { f: P.start, t: P.end }).forEach((s) => { ids[s.getString("user")] = true; });
  const people = Object.keys(ids).map((u) => { const v = one(app, u, P); delete v.shifts; delete v.days; delete v.roster; return v; }).sort((a, b) => a.user_name.localeCompare(b.user_name));
  return { period: P, previous: period(app, T().addDays(P.start, -1)), next: period(app, T().addDays(P.end, 1)), ended: P.end <= T().localDay(Date.now()), people: people };
}
function detail(app, c, user, q) { return Object.assign(one(app, user, period(app, q.period)), { period: period(app, q.period) }); }

function approve(app, c, b) {
  const access = require(`${__hooks}/lib/access.js`);
  const P = period(app, b.period);
  const user = String(b.user || "");
  const name = nameOf(app, user);
  if (!name) bad("Choose the person.");
  if (c.user && c.user.id === user && !access.isOwner(app, c.user)) throw new ForbiddenError("Someone else approves your own time sheet.");
  if (P.end > T().localDay(Date.now())) bad("The pay period ends on " + P.end + "; approve it then.");
  let r = stored(app, user, P.start);
  if (r && r.getString("status") !== "reopened") bad("Already approved.");
  const v = compute(app, user, P);
  if (v.blocking) bad(name + " has a shift with no punch-out: fix it first.");
  const note = String(b.note || "").trim();
  if (v.flags.length && !note) bad("Some things are flagged: say what you checked.");
  if (!r) r = new Record(app.findCollectionByNameOrId("timesheets"));
  r.load({ user: user, user_name: name, period_start: P.start, period_end: P.end, status: "approved", paid_min: v.paid_min, regular_min: v.regular_min, overtime_min: v.overtime_min,
    double_min: v.double_min, leave: v.leave, flags: v.flags, snapshot: v.shifts.map((s) => ({ id: s.id, day: s.day, clock_in: s.clock_in, clock_out: s.clock_out, breaks: s.breaks, paid_min: s.calc.paid_min, flags: s.flags })),
    note: note.substring(0, 500), approved_by: c.user ? c.user.getString("name") : c.actor, approved_at: new DateTime(), reopen_reason: "" });
  stamp(r, c); app.save(r);
  return storedView(r);
}

function reopen(app, c, b) {
  const P = period(app, b.period);
  const r = stored(app, String(b.user || ""), P.start);
  if (!r || r.getString("status") !== "approved") bad(r && r.getString("status") === "paid" ? "It is already paid; correct it in the next pay." : "It is not approved.");
  const reason = String(b.reason || "").trim();
  if (!reason) bad("Say why it is reopened.");
  r.set("status", "reopened"); r.set("reopen_reason", reason.substring(0, 300));
  stamp(r, c); app.save(r);
  return storedView(r);
}

// Is this person's day inside an approved or paid time sheet? (punch fixes are refused then)
function locked(app, user, day) {
  return app.findRecordsByFilter("timesheets", "user = {:u} && period_start <= {:d} && period_end >= {:d} && (status = 'approved' || status = 'paid') && deleted_at = ''", "", 1, 0, { u: user, d: day }).length > 0;
}

function mine(app, c, q) {
  if (!c.user) bad("Sign in as a person.");
  const P = period(app, q.period);
  const v = one(app, c.user.id, P);
  return Object.assign(v, { period: P, previous: period(app, T().addDays(P.start, -1)), next: period(app, T().addDays(P.end, 1)) });
}

module.exports = { period, compute, list, detail, approve, reopen, locked, mine, FLAG_TEXT };

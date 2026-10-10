// Time clock (P4 step 2; FR-9.04-9.06, BR-30-32, P4-e).
// A shift starts at clock-in and holds its breaks; every time is the hub's clock (BR-30), never the device's.
// Punch on any paired device with the PIN (the device stays signed in as whoever it was), or on your own
// signed-in device. BC rules (setting timeclock.rules, BR-31): a meal break of 30 minutes before 5 hours of
// work (only a break that long resets the count; shorter breaks are paid rest breaks), overtime 1.5× after
// 8 hours a day or 40 a week, double after 12 a day, 8 hours off between shifts. Alerts come **before**
// (warn_minutes ahead) to the person and to managers (inbox "alert"). A shift belongs to the day it started.
// Fixing punches (timeclock.manage, with a reason; not your own unless owner) keeps the original times and
// every change (FR-9.06). Time sheets (step 4) and payroll (step 5) use the paid minutes and the split.

const st = () => require(`${__hooks}/lib/stock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) { r.set("created_by", c.actor); if (c.device) r.set("device_id", c.device); } }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const MIN = 60000;

const DEFAULTS = { meal_after_hours: 5, meal_minutes: 30, meal_paid: false, daily_ot_hours: 8, daily_dt_hours: 12, weekly_ot_hours: 40, rest_hours: 8, warn_minutes: 30, week_starts: 0 };
function rules(app) { return Object.assign({}, DEFAULTS, setting(app, "timeclock.rules", {}) || {}); }

const ms = (s) => { if (!s) return 0; const t = Date.parse(String(s).replace(" ", "T")); return isNaN(t) ? 0 : t; };
const db = (t) => new Date(t).toISOString().replace("T", " ");
const p2 = (n) => (n < 10 ? "0" : "") + n;
function localDay(t) { const d = new Date(t); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
function hhmm(t) { const d = new Date(t); return p2(d.getHours()) + ":" + p2(d.getMinutes()); }
function weekStart(day, ws) {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() - ((x.getDay() - (ws || 0) + 7) % 7));
  return localDay(x.getTime());
}
function addDays(day, n) { const [y, m, d] = day.split("-").map(Number); return localDay(new Date(y, m - 1, d + n).getTime()); }

// One shift's minutes at time `now` (an open shift counts up to now)
function calc(s, now, R) {
  const tin = ms(s.clock_in), tout = s.clock_out ? ms(s.clock_out) : now;
  const breaks = (s.breaks || []).map((b) => ({ start: ms(b.start), end: b.end ? ms(b.end) : Math.min(now, tout) })).sort((a, b) => a.start - b.start);
  const mealLen = R.meal_minutes * MIN, limit = R.meal_after_hours * 60 * MIN;
  let unpaid = 0, breakMin = 0, anchor = tin, missedMeal = false, meals = 0;
  breaks.forEach((b) => {
    const len = Math.max(0, b.end - b.start);
    breakMin += len;
    if (b.start - anchor > limit) missedMeal = true;
    if (len >= mealLen) { meals++; anchor = b.end; if (!R.meal_paid) unpaid += len; }
  });
  const onBreak = s.status === "on_break";
  if (!onBreak && tout - anchor > limit) missedMeal = true;
  const total = Math.max(0, tout - tin);
  return { total_min: Math.round(total / MIN), break_min: Math.round(breakMin / MIN), paid_min: Math.round((total - unpaid) / MIN), meals: meals, missed_meal: missedMeal,
    since_meal_min: onBreak ? 0 : Math.round((tout - anchor) / MIN), meal_due_at: onBreak ? 0 : anchor + limit };
}

// Overtime split of a week of shifts (sorted by clock_in): per day, regular up to 8 h, 1.5× to 12, 2× after;
// regular hours past 40 in the week become 1.5×. Minutes.
function split(list, now, R) {
  const byDay = {};
  list.forEach((s) => { byDay[s.day] = (byDay[s.day] || 0) + calc(s, now, R).paid_min; });
  let weekReg = 0;
  const out = { regular_min: 0, overtime_min: 0, double_min: 0, days: {} };
  Object.keys(byDay).sort().forEach((d) => {
    const m = byDay[d];
    let reg = Math.min(m, R.daily_ot_hours * 60), ot = Math.min(Math.max(m - R.daily_ot_hours * 60, 0), (R.daily_dt_hours - R.daily_ot_hours) * 60), dt = Math.max(m - R.daily_dt_hours * 60, 0);
    const room = Math.max(0, R.weekly_ot_hours * 60 - weekReg);
    if (reg > room) { ot += reg - room; reg = room; }
    weekReg += reg;
    out.days[d] = { paid_min: m, regular_min: reg, overtime_min: ot, double_min: dt };
    out.regular_min += reg; out.overtime_min += ot; out.double_min += dt;
  });
  return out;
}

function raw(r) {
  return { id: r.id, user: r.getString("user"), user_name: r.getString("user_name"), day: r.getString("day"), clock_in: r.getString("clock_in"), clock_out: r.getString("clock_out"),
    breaks: j(r, "breaks", []), status: r.getString("status"), in_device: r.getString("in_device"), out_device: r.getString("out_device"), original: j(r, "original", null),
    edits: j(r, "edits", []), added_by_manager: r.getBool("added_by_manager"), alerts: j(r, "alerts", []), note: r.getString("note") };
}
function shiftsOf(app, user, from, to) {
  return app.findRecordsByFilter("shifts", "user = {:u} && day >= {:f} && day <= {:t} && deleted_at = ''", "clock_in", 0, 0, { u: user, f: from, t: to }).map(raw);
}
function openShift(app, user) {
  return app.findRecordsByFilter("shifts", "user = {:u} && status != 'closed' && deleted_at = ''", "-clock_in", 1, 0, { u: user })[0] || null;
}
function otEligible(app, user) {
  const e = app.findRecordsByFilter("employees", "user = {:u} && deleted_at = ''", "", 1, 0, { u: user })[0];
  return e ? e.getBool("overtime_eligible") : true;
}

// The person's clock: the open shift, today and this week, and what is coming (alerts before they happen)
function status(app, user, now) {
  now = now || Date.now();
  const R = rules(app), today = localDay(now), ws = weekStart(today, R.week_starts);
  const week = shiftsOf(app, user, ws, addDays(ws, 6));
  const o = openShift(app, user);
  const open = o ? raw(o) : null;
  const sp = split(week, now, R);
  const todayMin = (sp.days[open ? open.day : today] || { paid_min: 0 }).paid_min;
  const alerts = [];
  const warn = R.warn_minutes * MIN;
  if (open) {
    const c = calc(open, now, R);
    if (open.status === "open") {
      if (now >= c.meal_due_at) alerts.push({ kind: "meal", level: "bad", text: "Meal break overdue: no " + R.meal_minutes + "-minute break in " + R.meal_after_hours + " hours (since " + hhmm(c.meal_due_at) + ")" });
      else if (now >= c.meal_due_at - warn) alerts.push({ kind: "meal_soon", level: "warn", text: "Take a " + R.meal_minutes + "-minute meal break by " + hhmm(c.meal_due_at) });
      const eligible = otEligible(app, user);
      const dayLeft = R.daily_ot_hours * 60 * MIN - todayMin * MIN, dtLeft = R.daily_dt_hours * 60 * MIN - todayMin * MIN;
      const weekLeft = R.weekly_ot_hours * 60 * MIN - (sp.regular_min * MIN);
      if (eligible) {
        if (dtLeft <= 0) alerts.push({ kind: "double", level: "bad", text: "Double time: over " + R.daily_dt_hours + " hours today" });
        else if (dayLeft <= 0) alerts.push({ kind: "overtime", level: "bad", text: "Overtime: over " + R.daily_ot_hours + " hours today" + (dtLeft <= warn ? "; double time at " + hhmm(now + dtLeft) : "") });
        else if (dayLeft <= warn) alerts.push({ kind: "overtime_soon", level: "warn", text: "Overtime starts at " + hhmm(now + dayLeft) + " (" + R.daily_ot_hours + " hours today)" });
        if (weekLeft <= 0 && dayLeft > 0) alerts.push({ kind: "week_overtime", level: "bad", text: "Overtime: over " + R.weekly_ot_hours + " hours this week" });
        else if (weekLeft > 0 && weekLeft <= warn && weekLeft < dayLeft) alerts.push({ kind: "week_overtime_soon", level: "warn", text: "Weekly overtime starts at " + hhmm(now + weekLeft) + " (" + R.weekly_ot_hours + " hours this week)" });
      }
    }
    (open.alerts || []).filter((a) => a.kind === "short_rest").forEach((a) => alerts.push({ kind: "short_rest", level: "warn", text: a.text }));
  }
  return { now: db(now), open: open ? Object.assign(open, { calc: calc(open, now, R) }) : null, today_min: todayMin, week: { from: ws, ...sp }, shifts: week.map((s) => Object.assign(s, { calc: calc(s, now, R) })),
    alerts: alerts, rules: R };
}

// in | break | back | out, by `user` (a users record), on the device named devName
function punch(app, c, user, action, devName, now) {
  now = now || Date.now();
  const R = rules(app);
  const o = openShift(app, user.id);
  if (action === "in") {
    if (o) bad("You are already clocked in (since " + hhmm(ms(o.getString("clock_in"))) + ").");
    const s = new Record(app.findCollectionByNameOrId("shifts"));
    const alerts = [];
    const last = app.findRecordsByFilter("shifts", "user = {:u} && status = 'closed' && deleted_at = ''", "-clock_out", 1, 0, { u: user.id })[0];
    if (last && now - ms(last.getString("clock_out")) < R.rest_hours * 60 * MIN) {
      alerts.push({ kind: "short_rest", at: db(now), text: "Less than " + R.rest_hours + " hours off since the last shift (ended " + hhmm(ms(last.getString("clock_out"))) + ")" });
    }
    s.load({ user: user.id, user_name: user.getString("name"), day: localDay(now), clock_in: db(now), breaks: [], status: "open", in_device: devName || "", original: null, edits: [], alerts: alerts });
    stamp(s, c); app.save(s);
    if (alerts.length) toManagers(app, alerts[0].text + ": " + user.getString("name"), "short_rest:" + s.id);
    return status(app, user.id, now);
  }
  if (!o) bad("You are not clocked in.");
  const breaks = j(o, "breaks", []);
  if (action === "break") {
    if (o.getString("status") === "on_break") bad("You are already on a break.");
    breaks.push({ start: db(now), end: "" });
    o.set("breaks", breaks); o.set("status", "on_break");
  } else if (action === "back") {
    if (o.getString("status") !== "on_break") bad("You are not on a break.");
    breaks[breaks.length - 1].end = db(now);
    o.set("breaks", breaks); o.set("status", "open");
  } else if (action === "out") {
    if (o.getString("status") === "on_break") { breaks[breaks.length - 1].end = db(now); o.set("breaks", breaks); }
    o.set("clock_out", db(now)); o.set("status", "closed"); o.set("out_device", devName || "");
  } else bad("Clock in, break, back or out.");
  stamp(o, c); app.save(o);
  return status(app, user.id, now);
}

function managers(app) {
  const access = require(`${__hooks}/lib/access.js`);
  return app.findRecordsByFilter("users", "status = 'active' && deleted_at = ''", "", 0, 0).filter((u) => access.isOwner(app, u) || access.can(app, u, "timeclock.manage"));
}
function toManagers(app, text, ref) {
  const I = require(`${__hooks}/lib/inbox.js`);
  managers(app).forEach((u) => I.deliver(app, u.id, "alert", ref, text, text, {}, "clock"));
}

// Every few minutes: alerts for open shifts, once each per shift, to the person and the managers
function check(app, now) {
  now = now || Date.now();
  const I = require(`${__hooks}/lib/inbox.js`);
  let n = 0;
  app.findRecordsByFilter("shifts", "status != 'closed' && deleted_at = ''", "", 0, 0).forEach((r) => {
    const uid = r.getString("user");
    const sent = j(r, "alerts", []);
    const st0 = status(app, uid, now);
    const fresh = st0.alerts.filter((a) => a.kind !== "short_rest" && !sent.some((x) => x.kind === a.kind));
    // Forgot to clock out: still open long after a normal day
    if (now - ms(r.getString("clock_in")) > 14 * 60 * MIN && !sent.some((x) => x.kind === "no_out")) {
      fresh.push({ kind: "no_out", level: "bad", text: "Still clocked in after 14 hours (since " + r.getString("day") + " " + hhmm(ms(r.getString("clock_in"))) + "): a missed punch-out?" });
    }
    if (!fresh.length) return;
    fresh.forEach((a) => {
      const text = a.text + ": " + r.getString("user_name");
      I.deliver(app, uid, "alert", a.kind + ":" + r.id, a.text, a.text, {}, "clock");
      managers(app).filter((u) => u.id !== uid).forEach((u) => I.deliver(app, u.id, "alert", a.kind + ":" + r.id, text, text, {}, "clock"));
      sent.push({ kind: a.kind, at: db(now), text: a.text });
      n++;
    });
    r.set("alerts", sent); r.set("updated_by", "system:clock"); r.set("@actor", "system:clock");
    app.save(r);
  });
  return { sent: n };
}

// Who is on the clock now (any paired device; names only)
function who(app, now) {
  now = now || Date.now();
  const R = rules(app);
  return { items: app.findRecordsByFilter("shifts", "status != 'closed' && deleted_at = ''", "user_name", 0, 0).map((r) => {
    const s = raw(r);
    return { user: s.user, name: s.user_name, since: s.clock_in, on_break: s.status === "on_break", worked_min: calc(s, now, R).paid_min };
  }) };
}

// Managers: shifts between two days (by person), with flags and the overtime split per week
function list(app, c, q) {
  const now = Date.now(), R = rules(app);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || "") ? q.from : weekStart(localDay(now), R.week_starts);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || "") ? q.to : addDays(from, 6);
  let f = "day >= {:f} && day <= {:t} && deleted_at = ''";
  if (q.user) f += " && user = {:u}";
  const rows = app.findRecordsByFilter("shifts", f, "user_name,clock_in", 0, 0, { f: from, t: to, u: q.user || "" }).map(raw);
  const people = {};
  rows.forEach((s) => {
    s.calc = calc(s, now, R);
    s.flags = flags(s, now);
    const p = people[s.user] || (people[s.user] = { user: s.user, name: s.user_name, shifts: [], paid_min: 0 });
    p.shifts.push(s); p.paid_min += s.calc.paid_min;
  });
  Object.keys(people).forEach((u) => {
    const p = people[u];
    // overtime by week (each week inside the range, in full)
    const weeks = {};
    p.shifts.forEach((s) => { const w = weekStart(s.day, R.week_starts); (weeks[w] = weeks[w] || []).push(s); });
    p.regular_min = 0; p.overtime_min = 0; p.double_min = 0;
    const eligible = otEligible(app, u);
    Object.keys(weeks).forEach((w) => {
      const sp = split(weeks[w], now, R);
      if (!eligible) { p.regular_min += sp.regular_min + sp.overtime_min + sp.double_min; return; }
      p.regular_min += sp.regular_min; p.overtime_min += sp.overtime_min; p.double_min += sp.double_min;
    });
    p.overtime_eligible = eligible;
  });
  return { from: from, to: to, people: Object.keys(people).map((k) => people[k]).sort((a, b) => a.name.localeCompare(b.name)), rules: R };
}
function flags(s, now) {
  const f = [];
  if (s.status !== "closed" && now - ms(s.clock_in) > 14 * 60 * MIN) f.push("no_out");
  if (s.calc.missed_meal) f.push("no_meal");
  if (s.edits.length) f.push("edited");
  if (s.added_by_manager) f.push("added");
  if ((s.alerts || []).some((a) => a.kind === "short_rest")) f.push("short_rest");
  return f;
}

function cleanTimes(b, needOut) {
  const tin = ms(b.clock_in), tout = b.clock_out ? ms(b.clock_out) : 0;
  if (!tin) bad("When did the shift start?");
  if (needOut && !tout) bad("When did it end?");
  if (tout && tout <= tin) bad("The end must be after the start.");
  if (tout && tout - tin > 24 * 60 * MIN) bad("A shift cannot be longer than 24 hours.");
  if (tin > Date.now() + 5 * MIN || tout > Date.now() + 5 * MIN) bad("Times cannot be in the future.");
  const breaks = (Array.isArray(b.breaks) ? b.breaks : []).map((x) => ({ start: ms(x.start), end: ms(x.end) })).filter((x) => x.start).sort((a, b) => a.start - b.start);
  breaks.forEach((x) => {
    if (!x.end || x.end <= x.start) bad("Each break needs a start and a later end.");
    if (x.start < tin || (tout && x.end > tout)) bad("Breaks must be inside the shift.");
  });
  for (let i = 1; i < breaks.length; i++) if (breaks[i].start < breaks[i - 1].end) bad("Breaks overlap.");
  return { tin: tin, tout: tout, breaks: breaks.map((x) => ({ start: db(x.start), end: db(x.end) })) };
}
function guard(app, c, userId) {
  const access = require(`${__hooks}/lib/access.js`);
  if (c.user && c.user.id === userId && !access.isOwner(app, c.user)) throw new ForbiddenError("Someone else fixes your own punches.");
  const reason = String((c.body && c.body.reason) || "").trim();
  if (!reason) bad("Say why (it is kept with the change).");
  return reason;
}

// Fix a shift's times (FR-9.06): the original punches are kept, and every change with who and why
function edit(app, c, id, b) {
  const r = app.findRecordById("shifts", id);
  const reason = guard(app, c, r.getString("user"));
  const t = cleanTimes(b, r.getString("status") === "closed" || !!b.clock_out);
  const before = { clock_in: r.getString("clock_in"), clock_out: r.getString("clock_out"), breaks: j(r, "breaks", []) };
  if (!j(r, "original", null)) r.set("original", before);
  const after = { clock_in: db(t.tin), clock_out: t.tout ? db(t.tout) : "", breaks: t.breaks };
  const edits = j(r, "edits", []);
  edits.push({ at: db(Date.now()), by: c.user ? c.user.getString("name") : c.actor, reason: reason.substring(0, 300), from: before, to: after });
  r.set("clock_in", after.clock_in); r.set("clock_out", after.clock_out); r.set("breaks", after.breaks); r.set("edits", edits);
  r.set("day", localDay(t.tin));
  if (t.tout) r.set("status", "closed");
  stamp(r, c); app.save(r);
  return Object.assign(raw(r), { calc: calc(raw(r), Date.now(), rules(app)) });
}

// A shift the person forgot to punch at all
function add(app, c, b) {
  let u = null;
  try { u = app.findRecordById("users", String(b.user || "")); } catch (_) { u = null; }
  if (!u) bad("Choose the person.");
  const reason = guard(app, c, u.id);
  const t = cleanTimes(b, true);
  const clash = app.findRecordsByFilter("shifts", "user = {:u} && deleted_at = '' && clock_in < {:o} && (clock_out = '' || clock_out > {:i})", "", 1, 0, { u: u.id, i: db(t.tin), o: db(t.tout) });
  if (clash.length) bad("It overlaps another shift of " + u.getString("name") + ".");
  const r = new Record(app.findCollectionByNameOrId("shifts"));
  r.load({ user: u.id, user_name: u.getString("name"), day: localDay(t.tin), clock_in: db(t.tin), clock_out: db(t.tout), breaks: t.breaks, status: "closed", added_by_manager: true,
    edits: [{ at: db(Date.now()), by: c.user ? c.user.getString("name") : c.actor, reason: reason.substring(0, 300), from: null, to: { clock_in: db(t.tin), clock_out: db(t.tout), breaks: t.breaks } }],
    alerts: [], note: "" });
  stamp(r, c); app.save(r);
  return raw(r);
}

module.exports = { rules, calc, split, status, punch, check, who, list, edit, add, localDay, weekStart, addDays, ms, db, shiftsOf, otEligible };

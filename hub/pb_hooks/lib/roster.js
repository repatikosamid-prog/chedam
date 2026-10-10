// Roster (P4 step 3; FR-9.07). Managers (roster.manage) plan shifts by person and day as drafts, copy last
// week, and publish the week: each person with shifts gets "your schedule" in the inbox (kind schedule);
// changing a published shift marks it changed until the week is published again. Staff see their own
// published shifts and offer one to swap (to a colleague or to anyone); the colleague takes it; a manager
// approves (the shift moves to them) or declines. Labour cost against sales per day (totals only, so pay rates
// stay private): planned paid hours × the employee's rate (salary: a year / 52 / 5 per planned day), sales of
// the day (past days) or of the same day a week before (an estimate), and the hours actually clocked.

const T = () => require(`${__hooks}/lib/timeclock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) { r.set("created_by", c.actor); if (c.device) r.set("device_id", c.device); } }
const hm = (s) => { const m = String(s || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
function span(s) { const a = hm(s.start); let b = hm(s.end); if (b <= a) b += 1440; return { a: a, b: b }; }
function paidMin(s) { const x = span(s); return Math.max(0, x.b - x.a - (s.break_min || 0)); }

function view(r) {
  const s = { id: r.id, user: r.getString("user"), user_name: r.getString("user_name"), week: r.getString("week"), day: r.getString("day"), start: r.getString("start"), end: r.getString("end"),
    break_min: r.getInt("break_min"), position: r.getString("position"), note: r.getString("note"), status: r.getString("status"), changed: r.getBool("changed") };
  s.paid_min = paidMin(s);
  return s;
}
function weekOf(app, day) { return T().weekStart(day, T().rules(app).week_starts); }
function nameOf(app, id) { try { return app.findRecordById("users", id).getString("name"); } catch (_) { return ""; } }

// Labour cost per day for a week (totals only)
function labour(app, week, shifts) {
  const I = require(`${__hooks}/lib/insights.js`);
  const to = T().addDays(week, 6), today = T().localDay(Date.now());
  const rates = {};
  app.findRecordsByFilter("employees", "deleted_at = ''", "", 0, 0).forEach((e) => { rates[e.getString("user")] = { type: e.getString("pay_type"), cents: e.getInt("pay_rate_cents") }; });
  const days = {};
  for (let d = week; d <= to; d = T().addDays(d, 1)) days[d] = { day: d, planned_min: 0, cost_cents: 0, sales_cents: 0, estimate: d >= today, clocked_min: 0, no_rate: 0 };
  shifts.forEach((s) => {
    const x = days[s.day]; if (!x) return;
    x.planned_min += s.paid_min;
    const r = rates[s.user];
    if (!r || !r.cents) { x.no_rate++; return; }
    x.cost_cents += r.type === "salary" ? Math.round(r.cents / 52 / 5) : Math.round((r.cents * s.paid_min) / 60);
  });
  const past = I.perDay(I.load(app, I.span(week, to)), week, to);
  const before = I.perDay(I.load(app, I.span(T().addDays(week, -7), T().addDays(to, -7))), T().addDays(week, -7), T().addDays(to, -7));
  past.forEach((p, i) => { const x = days[p.day]; if (!x) return; x.sales_cents = x.estimate ? before[i].sales_cents : p.sales_cents; });
  const R = T().rules(app);
  app.findRecordsByFilter("shifts", "day >= {:f} && day <= {:t} && deleted_at = ''", "", 0, 0, { f: week, t: to })
    .forEach((r) => { const x = days[r.getString("day")]; if (x) x.clocked_min += T().calc({ clock_in: r.getString("clock_in"), clock_out: r.getString("clock_out"), breaks: JSON.parse(r.getString("breaks") || "[]"), status: r.getString("status") }, Date.now(), R).paid_min; });
  const list = Object.keys(days).sort().map((k) => { const x = days[k]; x.labour_pct = x.sales_cents ? Math.round((x.cost_cents * 1000) / x.sales_cents) / 10 : null; return x; });
  const tot = list.reduce((a, x) => ({ planned_min: a.planned_min + x.planned_min, cost_cents: a.cost_cents + x.cost_cents, sales_cents: a.sales_cents + x.sales_cents, clocked_min: a.clocked_min + x.clocked_min }),
    { planned_min: 0, cost_cents: 0, sales_cents: 0, clocked_min: 0 });
  tot.labour_pct = tot.sales_cents ? Math.round((tot.cost_cents * 1000) / tot.sales_cents) / 10 : null;
  return { days: list, total: tot };
}

function swapView(app, r) {
  return { id: r.id, shift: r.getString("shift"), from_user: r.getString("from_user"), from_name: nameOf(app, r.getString("from_user")), to_user: r.getString("to_user"),
    to_name: r.getString("to_user") ? nameOf(app, r.getString("to_user")) : "", taken_by: r.getString("taken_by"), taken_name: r.getString("taken_by") ? nameOf(app, r.getString("taken_by")) : "",
    status: r.getString("status"), note: r.getString("note"), decided_by: r.getString("decided_by") };
}
function openSwaps(app, shiftIds) {
  if (!shiftIds.length) return [];
  return app.findRecordsByFilter("roster_swaps", "status = 'offered' || status = 'accepted'", "-created_at", 0, 0).filter((r) => shiftIds.indexOf(r.getString("shift")) >= 0).map((r) => swapView(app, r));
}

// The week: everything for managers; published shifts for everyone else (their own, and colleagues' for swaps)
function week(app, c, q) {
  const wk = weekOf(app, ymdOk(q.week) ? q.week : T().localDay(Date.now()));
  const mgr = c.can("roster.manage");
  let shifts = app.findRecordsByFilter("roster_shifts", "week = {:w} && deleted_at = ''", "day,start,user_name", 0, 0, { w: wk }).map(view);
  if (!mgr) shifts = shifts.filter((s) => s.status === "published");
  const out = { week: wk, to: T().addDays(wk, 6), shifts: shifts, swaps: openSwaps(app, shifts.map((s) => s.id)), manage: mgr };
  if (mgr) {
    out.labour = labour(app, wk, shifts);
    out.drafts = shifts.filter((s) => s.status === "draft" || s.changed).length;
    out.people = app.findRecordsByFilter("users", "status = 'active' && deleted_at = ''", "name", 0, 0).map((u) => ({ id: u.id, name: u.getString("name") }));
  }
  if (c.user) out.mine = shifts.filter((s) => s.user === c.user.id);
  return out;
}

function checkShift(app, b, ignoreId) {
  if (!ymdOk(b.day)) bad("Choose the day.");
  if (hm(b.start) < 0 || hm(b.end) < 0) bad("Times as HH:MM.");
  const s = { start: b.start, end: b.end, break_min: Math.max(0, Math.round(Number(b.break_min) || 0)) };
  const x = span(s);
  if (x.b - x.a > 16 * 60) bad("A shift cannot be longer than 16 hours.");
  if (s.break_min >= x.b - x.a) bad("The break is longer than the shift.");
  // overlaps the same person's other shifts (the day before, the same day, the day after)
  const abs = (d, m) => Date.parse(d + "T00:00:00Z") / 60000 + m;
  const me0 = abs(b.day, x.a), me1 = abs(b.day, x.b);
  app.findRecordsByFilter("roster_shifts", "user = {:u} && day >= {:f} && day <= {:t} && deleted_at = '' && id != {:i}", "", 0, 0, { u: b.user, f: T().addDays(b.day, -1), t: T().addDays(b.day, 1), i: ignoreId || "" })
    .forEach((o) => { const y = span(view(o)); const o0 = abs(o.getString("day"), y.a), o1 = abs(o.getString("day"), y.b); if (me0 < o1 && o0 < me1) bad("It overlaps " + o.getString("user_name") + "'s shift on " + o.getString("day") + " " + o.getString("start") + "-" + o.getString("end") + "."); });
  return s;
}
// Things a manager should know (not refused): long days, short rest, over 40 hours in the week
function warnings(app, r) {
  const R = T().rules(app), s = view(r), w = [];
  if (s.paid_min > R.daily_ot_hours * 60) w.push("Over " + R.daily_ot_hours + " hours: overtime");
  if (span(s).b - span(s).a - s.break_min > R.meal_after_hours * 60 && s.break_min < R.meal_minutes) w.push("Over " + R.meal_after_hours + " hours with no " + R.meal_minutes + "-minute meal break");
  const wk = app.findRecordsByFilter("roster_shifts", "user = {:u} && week = {:w} && deleted_at = ''", "", 0, 0, { u: s.user, w: s.week }).reduce((a, o) => a + paidMin(view(o)), 0);
  if (wk > R.weekly_ot_hours * 60) w.push(s.user_name + " is planned " + Math.round(wk / 6) / 10 + " hours this week (overtime after " + R.weekly_ot_hours + ")");
  const abs = (d, m) => Date.parse(d + "T00:00:00Z") / 60000 + m;
  const me0 = abs(s.day, span(s).a), me1 = abs(s.day, span(s).b);
  app.findRecordsByFilter("roster_shifts", "user = {:u} && day >= {:f} && day <= {:t} && deleted_at = '' && id != {:i}", "", 0, 0, { u: s.user, f: T().addDays(s.day, -1), t: T().addDays(s.day, 1), i: r.id })
    .forEach((o) => { const y = span(view(o)); const o0 = abs(o.getString("day"), y.a), o1 = abs(o.getString("day"), y.b); const gap = o0 >= me1 ? o0 - me1 : me0 - o1; if (gap >= 0 && gap < R.rest_hours * 60) w.push("Less than " + R.rest_hours + " hours off between shifts"); });
  return w;
}

// {id?, user, day, start, end, break_min, position, note}
function save(app, c, b) {
  let r = null;
  if (b.id) { r = app.findRecordById("roster_shifts", b.id); if (r.getString("deleted_at")) bad("That shift was removed."); }
  const user = String(b.user || (r ? r.getString("user") : ""));
  const name = nameOf(app, user);
  if (!name) bad("Choose the person.");
  const day = b.day || (r ? r.getString("day") : "");
  const s = checkShift(app, { user: user, day: day, start: b.start || (r ? r.getString("start") : ""), end: b.end || (r ? r.getString("end") : ""), break_min: b.break_min !== undefined ? b.break_min : (r ? r.getInt("break_min") : 0) }, r ? r.id : "");
  if (!r) { r = new Record(app.findCollectionByNameOrId("roster_shifts")); r.set("status", "draft"); }
  else if (r.getString("status") === "published") r.set("changed", true);
  r.load({ user: user, user_name: name, week: weekOf(app, day), day: day, start: b.start || r.getString("start"), end: b.end || r.getString("end"), break_min: s.break_min,
    position: String(b.position !== undefined ? b.position : r.getString("position")).substring(0, 60), note: String(b.note !== undefined ? b.note : r.getString("note")).substring(0, 200) });
  stamp(r, c); app.save(r);
  return Object.assign(view(r), { warnings: warnings(app, r) });
}
function remove(app, c, id) {
  const r = app.findRecordById("roster_shifts", id);
  if (r.getString("status") === "published") {
    const I = require(`${__hooks}/lib/inbox.js`);
    I.deliver(app, r.getString("user"), "schedule", "removed:" + r.id, "Shift removed: " + r.getString("day") + " " + r.getString("start") + "-" + r.getString("end"), "Your shift on " + r.getString("day") + " " + r.getString("start") + "-" + r.getString("end") + " was taken off the roster.", {}, "roster");
  }
  r.set("deleted_at", new DateTime()); stamp(r, c); app.save(r);
  app.findRecordsByFilter("roster_swaps", "shift = {:s} && (status = 'offered' || status = 'accepted')", "", 0, 0, { s: r.id }).forEach((x) => { x.set("status", "cancelled"); stamp(x, c); app.save(x); });
  return { ok: true };
}

// Copy a week's shifts (as drafts) into another week; shifts that would overlap are skipped
function copy(app, c, b) {
  const from = weekOf(app, ymdOk(b.from) ? b.from : ""), to = weekOf(app, ymdOk(b.to) ? b.to : "");
  if (!ymdOk(b.from) || !ymdOk(b.to) || from === to) bad("Choose two different weeks.");
  const off = Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
  let n = 0, skipped = 0;
  app.findRecordsByFilter("roster_shifts", "week = {:w} && deleted_at = ''", "day,start", 0, 0, { w: from }).forEach((o) => {
    try { save(app, c, { user: o.getString("user"), day: T().addDays(o.getString("day"), off), start: o.getString("start"), end: o.getString("end"), break_min: o.getInt("break_min"), position: o.getString("position"), note: o.getString("note") }); n++; }
    catch (_) { skipped++; }
  });
  return { copied: n, skipped: skipped };
}

// Publish the week: drafts and changes become what staff see; each person gets their schedule
function publish(app, c, b) {
  const wk = weekOf(app, ymdOk(b.week) ? b.week : T().localDay(Date.now()));
  const all = app.findRecordsByFilter("roster_shifts", "week = {:w} && deleted_at = ''", "day,start", 0, 0, { w: wk });
  const touched = {};
  all.forEach((r) => {
    if (r.getString("status") === "published" && !r.getBool("changed")) return;
    touched[r.getString("user")] = true;
    r.set("status", "published"); r.set("changed", false); stamp(r, c); app.save(r);
  });
  const users = Object.keys(touched);
  if (!users.length) bad("Nothing new to publish this week.");
  const I = require(`${__hooks}/lib/inbox.js`);
  const stampNow = new Date().toISOString().substring(0, 19);
  users.forEach((u) => {
    const mine = all.filter((r) => r.getString("user") === u).map(view);
    const text = mine.map((s) => s.day + " " + s.start + "-" + s.end + (s.position ? " (" + s.position + ")" : "")).join("\n");
    I.deliver(app, u, "schedule", "roster:" + wk + ":" + stampNow, "Your schedule for the week of " + wk, text || "No shifts this week.", { week: wk }, "roster");
  });
  return { week: wk, published: all.length, notified: users.length };
}

// ---- Swaps -------------------------------------------------------------------------------------------------
function offer(app, c, shiftId, b) {
  const r = app.findRecordById("roster_shifts", shiftId);
  if (!c.user || r.getString("user") !== c.user.id) throw new ForbiddenError("Only your own shift.");
  if (r.getString("status") !== "published" || r.getString("deleted_at")) bad("Only a published shift.");
  if (r.getString("day") < T().localDay(Date.now())) bad("That shift is over.");
  if (openSwaps(app, [r.id]).length) bad("It is already offered.");
  let to = "";
  if (b.to_user) { if (!nameOf(app, b.to_user) || b.to_user === c.user.id) bad("Choose a colleague."); to = b.to_user; }
  const x = new Record(app.findCollectionByNameOrId("roster_swaps"));
  x.load({ shift: r.id, from_user: c.user.id, to_user: to, status: "offered", note: String(b.note || "").substring(0, 200) });
  stamp(x, c); app.save(x);
  const I = require(`${__hooks}/lib/inbox.js`);
  const what = r.getString("day") + " " + r.getString("start") + "-" + r.getString("end");
  const targets = to ? [to] : app.findRecordsByFilter("users", "status = 'active' && deleted_at = '' && id != {:u}", "", 0, 0, { u: c.user.id }).map((u) => u.id);
  targets.forEach((u) => I.deliver(app, u, "schedule", "swap:" + x.id, c.user.getString("name") + " offers a shift: " + what, (b.note ? b.note + "\n" : "") + "Time clock → Roster to take it.", {}, "roster"));
  return swapView(app, x);
}
function act(app, c, id, action) {
  const x = app.findRecordById("roster_swaps", id);
  const r = app.findRecordById("roster_shifts", x.getString("shift"));
  const I = require(`${__hooks}/lib/inbox.js`);
  const what = r.getString("day") + " " + r.getString("start") + "-" + r.getString("end");
  const me = c.user ? c.user.id : "";
  if (action === "accept") {
    if (x.getString("status") !== "offered") bad("It is no longer offered.");
    if (!me || me === x.getString("from_user") || (x.getString("to_user") && x.getString("to_user") !== me)) throw new ForbiddenError("It is not offered to you.");
    checkShift(app, { user: me, day: r.getString("day"), start: r.getString("start"), end: r.getString("end"), break_min: r.getInt("break_min") }, r.id);
    x.set("taken_by", me); x.set("status", "accepted");
    const access = require(`${__hooks}/lib/access.js`);
    app.findRecordsByFilter("users", "status = 'active' && deleted_at = ''", "", 0, 0).filter((u) => access.isOwner(app, u) || access.can(app, u, "roster.manage"))
      .forEach((u) => I.deliver(app, u.id, "schedule", "swap-ok:" + x.id, "Swap to approve: " + what, nameOf(app, me) + " takes " + nameOf(app, x.getString("from_user")) + "'s shift.", {}, "roster"));
  } else if (action === "cancel") {
    if (me !== x.getString("from_user") && !c.can("roster.manage")) throw new ForbiddenError("Only who offered it.");
    if (["offered", "accepted"].indexOf(x.getString("status")) < 0) bad("It is already decided.");
    x.set("status", "cancelled");
  } else if (action === "approve" || action === "decline") {
    if (!c.can("roster.manage")) throw new ForbiddenError("A manager approves swaps.");
    if (x.getString("status") !== "accepted") bad("Nobody has taken it yet.");
    x.set("status", action === "approve" ? "approved" : "declined");
    x.set("decided_by", c.user ? c.user.getString("name") : c.actor);
    if (action === "approve") {
      const to = x.getString("taken_by");
      checkShift(app, { user: to, day: r.getString("day"), start: r.getString("start"), end: r.getString("end"), break_min: r.getInt("break_min") }, r.id);
      r.set("user", to); r.set("user_name", nameOf(app, to)); stamp(r, c); app.save(r);
    }
    [x.getString("from_user"), x.getString("taken_by")].forEach((u) => I.deliver(app, u, "schedule", action + ":" + x.id, "Swap " + (action === "approve" ? "approved" : "declined") + ": " + what,
      action === "approve" ? nameOf(app, x.getString("taken_by")) + " works it." : nameOf(app, x.getString("from_user")) + " keeps it.", {}, "roster"));
  } else bad("Accept, cancel, approve or decline.");
  stamp(x, c); app.save(x);
  return swapView(app, x);
}

module.exports = { week, save, remove, copy, publish, offer, act, labour, paidMin };

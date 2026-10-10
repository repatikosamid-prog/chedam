// P4 step 4: time sheets (FR-9.08). The pay period's hours from the punches (regular / overtime by BC rules),
// leave taken, flags (no punch-out, no meal break, overtime, not rostered, late, no-show, fixed), approval
// with a note, the lock on approved punches, reopening with a reason, the person's own view.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step45-timesheets.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8138 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const at = (mo, d, h, mi = 0) => new Date(2026, mo - 1, d, h, mi).toISOString();

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), owner = await login("Demo Owner");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), O = as(owner);
  const shared = await t.pair("Back room tablet");
  const clk = (name, action, when) => t.api("POST", "/api/chedam/clock?at=" + encodeURIComponent(when), { user: people[name], pin: PIN[name], action }, { token: t.su, device: shared });
  const cal = people["Cal Cashier"];
  const emp = await O.post("/api/chedam/employees", { user: cal, legal_name: "Calvin Cashier", pay_type: "hourly", pay_rate_cents: 2000 });

  // Roster (published): Mon 14 and Tue 15 09:00-17:00, Wed 16 09:00-13:00 (not worked)
  for (const [d, s, e] of [["2026-09-14", "09:00", "17:00"], ["2026-09-15", "09:00", "17:00"], ["2026-09-16", "09:00", "13:00"], ["2026-09-21", "09:00", "17:00"]]) await M.post("/api/chedam/roster", { user: cal, day: d, start: s, end: e, break_min: 30 });
  await M.post("/api/chedam/roster/publish", { week: "2026-09-13" });
  await M.post("/api/chedam/roster/publish", { week: "2026-09-20" });
  // Punches: Mon clean; Tue late, no break, 9 h 10; Thu not rostered; next Mon still clocked in
  await clk("Cal Cashier", "in", at(9, 14, 9)); await clk("Cal Cashier", "break", at(9, 14, 12)); await clk("Cal Cashier", "back", at(9, 14, 12, 30)); await clk("Cal Cashier", "out", at(9, 14, 17));
  await clk("Cal Cashier", "in", at(9, 15, 9, 20)); await clk("Cal Cashier", "out", at(9, 15, 18, 30));
  await clk("Cal Cashier", "in", at(9, 17, 10)); await clk("Cal Cashier", "out", at(9, 17, 14));
  await clk("Cal Cashier", "in", at(9, 21, 9));
  await M.post(`/api/chedam/employees/${emp.json.id}/leave`, { kind: "unpaid", hours: 4, day: "2026-09-16", note: "Appointment" });

  console.log("The pay period (FR-9.08)");
  check("a cashier cannot see time sheets", (await C.get("/api/chedam/timesheets")).status === 403);
  const ls = (await M.get("/api/chedam/timesheets?period=2026-09-20")).json;
  check("biweekly from 2026-01-04: 13 to 26 September", ls.period.start === "2026-09-13" && ls.period.end === "2026-09-26" && ls.previous.start === "2026-08-30" && ls.ended, JSON.stringify(ls.period));
  const row = ls.people.find((p) => p.user === cal);
  check("Cal: to approve", row && row.status === "to_approve");
  const d = (await M.get(`/api/chedam/timesheets/${cal}?period=2026-09-20`)).json;
  const k = d.flags.map((f) => f.kind);
  check("flags: late, no meal break, overtime, not rostered, no-show, no punch-out", ["late", "no_meal", "overtime", "unscheduled", "no_show", "no_out"].every((x) => k.includes(x)), JSON.stringify(k));
  check("Monday is clean (450 min)", d.shifts.find((s) => s.day === "2026-09-14").flags.length === 0 && d.shifts.find((s) => s.day === "2026-09-14").calc.paid_min === 450);
  check("unpaid leave taken: 4 h", d.leave.unpaid === 4);
  check("not with a shift still open", (await M.post("/api/chedam/timesheets/approve", { user: cal, period: "2026-09-20", note: "ok" })).status === 400);
  const open = d.shifts.find((s) => s.day === "2026-09-21");
  await M.post(`/api/chedam/shifts/${open.id}`, { clock_in: at(9, 21, 9), clock_out: at(9, 21, 17), breaks: [], reason: "Forgot to clock out" });
  check("flagged things need a note", (await M.post("/api/chedam/timesheets/approve", { user: cal, period: "2026-09-20" })).status === 400);
  check("a period not yet ended cannot be approved", (await M.post("/api/chedam/timesheets/approve", { user: cal, period: new Date(Date.now() + 15 * 86400000).toISOString().substring(0, 10), note: "x" })).status === 400);
  await clk("Mira Manager", "in", at(9, 22, 9)); await clk("Mira Manager", "out", at(9, 22, 13));
  check("Mira cannot approve her own", (await M.post("/api/chedam/timesheets/approve", { user: people["Mira Manager"], period: "2026-09-20", note: "x" })).status === 403);
  const ap = await M.post("/api/chedam/timesheets/approve", { user: cal, period: "2026-09-20", note: "Checked with Cal; Thursday was a covered shift" });
  // 450 + 550 + 240 + 480 = 1720 paid; Tuesday 70 min overtime
  check("approved: 28 h 40 paid, 70 min overtime", ap.status === 200 && ap.json.paid_min === 1720 && ap.json.overtime_min === 70 && ap.json.regular_min === 1650 && ap.json.approved_by === "Mira Manager", JSON.stringify(ap.json).slice(0, 300));
  check("not twice", (await M.post("/api/chedam/timesheets/approve", { user: cal, period: "2026-09-20", note: "x" })).status === 400);

  console.log("Locked, reopened, own view");
  check("approved punches cannot be fixed", (await M.post(`/api/chedam/shifts/${open.id}`, { clock_in: at(9, 21, 9), clock_out: at(9, 21, 16), reason: "x" })).status === 400);
  check("nor a shift added in it", (await M.post("/api/chedam/shifts", { user: cal, clock_in: at(9, 24, 9), clock_out: at(9, 24, 12), reason: "x" })).status === 400);
  const mine = (await C.get("/api/chedam/me/timesheet?period=2026-09-20")).json;
  check("Cal sees his approved time sheet", mine.status === "approved" && mine.paid_min === 1720 && mine.shifts.length === 4);
  check("a reason is needed to reopen", (await M.post("/api/chedam/timesheets/reopen", { user: cal, period: "2026-09-20" })).status === 400);
  check("reopened with a reason", (await M.post("/api/chedam/timesheets/reopen", { user: cal, period: "2026-09-20", reason: "Cal left at 16:00 on the 21st" })).json.status === "reopened");
  check("now the fix is allowed", (await M.post(`/api/chedam/shifts/${open.id}`, { clock_in: at(9, 21, 9), clock_out: at(9, 21, 16), breaks: [], reason: "Left at 16:00" })).status === 200);
  const again = await M.post("/api/chedam/timesheets/approve", { user: cal, period: "2026-09-20", note: "Corrected" });
  check("approved again: 60 minutes less", again.json.paid_min === 1660 && again.json.status === "approved");
  check("in the event log", (await t.list("events", `table_name='timesheets'`)).items.length >= 3);
} catch (e) { err = e; }
await t.finish(err);

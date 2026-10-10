// P4 step 2: time clock (FR-9.04-9.06, BR-30-32). Punch with the PIN on a shared device (hub clock), breaks,
// BC alerts before a missed meal break or overtime (to the person and managers, once), short rest between
// shifts, the overtime split (daily 8/12, weekly 40), manager fixes with a reason keeping the original,
// missed shifts added, nobody fixes their own punches.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step43-timeclock.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8136 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

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
  const clk = (name, action, when, pin) => t.api("POST", "/api/chedam/clock?at=" + encodeURIComponent(when), { user: people[name], pin: pin || PIN[name], action }, { token: t.su, device: shared });
  const kinds = (r) => r.json.alerts.map((a) => a.kind);

  console.log("Punches (FR-9.04)");
  check("a wrong PIN is refused", (await clk("Cal Cashier", "in", at(2026, 9, 21, 9), "0000")).status === 400);
  check("no device, no punch", (await t.api("POST", "/api/chedam/clock", { user: people["Cal Cashier"], pin: PIN["Cal Cashier"], action: "in" })).status === 403);
  const i1 = await clk("Cal Cashier", "in", at(2026, 9, 21, 9));
  check("Cal clocks in at 09:00 on the shared tablet", i1.status === 200 && i1.json.open && i1.json.open.in_device === "Back room tablet" && i1.json.open.day === "2026-09-21", JSON.stringify(i1.json).slice(0, 300));
  check("not twice", (await clk("Cal Cashier", "in", at(2026, 9, 21, 9, 5))).status === 400);
  check("back without a break is refused", (await clk("Cal Cashier", "back", at(2026, 9, 21, 9, 6))).status === 400);

  console.log("BC alerts before they happen (BR-31)");
  check("12:40: nothing yet", (await clk("Cal Cashier", "status", at(2026, 9, 21, 12, 40))).json.alerts.length === 0);
  const s1 = await clk("Cal Cashier", "status", at(2026, 9, 21, 13, 35));
  check("13:35: take a meal break by 14:00", kinds(s1).includes("meal_soon") && s1.json.alerts[0].text.includes("14:00"), JSON.stringify(s1.json.alerts));
  check("14:05: overdue", kinds(await clk("Cal Cashier", "status", at(2026, 9, 21, 14, 5))).includes("meal"));
  const ch = await M.post("/api/chedam/clock/check?at=" + encodeURIComponent(at(2026, 9, 21, 13, 35)), {});
  check("the alert job sends it", ch.status === 200 && ch.json.sent >= 1, JSON.stringify(ch.json));
  check("once", (await M.post("/api/chedam/clock/check?at=" + encodeURIComponent(at(2026, 9, 21, 13, 40)), {})).json.sent === 0);
  const inbox = (await t.list("inbox_items", `kind='alert'`)).items;
  check("to Cal and to the managers (inbox)", inbox.some((x) => x.user === people["Cal Cashier"] && x.title.includes("meal break")) && inbox.some((x) => x.user === people["Mira Manager"] && x.title.includes("Cal Cashier")));
  check("Cal goes on a meal break at 13:00", (await clk("Cal Cashier", "break", at(2026, 9, 21, 13))).json.open.status === "on_break");
  check("a cashier sees who is on the clock", (await t.api("GET", "/api/chedam/clock/who", null, { device: shared })).json.items.some((x) => x.name === "Cal Cashier" && x.on_break));
  check("back at 13:35", (await clk("Cal Cashier", "back", at(2026, 9, 21, 13, 35))).json.open.status === "open");
  const s2 = await clk("Cal Cashier", "status", at(2026, 9, 21, 17, 10));
  check("17:10: no meal alert (break taken); overtime starts at 17:35", !kinds(s2).includes("meal") && kinds(s2).includes("overtime_soon") && s2.json.alerts.some((a) => a.text.includes("17:35")), JSON.stringify(s2.json.alerts));
  const o1 = await clk("Cal Cashier", "out", at(2026, 9, 21, 18));
  const sh1 = o1.json.shifts.find((x) => x.day === "2026-09-21");
  check("out at 18:00: 9 h, 35 min unpaid meal break, 8 h 25 paid", sh1 && sh1.calc.total_min === 540 && sh1.calc.paid_min === 505 && sh1.calc.break_min === 35, JSON.stringify(sh1 && sh1.calc));
  check("25 minutes of overtime that day", o1.json.week.overtime_min === 25 && o1.json.week.regular_min === 480, JSON.stringify(o1.json.week));
  const i2 = await clk("Cal Cashier", "in", at(2026, 9, 22, 1, 30));
  check("back at 01:30 the next day: less than 8 hours off, flagged", kinds(i2).includes("short_rest"), JSON.stringify(i2.json.alerts));
  await clk("Cal Cashier", "out", at(2026, 9, 22, 3));

  console.log("Shifts, fixes and missed punches (FR-9.06)");
  check("a cashier cannot see everyone's shifts", (await C.get("/api/chedam/shifts")).status === 403);
  const wk = (await M.get("/api/chedam/shifts?from=2026-09-20&to=2026-09-26")).json;
  const cal = wk.people.find((p) => p.name === "Cal Cashier");
  check("the week: Cal 9 h 55 paid, 25 min overtime, the short rest flagged", cal && cal.paid_min === 595 && cal.overtime_min === 25 && cal.shifts[1].flags.includes("short_rest"), JSON.stringify(cal).slice(0, 400));
  const id = cal.shifts[0].id;
  check("a fix needs a reason", (await M.post(`/api/chedam/shifts/${id}`, { clock_in: at(2026, 9, 21, 9), clock_out: at(2026, 9, 21, 17, 30), breaks: [{ start: at(2026, 9, 21, 13), end: at(2026, 9, 21, 13, 35) }] })).status === 400);
  check("breaks must be inside the shift", (await M.post(`/api/chedam/shifts/${id}`, { clock_in: at(2026, 9, 21, 9), clock_out: at(2026, 9, 21, 12), breaks: [{ start: at(2026, 9, 21, 13), end: at(2026, 9, 21, 13, 35) }], reason: "x" })).status === 400);
  const fx = await M.post(`/api/chedam/shifts/${id}`, { clock_in: at(2026, 9, 21, 9), clock_out: at(2026, 9, 21, 17, 30), breaks: [{ start: at(2026, 9, 21, 13), end: at(2026, 9, 21, 13, 35) }], reason: "Forgot to clock out; left at 17:30" });
  check("Mira fixes Cal's punch-out: the original and the change are kept", fx.status === 200 && fx.json.original.clock_out && fx.json.edits.length === 1 && fx.json.edits[0].by === "Mira Manager" && fx.json.calc.paid_min === 475, JSON.stringify(fx.json).slice(0, 400));
  await clk("Mira Manager", "in", at(2026, 9, 23, 9));
  await clk("Mira Manager", "out", at(2026, 9, 23, 15));
  const mira = (await M.get("/api/chedam/shifts?from=2026-09-20&to=2026-09-26&user=" + people["Mira Manager"])).json.people[0];
  check("Mira's 6 hours without a meal break are flagged", mira.shifts[0].flags.includes("no_meal"));
  check("Mira cannot fix her own punches", (await M.post(`/api/chedam/shifts/${mira.shifts[0].id}`, { clock_in: at(2026, 9, 23, 9), clock_out: at(2026, 9, 23, 14), reason: "x" })).status === 403);
  check("the owner can", (await O.post(`/api/chedam/shifts/${mira.shifts[0].id}`, { clock_in: at(2026, 9, 23, 9), clock_out: at(2026, 9, 23, 15), breaks: [{ start: at(2026, 9, 23, 12), end: at(2026, 9, 23, 12, 30) }], reason: "Took lunch, forgot to punch" })).status === 200);
  const add = (day, h1, h2, reason) => M.post("/api/chedam/shifts", { user: people["Sam Staff"], clock_in: at(2026, 9, day, h1), clock_out: at(2026, 9, day, h2), breaks: [], reason });
  check("a missed shift needs a reason", (await add(7, 9, 13, "")).status === 400);
  for (const d of [7, 8, 9, 10, 11]) await add(d, 9, 13, "Paper sheet");
  check("an overlapping one is refused", (await add(7, 12, 14, "x")).status === 400);
  await add(12, 6, 20, "Inventory day");
  const sam = (await M.get("/api/chedam/shifts?from=2026-09-06&to=2026-09-12&user=" + people["Sam Staff"])).json.people[0];
  // 5 × 4 h + 14 h (no meal break in 14 h: unpaid breaks none) → day 6: 8 regular, 4 overtime, 2 double
  check("the split: 28 h regular, 4 h overtime, 2 h double time (BC daily 8/12)", sam.regular_min === 28 * 60 && sam.overtime_min === 240 && sam.double_min === 120, JSON.stringify({ r: sam.regular_min, o: sam.overtime_min, d: sam.double_min }));
  check("added shifts are marked", sam.shifts.every((s) => s.flags.includes("added")));
  for (const d of [13, 14, 15, 16, 17]) await M.post("/api/chedam/shifts", { user: people["Sam Staff"], clock_in: at(2026, 9, d, 8), clock_out: at(2026, 9, d, 17), breaks: [{ start: at(2026, 9, d, 12), end: at(2026, 9, d, 12, 30) }], reason: "Paper sheet" });
  await M.post("/api/chedam/shifts", { user: people["Sam Staff"], clock_in: at(2026, 9, 18, 9), clock_out: at(2026, 9, 18, 13), breaks: [], reason: "Paper sheet" });
  const sam2 = (await M.get("/api/chedam/shifts?from=2026-09-13&to=2026-09-19&user=" + people["Sam Staff"])).json.people[0];
  // 5 × 8.5 h = 42.5 h: daily 0.5 h OT each (2.5 h); regular 40 by Thursday; Friday 4 h all weekly overtime
  check("weekly 40: 40 h regular, 6.5 h overtime", sam2.regular_min === 40 * 60 && sam2.overtime_min === 390, JSON.stringify({ r: sam2.regular_min, o: sam2.overtime_min }));
  const evs = (await t.list("events", `table_name='shifts'`)).items;
  check("every punch and fix is in the event log", evs.length >= 10);

  console.log("Own device");
  const me = await M.post("/api/chedam/me/clock", { action: "in" });
  check("Mira clocks in on her own signed-in device (hub time now)", me.status === 200 && me.json.open && Math.abs(Date.parse(me.json.open.clock_in.replace(" ", "T")) - Date.now()) < 60000);
  check("and sees it", (await M.get("/api/chedam/me/clock")).json.open.id === me.json.open.id);
  check("out", (await M.post("/api/chedam/me/clock", { action: "out" })).json.open === null);
} catch (e) { err = e; }
await t.finish(err);

// P4 step 3: roster (FR-9.07). Drafts only managers see; publish tells each person (inbox, schedule); changes
// after publishing; overlaps refused, BC warnings; swaps offered, taken, approved or declined; copy a week;
// labour cost against sales (totals; pay rates private).
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step44-roster.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8137 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const plus = (s, n) => { const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y, m - 1, d + n)); };

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), staff = await login("Sam Staff"), manager = await login("Mira Manager"), owner = await login("Demo Owner");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), S = as(staff), M = as(manager), O = as(owner);
  await O.post("/api/chedam/employees", { user: people["Cal Cashier"], legal_name: "Calvin Cashier", pay_type: "hourly", pay_rate_cents: 2000 });
  await O.post("/api/chedam/employees", { user: people["Sam Staff"], legal_name: "Sam Staff", pay_type: "hourly", pay_rate_cents: 1800 });
  const wk = (await M.get("/api/chedam/roster?week=" + ymd(new Date(Date.now() + 9 * 86400000)))).json.week;
  const D = (n) => plus(wk, n);

  console.log("Planning (FR-9.07)");
  check("a cashier cannot plan", (await C.post("/api/chedam/roster", { user: people["Cal Cashier"], day: D(1), start: "09:00", end: "17:30", break_min: 30 })).status === 403);
  const a = await M.post("/api/chedam/roster", { user: people["Cal Cashier"], day: D(1), start: "09:00", end: "17:30", break_min: 30, position: "Till" });
  check("Mira plans Cal Monday 09:00-17:30 (8 h paid), a draft", a.status === 200 && a.json.paid_min === 480 && a.json.status === "draft" && a.json.week === wk, JSON.stringify(a.json));
  check("an overlapping shift is refused", (await M.post("/api/chedam/roster", { user: people["Cal Cashier"], day: D(1), start: "17:00", end: "21:00" })).status === 400);
  const b = await M.post("/api/chedam/roster", { user: people["Cal Cashier"], day: D(2), start: "08:00", end: "19:00", break_min: 60 });
  check("a 10-hour day is planned with an overtime warning", b.status === 200 && b.json.warnings.some((w) => w.includes("overtime")), JSON.stringify(b.json.warnings));
  const nb = await M.post("/api/chedam/roster", { user: people["Sam Staff"], day: D(3), start: "10:00", end: "16:00", break_min: 0 });
  check("6 hours with no meal break: warned", nb.json.warnings.some((w) => w.includes("meal break")));
  await M.post("/api/chedam/roster", { id: nb.json.id, end: "14:00" });
  const s4 = await M.post("/api/chedam/roster", { user: people["Sam Staff"], day: D(4), start: "12:00", end: "16:00" });
  await M.post("/api/chedam/roster", { user: people["Mira Manager"], day: D(5), start: "09:00", end: "17:00", break_min: 30 });
  check("staff do not see drafts", (await C.get("/api/chedam/roster?week=" + wk)).json.shifts.length === 0);
  const lab = (await M.get("/api/chedam/roster?week=" + wk)).json;
  check("labour cost: Cal 8 h + 10 h at $20, Sam 4 h + 4 h at $18 = $504; Mira has no rate (counted)", lab.labour.total.cost_cents === 50400 && lab.labour.days.some((d) => d.no_rate === 1) && lab.drafts === 5, JSON.stringify(lab.labour.total));
  check("planned 33.5 hours; future days show last week's sales as an estimate", lab.labour.total.planned_min === 2010 && lab.labour.days.every((d) => d.estimate && typeof d.sales_cents === "number"));
  check("a cashier gets no labour figures", (await C.get("/api/chedam/roster?week=" + wk)).json.labour === undefined);

  console.log("Publishing");
  const pub = await M.post("/api/chedam/roster/publish", { week: wk });
  check("publish: 5 shifts, 3 people told", pub.status === 200 && pub.json.notified === 3, JSON.stringify(pub.json));
  const cv = (await C.get("/api/chedam/roster?week=" + wk)).json;
  check("Cal sees his 2 shifts", cv.mine.length === 2 && cv.mine[0].position === "Till");
  const inb = (await t.list("inbox_items", `kind='schedule' && user='${people["Cal Cashier"]}'`)).items;
  check("Cal's inbox: his schedule", inb.length === 1 && inb[0].body.includes("09:00-17:30"), JSON.stringify(inb.map((x) => x.body)));
  check("nothing new: refused", (await M.post("/api/chedam/roster/publish", { week: wk })).status === 400);
  const ch = await M.post("/api/chedam/roster", { id: b.json.id, start: "09:00", end: "17:00", break_min: 30 });
  check("a published shift changed is marked changed", ch.json.changed === true && ch.json.status === "published");
  check("published again: only Cal is told", (await M.post("/api/chedam/roster/publish", { week: wk })).json.notified === 1);

  console.log("Swaps");
  check("Cal cannot offer Sam's shift", (await C.post(`/api/chedam/roster/${s4.json.id}/swap`, {})).status === 403);
  const off = await C.post(`/api/chedam/roster/${a.json.id}/swap`, { to_user: people["Sam Staff"], note: "Dentist" });
  check("Cal offers Monday to Sam", off.status === 200 && off.json.status === "offered");
  check("not twice", (await C.post(`/api/chedam/roster/${a.json.id}/swap`, {})).status === 400);
  check("Sam is told", (await t.list("inbox_items", `kind='schedule' && user='${people["Sam Staff"]}' && title~'offers'`)).items.length === 1);
  check("Mira cannot take what was offered to Sam", (await M.post(`/api/chedam/swaps/${off.json.id}/accept`, {})).status === 403);
  check("approve before anyone took it: refused", (await M.post(`/api/chedam/swaps/${off.json.id}/approve`, {})).status === 400);
  check("Sam takes it", (await S.post(`/api/chedam/swaps/${off.json.id}/accept`, {})).json.status === "accepted");
  check("Cal cannot approve", (await C.post(`/api/chedam/swaps/${off.json.id}/approve`, {})).status === 403);
  const ap = await M.post(`/api/chedam/swaps/${off.json.id}/approve`, {});
  const after = (await M.get("/api/chedam/roster?week=" + wk)).json;
  check("Mira approves: Monday is Sam's; labour cost follows ($438)", ap.json.status === "approved" && after.shifts.find((s) => s.id === a.json.id).user === people["Sam Staff"] && after.labour.total.cost_cents === 43800, JSON.stringify(after.labour.total));
  const open = await S.post(`/api/chedam/roster/${s4.json.id}/swap`, {});
  check("Sam offers Thursday to anyone; Cal takes it", open.status === 200 && (await C.post(`/api/chedam/swaps/${open.json.id}/accept`, {})).json.status === "accepted");
  check("Mira declines: Sam keeps it", (await M.post(`/api/chedam/swaps/${open.json.id}/decline`, {})).json.status === "declined" && (await M.get("/api/chedam/roster?week=" + wk)).json.shifts.find((s) => s.id === s4.json.id).user === people["Sam Staff"]);

  console.log("Copy and remove");
  const cp = await M.post("/api/chedam/roster/copy", { from: wk, to: D(7) });
  check("copy the week to the next: 5 drafts", cp.json.copied === 5 && (await M.get("/api/chedam/roster?week=" + D(7))).json.shifts.every((s) => s.status === "draft"), JSON.stringify(cp.json));
  check("copying again skips the overlaps", (await M.post("/api/chedam/roster/copy", { from: wk, to: D(7) })).json.skipped === 5);
  check("removing a published shift tells the person", (await M.post(`/api/chedam/roster/${s4.json.id}/remove`, {})).status === 200 && (await t.list("inbox_items", `kind='schedule' && user='${people["Sam Staff"]}' && title~'removed'`)).items.length === 1);
  check("in the event log", (await t.list("events", `table_name='roster_shifts'`)).items.length >= 10);
} catch (e) { err = e; }
await t.finish(err);

// P4 step 1: employees and leave (FR-9.09, 9.10). Records by permission level (owner: everything; managers:
// no pay, SIN or bank; the person: their own); SIN checked, encrypted, revealed only to the owner (logged),
// never in the event log or exports; leave: accruals, the BC sick grant, time taken, adjustments.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step42-employees.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8135 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

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

  console.log("Records (FR-9.09)");
  check("a cashier cannot list employees", (await C.get("/api/chedam/employees")).status === 403);
  check("a manager cannot create one (owner only)", (await M.post("/api/chedam/employees", { user: people["Cal Cashier"], legal_name: "Cal C" })).status === 403);
  check("a bad SIN is refused", (await O.post("/api/chedam/employees", { user: people["Cal Cashier"], legal_name: "Calvin Cashier", sin: "123456789" })).status === 400);
  const cal = await O.post("/api/chedam/employees", { user: people["Cal Cashier"], legal_name: "Calvin Cashier", job_title: "Cashier", start_date: "2026-01-05", pay_type: "hourly",
    pay_rate_cents: 1785, sin: "046 454 286", bank: { institution: "001", transit: "12345", account: "1234567" }, personal_phone: "604-555-0101", emergency_name: "Pat", emergency_phone: "604-555-0102" });
  check("the owner adds Cal: pay, SIN (shown masked), bank (masked)", cal.status === 200 && cal.json.pay_rate_cents === 1785 && cal.json.sin_last3 === "•••-•••-286" && cal.json.bank.account === "••••567" && cal.json.has_sin, JSON.stringify(cal.json).slice(0, 300));
  check("one record per person", (await O.post("/api/chedam/employees", { user: people["Cal Cashier"], legal_name: "x" })).status === 400);
  const mv = (await M.get(`/api/chedam/employees/${cal.json.id}`)).json;
  check("a manager sees the record without pay, SIN digits, bank or personal phone", mv.legal_name === "Calvin Cashier" && mv.pay_rate_cents === undefined && mv.bank === undefined && mv.personal_phone === undefined && mv.emergency_name === "Pat");
  const own = (await C.get("/api/chedam/me/employee")).json.employee;
  check("Cal sees their own record (personal details, leave), not pay or bank", own && own.personal_phone === "604-555-0101" && own.pay_rate_cents === undefined && own.leave);
  check("Cal cannot see the SIN", (await C.post(`/api/chedam/employees/${cal.json.id}/sin`, {})).status === 403);
  const sin = await O.post(`/api/chedam/employees/${cal.json.id}/sin`, {});
  check("the owner can reveal it", sin.json.sin === "046-454-286");
  const rec = (await t.list("employees", `id='${cal.json.id}'`)).items[0];
  check("stored encrypted (not the digits)", rec.sin_enc && !rec.sin_enc.includes("046454286") && rec.bank_enc && !rec.bank_enc.includes("1234567") && rec.sin_viewed_by === "Demo Owner");
  const evs = JSON.stringify((await t.list("events", `table_name='employees'`)).items);
  check("the event log never has the SIN or bank details, even encrypted", !evs.includes("046454286") && !evs.includes(rec.sin_enc) && !evs.includes("1234567") && evs.includes("[personal]"));
  check("a cashier cannot read the table directly", (await C.get("/api/collections/employees/records")).status !== 200);

  console.log("Leave (FR-9.10)");
  const mira = await O.post("/api/chedam/employees", { user: people["Mira Manager"], legal_name: "Mira Manager", pay_type: "salary", pay_rate_cents: 5200000, hours_per_week: 40, vacation_days_per_year: 15, sick_days_per_year: 5, start_date: "2025-03-01" });
  const ac = await O.post("/api/chedam/hr/accrue?day=2026-10-10", {});
  check("monthly accrual and the yearly sick grant", ac.status === 200 && ac.json.added >= 2, JSON.stringify(ac.json));
  const lv = (await O.get(`/api/chedam/employees/${mira.json.id}`)).json.leave;
  check("Mira: 15 days a year / 12 = 10 hours of vacation; 5 sick days = 40 hours", lv.vacation === 10 && lv.sick === 40, JSON.stringify(lv));
  check("the same month again adds nothing", (await O.post("/api/chedam/hr/accrue?day=2026-10-20", {})).json.added === 0);
  const calLeave = (await O.get(`/api/chedam/employees/${cal.json.id}`)).json.leave;
  check("Cal (hourly, started 2026-01-05): the sick grant after 90 days, no monthly vacation hours (paid as 4% on each pay)", calLeave.sick === 40 && calLeave.vacation === 0, JSON.stringify(calLeave));
  const tk = await M.post(`/api/chedam/employees/${mira.json.id}/leave`, { kind: "sick", hours: 8, day: "2026-10-09", note: "Flu" });
  check("a manager records a sick day taken", tk.status === 200 && tk.json.leave.sick === 32);
  check("more than is left is refused", (await M.post(`/api/chedam/employees/${mira.json.id}/leave`, { kind: "vacation", hours: 50 })).status === 400);
  check("a manager cannot adjust a balance", (await M.post(`/api/chedam/employees/${mira.json.id}/leave`, { kind: "vacation", hours: 8, source: "adjust", note: "x" })).status === 403);
  check("an adjustment needs a reason", (await O.post(`/api/chedam/employees/${mira.json.id}/leave`, { kind: "vacation", hours: 8, source: "adjust" })).status === 400);
  const adj = await O.post(`/api/chedam/employees/${mira.json.id}/leave`, { kind: "vacation", hours: 16, source: "adjust", note: "Carried over from last year" });
  check("the owner adjusts with a reason", adj.json.leave.vacation === 26);
  const hist = (await M.get(`/api/chedam/employees/${mira.json.id}/leave`)).json.items;
  check("the history: accrual, grant, taken, adjustment", ["accrual", "grant", "taken", "adjust"].every((k) => hist.some((x) => x.source === k)));
} catch (e) { err = e; }
await t.finish(err);

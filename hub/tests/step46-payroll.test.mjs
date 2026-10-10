// P4 step 5: payroll preparation (FR-9.11-9.13, P4-c). From approved time sheets and salaries to gross
// (overtime, sick pay, vacation pay, unpaid leave), reimbursements, entered deductions, finalising (time
// sheets paid, pay stubs to each person), the payment, pay stubs with year-to-date, T4 boxes, ROE data.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step46-payroll.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8139 });
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
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), owner = await login("Demo Owner"), acct = await login("Ana Accountant");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), O = as(owner), A = as(acct);
  const shared = await t.pair("Back room tablet");
  const clk = (name, action, when) => t.api("POST", "/api/chedam/clock?at=" + encodeURIComponent(when), { user: people[name], pin: PIN[name], action }, { token: t.su, device: shared });
  const cal = people["Cal Cashier"], mira = people["Mira Manager"];
  const ce = (await O.post("/api/chedam/employees", { user: cal, legal_name: "Calvin Cashier", pay_type: "hourly", pay_rate_cents: 2000, start_date: "2026-03-02", sin: "046 454 286" })).json;
  const me = (await O.post("/api/chedam/employees", { user: mira, legal_name: "Mira Manager", pay_type: "salary", pay_rate_cents: 5200000, hours_per_week: 40, start_date: "2025-03-01" })).json;
  await O.post("/api/chedam/employees", { user: people["Sam Staff"], legal_name: "Sam Staff", pay_type: "hourly", pay_rate_cents: 1800 });
  // Cal: Mon 450 min; Tue 540 min (60 overtime); sick 8 h on Wed; an expense paid back with the next pay
  await clk("Cal Cashier", "in", at(9, 14, 9)); await clk("Cal Cashier", "break", at(9, 14, 12)); await clk("Cal Cashier", "back", at(9, 14, 12, 30)); await clk("Cal Cashier", "out", at(9, 14, 17));
  await clk("Cal Cashier", "in", at(9, 15, 9)); await clk("Cal Cashier", "break", at(9, 15, 12)); await clk("Cal Cashier", "back", at(9, 15, 12, 30)); await clk("Cal Cashier", "out", at(9, 15, 18, 30));
  await O.post(`/api/chedam/employees/${ce.id}/leave`, { kind: "sick", hours: 8, source: "adjust", note: "Sick days this year" });
  await M.post(`/api/chedam/employees/${ce.id}/leave`, { kind: "sick", hours: 8, day: "2026-09-16", note: "Flu" });
  await O.post(`/api/chedam/employees/${me.id}/leave`, { kind: "unpaid", hours: 8, day: "2026-09-18", note: "Personal day" });
  const ex = await C.post("/api/chedam/expenses", { vendor_name: "Staples", category: "Office", amount_cents: 2599, day: "2026-09-15", paid_with: "own_money" });
  await M.post(`/api/chedam/expenses/${ex.json.id}/approve`, {});
  await M.post(`/api/chedam/expenses/${ex.json.id}/reimburse`, { with: "next_pay" });
  await clk("Sam Staff", "in", at(9, 17, 9)); await clk("Sam Staff", "out", at(9, 17, 13));
  check("Cal's time sheet approved", (await M.post("/api/chedam/timesheets/approve", { user: cal, period: "2026-09-20", note: "Checked" })).status === 200);

  console.log("The payroll run (FR-9.11)");
  check("a cashier and a manager cannot prepare payroll", (await C.get("/api/chedam/payroll")).status === 403 && (await M.get("/api/chedam/payroll")).status === 403);
  check("the accountant can", (await A.get("/api/chedam/payroll")).status === 200);
  const run = await A.post("/api/chedam/payroll", { period: "2026-09-20", pay_date: "2026-10-02" });
  check("a run for 13-26 September: Cal and Mira; Sam waits (time sheet not approved)", run.status === 200 && run.json.lines.length === 2 && run.json.waiting.some((w) => w.legal_name === "Sam Staff") && /^PR-/.test(run.json.number), JSON.stringify(run.json).slice(0, 500));
  check("one run per period", (await A.post("/api/chedam/payroll", { period: "2026-09-14", pay_date: "2026-10-02" })).status === 400);
  const L = (r, n) => r.json.lines.find((l) => l.legal_name === n);
  const c1 = L(run, "Calvin Cashier");
  check("Cal: 15 h 30 × $20 = $310, 1 h overtime $30, sick 8 h $160, vacation pay 4% $20 = gross $520", c1.regular_cents === 31000 && c1.overtime_cents === 3000 && c1.sick_cents === 16000 && c1.vacation_pay_cents === 2000 && c1.gross_cents === 52000, JSON.stringify(c1));
  check("and the $25.99 expense paid back (not taxable)", c1.reimbursements_cents === 2599 && c1.reimbursed.length === 1 && c1.net_cents === 54599);
  const m1 = L(run, "Mira Manager");
  check("Mira: $52,000 / 26 = $2,000, less 8 h unpaid at $25 = $1,800", m1.salary_cents === 200000 && m1.unpaid_cents === 20000 && m1.gross_cents === 180000, JSON.stringify(m1));
  check("finalising before the deductions are entered is refused", (await A.post(`/api/chedam/payroll/${run.json.id}/finalize`, {})).status === 400);

  console.log("Deductions entered (P4-c)");
  check("more deductions than pay: refused", (await A.post(`/api/chedam/payroll/${run.json.id}/lines/${c1.id}`, { tax_cents: 60000 })).status === 400);
  const u1 = await A.post(`/api/chedam/payroll/${run.json.id}/lines/${c1.id}`, { cpp_cents: 2750, ei_cents: 850, tax_cents: 4000 });
  const c2 = L(u1, "Calvin Cashier");
  check("Cal's deductions from PDOC: net $469.99; employer CPP $27.50, EI $11.90", c2.net_cents === 46999 && c2.cpp_er_cents === 2750 && c2.ei_er_cents === 1190 && c2.deductions_entered);
  const u2 = await A.post(`/api/chedam/payroll/${run.json.id}/lines/${m1.id}`, { stat_cents: 0, cpp_cents: 10000, cpp2_cents: 0, ei_cents: 3000, tax_cents: 25000 });
  check("the run's totals", u2.json.gross_cents === 232000 && u2.json.net_cents === 46999 + 142000 && u2.json.employer_cents === 2750 + 1190 + 10000 + 4200, JSON.stringify(u2.json).slice(0, 300));
  const fin = await A.post(`/api/chedam/payroll/${run.json.id}/finalize`, {});
  check("finalised", fin.status === 200 && fin.json.status === "finalized" && fin.json.finalized_by === "Ana Accountant");
  check("no more changes", (await A.post(`/api/chedam/payroll/${run.json.id}/lines/${c1.id}`, { tax_cents: 1 })).status === 400);
  const ts = (await t.list("timesheets", `user='${cal}'`)).items[0];
  check("Cal's time sheet is paid and cannot be reopened", ts.status === "paid" && ts.payroll === run.json.id && (await M.post("/api/chedam/timesheets/reopen", { user: cal, period: "2026-09-20", reason: "x" })).status === 400);
  check("Cal is told (inbox)", (await t.list("inbox_items", `user='${cal}' && title~'pay stub'`)).items.length === 1);
  check("payment recorded", (await A.post(`/api/chedam/payroll/${run.json.id}/paid`, { method: "direct_deposit", reference: "Batch 0926" })).json.status === "paid");

  console.log("Pay stubs, T4, ROE (FR-9.12, 9.13)");
  const st = (await C.get("/api/chedam/me/paystubs")).json.items;
  check("Cal's pay stub with year-to-date", st.length === 1 && st[0].net_cents === 46999 && st[0].ytd.gross_cents === 52000 && st[0].ytd.cpp_cents === 2750);
  check("Mira sees only her own", (await M.get("/api/chedam/me/paystubs")).json.items.every((x) => x.user === mira));
  check("the expense is not paid back twice", (await t.list("expenses", `id='${ex.json.id}'`)).items[0].payroll === run.json.id);
  const t4 = (await A.get("/api/chedam/payroll/t4?year=2026")).json.items.find((x) => x.legal_name === "Calvin Cashier");
  check("T4 2026 for Cal: box 14 $520, 16 $27.50, 18 $8.50, 22 $40, SIN masked", t4 && t4.box14 === 52000 && t4.box16 === 2750 && t4.box18 === 850 && t4.box22 === 4000 && t4.sin === "•••-•••-286", JSON.stringify(t4));
  await O.post("/api/chedam/employees", { id: ce.id, status: "ended", end_date: "2026-09-26" });
  const roe = (await A.get(`/api/chedam/payroll/roe/${ce.id}`)).json;
  check("ROE for Cal: first day, last day paid, final period end, 25 insurable hours, earnings by period", roe.block10_first_day === "2026-03-02" && roe.block11_last_day_paid === "2026-09-26" && roe.block12_final_period_end === "2026-09-26" && roe.block15a_insurable_hours === 25 && roe.block15c_earnings[0].insurable_cents === 52000, JSON.stringify(roe));
  const r2 = await A.post("/api/chedam/payroll", { period: "2026-10-01", pay_date: "2026-10-16" });
  check("the next run (Mira's salary) can be cancelled while a draft", r2.status === 200 && (await A.post(`/api/chedam/payroll/${r2.json.id}/cancel`, {})).json.status === "cancelled", JSON.stringify(r2.json).slice(0, 200));
  check("pay is never in the event log for a cashier to see (table closed)", (await C.get("/api/collections/payroll_lines/records")).status !== 200);
} catch (e) { err = e; }
await t.finish(err);

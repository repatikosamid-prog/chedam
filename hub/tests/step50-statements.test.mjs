// P4 step 9: financial statements and tax returns (FR-10.07, 10.08, 4.15). Profit and loss (with the period
// before), balance sheet (balanced, with the earnings to date), cash flow (opening + in − out = closing),
// GST/HST return lines from the books, BC PST return with the commission, filed returns kept once.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step50-statements.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8143 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), acct = await login("Ana Accountant"), owner = await login("Demo Owner");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), A = as(acct), O = as(owner);
  const now = new Date(), today = ymd(now);
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1), prev = ymd(pm).substring(0, 7);
  const last = ymd(new Date(now.getFullYear(), now.getMonth(), 0));
  const D = (d) => prev + "-" + String(d).padStart(2, "0");
  const party = async (n) => (await t.list("parties", `name='${n}'`)).items[0];
  const coastal = await party("Coastal Beverages Ltd."), luna = await party("Cafe Luna");

  // Last month
  const acc = await A.post("/api/chedam/bank/accounts", { name: "RBC Business", kind: "chequing", opening_balance_cents: 1000000, opening_date: D(1) });
  const bill = await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, party_ref: "CB-1", doc_date: D(10), lines: [{ description: "Drinks", unit_cents: 10000 }], taxes: [{ code: "GST", label: "GST 5%", cents: 500 }] });
  await A.post(`/api/chedam/bills/${bill.json.id}/pay`, { day: D(20), amount_cents: 10500, method: "e_transfer" });
  const ex = await C.post("/api/chedam/expenses", { vendor_name: "Staples", category: "Office", amount_cents: 2100, gst_cents: 100, day: D(15), paid_with: "company_card" });
  await M.post(`/api/chedam/expenses/${ex.json.id}/approve`, {});
  await A.post("/api/chedam/bills", { kind: "invoice", party: luna.id, doc_date: D(18), lines: [{ description: "Beans", qty: 3, unit_cents: 2000 }], taxes: [{ code: "GST", label: "GST 5%", cents: 300 }] });
  await A.post("/api/chedam/bank/import", { account: acc.json.id, filename: "a.csv", text: `Date,Description,Amount\n${D(20)},E-TRANSFER COASTAL,-105.00\n${D(28)},MONTHLY FEE,-12.50\n${D(28)},TRANSFER TO OWNER,-500.00\n` });
  for (const l of (await A.get(`/api/chedam/bank/lines?account=${acc.json.id}&status=unmatched`)).json.items) await A.post(`/api/chedam/bank/lines/${l.id}/match`, { kind: "category", category: l.description.includes("FEE") ? "Bank fees" : "Owner draw" });
  // Today: sales with GST and PST
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const choc = (await C.get("/api/chedam/catalogue/lookup?code=2000000000077")).json.matches[0];
  const sl = [{ key: "a", product: choc.product.id, selling_unit: choc.unit.id, qty: 2 }];
  const q = (await C.post("/api/chedam/sales/quote", { lines: sl })).json;
  await C.post("/api/chedam/sales", { id: sid(), lines: sl, expected_total_cents: q.total_cents, payments: [{ method: "card", amount_cents: q.total_cents }] });

  console.log("Profit and loss (FR-10.07)");
  check("a manager cannot see the statements", (await M.get("/api/chedam/statements/pnl")).status === 403);
  const p = (await A.get(`/api/chedam/statements/pnl?from=${D(1)}&to=${last}&compare=1`)).json;
  check("last month: revenue $60 (invoice), expenses $20 office + $12.50 bank fees, net $27.50", p.revenue_cents === 6000 && p.expenses_cents === 3250 && p.net_income_cents === 2750 && p.gross_margin_pct === 100, JSON.stringify(p).slice(0, 600));
  check("with the month before for comparison", p.previous && p.previous.net_income_cents === 0);
  const pt = (await O.get(`/api/chedam/statements/pnl?from=${today}&to=${today}`)).json;
  check("today (the owner): sales less cost of goods; card fees estimated beside it", pt.revenue_cents > 0 && pt.cost_cents > 0 && pt.card_fees_estimate_cents > 0 && pt.net_income_with_estimates_cents === pt.net_income_cents - pt.card_fees_estimate_cents, JSON.stringify(pt).slice(0, 400));

  console.log("Balance sheet and cash flow");
  const b = (await A.get(`/api/chedam/statements/balance?to=${last}`)).json;
  const row = (ls, k) => (ls.find((r) => r.key === k) || { cents: 0 }).cents;
  check("assets = liabilities + equity + earnings", b.balanced && b.earnings_cents === 2750, JSON.stringify([b.assets_cents, b.liabilities_cents, b.equity_cents, b.earnings_cents]));
  check("bank $9,382.50; receivable $63; GST/HST collected $3; store card $21; owner draws −$500", row(b.assets, "bank:" + acc.json.id) === 938250 && row(b.assets, "ar") === 6300 && row(b.liabilities, "gst_payable") === 300 && row(b.liabilities, "credit_card") === 2100 && row(b.equity, "owner_draws") === -50000, JSON.stringify(b).slice(0, 700));
  const cf = (await A.get(`/api/chedam/statements/cashflow?from=${D(1)}&to=${last}`)).json;
  check("cash flow: opening $0 + opening balance (financing) − vendor − bank fees − owner draw = closing", cf.balanced && cf.opening_cents === 0 && cf.closing_cents === 938250 && cf.financing_cents === 1000000 - 50000 && cf.operating_cents === -10500 - 1250, JSON.stringify(cf));

  console.log("GST/HST and PST returns (FR-10.08, 4.15)");
  const g = (await A.get(`/api/chedam/statements/gst?from=${D(1)}&to=${last}`)).json;
  check("GST/HST: 101 $60, 103 $3, 106 $6 (bill $5 + office $1), 109 −$3: a refund", g.line101_cents === 6000 && g.line103_cents === 300 && g.line106_cents === 600 && g.line109_cents === -300 && g.refund, JSON.stringify(g));
  const ps = (await A.get(`/api/chedam/statements/pst?from=${today}&to=${today}`)).json;
  check("PST today: collected, sales subject to it, 3.3% commission", ps.collected_cents > 0 && Math.abs(Math.round(ps.sales_subject_cents * 0.07) - ps.collected_cents) <= 2 && ps.commission_cents === Math.min(Math.round(ps.collected_cents * 0.033), 19800) && ps.net_cents === ps.collected_cents - ps.commission_cents, JSON.stringify(ps));
  const f = await A.post("/api/chedam/tax-returns", { kind: "gst", from: D(1), to: last, filed_on: today, confirmation: "RC-12345" });
  check("the GST/HST return recorded as filed with its figures", f.status === 200 && f.json.net_cents === -300 && f.json.figures.line103_cents === 300 && f.json.confirmation === "RC-12345");
  check("not twice", (await A.post("/api/chedam/tax-returns", { kind: "gst", from: D(1), to: last, filed_on: today })).status === 400);
  check("a period not over yet cannot be filed", (await A.post("/api/chedam/tax-returns", { kind: "pst", from: today, to: today, filed_on: today })).status === 400);
  check("listed", (await A.get("/api/chedam/tax-returns")).json.items.length === 1);
} catch (e) { err = e; }
await t.finish(err);

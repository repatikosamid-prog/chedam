// P4 step 10: accountant exports (FR-10.12). QuickBooks and Xero journal CSVs (balanced per journal, the
// accountant's own codes), the sales journal one per day, the payroll journal and register, expenses, the bank
// reconciliation; date formats.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step51-accountant-exports.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8144 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const parse = (text) => text.trim().split(/\r\n/).map((l) => { const out = []; let c = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ",") { out.push(c); c = ""; } else c += ch; } out.push(c); return out; });

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
  const prev = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)).substring(0, 7), last = ymd(new Date(now.getFullYear(), now.getMonth(), 0));
  const D = (d) => prev + "-" + String(d).padStart(2, "0");
  const coastal = (await t.list("parties", `name='Coastal Beverages Ltd.'`)).items[0];
  const acc = await A.post("/api/chedam/bank/accounts", { name: "RBC Business", kind: "chequing", opening_balance_cents: 1000000, opening_date: D(1) });
  const bill = await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, party_ref: "CB-1", doc_date: D(10), lines: [{ description: "Drinks", unit_cents: 10000 }], taxes: [{ code: "GST", label: "GST 5%", cents: 500 }] });
  await A.post(`/api/chedam/bills/${bill.json.id}/pay`, { day: D(20), amount_cents: 10500, method: "e_transfer" });
  const ex = await C.post("/api/chedam/expenses", { vendor_name: "Staples, Inc.", category: "Office", amount_cents: 2100, gst_cents: 100, day: D(15), paid_with: "company_card", note: 'Paper "A4"' });
  await M.post(`/api/chedam/expenses/${ex.json.id}/approve`, {});
  await A.post("/api/chedam/bank/import", { account: acc.json.id, filename: "a.csv", text: `Date,Description,Amount\n${D(20)},E-TRANSFER COASTAL,-105.00\n${D(28)},MONTHLY FEE,-12.50\n` });
  // Payroll: Mira's salary for the pay period ending last month
  await O.post("/api/chedam/employees", { user: people["Mira Manager"], legal_name: "Mira Manager", pay_type: "salary", pay_rate_cents: 5200000, start_date: "2025-01-01" });
  const run = await A.post("/api/chedam/payroll", { period: D(10), pay_date: D(25) });
  const line = run.json.lines[0];
  await A.post(`/api/chedam/payroll/${run.json.id}/lines/${line.id}`, { cpp_cents: 10000, ei_cents: 3000, tax_cents: 25000 });
  await A.post(`/api/chedam/payroll/${run.json.id}/finalize`, {});
  await A.post(`/api/chedam/payroll/${run.json.id}/paid`, { method: "direct_deposit", day: D(25) });
  // Today: two sales
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const choc = (await C.get("/api/chedam/catalogue/lookup?code=2000000000077")).json.matches[0];
  const sl = [{ key: "a", product: choc.product.id, selling_unit: choc.unit.id, qty: 1 }];
  const q = (await C.post("/api/chedam/sales/quote", { lines: sl })).json;
  for (let i = 0; i < 2; i++) await C.post("/api/chedam/sales", { id: sid(), lines: sl, expected_total_cents: q.total_cents, payments: [{ method: "card", amount_cents: q.total_cents }] });
  const ch = (await A.get("/api/chedam/books/accounts")).json.items;
  await A.post(`/api/chedam/books/accounts/${ch.find((a) => a.key === "ap").id}`, { external_code: "2000-AP" });
  const X = (p) => A.get("/api/chedam/exports/accountant?" + p);

  console.log("Journals for QuickBooks and Xero (FR-10.12)");
  check("a manager cannot export the books", (await M.get(`/api/chedam/exports/accountant?kind=journal`)).status === 403);
  const qb = (await X(`kind=journal&from=${D(1)}&to=${last}&format=quickbooks`)).json;
  const qr = parse(qb.csv);
  check("QuickBooks: its header; the file name says so", qr[0].join() === "Journal No.,Journal Date,Account Name,Debits,Credits,Description,Name" && qb.filename.endsWith("-quickbooks.csv"), qr[0].join());
  const byNo = {};
  qr.slice(1).forEach((r) => { const x = byNo[r[0]] || (byNo[r[0]] = { d: 0, c: 0 }); x.d += Math.round(Number(r[3] || 0) * 100); x.c += Math.round(Number(r[4] || 0) * 100); });
  check("every journal balances", Object.keys(byNo).length >= 6 && Object.values(byNo).every((x) => x.d === x.c && x.d > 0), JSON.stringify(byNo));
  check("payables go out under the accountant's code 2000-AP", qr.some((r) => r[2] === "2000-AP"));
  check("the expense memo with a comma and quotes survives", qr.some((r) => r[5].includes("Staples, Inc.")));
  const xe = (await X(`kind=journal&from=${D(1)}&to=${last}&format=xero&dates=dmy`)).json;
  const xr = parse(xe.csv);
  const byN = {};
  xr.slice(1).forEach((r) => { byN[r[0] + r[1]] = (byN[r[0] + r[1]] || 0) + Math.round(Number(r[5]) * 100); });
  check("Xero: its header, codes, amounts summing to zero per journal, dates DD/MM/YYYY", xr[0][0] === "*Narration" && xr[0][3] === "*AccountCode" && Object.values(byN).every((v) => v === 0) && /^\d{2}\/\d{2}\/\d{4}$/.test(xr[1][1]) && xr.some((r) => r[3] === "2000-AP"), xe.csv.slice(0, 300));

  console.log("Sales, payroll, expenses, bank");
  const sj = (await X(`kind=sales&from=${today}&to=${today}`)).json;
  const sr = parse(sj.csv);
  check("the sales journal: one journal for the day (sales and stock together)", sj.rows === 1 && new Set(sr.slice(1).map((r) => r[0])).size === 1 && sr.some((r) => r[2] === "Sales"), sj.csv.slice(0, 400));
  const pj = (await X(`kind=payroll&from=${D(1)}&to=${last}`)).json;
  const pr = parse(pj.csv), rg = parse(pj.register.csv);
  check("the payroll journal: wages, deductions to remit (with the employer share), wages payable, and the payment", pr.some((r) => r[2] === "Wages" && r[3] === "2000.00") && pr.some((r) => r[2].startsWith("CPP, EI") && r[4] === "522.00") && pj.rows === 2, pj.csv);
  check("the payroll register: Mira's pay stub", pj.register.rows === 1 && rg[1][2] === "Mira Manager" && rg[1][5] === "2000.00" && rg[1][13] === "1620.00", pj.register.csv);
  const ec = parse((await X(`kind=expenses&from=${D(1)}&to=${last}`)).json.csv);
  check("expenses: the claim with its account and GST", ec.length === 2 && ec[1][3] === "Office" && ec[1][6] === "1.00" && ec[1][12] === 'Paper "A4"', JSON.stringify(ec));
  const bc = parse((await X(`kind=bank&from=${D(1)}&to=${last}&dates=mdy`)).json.csv);
  check("bank reconciliation: each line with what it matched, dates MM/DD/YYYY", bc.length === 3 && bc.some((r) => r[4] === "matched" && r[5].includes(bill.json.number)) && bc.some((r) => r[4] === "unmatched") && /^\d{2}\/\d{2}\/\d{4}$/.test(bc[1][1]), JSON.stringify(bc));
  check("an unknown export is refused", (await X("kind=nope")).status === 400);
} catch (e) { err = e; }
await t.finish(err);

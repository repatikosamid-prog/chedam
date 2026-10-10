// P4 step 8: the books and period close (FR-10.06, P4-d, BR-34). The journal derived from sales, stock, bills,
// payments, expenses, bank lines; balanced; balances by account; the chart renamed and mapped; closing a month
// (checks, in order, after it ends) locks what is dated in it; only the owner reopens, with a reason.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step49-books.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8142 });
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
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1), prev = ymd(pm).substring(0, 7);     // last month, e.g. 2026-09
  const D = (d) => prev + "-" + String(d).padStart(2, "0");
  const coastal = (await t.list("parties", `name='Coastal Beverages Ltd.'`)).items[0];

  // Last month: the bank account opened, a vendor bill paid by e-transfer, an expense on the store card, a bank fee
  const acc = await A.post("/api/chedam/bank/accounts", { name: "RBC Business", kind: "chequing", opening_balance_cents: 1000000, opening_date: D(1) });
  const bill = await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, party_ref: "CB-1", doc_date: D(10), lines: [{ description: "Drinks", qty: 1, unit_cents: 10000 }], taxes: [{ code: "GST", label: "GST 5%", cents: 500 }] });
  await A.post(`/api/chedam/bills/${bill.json.id}/pay`, { day: D(20), amount_cents: 10500, method: "e_transfer", reference: "ET1" });
  const ex = await C.post("/api/chedam/expenses", { vendor_name: "Staples", category: "Office", amount_cents: 2100, gst_cents: 100, day: D(15), paid_with: "company_card" });
  await M.post(`/api/chedam/expenses/${ex.json.id}/approve`, {});
  const csv = `Date,Description,Amount\n${D(20)},E-TRANSFER COASTAL,-105.00\n${D(28)},MONTHLY FEE,-12.50\n`;
  await A.post("/api/chedam/bank/import", { account: acc.json.id, filename: "sep.csv", text: csv });
  const fee = (await A.get(`/api/chedam/bank/lines?account=${acc.json.id}&status=unmatched`)).json.items[0];
  await A.post(`/api/chedam/bank/lines/${fee.id}/match`, { kind: "category", category: "Bank fees" });
  // Today: a card sale and a cash sale
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const choc = (await C.get("/api/chedam/catalogue/lookup?code=2000000000077")).json.matches[0];
  const sl = [{ key: "a", product: choc.product.id, selling_unit: choc.unit.id, qty: 1 }];
  const q = (await C.post("/api/chedam/sales/quote", { lines: sl })).json;
  const s1 = await C.post("/api/chedam/sales", { id: sid(), lines: sl, expected_total_cents: q.total_cents, payments: [{ method: "card", amount_cents: q.total_cents }] });
  const s2 = await C.post("/api/chedam/sales", { id: sid(), lines: sl, expected_total_cents: q.total_cents, payments: [{ method: "cash", amount_cents: q.total_cents + 100 }] });
  check("setup: two sales today", s1.status === 200 && s2.status === 200, JSON.stringify(s2.json).slice(0, 200));

  console.log("The journal (FR-10.06, P4-d)");
  check("a manager cannot see the books", (await M.get("/api/chedam/books/trial")).status === 403);
  const ch = (await A.get("/api/chedam/books/accounts")).json.items;
  check("the chart: standard accounts, the bank account and the expense categories", ch.some((a) => a.key === "sales") && ch.some((a) => a.key === "bank:" + acc.json.id && a.name.includes("RBC")) && ch.some((a) => a.key === "exp:Office"));
  const jr = (await A.get(`/api/chedam/books/journal?from=${D(1)}&to=${D(28)}`)).json.items;
  check("last month's entries: opening, bill, payment, expense, bank lines", ["opening", "bill", "bill_payment", "expense", "bank"].every((s) => jr.some((e) => e.source === s)) && jr.every((e) => !e.plug), JSON.stringify(jr.map((e) => e.source)));
  const tb = (await A.get(`/api/chedam/books/trial?from=${D(1)}&to=${D(28)}`)).json;
  const B = (k) => (tb.rows.find((r) => r.key === k) || { balance_cents: 0 }).balance_cents;
  check("balanced", tb.balanced && tb.total_dr > 0, JSON.stringify([tb.total_dr, tb.total_cr]));
  check("bank $10,000 − $105 − $12.50; the payment is on the statement (clearing 0); nothing owed to Coastal", B("bank:" + acc.json.id) === 1000000 - 10500 - 1250 && B("bank_clearing") === 0 && B("ap") === 0, JSON.stringify(tb.rows));
  check("GST paid $5 + $1; office $20 on the store card; bank fees $12.50; owner's equity $10,000", B("gst_receivable") === 600 && B("exp:Office") === 2000 && B("credit_card") === -2100 && B("bank_fees") === 1250 && B("owner_equity") === -1000000);
  const tt = (await A.get(`/api/chedam/books/trial?from=${today}&to=${today}`)).json;
  const T2 = (k) => (tt.rows.find((r) => r.key === k) || { period_dr: 0, period_cr: 0 });
  check("today's sales: card and cash in, sales and GST out, cost of goods against inventory; balanced", tt.balanced && T2("card_clearing").period_dr === q.total_cents && T2("cash").period_dr === q.total_cents + (s2.json.sale.rounding_cents || 0) && T2("sales").period_cr > 0 && T2("cogs").period_dr > 0 && T2("inventory").period_cr === T2("cogs").period_dr, JSON.stringify(tt.rows.filter((r) => r.period_dr || r.period_cr)));
  const sales = ch.find((a) => a.key === "sales");
  const rn = await A.post(`/api/chedam/books/accounts/${sales.id}`, { name: "Sales - store", external_code: "4000-QB" });
  check("the accountant renames and maps an account", rn.json.name === "Sales - store" && rn.json.external_code === "4000-QB");

  console.log("Closing a month (BR-34)");
  const per = (await A.get("/api/chedam/books/periods")).json.items;
  check("months listed: last month ended, this month open", per.some((p) => p.month === prev && p.ended && p.status === "open") && per.some((p) => p.month === today.substring(0, 7) && !p.ended));
  const w = await A.post("/api/chedam/books/periods/close", { month: prev });
  check("closing shows what is still open first (bank not reconciled)", w.status === 200 && !w.json.closed && w.json.warnings.some((x) => x.includes("reconciled")), JSON.stringify(w.json));
  check("this month cannot be closed yet", (await A.post("/api/chedam/books/periods/close", { month: today.substring(0, 7), confirm: true })).status === 400);
  const cl = await A.post("/api/chedam/books/periods/close", { month: prev, confirm: true });
  check("closed, with the warnings kept", cl.json.closed && (await A.get("/api/chedam/books/periods")).json.items.find((p) => p.month === prev).status === "closed");
  check("a bill dated in it is refused", (await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, party_ref: "CB-2", doc_date: D(25), lines: [{ description: "x", unit_cents: 100 }] })).status === 400);
  check("an expense dated in it is refused", (await C.post("/api/chedam/expenses", { vendor_name: "x", category: "Office", amount_cents: 100, day: D(26), paid_with: "own_money" })).status === 400);
  check("a bank line in it cannot be unmatched", (await A.post(`/api/chedam/bank/lines/${fee.id}/unmatch`, {})).status === 400);
  const im = await A.post("/api/chedam/bank/import", { account: acc.json.id, filename: "late.csv", text: `Date,Description,Amount\n${D(27)},LATE LINE,-1.00\n${today},TODAY LINE,-2.00\n` });
  check("a statement with a line in the closed month: that line is skipped", im.json.added === 1 && im.json.in_closed_months === 1, JSON.stringify(im.json));
  const tb2 = (await A.get(`/api/chedam/books/trial?from=${D(1)}&to=${today}`)).json;
  check("balances still balanced, from the snapshot", tb2.balanced);
  check("the accountant cannot reopen it", (await A.post("/api/chedam/books/periods/reopen", { month: prev, reason: "x" })).status === 403);
  check("the owner needs a reason", (await O.post("/api/chedam/books/periods/reopen", { month: prev })).status === 400);
  check("the owner reopens it", (await O.post("/api/chedam/books/periods/reopen", { month: prev, reason: "A missed vendor bill" })).json.status === "open");
  check("now the bill can be recorded", (await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, party_ref: "CB-2", doc_date: D(25), lines: [{ description: "x", unit_cents: 100 }] })).status === 200);
  check("the close and reopen are in the event log", (await t.list("events", `table_name='periods'`)).items.length >= 2);
} catch (e) { err = e; }
await t.finish(err);

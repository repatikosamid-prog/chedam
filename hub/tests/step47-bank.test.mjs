// P4 step 6: bank (FR-10.02, 10.03). Accounts; CSV (RBC-style header, TD without a header) and OFX/QFX
// imports, duplicates skipped; automatic matches (vendor payment, client payment, cash deposit, expense paid
// back); a card batch matched by hand with its fee; categories; wrong matches refused; reconciliation.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step47-bank.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8140 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const mdy = (s) => { const [y, m, d] = s.split("-"); return m + "/" + d + "/" + y; };

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), acct = await login("Ana Accountant");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), A = as(acct);
  const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 86400000)), yesterday = ymd(new Date(Date.now() - 86400000));
  const party = async (n) => (await t.list("parties", `name='${n}'`)).items[0];
  const coastal = await party("Coastal Beverages Ltd."), luna = await party("Cafe Luna");

  // What Chedam recorded
  const bill = await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, party_ref: "CB-77", doc_date: "2026-09-10", lines: [{ description: "Drinks", qty: 1, unit_cents: 10000 }], taxes: [{ code: "GST", label: "GST 5%", cents: 500 }] });
  await A.post(`/api/chedam/bills/${bill.json.id}/pay`, { day: "2026-09-20", amount_cents: 10500, method: "e_transfer", reference: "ET1" });
  const inv = await A.post("/api/chedam/bills", { kind: "invoice", party: luna.id, doc_date: "2026-09-15", lines: [{ description: "Beans", qty: 3, unit_cents: 2000 }] });
  await A.post(`/api/chedam/bills/${inv.json.id}/pay`, { day: "2026-09-25", amount_cents: 6000, method: "e_transfer", reference: "LUNA" });
  const ex = await C.post("/api/chedam/expenses", { vendor_name: "Staples", category: "Office", amount_cents: 4599, day: today, paid_with: "own_money" });
  await M.post(`/api/chedam/expenses/${ex.json.id}/approve`, {});
  await M.post(`/api/chedam/expenses/${ex.json.id}/reimburse`, { with: "e_transfer", reference: "ET-CAL" });
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const towels = (await C.get("/api/chedam/catalogue/lookup?code=2000000000091")).json.matches[0];
  const sl = [{ key: "a", product: towels.product.id, selling_unit: towels.unit.id, qty: 3 }];
  const q = (await C.post("/api/chedam/sales/quote", { lines: sl })).json;
  const sale = await C.post("/api/chedam/sales", { id: sid(), lines: sl, expected_total_cents: q.total_cents, payments: [{ method: "card", amount_cents: q.total_cents }] });
  check("a card sale today (setup)", sale.status === 200, JSON.stringify(sale.json).slice(0, 200));
  const card = q.total_cents, net = Math.round(card * 0.975);

  console.log("Accounts and deposits (FR-10.03)");
  check("cashiers and managers cannot see the bank", (await C.get("/api/chedam/bank")).status === 403 && (await M.get("/api/chedam/bank")).status === 403);
  const acc = await A.post("/api/chedam/bank/accounts", { name: "RBC Business", institution: "RBC", last4: "1234", kind: "chequing", opening_balance_cents: 1000000, opening_date: "2026-09-01" });
  check("the accountant adds the chequing account", acc.status === 200 && acc.json.balance_cents === 1000000);
  const dep = await A.post("/api/chedam/bank/deposits", { account: acc.json.id, day: yesterday, amount_cents: 25000, note: "Friday's cash" });
  check("a cash deposit to the bank: DP-, in transit", dep.status === 200 && /^DP-/.test(dep.json.number) && dep.json.status === "in_transit");
  check("closed tills to deposit are listed", (await A.get("/api/chedam/bank/tills")).status === 200);

  console.log("Import and automatic matching (FR-10.02)");
  const csv = [
    '"Account Type","Account Number","Transaction Date","Cheque Number","Description 1","Description 2","CAD$","USD$"',
    'Chequing,00001-1234,9/20/2026,,"E-TRANSFER SENT","COASTAL BEV",-105.00,',
    'Chequing,00001-1234,9/25/2026,,"E-TRANSFER RECEIVED","CAFE LUNA",60.00,',
    'Chequing,00001-1234,9/30/2026,,"MONTHLY FEE","",-12.50,',
    `Chequing,00001-1234,${mdy(yesterday)},,"BRANCH DEPOSIT","",250.00,`,
    `Chequing,00001-1234,${mdy(today)},,"E-TRANSFER SENT","CAL C",-45.99,`,
    `Chequing,00001-1234,${mdy(tomorrow)},,"MERCH DEP","MONERIS",${(net / 100).toFixed(2)},`,
  ].join("\r\n");
  const im = await A.post("/api/chedam/bank/import", { account: acc.json.id, filename: "rbc.csv", text: csv });
  check("6 lines imported; 4 matched by themselves (vendor payment, client payment, deposit, expense)", im.status === 200 && im.json.added === 6 && im.json.matched === 4 && im.json.format === "csv", JSON.stringify(im.json));
  check("the same file again: all duplicates", (await A.post("/api/chedam/bank/import", { account: acc.json.id, filename: "rbc.csv", text: csv })).json.duplicates === 6);
  const ls = (await A.get(`/api/chedam/bank/lines?account=${acc.json.id}`)).json.items;
  const L = (d) => ls.find((x) => x.description.includes(d));
  check("the deposit is matched and no longer in transit", L("BRANCH").match_kind === "deposit" && (await A.get("/api/chedam/bank")).json.deposits.find((d) => d.id === dep.json.id).status === "matched");
  check("the e-transfer to Coastal matched its bill payment", L("COASTAL").match_kind === "bill_payment" && L("COASTAL").auto && L("COASTAL").match_refs[0].label.includes(bill.json.number));
  check("Cal's expense paid back matched", L("CAL C").match_kind === "expense");
  const cands = (await A.get(`/api/chedam/bank/lines/${L("MONERIS").id}/candidates`)).json.items;
  const cb = cands.find((x) => x.kind === "card_batch");
  check("the card deposit is offered as today's card sales, with the fee", cb && cb.id === today && cb.fee_cents === card - net, JSON.stringify(cands));
  check("a wrong match is refused", (await A.post(`/api/chedam/bank/lines/${L("MONTHLY").id}/match`, { kind: "bill_payment", refs: [L("COASTAL").match_refs[0].id] })).status === 400);
  const mc = await A.post(`/api/chedam/bank/lines/${L("MONERIS").id}/match`, { kind: "card_batch", refs: [today] });
  check("matched by hand: the fee is recorded", mc.status === 200 && mc.json.fee_cents === card - net && mc.json.matched_by === "Ana Accountant");
  check("a category must be from the list", (await A.post(`/api/chedam/bank/lines/${L("MONTHLY").id}/match`, { kind: "category", category: "Fun" })).status === 400);
  check("the monthly fee: Bank fees", (await A.post(`/api/chedam/bank/lines/${L("MONTHLY").id}/match`, { kind: "category", category: "Bank fees" })).json.category === "Bank fees");

  console.log("Reconciliation");
  const bal = 1000000 - 10500 + 6000 - 1250 + 25000 - 4599 + net;
  const off = await A.post("/api/chedam/bank/reconcile", { account: acc.json.id, to: tomorrow, statement_balance_cents: bal + 100 });
  check("a $1 difference is shown, not reconciled", off.json.difference_cents === 100 && !off.json.reconciled);
  const rec = await A.post("/api/chedam/bank/reconcile", { account: acc.json.id, to: tomorrow, statement_balance_cents: bal });
  check("the statement's balance agrees, nothing unmatched: reconciled", rec.json.reconciled && rec.json.difference_cents === 0, JSON.stringify(rec.json));
  check("a line in a reconciled period cannot be unmatched", (await A.post(`/api/chedam/bank/lines/${L("MONTHLY").id}/unmatch`, {})).status === 400);

  console.log("Other formats");
  const cc = await A.post("/api/chedam/bank/accounts", { name: "Visa", kind: "credit_card", last4: "9876" });
  const ofx = "OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20260928120000[-8:PST]\n<TRNAMT>-23.45\n<FITID>2026092801\n<NAME>GAS STATION\n</STMTTRN>\n<STMTTRN>\n<TRNTYPE>CREDIT\n<DTPOSTED>20260929\n<TRNAMT>100.00\n<FITID>2026092902\n<NAME>PAYMENT THANK YOU\n</STMTTRN>\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";
  const io = await A.post("/api/chedam/bank/import", { account: cc.json.id, filename: "visa.qfx", text: ofx });
  check("a QFX file: 2 transactions by their FITID", io.json.added === 2 && io.json.format === "qfx", JSON.stringify(io.json));
  check("again: duplicates", (await A.post("/api/chedam/bank/import", { account: cc.json.id, filename: "visa.qfx", text: ofx })).json.duplicates === 2);
  const td = await A.post("/api/chedam/bank/accounts", { name: "TD Savings", kind: "savings" });
  const it = await A.post("/api/chedam/bank/import", { account: td.json.id, filename: "td.csv", text: "09/28/2026,COFFEE SHOP,4.50,,995.50\n09/29/2026,INTEREST,,0.12,995.62\n" });
  check("TD's CSV without a header: withdrawals and deposits", it.json.added === 2 && (await A.get(`/api/chedam/bank/lines?account=${td.json.id}`)).json.items.map((x) => x.amount_cents).sort((a, b) => a - b).join() === "-450,12");
  check("a file with no transactions is refused", (await A.post("/api/chedam/bank/import", { account: td.json.id, filename: "x.csv", text: "Date,Description,Amount\n" })).status === 400);
  const d2 = await A.post("/api/chedam/bank/deposits", { account: acc.json.id, day: today, amount_cents: 1000 });
  check("a deposit not on the statement can be cancelled", (await A.post(`/api/chedam/bank/deposits/${d2.json.id}/cancel`, {})).json.status === "cancelled");
  check("in the event log", (await t.list("events", `table_name='bank_lines'`)).items.length >= 8);
} catch (e) { err = e; }
await t.finish(err);

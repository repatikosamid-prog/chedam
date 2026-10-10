// P4 step 7: card fees by card type (estimated, then actual from the bank), delivery-platform payout
// statements against Chedam's orders (and matched to the bank), vendor statements against the bills.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step48-recon.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8141 });
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
  const cashier = await login("Cal Cashier"), acct = await login("Ana Accountant");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), A = as(acct);
  const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 86400000));
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const towels = await find("2000000000091"), choc = await find("2000000000077");
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const sell = async (it, qty, pay) => {
    const sl = [{ key: "a", product: it.product.id, selling_unit: it.unit.id, qty }];
    const q = (await C.post("/api/chedam/sales/quote", { lines: sl })).json;
    const r = await C.post("/api/chedam/sales", { id: sid(), lines: sl, expected_total_cents: q.total_cents, payments: [Object.assign({ method: "card", amount_cents: q.total_cents }, pay)] });
    return { r, total: q.total_cents };
  };

  console.log("Card fees by card type (FR-10.05)");
  const v = await sell(towels, 1, { card_type: "visa", last4: "4242" });
  const n = await sell(choc, 2, {});
  check("card sales: the till records the card type", v.r.status === 200 && v.r.json.sale.payments[0].card_type === "visa" && n.r.status === 200, JSON.stringify(v.r.json).slice(0, 200));
  check("a cashier cannot see card fees", (await C.get("/api/chedam/card-fees")).status === 403);
  const f1 = (await A.get(`/api/chedam/card-fees?from=${today}&to=${today}`)).json;
  const visa = f1.types.find((x) => x.card_type === "visa"), ng = f1.types.find((x) => x.card_type === "not_given");
  check("estimated: Visa 1.6%, not given at the 'other' rate 1.8%", visa && visa.est_fee_cents === Math.round(v.total * 0.016) && ng && ng.est_fee_cents === Math.round(n.total * 0.018), JSON.stringify(f1.types));
  check("no actual fee yet", f1.total.actual_days === 0 && f1.total.fee_cents === f1.total.est_fee_cents);
  const acc = await A.post("/api/chedam/bank/accounts", { name: "RBC", kind: "chequing", opening_balance_cents: 0, opening_date: "2026-09-01" });
  const tot = v.total + n.total, fee = Math.round(tot * 0.021);
  await A.post("/api/chedam/bank/import", { account: acc.json.id, filename: "a.csv", text: `Date,Description,Amount\n${tomorrow},MERCH DEP,${((tot - fee) / 100).toFixed(2)}\n` });
  const line = (await A.get(`/api/chedam/bank/lines?account=${acc.json.id}`)).json.items[0];
  await A.post(`/api/chedam/bank/lines/${line.id}/match`, { kind: "card_batch", refs: [today] });
  const f2 = (await A.get(`/api/chedam/card-fees?from=${today}&to=${today}`)).json;
  check("after the bank deposit: the actual fee (2.1%) replaces the estimate", f2.total.actual_fee_cents === fee && f2.total.fee_cents === fee && f2.total.actual_rate_pct === Math.round((fee * 10000) / tot) / 100, JSON.stringify(f2.total));

  console.log("Platform payouts (FR-8.10)");
  const d1 = await C.post("/api/chedam/delivery", { platform: "Uber Eats", number: "UE-1", lines: [{ product: choc.product.id, selling_unit: choc.unit.id, qty: 1 }] });
  await C.post(`/api/chedam/delivery/${d1.json.id}/picked_up`, {});
  const d2 = await C.post("/api/chedam/delivery", { platform: "Uber Eats", number: "UE-2", lines: [{ product: choc.product.id, selling_unit: choc.unit.id, qty: 2 }] });
  await C.post(`/api/chedam/delivery/${d2.json.id}/picked_up`, {});
  const t1 = d1.json.total_cents, t2 = d2.json.total_cents;
  check("two Uber Eats orders picked up (setup)", t1 > 0 && t2 > 0, JSON.stringify(d1.json).slice(0, 200));
  const gross = t1 + t2 + 500, com = Math.round(gross * 0.3);
  check("a payout that does not add up is refused", (await A.post("/api/chedam/payouts", { platform: "Uber Eats", period_from: today, period_to: today, gross_cents: gross, commission_cents: com, fees_cents: 0, adjustments_cents: 0, payout_cents: 1 })).status === 400);
  const po = await A.post("/api/chedam/payouts", { platform: "Uber Eats", period_from: today, period_to: today, day: tomorrow, gross_cents: gross, commission_cents: com, fees_cents: 99, adjustments_cents: -100, payout_cents: gross - com - 99 - 100,
    orders: [{ number: "UE-1", amount_cents: t1 }, { number: "UE-2", amount_cents: t2 + 200 }, { number: "UE-9", amount_cents: 300 }] });
  const ck = po.json.check;
  check("checked against Chedam's orders: 2 orders, gross $5 more, UE-2 differs, UE-9 not in Chedam, commission %", po.status === 200 && ck.chedam_orders === 2 && ck.gross_difference_cents === 500 && ck.amount_differences.length === 1 && ck.amount_differences[0].number === "UE-2" && ck.not_in_chedam[0].number === "UE-9" && po.json.commission_pct === Math.round((com * 10000) / gross) / 100, JSON.stringify(po.json));
  await A.post("/api/chedam/bank/import", { account: acc.json.id, filename: "b.csv", text: `Date,Description,Amount\n${tomorrow},UBER EATS PAYOUT,${(po.json.payout_cents / 100).toFixed(2)}\n` });
  const pl = (await A.get(`/api/chedam/payouts`)).json;
  check("the bank line matched the payout by itself", pl.items[0].status === "matched" && pl.platforms[0].platform === "Uber Eats" && pl.platforms[0].commission_cents === com, JSON.stringify(pl.items[0]));
  check("a matched payout cannot be cancelled", (await A.post(`/api/chedam/payouts/${po.json.id}/cancel`, {})).status === 400);

  console.log("Vendor statements (FR-10.04)");
  const coastal = (await t.list("parties", `name='Coastal Beverages Ltd.'`)).items[0];
  const b1 = await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, party_ref: "CB-100", doc_date: "2026-09-05", lines: [{ description: "x", unit_cents: 10000 }] });
  const b2 = await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, party_ref: "CB-101", doc_date: "2026-09-12", lines: [{ description: "x", unit_cents: 5000 }] });
  await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, party_ref: "CB-102", doc_date: "2026-09-20", lines: [{ description: "x", unit_cents: 2500 }] });
  await A.post(`/api/chedam/bills/${b1.json.id}/pay`, { day: "2026-09-15", amount_cents: 10000, method: "cheque", reference: "#5" });
  // The vendor's statement: CB-100 paid, CB-101 says $52.00, CB-103 we never recorded; CB-102 not on it
  const vs = await A.post("/api/chedam/vendor-statements", { party: coastal.id, statement_date: "2026-09-30", closing_balance_cents: 5200 + 4000,
    lines: [{ ref: "CB-100", day: "2026-09-05", amount_cents: 10000, kind: "invoice" }, { ref: "#5", amount_cents: 10000, kind: "payment" }, { ref: "cb-101", amount_cents: 5200, kind: "invoice" }, { ref: "CB-103", day: "2026-09-28", amount_cents: 4000, kind: "invoice" }] });
  const v1 = vs.json.check;
  check("the statement against the bills: CB-100 agreed, CB-101 differs, CB-103 missing in Chedam, CB-102 not on it", vs.status === 200 && v1.agreed.length === 1 && v1.amount_differences[0].number === b2.json.number && v1.missing_in_chedam[0].ref === "CB-103" && v1.not_on_statement[0].party_ref === "CB-102", JSON.stringify(v1));
  check("balances: Chedam $75 owed as of 30 Sep, statement $92: $17 difference", v1.chedam_balance_cents === 7500 && vs.json.difference_cents === 1700 && vs.json.status === "differences");
  check("listed for the vendor", (await A.get(`/api/chedam/vendor-statements?party=${coastal.id}`)).json.items.length === 1);
} catch (e) { err = e; }
await t.finish(err);

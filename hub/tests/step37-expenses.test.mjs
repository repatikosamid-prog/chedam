// P3 step 6: expenses and petty cash (FR-9.01-9.03). Claims with receipts; own claims only; approve / reject
// (not your own); reimburse by till cash (a pay-out), petty cash, cheque; paid by the store already; duplicate
// and missing-receipt flags; the petty cash box: expenses, top-ups, counts.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step37-expenses.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8130 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const devs = {};
  const login = async (n) => {
    devs[n] = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: devs[n] })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), staff = await login("Sam Staff"), acct = await login("Ana Accountant");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), S = as(staff), A = as(acct);
  const today = new Date().toISOString().substring(0, 10);

  console.log("Claims (FR-9.01, 9.02)");
  check("an amount is needed", (await S.post("/api/chedam/expenses", { vendor_name: "Home Depot", category: "Repairs and maintenance", amount_cents: 0 })).status === 400);
  check("a category from the list", (await S.post("/api/chedam/expenses", { vendor_name: "Home Depot", category: "Fun", amount_cents: 100 })).status === 400);
  const form = new FormData();
  form.append("data", JSON.stringify({ day: today, vendor_name: "Home Depot", amount_cents: 2350, gst_cents: 112, category: "Repairs and maintenance", paid_with: "own_money", note: "Hinge for the cooler door" }));
  form.append("receipts", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")], { type: "image/png" }), "receipt.png");
  const up = await fetch(t.base + "/api/chedam/expenses", { method: "POST", headers: { Authorization: staff, ...TestHub.deviceHeaders(devs["Sam Staff"]) }, body: form });
  const e1 = await up.json();
  check("Sam claims $23.50 paid with his own money, with the receipt photo", up.status === 200 && /^EX-/.test(e1.number) && e1.status === "submitted" && e1.receipts.length === 1 && e1.flags.length === 0, JSON.stringify(e1));
  const e2 = (await C.post("/api/chedam/expenses", { day: today, vendor_name: "home depot", amount_cents: 2350, category: "Repairs and maintenance", paid_with: "own_money" })).json;
  check("the same amount and vendor within 3 days: flagged as a possible duplicate; no receipt: flagged", e2.flags.includes("duplicate:" + e1.number) && e2.flags.includes("missing_receipt"), JSON.stringify(e2.flags));
  check("Cal sees only Cal's claims", (await C.get("/api/chedam/expenses")).json.items.every((x) => x.claimant === people["Cal Cashier"]));
  check("an approver sees all, with what waits", (await A.get("/api/chedam/expenses")).json.waiting >= 2);
  check("a cashier cannot approve", (await C.post(`/api/chedam/expenses/${e1.id}/approve`, {})).status === 403);
  check("rejecting needs a reason", (await A.post(`/api/chedam/expenses/${e2.id}/reject`, {})).status === 400);
  const rj = await A.post(`/api/chedam/expenses/${e2.id}/reject`, { reason: "Duplicate of " + e1.number });
  check("rejected with the reason", rj.json.status === "rejected" && rj.json.decided_by === "Ana Accountant");
  const ap = await M.post(`/api/chedam/expenses/${e1.id}/approve`, {});
  check("approved: waits to be paid back", ap.json.status === "approved");
  check("paying back needs a way", (await M.post(`/api/chedam/expenses/${e1.id}/reimburse`, { with: "gold" })).status === 400);

  console.log("Paying back from the till");
  const tillDev = devs["Mira Manager"];
  await M.post("/api/chedam/tills/open", { float_cents: 10000 });
  const till = (await t.list("tills", "status='open'")).items[0];
  const rb = await M.post(`/api/chedam/expenses/${e1.id}/reimburse`, { with: "till_cash", till: till.id });
  check("paid back from the open till: a pay-out on the till", rb.status === 200 && rb.json.status === "reimbursed" && (await t.list("cash_movements", `till='${till.id}' && type='payout'`)).items.some((m) => m.amount_cents === 2350 && /EX-/.test(m.reason)), JSON.stringify(rb.json));
  void tillDev;
  const mine = await M.post("/api/chedam/expenses", { vendor_name: "Staples", amount_cents: 999, category: "Office", paid_with: "own_money" });
  check("nobody approves their own claim", (await M.post(`/api/chedam/expenses/${mine.json.id}/approve`, {})).status === 400);

  console.log("Petty cash (FR-9.03)");
  check("staff cannot see the box", (await S.get("/api/chedam/petty-cash")).status === 403);
  check("an expense from an empty box is refused", (await S.post("/api/chedam/expenses", { vendor_name: "Dollarama", amount_cents: 500, category: "Cleaning", paid_with: "petty_cash" })).status === 400);
  await M.post("/api/chedam/petty-cash/top_up", { amount_cents: 20000, note: "Float" });
  const pe = await S.post("/api/chedam/expenses", { vendor_name: "Dollarama", amount_cents: 500, category: "Cleaning", paid_with: "petty_cash" });
  check("paid from the box: the box goes down now", pe.status === 200 && (await M.get("/api/chedam/petty-cash")).json.balance_cents === 19500);
  const pa = await M.post(`/api/chedam/expenses/${pe.json.id}/approve`, {});
  check("approved: the store paid it already, nothing to give back", pa.json.status === "reimbursed");
  const ct = await M.post("/api/chedam/petty-cash/count", { counted_cents: 19400 });
  check("a count: short $1.00 recorded, the balance follows the box", ct.json.balance_cents === 19400 && ct.json.moves[0].kind === "count" && /Short 1.00/.test(ct.json.moves[0].note));
  const by = (await A.get("/api/chedam/expenses")).json.by_category;
  check("totals by category (rejected left out)", by["Repairs and maintenance"] === 2350 && by["Cleaning"] === 500, JSON.stringify(by));
} catch (e) { err = e; }
await t.finish(err);

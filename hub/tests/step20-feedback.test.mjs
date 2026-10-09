// P1 testing feedback (2026-10-09): what each discount was, on the item and on the whole sale, in the
// quote, the saved sale and the printed receipt (DL-109); a device keeps its till number while every
// opening gets its own Z number (DL-110); card settlement batches numbered by the hub, in order, never
// twice (DL-111). Reprints needing a manager are in step15-printing.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step20-feedback.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8113 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Till of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager);
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const cola = await find("2000000000022"), chips = await find("2000000000060");
  const L = (m, extra = {}) => ({ key: "k" + Math.random().toString(36).slice(2, 8), product: m.product.id, selling_unit: m.unit.id, qty: 1, ...extra });

  console.log("Till numbers (DL-110)");
  const o1 = await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  check("first device's till is Till 1, Z 1", o1.status === 200 && o1.json.number === 1 && o1.json.shift === 1, JSON.stringify(o1.json).slice(0, 200));
  await C.post(`/api/chedam/tills/${o1.json.id}/close`, { counted_cents: 10000 });
  const o2 = await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  check("closing and opening again: still Till 1, now Z 2", o2.json.number === 1 && o2.json.shift === 2, JSON.stringify(o2.json).slice(0, 200));
  const o3 = await M.post("/api/chedam/tills/open", { float_cents: 10000 });
  check("another device is Till 2 (Z 3)", o3.json.number === 2 && o3.json.shift === 3, JSON.stringify(o3.json).slice(0, 200));
  check("the open till says its number", (await C.get("/api/chedam/tills/current")).json.till.number === 1);

  console.log("Discounts on items and on the sale (DL-109)");
  const lines = [L(chips, { discount: { type: "pct", value: 10 } }), L(cola, { qty: 2, discount: { type: "amount", value: 50 } }), L(cola)];
  const q = await M.post("/api/chedam/sales/quote", { lines, cart_discount: { type: "pct", value: 5 } });
  const ql = q.json.lines;
  check("quote: each item says its discount", ql[0].discount_label === "10% off" && ql[0].line_discount_cents === 40 && ql[1].discount_label === "$0.50 off" && ql[2].discount_label === "", JSON.stringify(ql.map((l) => [l.discount_label, l.line_discount_cents])));
  check("quote: the sale's discount is apart from the items'", q.json.cart_discount_label === "5% off" && q.json.cart_discount_cents > 0
    && q.json.discount_cents === 40 + 50 + q.json.cart_discount_cents, JSON.stringify([q.json.cart_discount_label, q.json.cart_discount_cents, q.json.discount_cents]));
  const sale = await M.post("/api/chedam/sales", { id: sid(), lines, cart_discount: { type: "pct", value: 5 }, expected_total_cents: q.json.total_cents,
    payments: [{ method: "card", amount_cents: q.json.total_cents }] });
  const sv = sale.json.sale;
  check("saved sale keeps what each discount was", sale.status === 200 && sv.lines[0].discount_label === "10% off" && sv.lines[1].discount_label === "$0.50 off"
    && sv.cart_discount_label === "5% off" && sv.cart_discount_cents === q.json.cart_discount_cents, JSON.stringify(sale.json).slice(0, 300));
  check("the sale carries its till number (for the receipt PDF, DL-116)", sv.till_number === 2, JSON.stringify(sv.till_number));
  const rt = (await M.get(`/api/chedam/sales/${sv.id}/receipt-text?chars=48`)).json.text;
  check("printed receipt: discount under its item, the sale's discount on its own line", /Potato chips 200 g[^\n]*\n\s+Discount 10% off\s+-\$0\.40/.test(rt) && /Discount \$0\.50 off\s+-\$0\.50/.test(rt)
    && /Sale discount 5% off\s+-\$/.test(rt), rt);
  const ten = await C.post("/api/chedam/sales/quote", { lines: [L(chips, { discount: { type: "pct", value: 10 } })] });
  check("10% of $3.99 rounds to $0.40 and is still within a cashier's 10% (no manager)", ten.json.lines[0].line_discount_cents === 40 && !ten.json.needs_approval.length, JSON.stringify(ten.json.needs_approval));
  const eleven = await C.post("/api/chedam/sales/quote", { lines: [L(chips, { discount: { type: "pct", value: 10.5 } })], cart_discount: { type: "pct", value: 10 } });
  check("above the limit still needs a manager", eleven.json.needs_approval.length === 1 && /above 10%/.test(eleven.json.needs_approval[0]), JSON.stringify(eleven.json.needs_approval));
  const none = await C.post("/api/chedam/sales/quote", { lines: [L(cola)] });
  check("no discount: no label", none.json.lines[0].discount_label === "" && none.json.cart_discount_label === "");

  console.log("Card settlement batch numbers (DL-111)");
  const zc = (await C.get("/api/chedam/tills/current")).json.till.summary;
  await C.post(`/api/chedam/tills/${o2.json.id}/close`, { counted_cents: zc.expected_cash_cents });
  const zm = (await M.get("/api/chedam/tills/current")).json.till.summary;
  await M.post(`/api/chedam/tills/${o3.json.id}/close`, { counted_cents: zm.expected_cash_cents });
  const card = (z) => (z.payments.find((p) => p.method === "card") || { amount_cents: 0 }).amount_cents;
  const r1 = await M.post(`/api/chedam/reports/tills/${o1.json.id}/reconcile`, { card_settlement_cents: 0 });
  const r2 = await M.post(`/api/chedam/reports/tills/${o3.json.id}/reconcile`, { card_settlement_cents: card(zm), settlement_ref: "TERM-77" });
  check("batches numbered by the hub in order", r1.json.batch_no === "B-000001" && r2.json.batch_no === "B-000002" && r2.json.settlement_ref === "TERM-77", JSON.stringify([r1.json.batch_no, r2.json.batch_no, r1.message]));
  const bad = await M.post(`/api/chedam/reports/tills/${o2.json.id}/reconcile`, { card_settlement_cents: 999999 });
  check("a refused reconcile uses no number", bad.status === 400);
  const r3 = await M.post(`/api/chedam/reports/tills/${o2.json.id}/reconcile`, { card_settlement_cents: card(zc) });
  check("the next till gets the next number", r3.json.batch_no === "B-000003", JSON.stringify(r3.json.batch_no));
  const again = await M.post(`/api/chedam/reports/tills/${o1.json.id}/reconcile`, { card_settlement_cents: 0, note: "checked again" });
  check("changing a reconciliation keeps its number", again.json.batch_no === "B-000001");
  const nos = (await t.list("tills")).items.map((x) => x.batch_no).filter(Boolean);
  check("never twice", new Set(nos).size === nos.length && nos.length === 3, JSON.stringify(nos));
  const rec = (await M.get("/api/chedam/reports/tills")).json.tills;
  check("reconciliation list shows till, Z and batch", rec.some((x) => x.number === 2 && x.shift === 3 && x.batch_no === "B-000002"), JSON.stringify(rec.map((x) => [x.number, x.shift, x.batch_no])));
} catch (e) {
  err = e;
}
await t.finish(err);

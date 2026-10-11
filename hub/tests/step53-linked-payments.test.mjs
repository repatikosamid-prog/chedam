// P5 step 2: linked card payments at the till (against a fake Square): Card sends the amount to the till's
// terminal, the till asks for the result, the hub fills the card payment from the processor's answer; one
// checkout at a time per terminal; cancel; a paid checkout whose sale was refused is picked up again; it can't
// be used twice or for another amount; Square down, training, waiting too long.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step53-linked-payments.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";
import { startFakeSquare, FAKE_TOKEN } from "../../tools/devhub/fake-square.mjs";

const t = new TestHub({ port: 8146 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

let err = null, fake = null;
try {
  fake = await startFakeSquare();
  await t.start({ CHEDAM_SQUARE_BASE: fake.url });
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const devs = {};
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    devs[n] = dev;
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const owner = await login("Demo Owner"), manager = await login("Mira Manager"), cashier = await login("Cal Cashier");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const O = as(owner), M = as(manager), C = as(cashier);
  await O.post("/api/chedam/payproc/connect", { kind: "square", environment: "sandbox", token: FAKE_TOKEN });
  const tm = (await O.post("/api/chedam/payproc/terminals", { name: "Front terminal", till_device: devs["Cal Cashier"].id })).json;
  fake.pair(Object.keys(fake.st.codes)[0]);
  await O.post(`/api/chedam/payproc/terminals/${tm.id}/refresh`, {});
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  await M.post("/api/chedam/tills/open", { float_cents: 10000 });
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const towels = await find("2000000000091");
  const lines = [{ key: "a", product: towels.product.id, selling_unit: towels.unit.id, qty: 1 }];
  await M.post("/api/chedam/stock/receive", { op_id: sid(), lines: [{ product: towels.product.id, selling_unit: towels.unit.id, qty: 20 }] });
  const total = (await C.post("/api/chedam/sales/quote", { lines })).json.total_cents;
  const sale = (id, payments, extra) => C.post("/api/chedam/sales", Object.assign({ id, lines, expected_total_cents: total, payments }, extra || {}));

  console.log("Card on a linked till (FR-3.21)");
  const s1 = sid();
  const co = await C.post("/api/chedam/terminal/checkouts", { sale_id: s1, amount_cents: total });
  check("the amount is sent to the till's terminal", co.status === 200 && co.json.status === "pending" && co.json.terminal === "Front terminal" && fake.lastCheckout().amount_money.amount === total && fake.lastCheckout().reference_id === s1, JSON.stringify(co.json));
  check("Square's checkout is for this terminal", fake.lastCheckout().device_options.device_id === fake.st.codes[Object.keys(fake.st.codes)[0]].device_id);
  check("waiting while the customer pays", (await C.get(`/api/chedam/terminal/checkouts/${co.json.id}`)).json.status === "pending");
  check("an unlinked till cannot send to a terminal", (await M.post("/api/chedam/terminal/checkouts", { sale_id: sid(), amount_cents: 500 })).status === 400);
  const other = await C.post("/api/chedam/terminal/checkouts", { sale_id: sid(), amount_cents: 500 });
  check("one payment at a time on a terminal", other.status === 400 && /busy/.test(other.json.message));
  const again = await C.post("/api/chedam/terminal/checkouts", { sale_id: s1, amount_cents: total });
  check("the same sale and amount again gets the same checkout", again.json.id === co.json.id && Object.keys(fake.st.checkouts).length === 1);
  check("a sale can't use it before it is approved", (await sale(s1, [{ method: "card", amount_cents: total, checkout: co.json.id }])).status === 400);
  fake.complete(fake.lastCheckout().id, { brand: "VISA", last4: "4242" });
  const done = (await C.get(`/api/chedam/terminal/checkouts/${co.json.id}`)).json;
  check("approved: card type and last 4 from Square", done.status === "completed" && done.card_type === "visa" && done.last4 === "4242", JSON.stringify(done));
  const r1 = await sale(s1, [{ method: "card", amount_cents: total, checkout: co.json.id, last4: "9999", card_type: "amex" }]);
  const p1 = r1.json && r1.json.sale && r1.json.sale.payments[0];
  check("the sale's card payment is filled by the hub (not what the till typed)", r1.status === 200 && p1.last4 === "4242" && p1.card_type === "visa" && p1.linked === true, JSON.stringify(r1.json).slice(0, 300));
  const pr = (await t.list("payments", `sale='${s1}'`)).items[0];
  check("kept: the processor, its payment id, the checkout", pr.processor === "square" && pr.processor_payment.startsWith("PAY") && pr.checkout === co.json.id);
  check("a used checkout can't pay another sale", (await sale(sid(), [{ method: "card", amount_cents: total, checkout: co.json.id }])).status === 400);

  console.log("Cancel on the till, cancelled on the terminal");
  const s2 = sid();
  const c2 = (await C.post("/api/chedam/terminal/checkouts", { sale_id: s2, amount_cents: total })).json;
  const can2 = (await C.post(`/api/chedam/terminal/checkouts/${c2.id}/cancel`, {})).json;
  check("cancelled from the till", can2.status === "cancelled", JSON.stringify(can2));
  const c3 = (await C.post("/api/chedam/terminal/checkouts", { sale_id: s2, amount_cents: total })).json;
  check("a new checkout for the same sale after a cancel", c3.id !== c2.id && c3.status === "pending");
  fake.cancel(fake.lastCheckout().id, "BUYER_CANCELED");
  const p3 = (await C.get(`/api/chedam/terminal/checkouts/${c3.id}`)).json;
  check("cancelled on the terminal: the till is told why", p3.status === "cancelled" && p3.cancel_reason === "buyer_canceled", JSON.stringify(p3));

  console.log("A paid checkout survives a refused sale");
  const c4 = (await C.post("/api/chedam/terminal/checkouts", { sale_id: s2, amount_cents: total })).json;
  fake.complete(fake.lastCheckout().id, { brand: "INTERAC", last4: "1111" });
  await C.get(`/api/chedam/terminal/checkouts/${c4.id}`);
  const bad1 = await sale(s2, [{ method: "card", amount_cents: total, checkout: c4.id }], { expected_total_cents: total + 1 });
  check("the sale is refused (total changed)", bad1.status === 409);
  const un = (await C.get(`/api/chedam/terminal/checkouts?sale=${s2}`)).json.items;
  check("the till finds the paid checkout for this sale again", un.length === 1 && un[0].id === c4.id && un[0].card_type === "interac");
  check("managers see paid checkouts not in a sale (after 15 minutes)", (await M.get("/api/chedam/terminal/checkouts")).status === 200 && (await C.get("/api/chedam/terminal/checkouts")).status === 403);
  check("the amount must match the checkout", (await sale(s2, [{ method: "card", amount_cents: total - 100, checkout: c4.id }, { method: "cash", amount_cents: 100 }])).status === 400);
  const ok4 = await sale(s2, [{ method: "card", amount_cents: total, checkout: c4.id }]);
  check("then the sale completes with it", ok4.status === 200 && ok4.json.sale.payments[0].card_type === "interac");

  console.log("Split: part on the terminal, the rest in cash");
  const s5 = sid();
  const c5 = (await C.post("/api/chedam/terminal/checkouts", { sale_id: s5, amount_cents: total - 500 })).json;
  fake.complete(fake.lastCheckout().id);
  await C.get(`/api/chedam/terminal/checkouts/${c5.id}`);
  const r5 = await sale(s5, [{ method: "card", amount_cents: total - 500, checkout: c5.id }, { method: "cash", amount_cents: 500 }]);
  check("linked card + cash", r5.status === 200 && r5.json.sale.payments.length === 2, JSON.stringify(r5.json).slice(0, 200));

  console.log("Fallbacks (P5-d)");
  check("a checkout can't be started for a sale already saved", (await C.post("/api/chedam/terminal/checkouts", { sale_id: s5, amount_cents: 100 })).status === 400);
  fake.down = true;
  const d6 = await C.post("/api/chedam/terminal/checkouts", { sale_id: sid(), amount_cents: total });
  check("Square down: refused with a message (the till keys it in instead)", d6.status === 400 && /Square/.test(d6.json.message));
  fake.down = false;
  const s7 = sid();
  const r7 = await sale(s7, [{ method: "card", amount_cents: total, last4: "5555", card_type: "mastercard", reference: "A1" }]);
  check("standalone card payments still work on a linked till", r7.status === 200 && r7.json.sale.payments[0].last4 === "5555" && r7.json.sale.payments[0].linked === false, JSON.stringify(r7.json).slice(0, 300));
  const s8 = sid();
  const c8 = (await C.post("/api/chedam/terminal/checkouts", { sale_id: s8, amount_cents: total })).json;
  fake.complete(fake.lastCheckout().id);
  await C.get(`/api/chedam/terminal/checkouts/${c8.id}`);
  check("training sales can't take a linked payment", (await sale(s8, [{ method: "card", amount_cents: total, checkout: c8.id }], { training: true })).status === 409);
  const setRec = (await t.list("settings", "key='payments.linked'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${setRec.id}`, { value: { enabled: true, poll_seconds: 2, wait_seconds: 0 } });
  const c9 = (await C.post("/api/chedam/terminal/checkouts", { sale_id: sid(), amount_cents: 700 })).json;
  await new Promise((r) => setTimeout(r, 1100));
  const p9 = (await C.get(`/api/chedam/terminal/checkouts/${c9.id}`)).json;
  check("waiting too long cancels it on the terminal", p9.status === "cancelled" && p9.cancel_reason === "timed_out" && fake.lastCheckout().status === "CANCELED", JSON.stringify(p9));
  const evs = JSON.stringify((await t.list("events", "table_name='terminal_checkouts'")).items);
  check("every checkout change is in the event log", (evs.match(/"action":"create"/g) || []).length >= 7, evs.slice(0, 200));
} catch (e) { err = e; }
if (fake) await fake.close();
await t.finish(err);

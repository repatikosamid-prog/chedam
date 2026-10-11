// P5 step 3: card refunds through the linked processor (against a fake Square): returns and voids go back to the
// same card (Interac on the terminal), the return names the refund and the hub checks it; a refused return keeps
// its refund; paid checkouts no sale took are refunded by a manager; the processor's fees and payouts.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step54-linked-refunds.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";
import { startFakeSquare, FAKE_TOKEN } from "../../tools/devhub/fake-square.mjs";

const t = new TestHub({ port: 8147 });
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
  const owner = await login("Demo Owner"), manager = await login("Mira Manager"), cashier = await login("Cal Cashier"), acct = await login("Ana Accountant");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const O = as(owner), M = as(manager), C = as(cashier), A = as(acct);
  await O.post("/api/chedam/payproc/connect", { kind: "square", environment: "sandbox", token: FAKE_TOKEN });
  const tm = (await O.post("/api/chedam/payproc/terminals", { name: "Front terminal", till_device: devs["Cal Cashier"].id })).json;
  fake.pair(Object.keys(fake.st.codes)[0]);
  await O.post(`/api/chedam/payproc/terminals/${tm.id}/refresh`, {});
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const towels = await find("2000000000091");
  await M.post("/api/chedam/stock/receive", { op_id: sid(), lines: [{ product: towels.product.id, selling_unit: towels.unit.id, qty: 30 }] });
  // A sale paid on the terminal
  const linkedSale = async (qty, opts) => {
    const lines = [{ key: "a", product: towels.product.id, selling_unit: towels.unit.id, qty }];
    const total = (await C.post("/api/chedam/sales/quote", { lines })).json.total_cents;
    const id = sid();
    const co = (await C.post("/api/chedam/terminal/checkouts", { sale_id: id, amount_cents: total })).json;
    fake.complete(fake.lastCheckout().id, opts || {});
    await C.get(`/api/chedam/terminal/checkouts/${co.id}`);
    const r = await C.post("/api/chedam/sales", { id, lines, expected_total_cents: total, payments: [{ method: "card", amount_cents: total, checkout: co.id }] });
    if (r.status !== 200) throw new Error("sale: " + JSON.stringify(r.json));
    return r.json.sale;
  };
  const ret = (sale, retId, refunds, extra) => {
    const line = sale.lines[0];
    return C.post("/api/chedam/returns", Object.assign({ id: retId, sale: sale.id, lines: [{ sale_line: line.id, qty: 1, disposition: "restock" }], reason: "Changed mind", refunds }, extra || {}));
  };

  console.log("A return goes back to the same card (FR-4.14 stage 2)");
  const s1 = await linkedSale(2);
  const found = (await C.get(`/api/chedam/returns/sale/${s1.id}`)).json;
  check("the sale shows what can go back through the processor", found && found.linked_refundable_cents === s1.total_cents && found.card_refundable_cents === s1.total_cents, JSON.stringify(found).slice(0, 200));
  const q1 = (await C.post("/api/chedam/returns/quote", { sale: s1.id, lines: [{ sale_line: s1.lines[0].id, qty: 1 }] })).json;
  const r1id = sid();
  check("not more than the card paid", (await C.post("/api/chedam/terminal/refunds", { sale: s1.id, ref: r1id, purpose: "return", amount_cents: s1.total_cents + 1 })).status === 400);
  const rf1 = await C.post("/api/chedam/terminal/refunds", { sale: s1.id, ref: r1id, purpose: "return", amount_cents: q1.refund_cents });
  const x1 = rf1.json.items && rf1.json.items[0];
  check("Visa: refunded without the card, accepted", rf1.status === 200 && x1.accepted && !x1.on_terminal && x1.last4 === "4242" && Object.values(fake.st.refunds).some((r) => r.amount_money.amount === q1.refund_cents), JSON.stringify(rf1.json));
  const again = await C.post("/api/chedam/terminal/refunds", { sale: s1.id, ref: r1id, purpose: "return", amount_cents: q1.refund_cents });
  check("asking again for the same return gets the same refund", again.json.items.length === 1 && again.json.items[0].id === x1.id && Object.keys(fake.st.refunds).length === 1);
  const done1 = await ret(s1, r1id, [{ method: "card", amount_cents: q1.refund_cents, processor_refund: x1.id, last4: "0000" }], { expected_refund_cents: q1.refund_cents });
  check("the return records it (last 4 from the processor)", done1.status === 200 && done1.json.return.refunds.some((r) => r.method === "card" && r.last4 === "4242"), JSON.stringify(done1.json).slice(0, 300));
  const rl = (await t.list("refunds", `return='${r1id}'`)).items[0];
  check("kept on the refund line: the processor refund", rl.processor_refund === x1.id);
  const r2id = sid();
  check("a used refund can't be used by another return", (await ret(s1, r2id, [{ method: "card", amount_cents: q1.refund_cents, processor_refund: x1.id }])).status === 400);
  const left = (await C.get(`/api/chedam/returns/sale/${s1.id}`)).json;
  check("what is left on the card goes down", left.linked_refundable_cents === s1.total_cents - q1.refund_cents);

  console.log("A refused return keeps its refund");
  const q2 = (await C.post("/api/chedam/returns/quote", { sale: s1.id, lines: [{ sale_line: s1.lines[0].id, qty: 1 }] })).json;
  const x2 = (await C.post("/api/chedam/terminal/refunds", { sale: s1.id, ref: r2id, purpose: "return", amount_cents: q2.refund_cents })).json.items[0];
  const bad2 = await ret(s1, r2id, [{ method: "card", amount_cents: q2.refund_cents, processor_refund: x2.id }], { expected_refund_cents: q2.refund_cents + 7 });
  check("the return is refused", bad2.status >= 400, JSON.stringify(bad2.json));
  const un2 = (await C.get(`/api/chedam/terminal/refunds?ref=${r2id}`)).json.items;
  check("the till finds the refund for this return again", un2.length === 1 && un2[0].id === x2.id);
  check("then the return completes with it", (await ret(s1, r2id, [{ method: "card", amount_cents: q2.refund_cents, processor_refund: x2.id }], { expected_refund_cents: q2.refund_cents })).status === 200);

  console.log("Interac goes back on the terminal");
  const s3 = await linkedSale(1, { brand: "INTERAC", last4: "1111" });
  const r3id = sid();
  const x3 = (await C.post("/api/chedam/terminal/refunds", { sale: s3.id, ref: r3id, purpose: "return", amount_cents: s3.total_cents })).json.items[0];
  check("on the till's terminal, waiting for the card", x3.on_terminal && x3.status === "pending" && !x3.accepted && x3.terminal === "Front terminal", JSON.stringify(x3));
  check("the return can't use it before it goes through", (await ret(s3, r3id, [{ method: "card", amount_cents: s3.total_cents, processor_refund: x3.id }])).status === 400);
  fake.finishRefund(Object.values(fake.st.refunds).find((r) => r.device_id).id);
  const p3 = (await C.get(`/api/chedam/terminal/refunds/${x3.id}`)).json;
  check("the customer tapped: completed", p3.status === "completed" && p3.accepted);
  check("then the return completes", (await ret(s3, r3id, [{ method: "card", amount_cents: s3.total_cents, processor_refund: x3.id }])).status === 200);

  console.log("A void of a linked sale");
  const s4 = await linkedSale(1);
  const v0 = await M.post(`/api/chedam/sales/${s4.id}/void`, { reason: "Wrong item" });
  check("refused until the card is refunded", v0.status === 400 && /refund the card first/.test(v0.json.message), JSON.stringify(v0.json));
  check("a void refund must be for its own sale", (await C.post("/api/chedam/terminal/refunds", { sale: s4.id, ref: sid(), purpose: "void", amount_cents: s4.total_cents })).status === 400);
  const x4 = (await C.post("/api/chedam/terminal/refunds", { sale: s4.id, ref: s4.id, purpose: "void", amount_cents: s4.total_cents })).json.items[0];
  const v1 = await M.post(`/api/chedam/sales/${s4.id}/void`, { reason: "Wrong item", processor_refunds: [x4.id] });
  check("voided with the card refund", v1.status === 200 && (await t.list("sales", `id='${s4.id}'`)).items[0].status === "voided", JSON.stringify(v1.json).slice(0, 200));

  console.log("A paid checkout no sale took");
  const co5 = (await C.post("/api/chedam/terminal/checkouts", { sale_id: sid(), amount_cents: 2500 })).json;
  fake.complete(fake.lastCheckout().id, { last4: "5555", brand: "MASTERCARD" });
  await C.get(`/api/chedam/terminal/checkouts/${co5.id}`);
  check("a cashier can't refund it", (await C.post(`/api/chedam/terminal/checkouts/${co5.id}/refund`, {})).status === 403);
  const x5 = await M.post(`/api/chedam/terminal/checkouts/${co5.id}/refund`, {});
  check("a manager refunds the whole amount", x5.status === 200 && x5.json.amount_cents === 2500 && x5.json.purpose === "unused" && x5.json.accepted, JSON.stringify(x5.json));
  check("a used checkout can't be refunded this way", (await M.post(`/api/chedam/terminal/checkouts/${s4.payments[0].checkout || "x"}/refund`, {})).status === 400);

  console.log("Fees and payouts (FR-10.05)");
  const s6 = await linkedSale(1, { withFee: false });
  const today = new Date().toISOString().substring(0, 10);
  const f0 = (await A.get(`/api/chedam/card-fees?from=${today}&to=${today}`)).json;
  const est0 = f0.total.fee_cents;
  const pid = Object.values(fake.st.payments).find((p) => p.amount_money.amount === s6.total_cents && !p.processing_fee.length).id;
  const fee6 = fake.setFee(pid);
  const po = fake.addPayout(54321, today);
  const sync = await O.post("/api/chedam/payproc/sync", {});
  check("the processor's fee is fetched; payouts listed", sync.status === 200 && sync.json.fees >= 1 && sync.json.items.some((x) => x.payout_id === po && x.amount_cents === 54321), JSON.stringify(sync.json).slice(0, 300));
  const f1 = (await A.get(`/api/chedam/card-fees?from=${today}&to=${today}`)).json;
  check("card fees: the processor's own fees for linked payments", f1.total.processor_fee_cents > 0 && f1.total.processor_fee_cents >= fee6, JSON.stringify(f1.total));
  check("the period's fee uses them instead of the estimate", f1.total.fee_cents !== est0 || f1.total.processor_fee_cents === 0, JSON.stringify({ est0, f1: f1.total }));
  check("the accountant sees the payouts; a cashier does not", (await A.get("/api/chedam/payproc/payouts")).json.items.length === 1 && (await C.get("/api/chedam/payproc/payouts")).status === 403);
} catch (e) { err = e; }
if (fake) await fake.close();
await t.finish(err);

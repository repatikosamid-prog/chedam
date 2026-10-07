// P1 step 6: returns, exchanges and store credit. Find a sale (number, date + amount, card last 4);
// refund = price paid after the discount share + original tax per type + deposit (BR-23), never more
// than sold, and the last return of a line takes exactly what is left; manager's PIN over the limit,
// outside the window, non-returnable or without a receipt (BR-17, FR-4.07, 4.10); no receipt = store
// credit at the lowest price of the last 30 days; card refund up to what the card paid; per-item stock
// (FR-4.11); store credit spent and given back on void; exchange in one transaction (FR-4.13); Z report.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step16-returns.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8109 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const RL = createRequire(import.meta.url)(join(HUB, "pb_hooks", "lib", "receipt_layout.js"));
const sum = (a, f) => a.reduce((x, y) => x + (f ? y[f] : y), 0);

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Till of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), staff = await login("Sam Staff");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager);
  const find = async (code, i = 0) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[i];
  const level = async (pid) => (await M.get("/api/chedam/stock/products/" + pid)).json.level;
  const setSetting = async (key, value) => { const r = (await t.list("settings", `key='${key}'`)).items[0]; await t.su_("PATCH", `/api/collections/settings/records/${r.id}`, { value }); };
  const approve = async (perm = "sales.approve") => (await C.post("/api/chedam/sales/approvals", { user: people["Mira Manager"], pin: PIN["Mira Manager"], permission: perm })).json.approval;
  const L = (m, extra = {}) => ({ key: "k" + Math.random().toString(36).slice(2, 8), product: m.product.id, selling_unit: m.unit.id, qty: 1, ...extra });

  const cola = await find("2000000000022"), chips = await find("2000000000060"), bananas = await find("4011"), choc = await find("2000000000077");
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  await M.post("/api/chedam/tills/open", { float_cents: 10000 });

  // Sale A: 3 colas, chips, 1.235 kg bananas, 5% off the cart, cash
  const sA = await C.post("/api/chedam/sales", { id: sid(), lines: [L(cola, { qty: 3 }), L(chips), L(bananas, { weight: 1.235 })], cart_discount: { type: "pct", value: 5 }, payments: [{ method: "cash", amount_cents: 5000 }] });
  const A = sA.json.sale;
  // Sale B: chocolate x4 by card ending 4242
  const qB = (await C.post("/api/chedam/sales/quote", { lines: [L(choc, { qty: 4 })] })).json;
  const sB = await C.post("/api/chedam/sales", { id: sid(), lines: [L(choc, { qty: 4 })], payments: [{ method: "card", amount_cents: qB.total_cents, last4: "4242" }] });
  const B = sB.json.sale;

  console.log("Finding the sale (FR-4.08)");
  check("staff (no sales.return) cannot look up returns", (await as(staff).get("/api/chedam/returns/find?number=" + A.number)).status === 403);
  check("by receipt number", (await C.get("/api/chedam/returns/find?number=" + A.number.toLowerCase())).json.sales[0].id === A.id);
  const today = new Date(); const ymd = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  check("by date and amount", (await C.get(`/api/chedam/returns/find?date=${ymd}&amount_cents=${B.total_cents}`)).json.sales.some((s) => s.id === B.id));
  check("by card last 4", (await C.get("/api/chedam/returns/find?last4=4242")).json.sales.map((s) => s.id).join() === B.id);
  check("nothing to search by is refused", (await C.get("/api/chedam/returns/find")).status === 400);
  const ra = (await C.get("/api/chedam/returns/sale/" + A.id)).json;
  const colaLine = ra.lines.find((l) => l.product === cola.product.id), chipsLine = ra.lines.find((l) => l.product === chips.product.id), banLine = ra.lines.find((l) => l.product === bananas.product.id);
  check("returnable lines with what was paid", ra.lines.length === 3 && colaLine.returnable_qty === 3 && !colaLine.outside_window && banLine.weighed, JSON.stringify(ra.lines.map((l) => [l.name, l.returnable_qty])));

  console.log("Refund amounts (BR-23)");
  const q1 = (await C.post("/api/chedam/returns/quote", { sale: A.id, lines: [{ sale_line: colaLine.id, qty: 1 }] })).json;
  const colaTax = sum(colaLine.taxes, "tax_cents");
  const exp1 = Math.round(colaLine.net_cents / 3) + Math.round(colaLine.deposit_cents / 3) + sum(colaLine.taxes.map((x) => Math.floor(x.tax_cents / 3 + 0.5)));
  check("1 of 3 colas: a third of the price paid (after the 5% share), tax and deposit", q1.refund_cents === exp1 && q1.net_cents === Math.round(colaLine.net_cents / 3), JSON.stringify({ q1: q1.refund_cents, exp1, line: colaLine }));
  check("no PIN needed under the limit", q1.needs_approval.length === 0);
  const colaBefore = (await level(cola.product.id)).on_hand;
  const r1 = await C.post("/api/chedam/returns", { id: sid(), sale: A.id, lines: [{ sale_line: colaLine.id, qty: 1, disposition: "restock" }], reason: "Changed mind",
    refunds: [{ method: "cash", amount_cents: q1.refund_cents }], expected_refund_cents: q1.refund_cents });
  check("recorded: R- number, cash refund rounded to 5 cents", r1.status === 200 && /^R-/.test(r1.json.return.number) && r1.json.return.paid_cents % 5 === 0
    && r1.json.return.paid_cents === Math.round(q1.refund_cents / 5) * 5, JSON.stringify(r1.json).slice(0, 400));
  check("back in stock (+1)", (await level(cola.product.id)).on_hand === colaBefore + 1);
  const r2 = await C.post("/api/chedam/returns", { id: sid(), sale: A.id, lines: [{ sale_line: colaLine.id, qty: 2 }], refunds: [{ method: "cash", amount_cents: 99999 }] });
  const back = [r1.json.return.lines[0], r2.json.return.lines[0]];
  check("the last 2 colas: exactly what is left, no cent lost or gained", r2.status === 200 && sum(back, "net_cents") === colaLine.net_cents && sum(back, "deposit_cents") === colaLine.deposit_cents
    && sum(back.map((l) => sum(l.taxes, "tax_cents"))) === colaTax, JSON.stringify(back));
  check("cannot return more than sold", (await C.post("/api/chedam/returns/quote", { sale: A.id, lines: [{ sale_line: colaLine.id, qty: 1 }] })).status === 400);
  const rq = (await C.post("/api/chedam/returns/quote", { sale: A.id, lines: [{ sale_line: banLine.id, qty: 0.5 }] })).json;
  check("0.5 kg of the 1.235 kg bananas", rq.net_cents === Math.round(banLine.net_cents * 0.5 / 1.235), JSON.stringify(rq));
  const dup = await C.post("/api/chedam/returns", { id: r1.json.return.id, sale: A.id, lines: [{ sale_line: colaLine.id, qty: 1 }], refunds: [{ method: "cash", amount_cents: 500 }] });
  check("same return id again: the first result (BR-10)", dup.json.duplicate === true);
  check("a sale with returns cannot be voided", (await M.post(`/api/chedam/sales/${A.id}/void`, { reason: "x" })).status === 400);

  console.log("Limits and approvals (BR-17, FR-4.07)");
  await setSetting("returns.cashier_limit_cents", 100);
  const over = await C.post("/api/chedam/returns", { id: sid(), sale: A.id, lines: [{ sale_line: chipsLine.id, qty: 1 }], refunds: [{ method: "cash", amount_cents: 1000 }] });
  check("over the cashier's limit: manager's PIN", over.status === 403 && /Refund over \$1\.00/.test(over.json.message), JSON.stringify(over.json));
  const ok = await C.post("/api/chedam/returns", { id: sid(), sale: A.id, lines: [{ sale_line: chipsLine.id, qty: 1, disposition: "damaged" }], approval: await approve(),
    refunds: [{ method: "cash", amount_cents: 1000 }] });
  check("with the PIN: done, the approval recorded", ok.status === 200 && ok.json.return.approvals[0].name === "Mira Manager", JSON.stringify(ok.json).slice(0, 300));
  await setSetting("returns.cashier_limit_cents", 5000);
  const chipsLevel = await level(chips.product.id);
  const shrink = (await t.su_("GET", `/api/chedam/stock/shrink?from=${ymd}&to=${ymd}`)).json;
  check("damaged: not back in stock, in the shrink report", shrink.by_reason ? shrink.by_reason.some((r) => /damaged/.test(r.reason)) : JSON.stringify(shrink).includes("Customer return: damaged"), JSON.stringify(shrink).slice(0, 300));
  await setSetting("returns.window_days", 0);
  const late = await C.post("/api/chedam/returns/quote", { sale: A.id, lines: [{ sale_line: banLine.id, qty: 0.2 }] });
  check("outside the return window: PIN", late.json.needs_approval.some((n) => /days/.test(n)), JSON.stringify(late.json));
  await setSetting("returns.window_days", 30);
  await t.su_("PATCH", `/api/collections/products/records/${bananas.product.id}`, { non_returnable: true });
  check("non-returnable item: PIN", (await C.post("/api/chedam/returns/quote", { sale: A.id, lines: [{ sale_line: banLine.id, qty: 0.2 }] })).json.needs_approval.some((n) => /non-returnable/.test(n)));
  await t.su_("PATCH", `/api/collections/products/records/${bananas.product.id}`, { non_returnable: false });

  console.log("Card refunds (FR-4.14)");
  const rb = (await C.get("/api/chedam/returns/sale/" + B.id)).json;
  check("card refundable = what the card paid", rb.card_refundable_cents === B.total_cents);
  const qb = (await C.post("/api/chedam/returns/quote", { sale: B.id, lines: [{ sale_line: rb.lines[0].id, qty: 1 }] })).json;
  const rcard = await C.post("/api/chedam/returns", { id: sid(), sale: B.id, lines: [{ sale_line: rb.lines[0].id, qty: 1 }], refunds: [{ method: "card", amount_cents: qb.refund_cents, last4: "4242" }] });
  check("refund to the card, exact (no rounding)", rcard.status === 200 && rcard.json.return.refunds[0].method === "card" && rcard.json.return.paid_cents === qb.refund_cents);
  check("more back to the card than it paid is refused", (await C.post("/api/chedam/returns", { id: sid(), sale: B.id, lines: [{ sale_line: rb.lines[0].id, qty: 3 }], approval: await approve(),
    refunds: [{ method: "card", amount_cents: B.total_cents }] })).status === 400);

  console.log("No receipt (FR-4.10)");
  const nr = { lines: [{ product: choc.product.id, selling_unit: choc.unit.id, qty: 2 }] };
  check("cashier alone: PIN needed", (await C.post("/api/chedam/returns", { id: sid(), ...nr, refunds: [{ method: "store_credit", amount_cents: 100 }] })).status === 403);
  const chocPrice = (await t.list("selling_units", `id='${choc.unit.id}'`)).items[0].price_cents;
  await t.su_("POST", "/api/collections/price_history/records", { product: choc.product.id, selling_unit: choc.unit.id, field: "price", old_cents: 199, new_cents: chocPrice, changed_by: "test", reason: "promo ended" });
  const nq = (await C.post("/api/chedam/returns/quote", nr)).json;
  check("the price history of its creation (from $0) is not a price", (await C.post("/api/chedam/returns/quote", { lines: [{ product: cola.product.id, selling_unit: cola.unit.id, qty: 1 }] })).json.lines[0].price_cents > 0);
  check("credited at the lowest price of 30 days ($1.99 each)", nq.lines[0].price_cents === 199 && nq.net_cents === 398 && nq.store_credit_only, JSON.stringify(nq));
  check("cash refund refused without a receipt", (await C.post("/api/chedam/returns", { id: sid(), ...nr, approval: await approve(), refunds: [{ method: "cash", amount_cents: nq.refund_cents }] })).status === 400);
  const rn = await C.post("/api/chedam/returns", { id: sid(), ...nr, approval: await approve(), refunds: [{ method: "store_credit", amount_cents: nq.refund_cents }] });
  const code = rn.json.return.refunds[0].reference;
  check("store credit code issued for the full amount", rn.status === 200 && /^SC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code) && (await C.get("/api/chedam/store-credits/" + code)).json.balance_cents === nq.refund_cents, JSON.stringify(rn.json).slice(0, 300));
  check("the cashier cannot list store credits", (await t.list("store_credits", "", cashier)).items === undefined || (await t.api("GET", "/api/collections/store_credits/records", null, { token: cashier })).status === 403);

  console.log("Store credit at the till (FR-3.08)");
  const qs = (await C.post("/api/chedam/sales/quote", { lines: [L(chips)] })).json;
  check("more than the balance is refused", (await C.post("/api/chedam/sales", { id: sid(), lines: [L(chips)], payments: [{ method: "store_credit", amount_cents: nq.refund_cents + 1, reference: code }] })).status === 400);
  const part = Math.min(qs.total_cents - 1, nq.refund_cents);
  const sC = await C.post("/api/chedam/sales", { id: sid(), lines: [L(chips)], payments: [{ method: "store_credit", amount_cents: part, reference: code.toLowerCase() }, { method: "card", amount_cents: qs.total_cents - part }] });
  check("paid with store credit + card; balance down", sC.status === 200 && (await C.get("/api/chedam/store-credits/" + code)).json.balance_cents === nq.refund_cents - part, JSON.stringify(sC.json).slice(0, 300));
  await M.post(`/api/chedam/sales/${sC.json.sale.id}/void`, { reason: "test" });
  const bal = (await C.get("/api/chedam/store-credits/" + code)).json;
  check("void gives the credit back", bal.balance_cents === nq.refund_cents && bal.status === "active", JSON.stringify(bal));
  check("unknown code refused", (await C.post("/api/chedam/sales", { id: sid(), lines: [L(chips)], payments: [{ method: "store_credit", amount_cents: 10, reference: "SC-XXXX-XXXX" }, { method: "card", amount_cents: qs.total_cents - 10 }] })).status === 400);

  console.log("Exchange (FR-4.13)");
  check("the exchange method cannot be used on a plain sale", (await C.post("/api/chedam/sales", { id: sid(), lines: [L(cola)], payments: [{ method: "exchange", amount_cents: 176 }] })).status === 400);
  const rb2 = (await C.get("/api/chedam/returns/sale/" + B.id)).json;
  const exq = (await C.post("/api/chedam/returns/quote", { sale: B.id, lines: [{ sale_line: rb2.lines[0].id, qty: 1 }] })).json;
  const colaQ = (await C.post("/api/chedam/sales/quote", { lines: [L(cola)] })).json;
  const ex1 = await C.post("/api/chedam/returns", { id: sid(), sale: B.id, lines: [{ sale_line: rb2.lines[0].id, qty: 1 }],
    exchange: { id: sid(), lines: [L(cola)] }, refunds: [{ method: "card", amount_cents: exq.refund_cents - colaQ.total_cents, last4: "4242" }] });
  check("chocolate for a cola: new sale paid by the exchange, the rest back to the card", ex1.status === 200 && ex1.json.sale && ex1.json.sale.payments[0].method === "exchange"
    && ex1.json.sale.payments[0].amount_cents === colaQ.total_cents && ex1.json.return.exchange_number === ex1.json.sale.number
    && ex1.json.return.refunds.some((r) => r.method === "exchange") && ex1.json.return.refunds.some((r) => r.method === "card"), JSON.stringify(ex1.json).slice(0, 500));
  const bigQ = (await C.post("/api/chedam/sales/quote", { lines: [L(chips, { qty: 3 })] })).json;
  const ex2 = await C.post("/api/chedam/returns", { id: sid(), sale: B.id, lines: [{ sale_line: rb2.lines[0].id, qty: 1 }],
    exchange: { id: sid(), lines: [L(chips, { qty: 3 })], payments: [{ method: "cash", amount_cents: 2000 }] } });
  check("chocolate for 3 chips: the customer pays the difference in cash", ex2.status === 200 && ex2.json.sale.total_cents === bigQ.total_cents
    && ex2.json.sale.payments.some((p) => p.method === "cash") && ex2.json.return.refunds.length === 1, JSON.stringify(ex2.json).slice(0, 500));
  const exBad = await C.post("/api/chedam/returns", { id: sid(), sale: B.id, lines: [{ sale_line: rb2.lines[0].id, qty: 1 }], exchange: { id: sid(), lines: [L(chips, { qty: 3 })], payments: [] } });
  const stillLeft = (await C.get("/api/chedam/returns/sale/" + B.id)).json.lines[0].returnable_qty;
  check("new items not paid: nothing recorded (one transaction)", exBad.status === 409 && stillLeft === 1, JSON.stringify(exBad.json).slice(0, 300));

  console.log("Till (Z figures)");
  const z = (await C.get("/api/chedam/tills/current")).json.till.summary;
  const cashBack = r1.json.return.paid_cents + r2.json.return.paid_cents + ok.json.return.paid_cents;
  check("returns counted; cash refunds leave the drawer", z.returns_count >= 6 && z.cash_refunds_cents === cashBack
    && z.expected_cash_cents === 10000 + z.cash_in_cents - cashBack, JSON.stringify(z));
  check("tax refunded by type", z.refund_taxes.length >= 1 && z.store_credit_issued_cents === nq.refund_cents);
  const ztext = RL.text(RL.tillReport(z, { name: "Demo" }), 48);
  check("X report lists the returns", /Returns\s+\d+/.test(ztext) && /Cash refunds/.test(ztext), ztext);

  console.log("Return slip");
  const v = (await C.get("/api/chedam/returns/" + rn.json.return.id)).json;
  const slip = RL.text(RL.returnReceipt(v, {}), 48);
  check("slip: RETURN, no receipt, store credit with its barcode", /RETURN/.test(slip) && /No receipt/.test(slip) && slip.includes("||| " + code + " |||") && /STORE CREDIT/.test(slip), slip);
  const exSlip = RL.text(RL.returnReceipt((await C.get("/api/chedam/returns/" + ex1.json.return.id)).json, {}), 48);
  check("exchange slip names the new sale", /EXCHANGE/.test(exSlip) && exSlip.includes(ex1.json.sale.number) && /signature/.test(exSlip), exSlip);
  check("no printer: the till prints it", (await C.post(`/api/chedam/returns/${rn.json.return.id}/print`, {})).json.no_printer === true);
} catch (e) {
  err = e;
}
await t.finish(err);

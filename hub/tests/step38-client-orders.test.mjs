// P3 step 7: layaway, special orders, quotes, house accounts (FR-3.18-3.20, 6.10). A layaway reserves stock
// against a deposit taken at the till (drawer counts it); pickup at the till applies the deposit and releases
// the reservation in the sale; cancel gives the deposit back; a special order is reserved when ready; a quote
// keeps its prices (override at the till) and becomes an invoice; a house account sale makes an invoice within
// the credit limit.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step38-client-orders.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8131 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

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
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const towels = await find("2000000000091"), choc = await find("2000000000077");
  const level = async (pid) => (await t.list("stock_levels", `product='${pid}'`)).items[0];
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const till = (await C.get("/api/chedam/tills/current")).json.till;
  const luna = (await t.list("parties", "name='Cafe Luna'")).items[0];
  const summary = async () => (await C.get("/api/chedam/tills/current")).json.till.summary;

  console.log("Layaway (FR-3.18, 6.10)");
  const lines = [{ product: towels.product.id, selling_unit: towels.unit.id, qty: 2 }];
  check("a layaway needs the minimum deposit", (await C.post("/api/chedam/client-orders", { kind: "layaway", name: "Rita", phone: "604-555-0170", lines, deposit: { amount_cents: 1, method: "cash", till: till.id } })).status === 400);
  const res0 = (await level(towels.product.id)).reserved || 0;
  const cash0 = (await summary()).expected_cash_cents;
  const la = await C.post("/api/chedam/client-orders", { kind: "layaway", name: "Rita", phone: "604-555-0170", lines, deposit: { amount_cents: 500, method: "cash", till: till.id } });
  check("a layaway with a $5 cash deposit: numbered, due in 30 days, stock reserved", la.status === 200 && /^LA-/.test(la.json.number) && la.json.reserved && la.json.paid_cents === 500
    && (await level(towels.product.id)).reserved === res0 + 2 * towels.unit.base_qty, JSON.stringify(la.json).slice(0, 300));
  check("the deposit is in the till's expected cash", (await summary()).expected_cash_cents === cash0 + 500);
  const pay = await C.post(`/api/chedam/client-orders/${la.json.id}/pay`, { amount_cents: 300, method: "card", till: till.id });
  check("another payment by card", pay.json.paid_cents === 800 && pay.json.deposit_left_cents === 800);
  const tt = (await C.get(`/api/chedam/client-orders/${la.json.id}/till`)).json;
  check("rung up at the till: its lines and the deposit to apply", tt.lines.length === 1 && tt.deposit_cents === 800);
  const saleLines = tt.lines.map((l, i) => ({ key: "k" + i, product: l.product, selling_unit: l.selling_unit, qty: l.qty }));
  const q = (await C.post("/api/chedam/sales/quote", { lines: saleLines })).json;
  const sale = await C.post("/api/chedam/sales", { id: sid(), lines: saleLines, expected_total_cents: q.total_cents,
    payments: [{ method: "deposit", amount_cents: 800, reference: la.json.id }, { method: "card", amount_cents: q.total_cents - 800 }] });
  check("picked up: the deposit pays part of the sale", sale.status === 200 && sale.json.sale.payments.some((p) => p.method === "deposit" && p.amount_cents === 800), JSON.stringify(sale.json).slice(0, 300));
  const la2 = (await C.get(`/api/chedam/client-orders/${la.json.id}`)).json;
  check("the order is picked up with the sale, nothing reserved any more", la2.status === "picked_up" && la2.sale === sale.json.sale.id && !la2.reserved && (await level(towels.product.id)).reserved === res0);
  const chocLines = [{ key: "c", product: choc.product.id, selling_unit: choc.unit.id, qty: 1 }];
  const cq = (await C.post("/api/chedam/sales/quote", { lines: chocLines })).json;
  const twice = await C.post("/api/chedam/sales", { id: sid(), lines: chocLines, expected_total_cents: cq.total_cents,
    payments: [{ method: "deposit", amount_cents: 100, reference: la.json.id }, { method: "card", amount_cents: cq.total_cents - 100 }] });
  check("a deposit cannot be used twice", twice.status === 400 && /deposit/i.test(twice.json.message), JSON.stringify(twice.json).slice(0, 200));

  console.log("Cancelling, special orders");
  const lb = await C.post("/api/chedam/client-orders", { kind: "layaway", name: "Sam", lines: [{ product: choc.product.id, selling_unit: choc.unit.id, qty: 2 }], deposit: { amount_cents: 500, method: "cash", till: till.id } });
  check("cancelling needs the deposit given back or kept", (await C.post(`/api/chedam/client-orders/${lb.json.id}/cancel`, {})).status === 400);
  check("only a manager keeps a deposit", (await C.post(`/api/chedam/client-orders/${lb.json.id}/cancel`, { refund: { keep: true } })).status === 403);
  const cash1 = (await summary()).expected_cash_cents;
  const cn = await C.post(`/api/chedam/client-orders/${lb.json.id}/cancel`, { refund: { method: "cash", till: till.id } });
  check("cancelled: the deposit given back from the drawer, the reservation released", cn.json.status === "cancelled" && cn.json.paid_cents === 0 && !cn.json.reserved
    && (await summary()).expected_cash_cents === cash1 - 500);
  const so = await C.post("/api/chedam/client-orders", { kind: "special_order", name: "Ali", lines: [{ product: choc.product.id, qty: 24 }] });
  check("a special order: nothing reserved until it arrives", so.status === 200 && !so.json.reserved);
  check("it cannot be rung up before it is ready", (await C.get(`/api/chedam/client-orders/${so.json.id}/till`)).status === 400);
  await C.post(`/api/chedam/client-orders/${so.json.id}/ordered`, { po: "" });
  const rd = await C.post(`/api/chedam/client-orders/${so.json.id}/ready`, {});
  check("ready: reserved", rd.json.status === "ready" && rd.json.reserved);

  console.log("Quotes (FR-3.19)");
  const qt = await C.post("/api/chedam/client-orders", { kind: "quote", party: luna.id, lines: [{ product: choc.product.id, selling_unit: choc.unit.id, qty: 10, price_cents: choc.unit.price_cents - 20 }] });
  check("a quote for Cafe Luna at an agreed price, valid 14 days", qt.status === 200 && /^QT-/.test(qt.json.number) && qt.json.lines[0].price_cents === choc.unit.price_cents - 20 && !!qt.json.due_date);
  const qtt = (await C.get(`/api/chedam/client-orders/${qt.json.id}/till`)).json;
  check("at the till the agreed price is an override with the quote as the reason", qtt.lines[0].price_cents === choc.unit.price_cents - 20 && /QT-/.test(qtt.lines[0].override_reason));
  const cv = await A.post(`/api/chedam/client-orders/${qt.json.id}/convert`, { to: "invoice" });
  check("turned into an invoice", cv.json.status === "converted" && /^invoice:/.test(cv.json.converted_to));

  console.log("House accounts (FR-3.20)");
  const accs = (await C.get("/api/chedam/house-accounts")).json.items;
  check("Cafe Luna has an account ($500 limit)", accs.some((x) => x.id === luna.id && x.credit_limit_cents === 50000));
  const hl = [{ key: "h", product: choc.product.id, selling_unit: choc.unit.id, qty: 2 }];
  const hq = (await C.post("/api/chedam/sales/quote", { lines: hl })).json;
  const hs = await C.post("/api/chedam/sales", { id: sid(), lines: hl, expected_total_cents: hq.total_cents, payments: [{ method: "house_account", amount_cents: hq.total_cents, reference: luna.id }] });
  const invs = (await A.get(`/api/chedam/bills?side=receivable&party=${luna.id}`)).json.items;
  check("a sale charged to the account: an invoice for it", hs.status === 200 && invs.some((x) => x.party_ref === hs.json.sale.number && x.total_cents === hq.total_cents), JSON.stringify(invs.map((x) => [x.party_ref, x.total_cents])));
  const owed = (await C.get("/api/chedam/house-accounts")).json.items.find((x) => x.id === luna.id).owed_cents;
  await t.api("PATCH", `/api/collections/parties/records/${luna.id}`, { credit_limit_cents: owed + 100 }, { token: manager });
  const over = await C.post("/api/chedam/sales", { id: sid(), lines: hl, expected_total_cents: hq.total_cents, payments: [{ method: "house_account", amount_cents: hq.total_cents, reference: luna.id }] });
  check("over the limit: refused", over.status === 400 && /over the limit/.test(over.json.message), JSON.stringify(over.json).slice(0, 200));
  const coastal = (await t.list("parties", "name='Coastal Beverages Ltd.'")).items[0];
  check("a vendor has no house account", (await C.post("/api/chedam/sales", { id: sid(), lines: hl, expected_total_cents: hq.total_cents, payments: [{ method: "house_account", amount_cents: hq.total_cents, reference: coastal.id }] })).status === 400);
  void M;
} catch (e) { err = e; }
await t.finish(err);

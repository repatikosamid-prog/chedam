// P2 step 3: customers and loyalty (FR-7.01-7.06, 7.08, 4.12, BR-24). Join and find at the till, the
// programme off until the owner sets it, earn after discounts before tax, redeem before tax, cards
// (generate, link, block), returns take points back, the offline till (no phone numbers, same arithmetic,
// double use becomes a task), manager tools (adjust, move), BC PIPA data and deletion, and no personal
// details in the audit log.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step23-customers-loyalty.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8116 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const req = createRequire(import.meta.url);
globalThis.__pricingCore = req(join(HUB, "pb_hooks", "lib", "pricing_core.js"));
globalThis.__promoCore = req(join(HUB, "pb_hooks", "lib", "promotions_core.js"));
const opFile = join(mkdtempSync(join(tmpdir(), "chedam-op-")), "offline_price.mjs");
writeFileSync(opFile, readFileSync(join(HUB, "..", "client", "src", "lib", "offline_price.js"), "utf8")
  .replace('import core from "virtual:pricing-core";', "const core = globalThis.__pricingCore;")
  .replace('import promoCore from "virtual:promotions-core";', "const promoCore = globalThis.__promoCore;"));
const OP = await import(pathToFileURL(opFile).href);
const sha = async (x) => createHash("sha256").update(x).digest("hex");

let err = null;
try {
  console.log("Arithmetic (Node, BR-24)");
  const C0 = globalThis.__pricingCore, prog = { points_per_dollar: 1, points_per_dollar_off: 100, min_redeem: 500 };
  check("earn: 1 point per $1, rounded down ($15.99 → 15)", C0.loyaltyEarn(1599, prog) === 15 && C0.loyaltyEarn(0, prog) === 0);
  check("redeem 750 of 900 → $7.50; capped by what the sale costs ($3.00 → 300 points)", JSON.stringify(C0.loyaltyRedeem(750, 900, 10000, prog)) === JSON.stringify({ points: 750, cents: 750, error: "" })
    && C0.loyaltyRedeem(750, 900, 300, prog).points === 300);
  check("redeem: below the minimum or above the balance refused", !!C0.loyaltyRedeem(400, 900, 1000, prog).error && !!C0.loyaltyRedeem(1000, 900, 5000, prog).error);

  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Till of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), owner = await login("Demo Owner");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), O = as(owner);
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const chips = await find("2000000000060"), choc = await find("2000000000077"), towels = await find("2000000000091");
  const L = (m, extra = {}) => ({ key: "k" + Math.random().toString(36).slice(2, 8), product: m.product.id, selling_unit: m.unit.id, qty: 1, ...extra });
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const sell = async (lines, extra = {}) => {
    const q = (await C.post("/api/chedam/sales/quote", { lines, ...extra })).json;
    return C.post("/api/chedam/sales", { id: sid(), lines, ...extra, expected_total_cents: q.total_cents, payments: [{ method: "card", amount_cents: q.total_cents }] });
  };

  console.log("Join and find (FR-7.01, 7.02)");
  check("join needs 'customer agreed'", (await C.post("/api/chedam/customers", { first_name: "Ana", phone: "604-555-0199" })).status === 400);
  const ana = await C.post("/api/chedam/customers", { first_name: "Ana", phone: "(604) 555-0199", agreed: true });
  check("a cashier joins a customer; the phone is shown masked", ana.status === 200 && ana.json.phone === "•••-•••-0199" && ana.json.points === 0, JSON.stringify(ana.json));
  check("same phone twice refused", (await C.post("/api/chedam/customers", { first_name: "Other", phone: "6045550199", agreed: true })).status === 400);
  const f1 = (await C.get("/api/chedam/customers/find?q=" + encodeURIComponent("+1 604 555 0199"))).json;
  check("found by phone in any format", f1.results.length === 1 && f1.results[0].id === ana.json.id && f1.program === null, JSON.stringify(f1));
  check("a cashier cannot browse customers by name", (await C.get("/api/chedam/customers/find?q=Ana")).json.results.length === 0);
  check("a manager can", (await M.get("/api/chedam/customers/find?q=Ana")).json.results.length === 1);

  console.log("Programme off until the owner sets it (Q6)");
  let q = (await C.post("/api/chedam/sales/quote", { lines: [L(chips)], customer: ana.json.id })).json;
  check("off: the customer is on the sale but no points", q.loyalty && q.loyalty.enabled === false && q.loyalty.earn === 0, JSON.stringify(q.loyalty));
  check("only the owner sets the programme", (await M.post("/api/chedam/loyalty/program", { enabled: true, points_per_dollar: 1, points_per_dollar_off: 100, min_redeem: 500 })).status === 403);
  const snacks = (await t.list("categories", "name='Household'")).items[0].id;
  const set = await O.post("/api/chedam/loyalty/program", { enabled: true, points_per_dollar: 2, points_per_dollar_off: 100, min_redeem: 200, earn_on_promotions: true, exclude_categories: [snacks] });
  check("the owner switches it on with their values", set.status === 200 && set.json.active.points_per_dollar === 2, JSON.stringify(set.json));

  console.log("Earn and redeem (BR-24, FR-7.04)");
  q = (await C.post("/api/chedam/sales/quote", { lines: [L(chips), L(choc), L(towels)], customer: ana.json.id })).json;
  check("earn 2 points per $1 after discounts, before tax; Household left out ($6.78 → 13)", q.loyalty.earn === 13, JSON.stringify(q.loyalty));
  const s1 = await sell([L(chips), L(choc), L(towels)], { customer: ana.json.id });
  check("sale: 13 points earned, balance 13", s1.status === 200 && s1.json.sale.loyalty_earned === 13 && s1.json.sale.loyalty_balance === 13 && s1.json.sale.customer_name === "Ana", JSON.stringify(s1.json.sale).slice(0, 200));
  await M.post(`/api/chedam/customers/${ana.json.id}/adjust`, { points: 500, note: "Welcome bonus" });
  check("a manager adjusts points with a reason; a cashier cannot", (await C.post(`/api/chedam/customers/${ana.json.id}/adjust`, { points: 5, note: "x" })).status === 403
    && (await C.get(`/api/chedam/customers/${ana.json.id}`)).json.points === 513);
  q = (await C.post("/api/chedam/sales/quote", { lines: [L(chips), L(choc)], customer: ana.json.id, redeem_points: 100 })).json;
  check("below the minimum: said so", q.problems.some((p) => p.type === "loyalty" && /At least 200/.test(p.message)));
  const base = (await C.post("/api/chedam/sales/quote", { lines: [L(chips), L(choc)] })).json;
  q = (await C.post("/api/chedam/sales/quote", { lines: [L(chips), L(choc)], customer: ana.json.id, redeem_points: 300 })).json;
  check("300 points = $3.00 off before tax (the tax is on the lower amount)", q.loyalty.redeem_cents === 300 && q.loyalty.redeem_points === 300 && q.subtotal_cents === base.subtotal_cents
    && q.tax_cents < base.tax_cents && q.total_cents < base.total_cents - 300, JSON.stringify({ q: [q.total_cents, q.tax_cents], base: [base.total_cents, base.tax_cents] }));
  const s2lines = [L(chips), L(choc)];
  const s2 = await sell(s2lines, { customer: ana.json.id, redeem_points: 300 });
  check("sale: points used and earned on what was paid; receipt shows earned, used, balance", s2.json.sale.loyalty_redeemed === 300 && s2.json.sale.loyalty_earned === Math.floor((678 - 300) * 2 / 100)
    && s2.json.sale.loyalty_balance === 513 - 300 + s2.json.sale.loyalty_earned, JSON.stringify(s2.json.sale).slice(0, 300));
  const rt = (await C.get(`/api/chedam/sales/${s2.json.sale.id}/receipt-text?chars=48`)).json.text;
  check("receipt text", /Points used \(300\)\s+-\$3\.00/.test(rt) && /Loyalty: Ana/.test(rt) && /Points balance\s+\d+/.test(rt), rt);

  console.log("Returns take points back (FR-4.12)");
  const before = (await C.get(`/api/chedam/customers/${ana.json.id}`)).json.points;
  const saleV = (await C.get(`/api/chedam/sales/${s2.json.sale.id}`)).json;
  const chipLine = saleV.lines.find((l) => l.product === chips.product.id);
  const rq = await C.post("/api/chedam/returns/quote", { sale: s2.json.sale.id, lines: [{ sale_line: chipLine.id, qty: 1, disposition: "restock" }] });
  const ret = await C.post("/api/chedam/returns", { id: sid(), sale: s2.json.sale.id, lines: [{ sale_line: chipLine.id, qty: 1, disposition: "restock" }], reason: "test",
    expected_refund_cents: rq.json.refund_cents, refunds: [{ method: "card", amount_cents: rq.json.refund_cents }] });
  const after = (await C.get(`/api/chedam/customers/${ana.json.id}`)).json.points;
  const r = ret.json.return || {};
  check("returning the chips takes back their earned share and gives back their redeemed share", ret.status === 200 && after === before - (r.loyalty_reversed || 0) + (r.loyalty_returned || 0)
    && (await t.list("returns", `id='${r.id}'`)).items[0].loyalty_returned > 0, JSON.stringify({ status: ret.status, msg: ret.json.message, before, after, rq: rq.json && rq.json.refund_cents }));

  console.log("Cards (FR-7.05)");
  check("a cashier cannot make cards", (await C.post("/api/chedam/loyalty/cards", { count: 2 })).status === 403);
  const cards = (await M.post("/api/chedam/loyalty/cards", { count: 3 })).json.numbers;
  const ean = (n) => { let s = 0; for (let i = 0; i < 12; i++) s += Number(n[11 - i]) * (i % 2 === 0 ? 3 : 1); return (10 - (s % 10)) % 10 === Number(n[12]); };
  check("3 cards: 13 digits, start 29, valid check digit, all different", cards.length === 3 && cards.every((n) => /^29\d{11}$/.test(n) && ean(n)) && new Set(cards).size === 3, JSON.stringify(cards));
  check("a new card scanned at the till: ready to join", (await C.get("/api/chedam/customers/find?q=" + cards[0])).json.results[0].new_card === cards[0]);
  const bob = await C.post("/api/chedam/customers", { first_name: "Bob", card: cards[0], agreed: true });
  check("join with a card only (no phone)", bob.status === 200 && bob.json.card === cards[0]);
  check("found by card", (await C.get("/api/chedam/customers/find?q=" + cards[0])).json.results[0].id === bob.json.id);
  check("a card of another customer cannot be used", (await C.post(`/api/chedam/customers/${ana.json.id}`, { card: cards[0] })).status === 400);
  await sell([L(towels)], { customer: bob.json.id });
  await C.post("/api/chedam/loyalty/cards/block", { number: cards[0] });
  check("a lost card: blocked, cannot be used", (await C.get("/api/chedam/customers/find?q=" + cards[0])).status === 400);
  const relink = await C.post(`/api/chedam/customers/${bob.json.id}`, { card: cards[1] });
  check("a new card for the same customer: the points stay", relink.status === 200 && relink.json.card === cards[1], JSON.stringify(relink.json));

  console.log("Offline till (FR-7.06)");
  const pack = (await C.get("/api/chedam/sales/offline-pack")).json;
  check("pack: the programme and members, phone numbers only as hashes", pack.loyalty && pack.loyalty.program.points_per_dollar === 2 && pack.loyalty.customers.length >= 2
    && !JSON.stringify(pack.loyalty).includes("6045550199"), JSON.stringify(pack.loyalty).slice(0, 200));
  const ix = OP.indexPack(pack);
  const off = await OP.findMemberOffline(ix, "604 555 0199", sha);
  check("the till finds Ana offline by phone (salted hash) and Bob by card", off.length === 1 && off[0].id === ana.json.id && (await OP.findMemberOffline(ix, cards[1], sha))[0].id === bob.json.id);
  const anaNow = (await C.get(`/api/chedam/customers/${ana.json.id}`)).json;
  const cart = { lines: [L(chips), L(choc, { qty: 2 })], customer: { id: ana.json.id, first_name: "Ana" }, redeem_points: 200 };
  const hubQ = (await C.post("/api/chedam/sales/quote", { lines: cart.lines, customer: ana.json.id, redeem_points: 200 })).json;
  const loc = OP.quoteOffline(cart, ix, { discount: true, approve: false, exempt: true });
  check("offline till = hub: points used, earned, total", loc.total_cents === hubQ.total_cents && loc.loyalty.earn === hubQ.loyalty.earn && loc.loyalty.redeem_cents === hubQ.loyalty.redeem_cents,
    JSON.stringify({ hub: [hubQ.total_cents, hubQ.loyalty], loc: [loc.total_cents, loc.loyalty] }));
  // Spend the points on the hub first, then the offline sale arrives using them again
  await M.post(`/api/chedam/customers/${ana.json.id}/adjust`, { points: -anaNow.points, note: "Used elsewhere" });
  const till = (await C.get("/api/chedam/tills/current")).json.till;
  const up = await C.post("/api/chedam/sales/offline", { id: sid(), offline: true, offline_ref: "OFF-L-1", device_time: new Date().toISOString(), cashier: people["Cal Cashier"], till: till.id,
    training: false, tax_mode: loc.tax_mode, lines: loc.upload_lines, cart_discount_cents: loc.cart_discount_cents + loc.loyalty.redeem_cents, totals: { total_cents: loc.total_cents, tax_cents: loc.tax_cents },
    customer: ana.json.id, loyalty_earned: loc.loyalty.earn, loyalty_redeemed: loc.loyalty.redeem_points, loyalty_redeem_cents: loc.loyalty.redeem_cents,
    payments: [{ method: "card", amount_cents: loc.total_cents }] });
  check("offline sale with points arrives: kept as the till counted", up.status === 200 && up.json.sale.loyalty_redeemed === 200, JSON.stringify(up.json).slice(0, 300));
  check("points used twice: a task for the manager", (await t.list("tasks", "kind='loyalty'")).items.length === 1);

  console.log("Manager tools, privacy (FR-7.08)");
  const dup = await C.post("/api/chedam/customers", { first_name: "Bobby", phone: "7785550100", agreed: true });
  await M.post(`/api/chedam/customers/${dup.json.id}/adjust`, { points: 40, note: "test" });
  const moved = await M.post(`/api/chedam/customers/${dup.json.id}/move`, { into: bob.json.id });
  check("two records of one person: points moved, the first is deleted", moved.status === 200 && (await t.list("customers", `id='${dup.json.id}'`)).items[0].status === "erased", JSON.stringify(moved.json));
  const data = (await M.get(`/api/chedam/customers/${ana.json.id}/data`)).json;
  check("data request: details, cards, purchases and points history", data.customer.first_name === "Ana" && data.purchases.length >= 3 && data.points.length >= 4, JSON.stringify(data).slice(0, 200));
  check("deleting needs confirming", (await M.post(`/api/chedam/customers/${ana.json.id}/erase`, {})).status === 400);
  const er = await M.post(`/api/chedam/customers/${ana.json.id}/erase`, { confirm: true });
  check("deleted on request: name and phone gone, not found any more", er.status === 200 && er.json.first_name === "Deleted customer"
    && (await C.get("/api/chedam/customers/find?q=6045550199")).json.results.length === 0);
  const evs = (await t.list("events", `table_name='customers' && record_id='${ana.json.id}'`)).items;
  check("the audit log keeps who changed what, never the name or phone", evs.length >= 3 && !JSON.stringify(evs).includes("0199") && !JSON.stringify(evs).includes('"Ana"')
    && evs.some((e) => (e.changed || []).includes("first_name")), JSON.stringify(evs.map((e) => [e.action, e.changed])).slice(0, 300));
  const sAfter = (await C.get(`/api/chedam/sales/${s1.json.sale.id}`)).json;
  check("sales are kept (6 years) without the person's name", sAfter.number && sAfter.customer_name === "Deleted customer");
} catch (e) {
  err = e;
}
await t.finish(err);

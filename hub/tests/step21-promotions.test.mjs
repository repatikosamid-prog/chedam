// P2 step 1: promotions and scheduled prices (FR-5.06-5.10, BR-20, 21, 25). The engine
// (lib/promotions_core.js) in Node: every type, best deal without stacking, stackable deals, limits, days and
// hours, coupons, exact cents. Then the hub: who may manage them, checks, quote and sale with deals, coupons,
// uses counted, scheduled prices, preview with margins, labels, the offline pack and offline sales.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step21-promotions.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8114 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const P = createRequire(import.meta.url)(join(HUB, "pb_hooks", "lib", "promotions_core.js"));
const iso = (d) => d.toISOString().replace("T", " ");
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));

// The till's offline pricing (client/src/lib/offline_price.js) with its virtual imports pointed at the hub's files.
globalThis.__pricingCore = createRequire(import.meta.url)(join(HUB, "pb_hooks", "lib", "pricing_core.js"));
globalThis.__promoCore = P;
const opSrc = readFileSync(join(HUB, "..", "client", "src", "lib", "offline_price.js"), "utf8")
  .replace('import core from "virtual:pricing-core";', "const core = globalThis.__pricingCore;")
  .replace('import promoCore from "virtual:promotions-core";', "const promoCore = globalThis.__promoCore;");
const opFile = join(mkdtempSync(join(tmpdir(), "chedam-op-")), "offline_price.mjs");
writeFileSync(opFile, opSrc);
const OP = await import(pathToFileURL(opFile).href);

let err = null;
try {
  console.log("Engine (Node)");
  const now = new Date();
  const A = { key: "a", product: "pa", category: "c1", kind: "single", qty: 2, price_cents: 300 };
  const B = { key: "b", product: "pb", category: "c1", kind: "single", qty: 1, price_cents: 199 };
  const W = { key: "w", product: "pw", category: "c2", kind: "weight", qty: 1.5, price_cents: 400 };
  const promo = (x) => Object.assign({ id: "p" + Math.random().toString(36).slice(2, 7), status: "active", products: [], categories: [], exclude: [] }, x);
  const ev = (lines, promos, o) => P.evaluate(lines, promos, Object.assign({ now }, o || {}));

  let r = ev([A, W], [promo({ type: "pct_off", pct: 10, categories: ["c1", "c2"] })]);
  check("% off: each item and a weighed line (10% of $6.00 and of 1.5 kg × $4.00)", r.lines.a.promo_cents === 60 && r.lines.w.promo_cents === 60, JSON.stringify(r.lines));
  r = ev([A, W], [promo({ type: "amount_off", amount_cents: 50, products: ["pa", "pw"] })]);
  check("$ off each item; per kg when weighed", r.lines.a.promo_cents === 100 && r.lines.w.promo_cents === 75, JSON.stringify(r.lines));
  r = ev([A], [promo({ type: "fixed_price", price_cents: 250, products: ["pa"] })]);
  check("fixed price $2.50", r.lines.a.promo_cents === 100);
  const three = { key: "x", product: "px", category: "c3", kind: "single", qty: 4, price_cents: 199 };
  r = ev([three], [promo({ type: "multi_price", buy_qty: 3, price_cents: 500, products: ["px"] })]);
  check("3 for $5.00 on 4 items: one group, the 4th at full price ($5.97 - $5.00)", r.lines.x.promo_cents === 97 && r.applied[0].times === 1, JSON.stringify(r));
  const x1 = { key: "x1", product: "px", category: "c3", kind: "single", qty: 1, price_cents: 199 };
  const x2 = Object.assign({}, x1, { key: "x2" }), x3 = Object.assign({}, x1, { key: "x3" });
  r = ev([x1, x2, x3], [promo({ type: "multi_price", buy_qty: 3, price_cents: 500, products: ["px"] })]);
  check("3 for $5.00 on three lines: exactly $0.97 off in whole cents", r.lines.x1.promo_cents + r.lines.x2.promo_cents + r.lines.x3.promo_cents === 97, JSON.stringify(r.lines));
  r = ev([A, B], [promo({ type: "mix_match", buy_qty: 3, price_cents: 600, categories: ["c1"] })]);
  check("mix and match 3 for $6.00 across two products ($7.99 → $6.00)", r.lines.a.promo_cents + r.lines.b.promo_cents === 199, JSON.stringify(r.lines));
  r = ev([A, B], [promo({ type: "buy_get", buy_qty: 2, get_qty: 1, reward: "free", categories: ["c1"] })]);
  check("buy 2 get 1 free: the cheapest is free", r.lines.b.promo_cents === 199 && r.lines.a.promo_cents === 0, JSON.stringify(r.lines));
  r = ev([Object.assign({}, A, { qty: 4 })], [promo({ type: "buy_get", buy_qty: 1, get_qty: 1, reward: "pct", pct: 50, products: ["pa"] })]);
  check("buy 1 get 1 50% off on 4: twice", r.lines.a.promo_cents === 300 && r.applied[0].times === 2, JSON.stringify(r));
  r = ev([A, B], [promo({ type: "spend", threshold_cents: 700, reward: "pct", pct: 10 })]);
  check("spend $7.00 get 10% off ($7.99)", r.lines.a.promo_cents + r.lines.b.promo_cents === 80, JSON.stringify(r.lines));
  r = ev([A], [promo({ type: "spend", threshold_cents: 700, reward: "pct", pct: 10 })]);
  check("below the threshold: nothing", r.lines.a.promo_cents === 0);

  console.log("Best deal, stacking, limits (BR-20)");
  r = ev([A], [promo({ type: "pct_off", pct: 10, products: ["pa"] }), promo({ type: "fixed_price", price_cents: 200, products: ["pa"], name: "Two dollars" })]);
  check("no stacking: the better deal only ($2.00 each beats 10%)", r.lines.a.promo_cents === 200 && r.lines.a.label === "Two dollars" && r.applied.length === 1, JSON.stringify(r));
  r = ev([A], [promo({ type: "pct_off", pct: 10, categories: ["c1"], name: "cat" }), promo({ type: "pct_off", pct: 10, products: ["pa"], name: "item" })]);
  check("a tie goes to the item deal over the category deal", r.lines.a.label === "item", r.lines.a.label);
  r = ev([A], [promo({ type: "fixed_price", price_cents: 200, products: ["pa"] }), promo({ type: "pct_off", pct: 10, products: ["pa"], stackable: true })]);
  check("a stackable deal adds on top (10% of what is left: $4.00 → $3.60)", r.lines.a.promo_cents === 240, JSON.stringify(r.lines));
  r = ev([Object.assign({}, A, { qty: 5 })], [promo({ type: "pct_off", pct: 10, products: ["pa"], per_transaction: 2 })]);
  check("per-sale limit: 2 items", r.lines.a.promo_cents === 60);
  check("max uses reached: not in force", !P.inForce(promo({ type: "pct_off", pct: 10, max_uses: 5, uses: 5 }), now));
  r = ev([Object.assign({}, A, { no_promo: true })], [promo({ type: "pct_off", pct: 10, products: ["pa"] })]);
  check("a price changed by hand gets no deal", r.lines.a.promo_cents === 0);
  r = ev([A], [promo({ type: "pct_off", pct: 10, products: ["pa"], exclude: ["pa"] })]);
  check("excluded product: nothing", r.lines.a.promo_cents === 0);

  console.log("Dates, days, hours, coupons");
  const past = new Date(Date.now() - 3600e3), future = new Date(Date.now() + 3600e3);
  check("not started / ended / draft: not in force", !P.inForce(promo({ type: "pct_off", starts_at: iso(future) }), now) && !P.inForce(promo({ type: "pct_off", ends_at: iso(past) }), now)
    && !P.inForce(promo({ type: "pct_off", status: "draft" }), now) && P.inForce(promo({ type: "pct_off", starts_at: iso(past), ends_at: iso(future) }), now));
  const at = (h, m, day) => { const d = new Date(2026, 9, 9, h, m); while (d.getDay() !== day) d.setDate(d.getDate() + 1); return d; };
  const happy = promo({ type: "pct_off", hours_from: "16:00", hours_to: "18:00", days: [1, 2, 3, 4, 5] });
  check("happy hour: weekdays 16:00-18:00", P.inForce(happy, at(16, 30, 3)) && !P.inForce(happy, at(18, 0, 3)) && !P.inForce(happy, at(16, 30, 6)));
  check("hours past midnight (22:00-02:00)", P.inForce(promo({ type: "pct_off", hours_from: "22:00", hours_to: "02:00" }), at(1, 0, 2)) && !P.inForce(promo({ type: "pct_off", hours_from: "22:00", hours_to: "02:00" }), at(12, 0, 2)));
  const cp = promo({ type: "pct_off", pct: 20, products: ["pa"], coupon_code: "SAVE20" });
  check("coupon: only with its code (any case)", ev([A], [cp]).lines.a.promo_cents === 0 && ev([A], [cp], { coupons: ["save20"] }).lines.a.promo_cents === 120);
  check("scheduled price: the one that started last; regular otherwise", P.scheduledPrice("u", 300, [{ selling_unit: "u", price_cents: 250, starts_at: iso(new Date(Date.now() - 7200e3)) },
    { selling_unit: "u", price_cents: 270, starts_at: iso(past) }, { selling_unit: "u", price_cents: 100, starts_at: iso(future) }], now).price_cents === 270
    && P.scheduledPrice("u", 300, [], now).price_cents === 300);
  check("descriptions", P.describe({ type: "buy_get", buy_qty: 2, get_qty: 1, reward: "free" }) === "Buy 2, get 1 free" && P.describe({ type: "multi_price", buy_qty: 3, price_cents: 500 }) === "3 for $5.00");

  // ---- Hub
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
  const chips = await find("2000000000060"), choc = await find("2000000000077"), cola = await find("2000000000022");
  const L = (m, extra = {}) => ({ key: "k" + Math.random().toString(36).slice(2, 8), product: m.product.id, selling_unit: m.unit.id, qty: 1, ...extra });
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });

  console.log("Hub: managing promotions");
  const snack = (await t.list("categories", "name='Snacks'")).items[0].id;
  check("a cashier cannot create promotions", (await C.post("/api/chedam/promotions", { name: "x", type: "pct_off", pct: 10, products: [chips.product.id] })).status === 403);
  check("no scope: refused", (await M.post("/api/chedam/promotions", { name: "x", type: "pct_off", pct: 10 })).status === 400);
  check("bad percentage: refused", (await M.post("/api/chedam/promotions", { name: "x", type: "pct_off", pct: 150, products: [chips.product.id] })).status === 400);
  check("end before start: refused", (await M.post("/api/chedam/promotions", { name: "x", type: "pct_off", pct: 10, products: [chips.product.id], starts_at: iso(future), ends_at: iso(past) })).status === 400);
  const pv = await M.post("/api/chedam/promotions/preview", { type: "fixed_price", price_cents: 150, categories: [snack] });
  const chipRow = pv.json.rows.find((x) => x.product === chips.product.id);
  check("preview: regular vs promo price, cost and margin; below cost flagged (chips cost $1.90)", chipRow && chipRow.regular_cents === 399 && chipRow.promo_cents === 150 && chipRow.below_cost === true && pv.json.below_cost >= 1, JSON.stringify(pv.json).slice(0, 300));
  const before = (await M.get("/api/chedam/labels/batch")).json.items.filter((x) => x.product === chips.product.id).length;
  const snacks = await M.post("/api/chedam/promotions", { name: "Snack week", type: "pct_off", pct: 10, status: "active", categories: [snack], starts_at: iso(past) });
  check("manager creates an active promotion", snacks.status === 200 && snacks.json.status === "active", JSON.stringify(snacks.json).slice(0, 200));
  const lb = (await M.get("/api/chedam/labels/batch")).json.items.filter((x) => x.product === chips.product.id);
  check("its products go on the label batch, showing the deal (BR-25)", lb.length >= 1 && lb.some((x) => x.reasons.includes("promotion") && x.promo && x.promo.price_cents === 359 && x.promo.regular_cents === 399), JSON.stringify(lb).slice(0, 300) + " before " + before);

  console.log("Hub: quote and sale");
  let q = await C.post("/api/chedam/sales/quote", { lines: [L(chips), L(choc)] });
  const ql = q.json.lines;
  check("quote: both snacks 10% off, the deal named", ql[0].promo_cents === 40 && ql[0].promo_label === "Snack week" && ql[1].promo_cents === 28 && q.json.promotions[0].saving_cents === 68, JSON.stringify(q.json).slice(0, 400));
  const fixed = await M.post("/api/chedam/promotions", { name: "Chips $2.99", type: "fixed_price", price_cents: 299, status: "active", products: [chips.product.id] });
  q = await C.post("/api/chedam/sales/quote", { lines: [L(chips), L(choc)] });
  check("the better deal wins on chips, the category deal stays on chocolate (no stacking)", q.json.lines[0].promo_label === "Chips $2.99" && q.json.lines[0].promo_cents === 100 && q.json.lines[1].promo_label === "Snack week", JSON.stringify(q.json.lines.map((l) => [l.promo_label, l.promo_cents])));
  q = await C.post("/api/chedam/sales/quote", { lines: [L(chips, { discount: { type: "pct", value: 10 } })] });
  check("a cashier's discount comes after the deal (10% of $2.99)", q.json.lines[0].line_discount_cents === 100 + 30 && q.json.lines[0].discount_label === "10% off", JSON.stringify(q.json.lines[0]));
  const lines = [L(chips), L(choc)];
  q = await C.post("/api/chedam/sales/quote", { lines });
  const sale = await C.post("/api/chedam/sales", { id: sid(), lines, expected_total_cents: q.json.total_cents, payments: [{ method: "card", amount_cents: q.json.total_cents }] });
  check("sale keeps each line's deal and the deals used", sale.status === 200 && sale.json.sale.lines[0].promo_label === "Chips $2.99" && sale.json.sale.lines[0].promo_cents === 100
    && sale.json.sale.promotions.length === 2, JSON.stringify(sale.json).slice(0, 400));
  check("uses counted", (await t.list("promotions", `id='${fixed.json.id}'`)).items[0].uses === 1);
  const rt = (await C.get(`/api/chedam/sales/${sale.json.sale.id}/receipt-text?chars=48`)).json.text;
  check("receipt: the deal under its product", /Potato chips 200 g[^\n]*\n\s+Chips \$2\.99\s+-\$1\.00/.test(rt) && /Snack week\s+-\$0\.28/.test(rt), rt);

  console.log("Hub: coupons, limits, ending");
  await M.post("/api/chedam/promotions", { name: "Cola coupon", type: "pct_off", pct: 50, status: "active", products: [cola.product.id], coupon_code: "cola50" });
  q = await C.post("/api/chedam/sales/quote", { lines: [L(cola)] });
  check("coupon deal not without its code", !q.json.lines[0].promo_cents);
  q = await C.post("/api/chedam/sales/quote", { lines: [L(cola)], coupons: ["COLA50", "NOPE1"] });
  check("with the code: applied; an unknown code is reported", q.json.lines[0].promo_cents === 75 && q.json.coupons_unused.join() === "NOPE1", JSON.stringify(q.json).slice(0, 300));
  check("a coupon code is unique", (await M.post("/api/chedam/promotions", { name: "dup", type: "pct_off", pct: 5, products: [cola.product.id], coupon_code: "COLA50" })).status === 400);
  const ended = await M.post(`/api/chedam/promotions/${fixed.json.id}/end`, {});
  q = await C.post("/api/chedam/sales/quote", { lines: [L(chips)] });
  check("an ended promotion no longer applies (the category deal is back)", ended.json.status === "ended" && q.json.lines[0].promo_label === "Snack week", JSON.stringify(q.json.lines[0]));
  check("an ended promotion cannot be changed", (await M.post("/api/chedam/promotions", { id: fixed.json.id, name: "x", type: "pct_off", pct: 5, products: [chips.product.id] })).status === 400);
  const draft = await M.post("/api/chedam/promotions", { name: "Draft", type: "fixed_price", price_cents: 100, status: "draft", products: [choc.product.id] });
  q = await C.post("/api/chedam/sales/quote", { lines: [L(choc)] });
  check("a draft does not apply", draft.status === 200 && q.json.lines[0].promo_label === "Snack week");

  console.log("Hub: scheduled prices (FR-5.06)");
  const sp = await M.post("/api/chedam/scheduled-prices", { selling_unit: cola.unit.id, price_cents: 129, starts_at: iso(past), ends_at: iso(future) });
  q = await C.post("/api/chedam/sales/quote", { lines: [L(cola)] });
  check("the scheduled price is the price now (regular kept to show 'was')", sp.status === 200 && q.json.lines[0].price_cents === 129 && q.json.lines[0].regular_price_cents === 149, JSON.stringify(q.json.lines[0]));
  const colaLabel = (await M.get("/api/chedam/labels/batch")).json.items.find((x) => x.selling_unit === cola.unit.id);
  check("its label is queued with the new price", colaLabel && colaLabel.price_cents === 129, JSON.stringify(colaLabel));
  await M.post("/api/chedam/scheduled-prices", { id: sp.json.id, remove: true });
  q = await C.post("/api/chedam/sales/quote", { lines: [L(cola)] });
  check("removed: back to the regular price", q.json.lines[0].price_cents === 149);
  const later = await M.post("/api/chedam/scheduled-prices", { selling_unit: cola.unit.id, price_cents: 99, starts_at: iso(future) });
  q = await C.post("/api/chedam/sales/quote", { lines: [L(cola)] });
  check("a future price is not used yet", later.status === 200 && q.json.lines[0].price_cents === 149);

  console.log("Hub: offline pack and offline sales");
  const pack = (await C.get("/api/chedam/sales/offline-pack")).json;
  check("the till's offline pack has the deals and scheduled prices", pack.modules.promotions === true && pack.promotions.some((p) => p.name === "Snack week") && pack.scheduled_prices.some((x) => x.price_cents === 99), JSON.stringify(Object.keys(pack)));
  const ix = OP.indexPack(pack);
  const perms = { discount: true, approve: false, exempt: true };
  const carts = [
    ["snacks deal", { lines: [L(chips), L(choc, { qty: 3 })] }],
    ["coupon", { lines: [L(cola, { qty: 2 }), L(chips)], coupons: ["COLA50"] }],
    ["deal + cashier discount + sale discount", { lines: [L(choc, { qty: 2, discount: { type: "pct", value: 5 } }), L(cola)], cart_discount: { type: "amount", value: 50 } }],
  ];
  for (const [name, cart] of carts) {
    const hub = (await C.post("/api/chedam/sales/quote", cart)).json;
    const loc = OP.quoteOffline(cart, ix, perms);
    const same = hub.total_cents === loc.total_cents && hub.tax_cents === loc.tax_cents && canon(hub.taxes) === canon(loc.taxes)
      && hub.lines.every((l) => { const o = loc.lines.find((x) => x.key === l.key); return o && o.promo_cents === l.promo_cents && o.promo_label === l.promo_label && o.net_cents === l.net_cents; });
    check(`offline till = hub with deals: ${name} (${hub.total_cents} c)`, same, JSON.stringify({ hub: hub.lines.map((l) => [l.promo_label, l.promo_cents, l.net_cents]), loc: loc.lines.map((l) => [l.promo_label, l.promo_cents, l.net_cents]), ht: hub.total_cents, lt: loc.total_cents }));
  }
  const q0 = OP.quoteOffline(carts[0][1], ix, perms);
  const snackId = pack.promotions.find((p) => p.name === "Snack week").id;
  const usesBefore = (await t.list("promotions", `id='${snackId}'`)).items[0].uses;
  const till = (await C.get("/api/chedam/tills/current")).json.till;
  const off = await C.post("/api/chedam/sales/offline", { id: sid(), offline: true, offline_ref: "OFF-P-1", device_time: new Date().toISOString(), cashier: people["Cal Cashier"],
    till: till.id, training: false, tax_mode: q0.tax_mode, lines: q0.upload_lines, cart_discount_cents: q0.cart_discount_cents, promotions: q0.promotions, coupons: q0.coupons,
    totals: { total_cents: q0.total_cents, tax_cents: q0.tax_cents }, payments: [{ method: "card", amount_cents: q0.total_cents }] });
  check("an offline sale keeps its deals as the till priced them, and counts each use (4 items)", off.status === 200 && off.json.sale.lines.every((l) => l.promo_label === "Snack week" && l.promo_cents > 0)
    && (await t.list("promotions", `id='${snackId}'`)).items[0].uses === usesBefore + q0.promotions[0].times, JSON.stringify({ lines: off.json.sale && off.json.sale.lines.map((l) => [l.promo_label, l.promo_cents]), uses: [usesBefore, (await t.list("promotions", `id='${snackId}'`)).items[0].uses], promos: q0.promotions }));

  const list = (await M.get("/api/chedam/promotions")).json;
  check("list: in force or not, and what each deal is", list.promotions.find((p) => p.name === "Snack week").in_force === true && list.promotions.find((p) => p.name === "Snack week").text === "10% off");

  console.log("Hub: module off");
  const mod = (await t.list("modules", "module='promotions'")).items[0];
  await t.su_("PATCH", `/api/collections/modules/records/${mod.id}`, { enabled: false });
  q = await C.post("/api/chedam/sales/quote", { lines: [L(chips)] });
  check("Promotions module off: no deals", !q.json.lines[0].promo_cents);
  await t.su_("PATCH", `/api/collections/modules/records/${mod.id}`, { enabled: true });
  check("promotions are in the event log", (await t.list("events", "table_name='promotions'")).items.length >= 4);
} catch (e) {
  err = e;
}
await t.finish(err);

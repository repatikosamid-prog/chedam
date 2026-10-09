// P1 step 4: offline selling. The offline pack; the till's offline pricing (client/src/lib/offline_price.js
// with the hub's pricing_core.js) matches the hub's quote to the cent; upload of offline sales: recorded
// as charged, duplicate ids answered with the first result (BR-10), figures checked, stock may go
// negative with an urgent task that closes itself (BR-12), late arrival after the till closed, payment
// methods switched off since, cashier kept.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step14-offline.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8107 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
// Same values regardless of key order
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

// The client's offline pricing, with its `virtual:pricing-core` and `virtual:promotions-core` imports
// pointed at the hub's files.
globalThis.__pricingCore = createRequire(import.meta.url)(join(HUB, "pb_hooks", "lib", "pricing_core.js"));
globalThis.__promoCore = createRequire(import.meta.url)(join(HUB, "pb_hooks", "lib", "promotions_core.js"));
const src = readFileSync(join(HUB, "..", "client", "src", "lib", "offline_price.js"), "utf8")
  .replace('import core from "virtual:pricing-core";', "const core = globalThis.__pricingCore;")
  .replace('import promoCore from "virtual:promotions-core";', "const promoCore = globalThis.__promoCore;");
const tmp = join(mkdtempSync(join(tmpdir(), "chedam-op-")), "offline_price.mjs");
writeFileSync(tmp, src);
const OP = await import(pathToFileURL(tmp).href);

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const devs = {};
  const login = async (n) => {
    devs[n] = await t.pair("Till of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: devs[n] })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), staff = await login("Sam Staff");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager);
  const level = async (pid) => (await M.get("/api/chedam/stock/products/" + pid)).json.level;

  console.log("Offline pack");
  check("staff (no sales.sell) cannot download it", (await as(staff).get("/api/chedam/sales/offline-pack")).status === 403);
  const pk = await C.get("/api/chedam/sales/offline-pack");
  check("pack: products, units with barcode lists, tax rates and classes", pk.status === 200 && pk.json.products.length >= 11
    && pk.json.units.some((u) => Array.isArray(u.barcodes) && u.barcodes.includes("2000000000022")) && pk.json.tax_rates.length === 2 && pk.json.tax_classes.length === 4, JSON.stringify({ p: pk.json.products.length, u: pk.json.units.slice(0, 2), r: pk.json.tax_rates, c: pk.json.tax_classes.length }));
  check("pack has no costs", !JSON.stringify(pk.json).includes("cost_cents"));
  const ix = OP.indexPack(pk.json);
  const find = (code) => OP.lookupOffline(ix, code).matches;
  check("offline lookup: barcode, shared barcode, PLU, UPC-A form", find("2000000000022").length === 1 && find("2000000000053").length === 2 && find("4011")[0].unit.kind === "weight");
  const m = (code, i = 0) => find(code)[i];
  const L = (x, extra = {}) => ({ key: "k" + Math.random().toString(36).slice(2, 8), product: x.product.id, selling_unit: x.unit.id, qty: 1, ...extra });

  console.log("Parity: till offline = hub quote");
  const perms = { discount: true, approve: false, exempt: true };
  const carts = [
    ["basket", { lines: [L(m("2000000000022"), { qty: 2 }), L(m("2000000000060")), L(m("4011"), { weight: 1.235 })] }],
    ["discounts", { lines: [L(m("2000000000077"), { qty: 3, discount: { type: "pct", value: 7.5 } }), L(m("2000000000091"), { discount: { type: "amount", value: 55 } })], cart_discount: { type: "pct", value: 5 } }],
    ["override", { lines: [L(m("2000000000077"), { price_cents: 260, override_reason: "Shelf price" }), L(m("2000000000015"), { qty: 2 })] }],
    ["exempt", { lines: [L(m("2000000000077"), { qty: 4 }), L(m("2000000000022"), { qty: 6 })], exempt: { reason: "pst_resale", reference: "PST-99" } }],
    ["packs", { lines: [L(m("2000000000053", 1), { qty: 2 }), L(m("2000000000046"))] }],
    ["weights", { lines: [L(m("4664"), { weight: 0.873 }), L(m("4011"), { weight: 2.004 })], cart_discount: { type: "amount", value: 37 } }],
  ];
  for (const [name, cart] of carts) {
    const hub = (await C.post("/api/chedam/sales/quote", { ...cart, cart_id: "p" + name })).json;
    const loc = OP.quoteOffline(cart, ix, perms);
    const same = hub.total_cents === loc.total_cents && hub.tax_cents === loc.tax_cents && hub.deposit_cents === loc.deposit_cents
      && canon(hub.taxes) === canon(loc.taxes) && hub.cash_total_cents === loc.cash_total_cents && hub.exempt_cents === loc.exempt_cents
      && hub.lines.every((l) => { const o = loc.lines.find((x) => x.key === l.key); return o && o.net_cents === l.net_cents && canon(o.taxes) === canon(l.taxes); });
    check(`${name}: ${hub.total_cents} c on both`, same, JSON.stringify({ hub: [hub.total_cents, hub.taxes], loc: [loc.total_cents, loc.taxes] }));
  }
  const big = OP.quoteOffline({ lines: [L(m("2000000000077"), { discount: { type: "pct", value: 30 } })] }, ix, perms);
  check("offline: a discount above the limit is refused (no PIN without the hub)", big.problems.some((p) => p.type === "approval_offline"));
  check("offline: age check still asked", OP.quoteOffline({ lines: [L(m("2000000000107"))] }, ix, perms).problems.some((p) => p.type === "age"));

  console.log("Upload (Section 8.2)");
  const till = (await C.post("/api/chedam/tills/open", { float_cents: 10000 })).json;
  const payload = (cart, payments, extra = {}) => {
    const q = OP.quoteOffline(cart, ix, perms);
    return { id: sid(), offline: true, offline_ref: "OFF-TEST-" + Math.floor(Math.random() * 9999), device_time: new Date().toISOString(), cashier: people["Cal Cashier"],
      till: till.id, training: false, tax_mode: q.tax_mode, lines: q.upload_lines, cart_discount_cents: q.cart_discount_cents, exempt: q.exempt, exempt_cents: q.exempt_cents,
      totals: { total_cents: q.total_cents, tax_cents: q.tax_cents }, payments: payments(q), ...extra };
  };
  const cola = m("2000000000022").product.id;
  const before = (await level(cola)).on_hand;
  const p1 = payload(carts[0][1], () => [{ method: "cash", amount_cents: 2000 }]);
  const u1 = await C.post("/api/chedam/sales/offline", p1);
  check("offline sale recorded: S- number, offline ref kept, 9.90 cash, change 10.10", u1.status === 200 && /^S-/.test(u1.json.sale.number) && u1.json.sale.offline_ref === p1.offline_ref
    && u1.json.sale.offline && u1.json.sale.rounding_cents === 2 && u1.json.sale.change_cents === 1010, JSON.stringify(u1.json).slice(0, 400));
  check("stock taken out", (await level(cola)).on_hand === before - 2);
  check("sold by the cashier of that moment", u1.json.sale.cashier === "Cal Cashier");
  const u1b = await C.post("/api/chedam/sales/offline", p1);
  check("uploaded twice: first result, stock unchanged (BR-10)", u1b.json.duplicate === true && (await level(cola)).on_hand === before - 2);
  const bad = payload(carts[1][1], (q) => [{ method: "card", amount_cents: q.total_cents }]);
  bad.totals.total_cents += 100;
  check("figures that do not add up are refused", (await C.post("/api/chedam/sales/offline", bad)).status === 400);
  check("not paid in full refused", (await C.post("/api/chedam/sales/offline", payload(carts[1][1], () => [{ method: "card", amount_cents: 1 }]))).status === 400);

  console.log("Oversold while offline (BR-12)");
  const vape = m("2000000000107");
  const vOn = (await level(vape.product.id)).on_hand;   // 5 in the sample
  const ov = await C.post("/api/chedam/sales/offline", payload({ lines: [L(vape, { qty: vOn + 3, age_checked: true })] }, (q) => [{ method: "card", amount_cents: q.total_cents }]));
  check("accepted although only " + vOn + " were in stock", ov.status === 200, JSON.stringify(ov.json));
  check("stock shows the true negative (-3)", (await level(vape.product.id)).on_hand === -3);
  let tasks = (await t.list("tasks", `rule_key='stock:oversold:${vape.product.id}' && status='open'`)).items;
  check("urgent 'oversold while offline' task", tasks.length === 1 && tasks[0].priority === "urgent" && /-3/.test(tasks[0].title), JSON.stringify(tasks));
  await M.post("/api/chedam/stock/receive", { op_id: "op" + sid(), lines: [{ product: vape.product.id, qty: 5 }] });
  tasks = (await t.list("tasks", `rule_key='stock:oversold:${vape.product.id}' && status='open'`)).items;
  check("receiving 5 brings it to 2 and closes the task", (await level(vape.product.id)).on_hand === 2 && tasks.length === 0);

  console.log("Payment methods, late arrival");
  const pm = (await t.list("settings", "key='sales.payment_methods'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${pm.id}`, { value: ["cash", "card"] });
  const us = await C.post("/api/chedam/sales/offline", payload(carts[2][1], () => [{ method: "usd_cash", amount_cents: 2000 }]));
  check("US cash taken offline is kept though switched off since", us.status === 200 && us.json.sale.payments[0].method === "usd_cash", JSON.stringify(us.json).slice(0, 200));
  check("online, US cash is now refused", (await C.post("/api/chedam/sales", { id: sid(), lines: carts[2][1].lines, payments: [{ method: "usd_cash", amount_cents: 2000 }] })).status === 400);
  const z = (await C.get("/api/chedam/tills/current")).json.till.summary;
  check("the 3 accepted offline sales count in the till's Z figures", z.sales_count === 3, JSON.stringify(z));
  await C.post(`/api/chedam/tills/${till.id}/close`, { counted_cents: z.expected_cash_cents });
  const late = await C.post("/api/chedam/sales/offline", payload(carts[2][1], (q) => [{ method: "card", amount_cents: q.total_cents }]));
  check("arriving after the till closed: kept, noted, task raised", late.status === 200 && /closed/.test(late.json.sale.sync_note)
    && (await t.list("tasks", "kind='offline_sale' && status='open'")).items.length === 1, JSON.stringify(late.json).slice(0, 300));
  check("another device cannot upload into this till", (await M.post("/api/chedam/sales/offline", payload(carts[2][1], (q) => [{ method: "card", amount_cents: q.total_cents }]))).json.sale.till === "");

  console.log("Till opened offline (DL-90)");
  const tid = sid();
  const openedAt = new Date(Date.now() - 3600000);
  const oo = await C.post("/api/chedam/tills/offline-open", { id: tid, float_cents: 15000, opened_by: people["Cal Cashier"], device_time: openedAt.toISOString() });
  check("opened at the till's time (1 h ago), not on arrival", Math.abs(Date.parse(oo.json.till.opened_at.replace(" ", "T")) - openedAt.getTime()) < 2000, oo.json.till.opened_at);
  check("recorded with the till's id, a number, its float, offline", oo.status === 200 && oo.json.till.id === tid && oo.json.till.number > 0
    && oo.json.till.float_cents === 15000 && oo.json.till.offline && oo.json.till.status === "open", JSON.stringify(oo.json));
  check("uploaded twice: first result", (await C.post("/api/chedam/tills/offline-open", { id: tid, float_cents: 99 })).json.duplicate === true);
  check("another device cannot claim it", (await M.post("/api/chedam/tills/offline-open", { id: tid, float_cents: 0 })).status === 400);
  const os = await C.post("/api/chedam/sales/offline", { ...payload(carts[0][1], () => [{ method: "cash", amount_cents: 2000 }]), till: tid });
  check("its offline sale lands in it, no note", os.status === 200 && os.json.sale.till === tid && !os.json.sale.sync_note, JSON.stringify(os.json).slice(0, 300));
  const oz = (await C.get("/api/chedam/tills/current")).json.till;
  check("it is this device's till; float + cash 9.90 expected", oz.id === tid && oz.summary.sales_count === 1 && oz.summary.expected_cash_cents === 15000 + 990, JSON.stringify(oz.summary));
  const tid2 = sid();
  const o2 = await C.post("/api/chedam/tills/offline-open", { id: tid2, float_cents: 0 });
  check("opened offline while another till is open: kept, noted, task", o2.status === 200 && /still open/.test(o2.json.till.sync_note)
    && (await t.list("tasks", `rule_key='till:double:${tid2}' && status='open'`)).items.length === 1, JSON.stringify(o2.json));
  check("bad id refused", (await C.post("/api/chedam/tills/offline-open", { id: "x", float_cents: 0 })).status === 400);
} catch (e) {
  err = e;
}
await t.finish(err);

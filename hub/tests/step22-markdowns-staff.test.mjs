// P2 step 2: near-expiry markdowns (FR-5.11) and staff discounts (FR-5.20). Engine in Node (markdown steps,
// lots in selling order, markdown vs other deals); then the hub: markdowns off until switched on, % by
// days left per lot, FEFO, perishable only, near-expiry stickers by the minute job; staff discount with
// the staff member's PIN, exclusions, monthly limit, a staff PIN never approves anything else, recorded
// on the sale and the receipt; the offline till applies markdowns and refuses staff discounts.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step22-markdowns-staff.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8115 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const P = createRequire(import.meta.url)(join(HUB, "pb_hooks", "lib", "promotions_core.js"));
globalThis.__pricingCore = createRequire(import.meta.url)(join(HUB, "pb_hooks", "lib", "pricing_core.js"));
globalThis.__promoCore = P;
const opFile = join(mkdtempSync(join(tmpdir(), "chedam-op-")), "offline_price.mjs");
writeFileSync(opFile, readFileSync(join(HUB, "..", "client", "src", "lib", "offline_price.js"), "utf8")
  .replace('import core from "virtual:pricing-core";', "const core = globalThis.__pricingCore;")
  .replace('import promoCore from "virtual:promotions-core";', "const promoCore = globalThis.__promoCore;"));
const OP = await import(pathToFileURL(opFile).href);
const ymd = (days) => { const d = new Date(Date.now() + days * 86400000); const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };

let err = null;
try {
  console.log("Engine (Node)");
  const steps = [{ days: 3, pct: 25 }, { days: 1, pct: 50 }];
  check("% by days left: 3 → 25, 1 → 50, 0 → 50, 4 → none, expired → none", P.markdownPct(3, steps) === 25 && P.markdownPct(1, steps) === 50 && P.markdownPct(0, steps) === 50
    && P.markdownPct(4, steps) === 0 && P.markdownPct(-1, steps) === 0);
  const L1 = { key: "a", product: "p", kind: "single", qty: 2, base_qty: 1, price_cents: 400 }, L2 = { key: "b", product: "p", kind: "single", qty: 2, base_qty: 1, price_cents: 400 };
  const md = P.markdowns([L1, L2], { p: [{ qty: 1, pct: 50 }, { qty: 2, pct: 25 }] });
  check("items take the marked-down lots in selling order, across lines", JSON.stringify(md) === JSON.stringify({ a: [50, 25], b: [25, 0] }), JSON.stringify(md));
  const W = { key: "w", product: "q", kind: "weight", qty: 2, price_cents: 500 };
  const mw = P.markdowns([W], { q: [{ qty: 1, pct: 50 }] });
  check("weighed: the share of the weight from the marked lot (1 of 2 kg at 50% = 25%)", mw.w[0] === 25);
  let r = P.evaluate([L1], [], { markdowns: { a: [50, 25] } });
  check("markdown as a deal: $2.00 + $1.00 off, labelled near expiry", r.lines.a.promo_cents === 300 && /Near expiry/.test(r.lines.a.label), JSON.stringify(r));
  r = P.evaluate([L1], [{ id: "x", type: "pct_off", pct: 30, status: "active", products: ["p"], categories: [], exclude: [] }], { markdowns: { a: [50, 0] } });
  check("best deal per item: 50% markdown on one, the 30% deal on the other (no stacking)", r.lines.a.promo_cents === 200 + 120, JSON.stringify(r));

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
  const bread = await find("2000000000046") || null;
  const sour = (await C.get("/api/chedam/catalogue/lookup?code=" + encodeURIComponent((await t.list("products", "name='Sourdough loaf'")).items[0].plu || "x"))).json.matches[0]
    || { product: { id: (await t.list("products", "name='Sourdough loaf'")).items[0].id }, unit: { id: (await t.list("selling_units", `product='${(await t.list("products", "name='Sourdough loaf'")).items[0].id}'`)).items[0].id } };
  const chips = await find("2000000000060"), choc = await find("2000000000077"), bananas = await find("4011");
  const L = (m, extra = {}) => ({ key: "k" + Math.random().toString(36).slice(2, 8), product: m.product.id, selling_unit: m.unit.id, qty: 1, ...extra });
  const setting = async (key, value) => { const s = (await t.list("settings", `key='${key}'`)).items[0]; return t.su_("PATCH", `/api/collections/settings/records/${s.id}`, { value }); };
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  void bread;

  console.log("Hub: near-expiry markdowns");
  let q = await C.post("/api/chedam/sales/quote", { lines: [L(sour, { qty: 2 })] });
  check("off by default: no markdown", !q.json.lines[0].promo_cents, JSON.stringify(q.json.lines[0]));
  await setting("promotions.markdowns", { enabled: true, perishable_only: true, steps: [{ days: 3, pct: 25 }, { days: 1, pct: 50 }] });
  q = await C.post("/api/chedam/sales/quote", { lines: [L(sour, { qty: 2 })] });
  const loaf = q.json.lines[0].price_cents;
  check("sourdough expiring in 3 days: 25% off each", q.json.lines[0].promo_cents === Math.floor(loaf * 2 * 0.25 + 0.5) && q.json.lines[0].promo_label === "Near expiry 25% off", JSON.stringify(q.json.lines[0]));
  const rec = await M.post("/api/chedam/stock/receive", { op_id: "op" + sid(), lines: [{ product: sour.product.id, selling_unit: sour.unit.id, qty: 2, expiry_date: ymd(1) }] });
  check("2 more loaves expiring tomorrow received", rec.status === 200, JSON.stringify(rec.json).slice(0, 200));
  q = await C.post("/api/chedam/sales/quote", { lines: [L(sour, { qty: 3 })] });
  check("selling order: the 2 expiring tomorrow at 50%, the 3rd at 25%", q.json.lines[0].promo_cents === Math.floor(loaf * (0.5 * 2 + 0.25) + 0.5) && q.json.lines[0].promo_label === "Near expiry markdown",
    JSON.stringify(q.json.lines[0]));
  q = await C.post("/api/chedam/sales/quote", { lines: [L(chips)] });
  check("non-perishable products: no markdown", !q.json.lines[0].promo_cents);
  const list = (await M.get("/api/chedam/promotions/markdowns")).json.rows;
  check("markdown list: the lots, expiry and %", list.some((x) => x.pct === 50 && x.qty === 2) && list.some((x) => x.pct === 25), JSON.stringify(list));
  const sale = await C.post("/api/chedam/sales", { id: sid(), lines: [L(sour)], expected_total_cents: (await C.post("/api/chedam/sales/quote", { lines: [L(sour)] })).json.total_cents,
    payments: [{ method: "card", amount_cents: (await C.post("/api/chedam/sales/quote", { lines: [L(sour)] })).json.total_cents }] });
  check("sale with a markdown: recorded on the line", sale.status === 200 && sale.json.sale.lines[0].promo_label === "Near expiry 50% off", JSON.stringify(sale.json).slice(0, 300));
  // The minute job puts stickers on the label batch (wait for it)
  let stickers = [];
  for (let i = 0; i < 40 && !stickers.length; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    stickers = (await M.get("/api/chedam/labels/batch")).json.items.filter((x) => x.product === sour.product.id && x.markdown_pct > 0);
  }
  check("near-expiry stickers queued by the minute job, one per item, at the lot's %", stickers.some((x) => x.markdown_pct === 50 && x.qty === 1 && x.promo && /Near expiry 50%/.test(x.promo.text))
    && stickers.some((x) => x.markdown_pct === 25 && x.qty === 6), JSON.stringify(stickers.map((x) => [x.markdown_pct, x.qty, x.promo && x.promo.price_cents])));

  console.log("Offline till: markdowns yes, staff discounts no");
  const pack = (await C.get("/api/chedam/sales/offline-pack")).json;
  const ix = OP.indexPack(pack);
  const cart = { lines: [L(sour, { qty: 2 }), L(chips)] };
  const hubQ = (await C.post("/api/chedam/sales/quote", cart)).json, loc = OP.quoteOffline(cart, ix, { discount: true, approve: false, exempt: true });
  check("offline pack has the markdowns; the till prices them like the hub", pack.markdowns[sour.product.id] && hubQ.total_cents === loc.total_cents && loc.lines[0].promo_cents === hubQ.lines[0].promo_cents,
    JSON.stringify({ hub: hubQ.total_cents, loc: loc.total_cents, md: pack.markdowns }));
  check("offline: a staff discount is refused (PIN checked on the hub)", OP.quoteOffline({ ...cart, staff: { approval: "x" } }, ix, { discount: true }).problems.some((p) => p.type === "staff"));

  console.log("Hub: staff discounts");
  const produce = (await t.list("categories", "name='Produce'")).items[0].id;
  const staffAppr = async () => (await C.post("/api/chedam/sales/approvals", { user: people["Sam Staff"], pin: PIN["Sam Staff"], permission: "staff" })).json.approval;
  let a = await staffAppr();
  q = await C.post("/api/chedam/sales/quote", { lines: [L(chips)], staff_approval: a });
  check("off by default: refused with a reason", q.json.problems.some((p) => p.type === "staff" && /switched off/.test(p.message)), JSON.stringify(q.json.problems));
  await setting("sales.staff_discount", { enabled: true, pct: 20, monthly_limit_cents: 300, on_promotions: false, exclude_categories: [produce] });
  check("a wrong PIN gives no staff approval", (await C.post("/api/chedam/sales/approvals", { user: people["Sam Staff"], pin: "0000", permission: "staff" })).status === 400);
  q = await C.post("/api/chedam/sales/quote", { lines: [L(chips), L(bananas, { weight: 1 })], staff_approval: a });
  check("20% off chips; produce excluded", q.json.lines[0].staff_cents === 80 && !q.json.lines[1].staff_cents && q.json.staff.name === "Sam Staff" && q.json.staff.left_cents === 220, JSON.stringify(q.json.staff));
  q = await C.post("/api/chedam/sales/quote", { lines: [L(sour), L(choc)], staff_approval: a });
  check("items on a deal (the markdown) get no staff discount unless allowed", !q.json.lines[0].staff_cents && q.json.lines[1].staff_cents === 56, JSON.stringify(q.json.lines.map((l) => l.staff_cents)));
  const big = await C.post("/api/chedam/sales/quote", { lines: [L(choc, { discount: { type: "pct", value: 50 } })], approval: a });
  check("a staff PIN never approves a manager's item (discount above the limit still needs a manager)", big.json.needs_approval.length === 1, JSON.stringify(big.json.needs_approval));
  const lines = [L(chips, { qty: 2 })];
  q = await C.post("/api/chedam/sales/quote", { lines, staff_approval: a });
  const s1 = await C.post("/api/chedam/sales", { id: sid(), lines, staff_approval: a, expected_total_cents: q.json.total_cents, payments: [{ method: "card", amount_cents: q.json.total_cents }] });
  check("staff sale recorded: who and how much", s1.status === 200 && s1.json.sale.staff_name === "Sam Staff" && s1.json.sale.staff_discount_cents === 160, JSON.stringify(s1.json).slice(0, 300));
  const rt = (await C.get(`/api/chedam/sales/${s1.json.sale.id}/receipt-text?chars=48`)).json.text;
  check("receipt: staff discount under the item and who bought", /Staff discount\s+-\$1\.60/.test(rt) && /Staff purchase: Sam Staff/.test(rt), rt);
  q = await C.post("/api/chedam/sales/quote", { lines: [L(chips)], staff_approval: a });
  check("the approval is used once", q.json.problems.some((p) => p.type === "staff" && /PIN again/.test(p.message)));
  a = await staffAppr();
  q = await C.post("/api/chedam/sales/quote", { lines: [L(chips, { qty: 3 })], staff_approval: a });
  check("monthly limit: $3.00 less $1.60 used leaves $1.40", q.json.staff.cents === 140 && q.json.staff.left_cents === 0, JSON.stringify(q.json.staff));
  const lines2 = [L(chips, { qty: 3 })];
  q = await C.post("/api/chedam/sales/quote", { lines: lines2, staff_approval: a });
  await C.post("/api/chedam/sales", { id: sid(), lines: lines2, staff_approval: a, expected_total_cents: q.json.total_cents, payments: [{ method: "card", amount_cents: q.json.total_cents }] });
  a = await staffAppr();
  q = await C.post("/api/chedam/sales/quote", { lines: [L(chips)], staff_approval: a });
  check("limit used up: said so", q.json.problems.some((p) => p.type === "staff" && /used this month/.test(p.message)), JSON.stringify(q.json.problems));
} catch (e) {
  err = e;
}
await t.finish(err);

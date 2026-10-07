// P1 step 3: till and checkout. Open till with float, sell (hub prices again, BR-21/22), cash rounding
// (BR-16), idempotent sale id (BR-10), stock and lots (BR-11, BR-14 FEFO, expired needs approval),
// pack-break prompt (FR-3.05), age check (FR-3.06), deposits (FR-3.07), discounts and overrides with
// manager PIN (BR-18), split/declined/USD payments (FR-3.08/3.09), tax exemption (FR-4.05), tax
// included (FR-4.04), training (FR-3.12), hold/recall (FR-3.10), soft holds (BR-13), void (FR-3.11),
// cash drops/pay-outs/no-sale, close with Z report and variance task (FR-3.01), costs hidden (DL-72).
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step13-sales.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8106 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

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
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches;
  const unitsOf = async (pid) => Object.fromEntries((await M.get("/api/chedam/catalogue/products/" + pid)).json.units.map((u) => [u.name, u.id]));
  const level = async (pid) => (await M.get("/api/chedam/stock/products/" + pid)).json;

  const colaM = (await find("2000000000022"))[0];
  const cola = colaM.product.id, colaU = await unitsOf(cola);
  const chips = (await find("2000000000060"))[0];
  const bananas = (await find("4011"))[0];
  const vape = (await find("2000000000107"))[0];
  const milk = (await find("2000000000015"))[0];
  const choc = (await find("2000000000077"))[0];
  const L = (m, extra = {}) => ({ key: "k" + Math.random().toString(36).slice(2, 8), product: m.product.id, selling_unit: m.unit.id, qty: 1, ...extra });
  const basket = () => [L(colaM, { qty: 2 }), L(chips), L(bananas, { weight: 1.235 })];

  console.log("Till");
  check("staff cannot sell (no sales.sell)", (await as(staff).post("/api/chedam/sales/quote", { lines: basket() })).status === 403);
  let r = await C.post("/api/chedam/sales", { id: sid(), lines: basket(), payments: [{ method: "cash", amount_cents: 2000 }] });
  check("selling before the till is open refused", r.status === 409 && /Open the till/.test(r.json.message), JSON.stringify(r.json));
  const op = await C.post("/api/chedam/tills/open", { float_detail: { 2000: 5, 500: 4, 100: 10, 25: 20 } });
  check("open with a counted float of $135.00", op.status === 200 && op.json.float_cents === 13500 && op.json.status === "open", JSON.stringify(op.json));
  check("opening twice refused", (await C.post("/api/chedam/tills/open", {})).status === 400);
  const till = op.json.id;
  check("unknown denomination refused", (await M.post("/api/chedam/tills/open", { float_detail: { 300: 1 } })).status === 400);

  console.log("Quote and sale (BR-21, BR-22, BR-16)");
  const q = await C.post("/api/chedam/sales/quote", { lines: basket() });
  check("quote: total 9.88 (GST 35, PST 21, deposits 20), cash 9.90", q.status === 200 && q.json.total_cents === 988 && q.json.cash_total_cents === 990
    && q.json.taxes.find((x) => x.code === "GST").tax_cents === 35 && q.json.taxes.find((x) => x.code === "PST").tax_cents === 21 && q.json.deposit_cents === 20, JSON.stringify(q.json).slice(0, 600));
  const colaBefore = (await level(cola)).level, chipsBefore = (await level(chips.product.id)).level.on_hand;
  const id1 = sid();
  const s1 = await C.post("/api/chedam/sales", { id: id1, lines: basket(), expected_total_cents: 988, payments: [{ method: "cash", amount_cents: 2000 }] });
  check("cash sale: rounded to 9.90, change 10.10", s1.status === 200 && s1.json.sale.number === "S-000001" && s1.json.sale.rounding_cents === 2 && s1.json.sale.change_cents === 1010, JSON.stringify(s1.json).slice(0, 500));
  check("receipt has the store's name and GST/PST lines", !!s1.json.sale.business.name && s1.json.sale.taxes.length === 2);
  check("cashier does not see costs on the receipt (DL-72)", s1.json.sale.lines.every((l) => l.cost_cents === undefined));
  let lv = (await level(cola)).level;
  check("stock: 2 cola cans out of loose stock", lv.loose_qty === colaBefore.loose_qty - 2 && lv.on_hand === colaBefore.on_hand - 2);
  check("chips 1 out; bananas 1.235 kg out", (await level(chips.product.id)).level.on_hand === chipsBefore - 1 && Math.abs((await level(bananas.product.id)).level.on_hand - (18.5 - 1.235)) < 1e-9);
  const again = await C.post("/api/chedam/sales", { id: id1, lines: basket(), payments: [{ method: "cash", amount_cents: 2000 }] });
  check("same sale id again: first result, stock unchanged (BR-10)", again.json.duplicate === true && (await level(cola)).level.on_hand === lv.on_hand);
  const mv = (await t.list("stock_movements", `ref_id='${id1}'`)).items;
  check("one 'sale' movement per line with its cost and lots", mv.length === 3 && mv.every((m) => m.type === "sale" && m.value_cents < 0 && m.lots_taken.length >= 1), JSON.stringify(mv.map((m) => [m.type, m.value_cents])));
  const ls = (await t.list("sale_lines", `sale='${id1}'`)).items;
  check("each line keeps its tax share (FR-4.06)", ls.reduce((a, l) => a + (l.taxes.find((x) => x.code === "GST") || { tax_cents: 0 }).tax_cents, 0) === 35);
  check("changed prices: expected total mismatch refused", (await C.post("/api/chedam/sales", { id: sid(), lines: basket(), expected_total_cents: 987, payments: [{ method: "cash", amount_cents: 2000 }] })).status === 409);
  check("not paid in full refused", (await C.post("/api/chedam/sales", { id: sid(), lines: basket(), payments: [{ method: "cash", amount_cents: 500 }] })).status === 409);
  check("a card cannot pay more than is due", (await C.post("/api/chedam/sales", { id: sid(), lines: basket(), payments: [{ method: "card", amount_cents: 5000 }] })).status === 400);
  check("bad sale id refused", (await C.post("/api/chedam/sales", { id: "x", lines: basket(), payments: [] })).status === 400);

  console.log("Age check, packs (FR-3.06, FR-3.05)");
  r = await C.post("/api/chedam/sales/quote", { lines: [L(vape)] });
  check("age-restricted item flagged until ID is checked", r.json.problems.some((p) => p.type === "age"), JSON.stringify(r.json.problems));
  r = await C.post("/api/chedam/sales", { id: sid(), lines: [L(vape, { age_checked: true })], payments: [{ method: "card", amount_cents: 0 + (await C.post("/api/chedam/sales/quote", { lines: [L(vape, { age_checked: true })] })).json.total_cents, last4: "4242", reference: "A1" }] });
  check("ID checked: card sale goes through, line marked", r.status === 200 && r.json.sale.lines[0].age_checked === true && r.json.sale.payments[0].last4 === "4242", JSON.stringify(r.json).slice(0, 300));
  const colaNow = (await level(cola)).level;   // 8 loose, 3 cases
  r = await C.post("/api/chedam/sales/quote", { lines: [L(colaM, { qty: 10 })] });
  check("10 cans with 8 loose: 'open a pack?'", r.json.problems.some((p) => p.type === "pack_break"), JSON.stringify(r.json.problems));
  const qt = (await C.post("/api/chedam/sales/quote", { lines: [L(colaM, { qty: 10, break_pack: true })] })).json.total_cents;
  r = await C.post("/api/chedam/sales", { id: sid(), lines: [L(colaM, { qty: 10, break_pack: true })], payments: [{ method: "card", amount_cents: qt }] });
  lv = (await level(cola)).level;
  check("with 'open a pack': a case and a 12-pack opened, 10 sold", r.status === 200 && lv.on_hand === colaNow.on_hand - 10 && lv.sealed[colaU["Case of 2 x 12"]] === 2 && lv.sealed[colaU["12-pack"]] === 1 && lv.loose_qty === 10, JSON.stringify(lv));
  check("pack breaks recorded (BR-15)", (await t.list("stock_movements", `product='${cola}' && type='pack_break'`)).items.length === 2);

  console.log("Discounts, overrides, approvals (BR-18)");
  const choc1 = (x) => [L(choc, x)];
  check("5% line discount by the cashier: fine", (await C.post("/api/chedam/sales/quote", { lines: choc1({ discount: { type: "pct", value: 5 } }) })).json.needs_approval.length === 0);
  r = await C.post("/api/chedam/sales/quote", { lines: choc1({ discount: { type: "pct", value: 20 } }) });
  check("20% needs a manager", r.json.needs_approval.length === 1, JSON.stringify(r.json.needs_approval));
  const tot20 = r.json.total_cents;
  check("sale without approval refused (403)", (await C.post("/api/chedam/sales", { id: sid(), lines: choc1({ discount: { type: "pct", value: 20 } }), payments: [{ method: "card", amount_cents: tot20 }] })).status === 403);
  check("wrong manager PIN refused", (await C.post("/api/chedam/sales/approvals", { user: people["Mira Manager"], pin: "0000" })).status === 400);
  check("a cashier cannot approve", (await C.post("/api/chedam/sales/approvals", { user: people["Cal Cashier"], pin: PIN["Cal Cashier"] })).status === 403);
  const ap = await C.post("/api/chedam/sales/approvals", { user: people["Mira Manager"], pin: PIN["Mira Manager"] });
  check("manager PIN gives an approval", ap.status === 200 && !!ap.json.approval && ap.json.by === "Mira Manager");
  r = await C.post("/api/chedam/sales", { id: sid(), lines: choc1({ discount: { type: "pct", value: 20 } }), approval: ap.json.approval, payments: [{ method: "card", amount_cents: tot20 }] });
  check("approved sale goes through and records who approved", r.status === 200 && r.json.sale.approvals[0].name === "Mira Manager", JSON.stringify(r.json).slice(0, 300));
  check("an approval is used once", (await C.post("/api/chedam/sales", { id: sid(), lines: choc1({ discount: { type: "pct", value: 20 } }), approval: ap.json.approval, payments: [{ method: "card", amount_cents: tot20 }] })).status === 403);
  r = await C.post("/api/chedam/sales/quote", { lines: choc1({ price_cents: 250 }) });
  check("price override needs a reason", r.json.problems.some((p) => p.type === "override_reason"));
  r = await C.post("/api/chedam/sales/quote", { lines: choc1({ price_cents: 260, override_reason: "Shelf label price" }) });
  check("override within 10%: no approval", r.json.problems.length === 0 && r.json.needs_approval.length === 0 && r.json.lines[0].price_cents === 260);
  check("override 50% lower needs a manager", (await C.post("/api/chedam/sales/quote", { lines: choc1({ price_cents: 139, override_reason: "Damaged box" }) })).json.needs_approval.length === 1);
  check("manager's own sale needs no approval", (await M.post("/api/chedam/sales/quote", { lines: choc1({ discount: { type: "pct", value: 50 } }) })).json.needs_approval.length === 0);

  console.log("Expired stock (BR-14)");
  const milkLv = (await level(milk.product.id));
  const fresh = milkLv.lots.filter((l) => !l.expired).reduce((a, l) => a + l.qty, 0);
  r = await C.post("/api/chedam/sales/quote", { lines: [L(milk, { qty: fresh + 1 })] });
  check("selling into the expired lot needs a manager", r.json.needs_approval.some((x) => /expired/.test(x)), JSON.stringify(r.json));
  r = await C.post("/api/chedam/sales/quote", { lines: [L(milk, { qty: 1 })] });
  check("1 milk from fresh lots: no approval", r.json.needs_approval.length === 0);
  const milkTot = r.json.total_cents;
  r = await C.post("/api/chedam/sales", { id: sid(), lines: [L(milk, { qty: 1 })], payments: [{ method: "card", amount_cents: milkTot }] });
  const taken = (await t.list("sale_lines", `sale='${r.json.sale.id}'`, t.su)).items[0].lots;
  check("FEFO took a fresh lot, not the expired one", (await t.list("stock_lots", `id='${taken[0].lot}'`)).items[0].lot_code !== "OLD", JSON.stringify(taken));

  console.log("Payments (FR-3.08, 3.09)");
  const qp = (await C.post("/api/chedam/sales/quote", { lines: basket() })).json.total_cents;   // 988
  r = await C.post("/api/chedam/sales", { id: sid(), lines: basket(), payments: [
    { method: "card", amount_cents: 500, status: "declined" }, { method: "card", amount_cents: 500, last4: "1111" }, { method: "cash", amount_cents: 500 }] });
  check("split: declined card kept, card 5.00 + cash; cash part 4.88 -> 4.90", r.status === 200 && r.json.sale.payments.length === 3 && r.json.sale.payments[0].status === "declined"
    && r.json.sale.rounding_cents === 2 && r.json.sale.change_cents === 10, JSON.stringify(r.json.sale && r.json.sale.payments));
  r = await C.post("/api/chedam/sales", { id: sid(), lines: basket(), payments: [{ method: "usd_cash", amount_cents: 1000 }] });
  check("US $10 at 1.35 = CAD 13.50 for 9.90: change CAD 3.60", r.status === 200 && r.json.sale.change_cents === 360 && r.json.sale.payments[0].currency === "USD", JSON.stringify(r.json.sale && r.json.sale.payments));
  check("a method the store does not take is refused", (await C.post("/api/chedam/sales", { id: sid(), lines: basket(), payments: [{ method: "platform", amount_cents: qp }] })).status === 400);

  console.log("Tax exemption (FR-4.05) and tax included (FR-4.04)");
  check("exemption needs a reference", (await C.post("/api/chedam/sales/quote", { lines: choc1(), exempt: { reason: "pst_resale" } })).status === 400);
  r = await C.post("/api/chedam/sales/quote", { lines: choc1(), exempt: { reason: "pst_resale", reference: "PST-1234-5678" } });
  check("PST resale: only GST charged (2.79 -> 14 c), 20 c exempt", r.json.taxes.length === 1 && r.json.taxes[0].code === "GST" && r.json.tax_cents === 14 && r.json.exempt_cents === 20, JSON.stringify(r.json));
  const ex = await C.post("/api/chedam/sales", { id: sid(), lines: choc1(), exempt: { reason: "pst_resale", reference: "PST-1234-5678" }, payments: [{ method: "card", amount_cents: r.json.total_cents }] });
  check("exempt sale saved with its reason", ex.status === 200 && ex.json.sale.exempt.reference === "PST-1234-5678");
  const rep = await M.get("/api/chedam/sales/reports/exempt");
  check("exempt report lists it (manager)", rep.status === 200 && rep.json.rows.length === 1 && rep.json.total_exempt_cents === 20, JSON.stringify(rep.json));
  check("cashier cannot see the exempt report", (await C.get("/api/chedam/sales/reports/exempt")).status === 403);
  const biz = (await t.list("business")).items[0];
  await t.su_("PATCH", `/api/collections/business/records/${biz.id}`, { tax_display_mode: "tax_included" });
  r = await C.post("/api/chedam/sales/quote", { lines: [L(colaM, { qty: 2 })] });
  check("tax included: 2 cans = 2.98 + 0.20 deposit, tax inside (13 + 19)", r.json.total_cents === 318 && r.json.tax_cents === 32, JSON.stringify(r.json.taxes));
  await t.su_("PATCH", `/api/collections/business/records/${biz.id}`, { tax_display_mode: "tax_added" });

  console.log("Training, holds, soft holds");
  const chipsLv = (await level(chips.product.id)).level.on_hand;
  r = await C.post("/api/chedam/sales", { id: sid(), training: true, lines: [L(chips)], payments: [{ method: "cash", amount_cents: 1000 }] });
  check("training sale: T- number, stock untouched (FR-3.12)", r.status === 200 && r.json.sale.number === "T-000001" && r.json.sale.training && (await level(chips.product.id)).level.on_hand === chipsLv);
  const hd = await C.post("/api/chedam/holds", { label: "Lady in blue", cart: { lines: basket() }, total_cents: 988 });
  check("hold a cart", hd.status === 200);
  const holds = await M.get("/api/chedam/holds");
  check("another till sees it", holds.json.some((h) => h.id === hd.json.id && h.label === "Lady in blue" && h.held_by === "Cal Cashier"));
  const rc = await M.post(`/api/chedam/holds/${hd.json.id}/recall`, {});
  check("recalled on another till with its cart", rc.status === 200 && rc.json.cart.lines.length === 3);
  check("cannot recall twice", (await C.post(`/api/chedam/holds/${hd.json.id}/recall`, {})).status === 400);
  const vapeLeft = (await level(vape.product.id)).level.on_hand;   // 4 left: not low yet (limit 3)
  await C.post("/api/chedam/sales", { id: sid(), lines: [L(vape, { age_checked: true })], payments: [{ method: "card", amount_cents: (await C.post("/api/chedam/sales/quote", { lines: [L(vape, { age_checked: true })] })).json.total_cents }] });
  const sh = await M.post("/api/chedam/sales/soft-holds", { cart_id: "cartM12345", items: [{ product: vape.product.id, qty_base: 2 }] });
  check("low stock (3 left): 2 held for the manager's cart", sh.status === 200 && sh.json.held.length === 1, JSON.stringify(sh.json) + " left " + (vapeLeft - 1));
  r = await C.post("/api/chedam/sales/quote", { cart_id: "cartC12345", lines: [L(vape, { qty: 2, age_checked: true })] });
  check("another till cannot take the held units (BR-13)", r.json.problems.some((p) => p.type === "stock" && /another till/.test(p.message)), JSON.stringify(r.json.problems));
  await M.post("/api/chedam/sales/soft-holds", { cart_id: "cartM12345", items: [] });
  r = await C.post("/api/chedam/sales/quote", { cart_id: "cartC12345", lines: [L(vape, { qty: 2, age_checked: true })] });
  check("released: now it can", r.json.problems.length === 0, JSON.stringify(r.json.problems));
  check("more than on hand refused (BR-11)", (await C.post("/api/chedam/sales/quote", { lines: [L(vape, { qty: 50, age_checked: true })] })).json.problems.some((p) => p.type === "stock"));

  console.log("Void (FR-3.11)");
  const before = (await level(chips.product.id)).level.on_hand;
  const vs = await C.post("/api/chedam/sales", { id: sid(), lines: [L(chips, { qty: 2 })], payments: [{ method: "cash", amount_cents: 1000 }] });
  check("cashier cannot void without a manager", (await C.post(`/api/chedam/sales/${vs.json.sale.id}/void`, { reason: "Customer changed mind" })).status === 403);
  const vap = await C.post("/api/chedam/sales/approvals", { user: people["Mira Manager"], pin: PIN["Mira Manager"], permission: "sales.void" });
  const vd = await C.post(`/api/chedam/sales/${vs.json.sale.id}/void`, { reason: "Customer changed mind", approval: vap.json.approval });
  check("voided with the manager's PIN: stock back, payments voided", vd.status === 200 && vd.json.status === "voided" && (await level(chips.product.id)).level.on_hand === before && vd.json.payments.every((p) => p.status === "voided"), JSON.stringify(vd.json).slice(0, 300));
  check("voiding twice refused", (await M.post(`/api/chedam/sales/${vs.json.sale.id}/void`, { reason: "again" })).status === 400);

  console.log("Cash, close and Z report");
  check("drop $50 by the cashier", (await C.post(`/api/chedam/tills/${till}/cash`, { type: "drop", amount_cents: 5000 })).status === 200);
  check("pay-out needs a manager", (await C.post(`/api/chedam/tills/${till}/cash`, { type: "payout", amount_cents: 1000, reason: "Window cleaner" })).status === 403);
  check("manager pays out $10 from this till", (await M.post(`/api/chedam/tills/${till}/cash`, { type: "payout", amount_cents: 1000, reason: "Window cleaner" })).status === 200);
  check("no-sale needs a reason", (await C.post(`/api/chedam/tills/${till}/cash`, { type: "no_sale" })).status === 400);
  check("no-sale with a reason is logged", (await C.post(`/api/chedam/tills/${till}/cash`, { type: "no_sale", reason: "Change for a customer" })).status === 200);
  const cur = (await C.get("/api/chedam/tills/current")).json;
  const z0 = cur.till.summary;
  check("running summary: float + cash in - US change - drop - pay-out", z0.expected_cash_cents === 13500 + z0.cash_in_cents - z0.usd_change_cents - 5000 - 1000, JSON.stringify(z0));
  check("voided sale and training sale kept out of the totals", z0.voided_sales === 1 && z0.training_sales === 1 && z0.no_sales === 1, JSON.stringify(z0));
  const cl = await C.post(`/api/chedam/tills/${till}/close`, { counted_cents: z0.expected_cash_cents - 1000, counted_usd_cents: 1000 });
  check("close $10 short: Z report with variance -10.00", cl.status === 200 && cl.json.status === "closed" && cl.json.z_report.variance_cents === -1000 && cl.json.z_report.usd_variance_cents === 0, JSON.stringify(cl.json).slice(0, 400));
  check("variance task raised", (await t.list("tasks", "kind='till_variance' && status='open'")).items.length === 1);
  check("Z report: sales by method and tax by type", cl.json.z_report.payments.some((p) => p.method === "card") && cl.json.z_report.taxes.some((x) => x.code === "GST"));
  check("closed till: no more sales", (await C.post("/api/chedam/sales", { id: sid(), lines: basket(), payments: [{ method: "cash", amount_cents: 2000 }] })).status === 409);
  check("closed till: void refused (use a return)", (await M.post(`/api/chedam/sales/${id1}/void`, { reason: "late" })).status === 400);

  console.log("Read access and costs");
  const cl2 = (await C.get("/api/collections/sale_lines?perPage=5")).status;
  const lines2 = (await C.get("/api/collections/sale_lines/records?perPage=200")).json.items;
  check("cashier reads sale lines without cost or lots", lines2.length > 0 && lines2.every((l) => l.cost_cents === undefined && l.lots === undefined), String(cl2));
  check("manager sees cost of goods on a sale", (await M.get("/api/chedam/sales/" + id1)).json.lines.every((l) => typeof l.cost_cents === "number"));
  check("sales cannot be written through the generic API", (await M.post("/api/collections/sales/records", { status: "completed" })).status === 403);
  check("sales are in the event log", (await t.list("events", "table_name='sales'")).items.length >= 5);
} catch (e) {
  err = e;
}
await t.finish(err);

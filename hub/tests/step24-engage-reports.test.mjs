// P2 step 4: promotion and loyalty reports (FR-5.12, 7.07). Promotion results (times, sales, units, savings,
// margin with costs.view) against the period before, with the lift on the deal's products; coupons; loyalty:
// members, members' share of sales, points earned and used, the liability in $ and the top customers.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step24-engage-reports.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8117 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const iso = (d) => d.toISOString();

let err = null;
try {
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
  const chips = await find("2000000000060"), choc = await find("2000000000077");
  const L = (m, extra = {}) => ({ key: "k" + Math.random().toString(36).slice(2, 8), product: m.product.id, selling_unit: m.unit.id, qty: 1, ...extra });
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const sell = async (lines, extra = {}) => {
    const q = (await C.post("/api/chedam/sales/quote", { lines, ...extra })).json;
    return C.post("/api/chedam/sales", { id: sid(), lines, ...extra, expected_total_cents: q.total_cents, payments: [{ method: "card", amount_cents: q.total_cents }] });
  };
  const today = ymd(new Date()), yest = ymd(new Date(Date.now() - 86400000));
  const P = (who = M, from = today, to = today) => who.get(`/api/chedam/reports/promotions?from=${from}&to=${to}`);
  const LY = (who = M, from = today, to = today) => who.get(`/api/chedam/reports/loyalty?from=${from}&to=${to}`);

  console.log("Promotion results (FR-5.12)");
  check("a cashier cannot see the reports", (await P(C)).status === 403 && (await LY(C)).status === 403);
  const r0 = await P();
  check("the period before: as long, just before", r0.status === 200 && r0.json.before.to === yest && r0.json.before.from === yest, JSON.stringify(r0.json.before));
  const week = (await P(M, ymd(new Date(Date.now() - 6 * 86400000)), today)).json.before;
  check("a 7-day period is compared with the 7 days before it", week.to === ymd(new Date(Date.now() - 7 * 86400000)) && week.from === ymd(new Date(Date.now() - 13 * 86400000)), JSON.stringify(week));
  const promo = await M.post("/api/chedam/promotions", { name: "Chip deal", type: "pct_off", pct: 20, status: "active", products: [chips.product.id], starts_at: iso(new Date(Date.now() - 3600000)) });
  check("a deal is set up", promo.status === 200, JSON.stringify(promo.json).slice(0, 200));
  const coupon = await M.post("/api/chedam/promotions", { name: "Choc coupon", type: "amount_off", amount_cents: 50, status: "active", products: [choc.product.id], coupon_code: "CHOC50", starts_at: iso(new Date(Date.now() - 3600000)) });
  const a = await sell([L(chips, { qty: 2 })]);
  const b = await sell([L(chips), L(choc)], { coupons: ["CHOC50"] });
  const c0 = await sell([L(choc)]);
  check("three sales", a.status === 200 && b.status === 200 && c0.status === 200, JSON.stringify([a.json.message, b.json.message, c0.json.message]));
  const saving = (s, id) => (s.json.sale.promotions || []).filter((x) => x.id === id).reduce((x, y) => x + y.saving_cents, 0);
  const r1 = (await P()).json;
  const row = r1.promotions.find((x) => x.id === promo.json.id);
  check("the deal: used 3 times on 2 sales, 3 units", row && row.now.times === 3 && row.now.sales === 2 && row.now.units === 3, JSON.stringify(row && row.now));
  check("savings given = what the sales say", row.now.savings_cents === saving(a, promo.json.id) + saving(b, promo.json.id) && row.now.savings_cents > 0, JSON.stringify(row.now));
  check("sales value before tax and the margin (manager sees costs)", r1.show_cost === true && row.now.sales_cents > 0 && row.now.margin_cents === row.now.sales_cents - row.now.cost_cents && typeof row.now.margin_pct === "number", JSON.stringify(row.now));
  check("not used the day before", row.before === null || row.before.times === 0);
  check("lift: all units of the deal's products today (3 chips)", row.lift.now.units === 3 && row.lift.before.units === 0, JSON.stringify(row.lift));
  const crow = r1.promotions.find((x) => x.id === coupon.json.id);
  check("the coupon deal: once (the coupon), its code counted", crow && crow.now.times === 1 && crow.coupon === "CHOC50" && r1.coupons.some((x) => x.code === "CHOC50" && x.sales === 1), JSON.stringify([crow && crow.now, r1.coupons]));
  check("totals: sales with a deal and all savings", r1.totals.now.with_deal >= 2 && r1.totals.now.savings_cents >= row.now.savings_cents + crow.now.savings_cents && r1.totals.now.sales >= 3, JSON.stringify(r1.totals.now));
  const prev = (await P(M, ymd(new Date(Date.now() + 86400000)), ymd(new Date(Date.now() + 86400000)))).json;
  const prow = prev.promotions.find((x) => x.id === promo.json.id);
  check("tomorrow's report: today is the period before (shown though not used tomorrow)", prow && prow.now.times === 0 && prow.before.times === 3, JSON.stringify(prow));
  check("bad dates refused", (await P(M, today, yest)).status === 400);

  console.log("Loyalty (FR-7.07)");
  await O.post("/api/chedam/loyalty/program", { enabled: true, points_per_dollar: 1, points_per_dollar_off: 100, min_redeem: 100, earn_on_promotions: true });
  const l0 = (await LY()).json;
  const ana = await C.post("/api/chedam/customers", { first_name: "Ana", phone: "604-555-0144", agreed: true });
  const bo = await C.post("/api/chedam/customers", { first_name: "Bo", phone: "604-555-0145", agreed: true });
  const s1 = await sell([L(chips), L(choc), L(choc)], { customer: ana.json.id });
  await M.post(`/api/chedam/customers/${ana.json.id}/adjust`, { points: 300, note: "Welcome" });
  const s2 = await sell([L(choc), L(chips)], { customer: ana.json.id, redeem_points: 150 });
  const s3 = await sell([L(chips)], { customer: bo.json.id });
  check("member sales", s1.status === 200 && s2.status === 200 && s3.status === 200, JSON.stringify([s1.json.message, s2.json.message, s3.json.message]));
  const l1 = (await LY()).json;
  check("members: 2 more, both new and bought today", l1.members.total === l0.members.total + 2 && l1.members.new === l0.members.new + 2 && l1.members.bought === l0.members.bought + 2, JSON.stringify(l1.members));
  const earned = [s1, s2, s3].reduce((x, s) => x + s.json.sale.loyalty_earned, 0);
  check("points earned and used today", l1.points.earned - l0.points.earned === earned && l1.points.used - l0.points.used === 150 && l1.points.adjusted - l0.points.adjusted === 300
    && l1.points.redeem_cents - l0.points.redeem_cents === 150, JSON.stringify(l1.points));
  const memberCents = [s1, s2, s3].reduce((x, s) => x + s.json.sale.total_cents + (s.json.sale.rounding_cents || 0), 0);
  check("members' share of sales", l1.sales.members - l0.sales.members === 3 && l1.sales.member_cents - l0.sales.member_cents === memberCents && l1.sales.member_pct > 0 && l1.sales.member_pct <= 100, JSON.stringify(l1.sales));
  const held = (await t.list("customers", "status='active'")).items.reduce((x, c) => x + c.points, 0);
  check("liability: the points held, at 100 points = $1", l1.liability.points === held && l1.liability.cents === Math.floor(held * 100 / 100), JSON.stringify(l1.liability));
  check("top customers: Ana first (spent most), with visits, and no full phone", l1.top[0].first_name === "Ana" && l1.top[0].visits === 2 && l1.top[0].phone === "…0144" && !JSON.stringify(l1.top).includes("6045550144"), JSON.stringify(l1.top));
  check("the accountant's view has no customer list", (await (async () => { const acc = Object.keys(people).find((n) => /Account/i.test(n)); if (!acc) return true; const tok = await login(acc); const r = await as(tok).get(`/api/chedam/reports/loyalty?from=${today}&to=${today}`); return r.status === 200 && r.json.top === undefined; })()));
  await O.post("/api/chedam/loyalty/program", { enabled: true, points_per_dollar: 1, points_per_dollar_off: 50, min_redeem: 100, earn_on_promotions: true });
  const l2 = (await LY()).json;
  check("the owner's new value changes the liability (50 points = $1)", l2.liability.cents === Math.floor(l2.liability.points * 100 / 50), JSON.stringify(l2.liability));
  await M.post(`/api/chedam/customers/${bo.json.id}/erase`, { confirm: true });
  const l3 = (await LY()).json;
  check("a deleted customer: no longer a member, shown without a name", l3.members.total === l1.members.total - 1 && !l3.top.some((x) => x.first_name === "Bo"), JSON.stringify(l3.top));
} catch (e) { err = e; }
await t.finish(err);

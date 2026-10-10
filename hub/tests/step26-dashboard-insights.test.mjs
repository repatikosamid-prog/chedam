// P2 step 6: dashboard and sales insights (FR-2.01, FR-10.10). The dashboard by permission (attention list
// for everyone, sales for sales.view, P&L and stock value for costs.view); insights: weekday × hour, best and
// worst sellers, sell-through, year over year, margin by category.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step26-dashboard-insights.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8119 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

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
  const C = as(cashier), M = as(manager), S = as(staff);
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const chips = await find("2000000000060"), choc = await find("2000000000077");
  const L = (m, qty = 1) => ({ key: "k" + Math.random().toString(36).slice(2, 8), product: m.product.id, selling_unit: m.unit.id, qty });
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const sell = async (lines) => {
    const q = (await C.post("/api/chedam/sales/quote", { lines })).json;
    return C.post("/api/chedam/sales", { id: sid(), lines, expected_total_cents: q.total_cents, payments: [{ method: "card", amount_cents: q.total_cents }] });
  };
  const d0 = (await M.get("/api/chedam/dashboard")).json;

  console.log("Dashboard (FR-2.01)");
  const s1 = await sell([L(chips, 3)]), s2 = await sell([L(chips), L(choc, 2)]);
  check("two sales", s1.status === 200 && s2.status === 200);
  const d1 = (await M.get("/api/chedam/dashboard")).json;
  check("a manager sees today's sales: 2 more transactions", d1.kpis && d1.kpis.today.transactions === d0.kpis.today.transactions + 2 && d1.kpis.today.sales_cents > d0.kpis.today.sales_cents, JSON.stringify(d1.kpis && d1.kpis.today));
  check("average basket = sales / transactions", d1.kpis.today.avg_basket_cents === Math.round(d1.kpis.today.sales_cents / d1.kpis.today.transactions));
  check("month to date and the same days last month", d1.kpis.month.transactions >= 2 && d1.kpis.last_month_same_days && d1.kpis.month_from.endsWith("-01"));
  check("30 days per day, today last, with last year's figure", d1.daily.length === 30 && d1.daily[29].day === ymd(new Date()) && d1.daily[29].transactions >= 2 && "last_year_cents" in d1.daily[0]);
  check("margin by category (manager sees costs)", d1.categories.length > 0 && typeof d1.categories[0].margin_pct === "number", JSON.stringify(d1.categories[0]));
  check("P&L month to date: gross = sales − cost; result after wastage and payouts", d1.pnl && d1.pnl.gross_cents === d1.pnl.sales_cents - d1.pnl.cost_cents
    && d1.pnl.result_cents === d1.pnl.gross_cents - d1.pnl.damage_cents - d1.pnl.loss_cents - d1.pnl.count_cents - d1.pnl.payouts_cents, JSON.stringify(d1.pnl));
  check("inventory health with stock value", d1.inventory && typeof d1.inventory.stock_value_cents === "number" && typeof d1.inventory.out_of_stock === "number");
  check("an attention list", Array.isArray(d1.attention));
  const ds = (await S.get("/api/chedam/dashboard"));
  check("staff: the attention list and stock (with its value: staff see costs, DL-72), but no sales or P&L", ds.status === 200 && !ds.json.kpis && !ds.json.pnl && ds.json.inventory && typeof ds.json.inventory.stock_value_cents === "number", JSON.stringify(Object.keys(ds.json)));
  const dc = (await C.get("/api/chedam/dashboard")).json;
  check("a cashier: no sales figures and no stock value", !dc.kpis && dc.inventory && dc.inventory.stock_value_cents === undefined);
  check("signed out: refused", (await t.api("GET", "/api/chedam/dashboard")).status === 401);

  console.log("Insights (FR-10.10)");
  const today = ymd(new Date());
  check("a cashier cannot see insights", (await C.get(`/api/chedam/reports/insights?from=${today}&to=${today}`)).status === 403);
  const ins = (await M.get(`/api/chedam/reports/insights?from=${today}&to=${today}`)).json;
  const hour = new Date().getHours(), wd = new Date().getDay();
  check("weekday × hour: this hour has the sales", ins.heatmap.length === 7 && ins.heatmap[0].length === 24 && ins.heatmap[wd][hour].transactions >= 2, JSON.stringify(ins.heatmap[wd][hour]));
  const ch = ins.best.find((x) => x.id === chips.product.id);
  check("best sellers: chips 4 units on 2 sales", ch && ch.units === 4 && ch.transactions === 2, JSON.stringify(ch));
  check("sell-through = sold / (sold + on hand)", ch.on_hand !== null && Math.abs(ch.sell_through_pct - Math.round(10000 * 4 / (4 + ch.on_hand)) / 100) < 0.6, JSON.stringify(ch));
  check("worst sellers: stocked products that sold least (none sold first)", ins.worst.length > 0 && ins.worst[0].units === 0 && ins.worst.every((x) => x.id !== chips.product.id || x.units >= 0));
  check("year over year: the same dates last year", ins.last_year.from === ymd(new Date(new Date().getFullYear() - 1, new Date().getMonth(), new Date().getDate())) && ins.last_year_totals.transactions === 0);
  check("categories with margin and last year's sales", ins.categories.length > 0 && "last_year_cents" in ins.categories[0] && typeof ins.categories[0].margin_pct === "number");
} catch (e) { err = e; }
await t.finish(err);

// P1 step 2: stock. Receiving (sealed and loose, lots, expiry, last cost), idempotent operations (BR-10),
// one transaction per request, whole numbers / 3 decimals (BR-03), pack break and make (FR-6.05,
// BR-15), adjust/damage/loss with reasons (BR-05) and manager approval above the limit (FR-6.06,
// BR-18), FEFO (BR-14), counts with variance approval (FR-6.08), shrink report (FR-6.07), costs
// hidden from cashiers (DL-72).
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step12-stock.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB, rid } from "./lib/hub.mjs";

const t = new TestHub({ port: 8105, skipDev: ["1791300101_dev_sample_stock.js"] });   // start from empty shelves
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const op = () => "op" + rid(8);
const ymd = (days = 0) => { const d = new Date(Date.now() + days * 86400000); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const d = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: d })).json.token;
  };
  const manager = await login("Mira Manager"), cashier = await login("Cal Cashier"), staff = await login("Sam Staff");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const lookup = async (code) => (await as(manager).get("/api/chedam/catalogue/lookup?code=" + code)).json.matches;
  const view = async (pid, tok = manager) => (await as(tok).get("/api/chedam/stock/products/" + pid)).json;
  const prodByName = async (name) => (await t.list("products", `name='${name}'`)).items[0];

  const colaM = await lookup("2000000000022");
  const cola = colaM[0].product.id;
  const cv = (await as(manager).get("/api/chedam/catalogue/products/" + cola)).json;
  const U = Object.fromEntries(cv.units.map((u) => [u.name, u.id]));   // Single, 12-pack, Case of 2 x 12

  console.log("Receiving");
  check("cashier cannot receive (403)", (await as(cashier).post("/api/chedam/stock/receive", { op_id: op(), lines: [{ product: cola, qty: 1 }] })).status === 403);
  const rop = op();
  const rec = await as(staff).post("/api/chedam/stock/receive", { op_id: rop, lines: [
    { product: cola, selling_unit: U["Case of 2 x 12"], qty: 2, cost_cents: 2000 },
    { product: cola, selling_unit: U.Single, qty: 6, cost_cents: 50 },
  ] });
  check("staff receives 2 cases and 6 singles", rec.status === 200 && rec.json.movements.length === 2, JSON.stringify(rec.json));
  let v = await view(cola);
  check("level: 2 sealed cases, 6 loose, 54 on hand", v.level.on_hand === 54 && v.level.loose_qty === 6 && v.level.sealed[U["Case of 2 x 12"]] === 2, JSON.stringify(v.level));
  check("two lots: 48 at 83.33 c, 6 at 50 c", v.lots.length === 2 && v.lots.some((l) => l.qty === 48 && Math.abs(l.cost_cents - 83.3333) < 0.01) && v.lots.some((l) => l.qty === 6 && l.cost_cents === 50), JSON.stringify(v.lots));
  check("receive value at cost: $40.00 and $3.00", rec.json.movements[0].value_cents === 4000 && rec.json.movements[1].value_cents === 300);
  check("product cost = last cost (50 c), in price history", (await t.list("products", `id='${cola}'`)).items[0].cost_cents === 50
    && (await t.list("price_history", `product='${cola}' && field='cost' && new_cents=50`)).items.length === 1);
  const again = await as(staff).post("/api/chedam/stock/receive", { op_id: rop, lines: [{ product: cola, selling_unit: U.Single, qty: 6 }] });
  check("same op_id again: duplicate, nothing added (BR-10)", again.status === 200 && again.json.duplicate === true && (await view(cola)).level.on_hand === 54);

  const milk = (await lookup("2000000000015"))[0].product.id;
  const peas = (await lookup("2000000000084"))[0].product.id;
  const bad2 = await as(staff).post("/api/chedam/stock/receive", { op_id: op(), lines: [{ product: milk, qty: 3 }, { product: peas, qty: 5 }] });
  check("frozen peas without expiry refused", bad2.status === 400 && /expiry/.test(bad2.json.message), JSON.stringify(bad2.json));
  check("…and the milk line of that request was not saved (one transaction)", (await view(milk)).level.on_hand === 0);
  const okMilk = await as(staff).post("/api/chedam/stock/receive", { op_id: op(), lines: [{ product: milk, qty: 3 }, { product: peas, qty: 5, expiry_date: ymd(200) }] });
  v = await view(milk);
  check("milk without a date gets today + 14 days shelf life", okMilk.status === 200 && v.lots[0].expiry_date === ymd(14), JSON.stringify(v.lots));
  const bananas = (await lookup("4011"))[0].product.id;
  check("bananas 12.345 kg accepted", (await as(staff).post("/api/chedam/stock/receive", { op_id: op(), lines: [{ product: bananas, qty: 12.345 }] })).status === 200);
  check("1.2345 kg refused (3 decimals)", (await as(staff).post("/api/chedam/stock/receive", { op_id: op(), lines: [{ product: bananas, qty: 1.2345 }] })).status === 400);
  check("1.5 cans refused (whole numbers, BR-03)", (await as(staff).post("/api/chedam/stock/receive", { op_id: op(), lines: [{ product: cola, qty: 1.5 }] })).status === 400);
  check("bad op_id refused", (await as(staff).post("/api/chedam/stock/receive", { op_id: "x;", lines: [{ product: cola, qty: 1 }] })).status === 400);

  console.log("Packs (FR-6.05, BR-15)");
  const br = await as(staff).post("/api/chedam/stock/pack-break", { op_id: op(), product: cola, selling_unit: U["Case of 2 x 12"], count: 1 });
  v = await view(cola);
  check("break a case: 1 case + 2 12-packs, on hand unchanged", br.status === 200 && v.level.sealed[U["Case of 2 x 12"]] === 1 && v.level.sealed[U["12-pack"]] === 2 && v.level.on_hand === 54, JSON.stringify(v.level));
  const br2 = await as(staff).post("/api/chedam/stock/pack-break", { op_id: op(), product: cola, selling_unit: U["12-pack"], count: 1, damaged: 2 });
  v = await view(cola);
  check("break a 12-pack, 2 cans damaged: loose 6+12-2 = 16, on hand 52", br2.status === 200 && v.level.loose_qty === 16 && v.level.on_hand === 52, JSON.stringify(br2.json) + JSON.stringify(v.level));
  check("damage recorded with its reason, by the staff member", v.movements.some((m) => m.type === "damage" && m.reason === "Damaged when opening a pack" && m.qty_base === -2 && m.by === "users:" + people["Sam Staff"]));
  check("breaking more than there is refused", (await as(staff).post("/api/chedam/stock/pack-break", { op_id: op(), product: cola, selling_unit: U["12-pack"], count: 5 })).status === 400);
  const mk = await as(staff).post("/api/chedam/stock/pack-make", { op_id: op(), product: cola, selling_unit: U["12-pack"], count: 1 });
  v = await view(cola);
  check("make a 12-pack from 12 loose: loose 4, 12-packs 2", mk.status === 200 && v.level.loose_qty === 4 && v.level.sealed[U["12-pack"]] === 2 && v.level.on_hand === 52, JSON.stringify(v.level));

  console.log("Adjust, damage, loss (BR-05, FR-6.06)");
  check("no reason refused", (await as(staff).post("/api/chedam/stock/adjust", { op_id: op(), product: cola, type: "loss", qty: 1 })).status === 400);
  check("unknown reason refused", (await as(staff).post("/api/chedam/stock/adjust", { op_id: op(), product: cola, type: "loss", qty: 1, reason: "Gremlins" })).status === 400);
  const short = await as(staff).post("/api/chedam/stock/adjust", { op_id: op(), product: cola, type: "loss", qty: 10, reason: "Theft" });
  check("more loose than there is: refused with a hint", short.status === 400 && /break a pack/.test(short.json.message), JSON.stringify(short.json));
  const found = await as(staff).post("/api/chedam/stock/adjust", { op_id: op(), product: cola, type: "adjust", direction: "in", qty: 2, reason: "Found stock" });
  check("found stock adds 2", found.status === 200 && (await view(cola)).level.loose_qty === 6);

  const towels = (await lookup("2000000000091"))[0].product.id;
  await as(manager).post("/api/chedam/stock/receive", { op_id: op(), lines: [{ product: towels, qty: 10, cost_cents: 600 }] });
  const big = await as(staff).post("/api/chedam/stock/adjust", { op_id: op(), product: towels, type: "damage", qty: 5, reason: "Damaged in store" });
  check("staff write-off of $30 waits for approval", big.status === 200 && big.json.movements[0].status === "pending", JSON.stringify(big.json));
  check("…stock not changed yet", (await view(towels)).level.on_hand === 10);
  let tasks = (await t.list("tasks", "rule_key='stock:approvals' && status='open'")).items;
  check("approval task open", tasks.length === 1 && /1 stock change/.test(tasks[0].title), JSON.stringify(tasks));
  const small = await as(staff).post("/api/chedam/stock/adjust", { op_id: op(), product: towels, type: "damage", qty: 1, reason: "Damaged in store" });
  check("staff write-off of $6 posts at once", small.json.movements[0].status === "posted" && (await view(towels)).level.on_hand === 9);
  const pend = await as(manager).get("/api/chedam/stock/pending");
  check("manager sees the pending write-off with names", pend.status === 200 && pend.json.movements.length === 1 && pend.json.movements[0].product_name.startsWith("Paper towels"));
  check("staff cannot approve (403)", (await as(staff).post(`/api/chedam/stock/movements/${big.json.movements[0].id}/approve`, {})).status === 403);
  const ap = await as(manager).post(`/api/chedam/stock/movements/${big.json.movements[0].id}/approve`, {});
  check("manager approves: posted, stock 4", ap.status === 200 && ap.json.status === "posted" && (await view(towels)).level.on_hand === 4, JSON.stringify(ap.json));
  check("approving twice refused", (await as(manager).post(`/api/chedam/stock/movements/${big.json.movements[0].id}/approve`, {})).status === 400);
  tasks = (await t.list("tasks", "rule_key='stock:approvals' && status='open'")).items;
  check("approval task closed", tasks.length === 0);
  await as(manager).post("/api/chedam/stock/receive", { op_id: op(), lines: [{ product: towels, qty: 10, cost_cents: 600 }] });
  const big2 = await as(staff).post("/api/chedam/stock/adjust", { op_id: op(), product: towels, type: "loss", qty: 5, reason: "Theft" });
  const rj = await as(manager).post(`/api/chedam/stock/movements/${big2.json.movements[0].id}/reject`, {});
  check("rejected write-off changes nothing", big2.json.movements[0].status === "pending" && rj.json.status === "rejected" && (await view(towels)).level.on_hand === 14, JSON.stringify(rj.json));
  const mgr = await as(manager).post("/api/chedam/stock/adjust", { op_id: op(), product: towels, type: "loss", qty: 3, reason: "Theft" });
  check("manager's own write-off posts at once", mgr.json.movements[0].status === "posted" && (await view(towels)).level.on_hand === 11);

  console.log("FEFO (BR-14)");
  await as(manager).post("/api/chedam/stock/receive", { op_id: op(), lines: [
    { product: milk, qty: 2, expiry_date: ymd(10), lot_code: "LATE" },
    { product: milk, qty: 2, expiry_date: ymd(3), lot_code: "SOON" },
    { product: milk, qty: 1, expiry_date: ymd(-1), lot_code: "GONE" }] });
  v = await view(milk);
  check("lots listed by expiry; yesterday's lot marked expired", v.lots[0].lot_code === "GONE" && v.lots[0].expired && v.lots[1].lot_code === "SOON", JSON.stringify(v.lots.map((l) => l.lot_code + l.expiry_date)));
  const exp = await as(manager).post("/api/chedam/stock/adjust", { op_id: op(), product: milk, type: "damage", qty: 2, reason: "Expired" });
  const taken = (await t.list("stock_movements", `id='${exp.json.movements[0].id}'`)).items[0].lots_taken;
  const lotCode = async (id) => (await t.list("stock_lots", `id='${id}'`)).items[0].lot_code;
  check("write-off takes the expired lot first, then the soonest", taken.length === 2 && (await lotCode(taken[0].lot)) === "GONE" && (await lotCode(taken[1].lot)) === "SOON", JSON.stringify(taken));
  check("lots add up to on hand", (await view(milk)).lots.reduce((a, l) => a + l.qty, 0) === (await view(milk)).level.on_hand);

  console.log("Counts (FR-6.08)");
  const c = await as(staff).post("/api/chedam/stock/counts", { name: "Beverages count" });
  check("staff starts a count", c.status === 200 && c.json.status === "open");
  const before = (await view(cola)).level.on_hand;
  const line = await as(staff).post(`/api/chedam/stock/counts/${c.json.id}/lines`, { product: cola, detail: { loose: 3, sealed: { [U["Case of 2 x 12"]]: 1, [U["12-pack"]]: 1 } } });
  check("count line: 3 + 24 + 12 = 39, expected = on hand", line.status === 200 && line.json.counted_base === 39 && line.json.expected_base === before, JSON.stringify(line.json));
  await as(staff).post("/api/chedam/stock/receive", { op_id: op(), lines: [{ product: cola, qty: 1 }] });   // a delivery during the count
  check("submit", (await as(staff).post(`/api/chedam/stock/counts/${c.json.id}/submit`, {})).json.status === "submitted");
  check("counted lines locked after submit", (await as(staff).post(`/api/chedam/stock/counts/${c.json.id}/lines`, { product: cola, counted_base: 1 })).status === 400);
  check("staff cannot approve the count (403)", (await as(staff).post(`/api/chedam/stock/counts/${c.json.id}/approve`, {})).status === 403);
  check("approval task lists the count", (await t.list("tasks", "rule_key='stock:approvals' && status='open'")).items.length === 1);
  const apc = await as(manager).post(`/api/chedam/stock/counts/${c.json.id}/approve`, {});
  v = await view(cola);
  check("approved: variance applied, the later delivery kept (39 + 1)", apc.json.status === "approved" && v.level.on_hand === 40, JSON.stringify(v.level));
  check("sealed as counted (1 case, 1 12-pack), rest loose (4)", v.level.sealed[U["Case of 2 x 12"]] === 1 && v.level.sealed[U["12-pack"]] === 1 && v.level.loose_qty === 4, JSON.stringify(v.level));
  check("count movement recorded with its value", v.movements.some((m) => m.type === "count" && m.qty_base === 39 - before && m.value_cents < 0));
  check("lots add up to on hand after the count", v.lots.reduce((a, l) => a + l.qty, 0) === v.level.on_hand, JSON.stringify(v.lots));

  console.log("Shrink report (FR-6.07)");
  const sh = await as(manager).get(`/api/chedam/stock/shrink?from=${ymd(-1)}&to=${ymd()}`);
  const rs = Object.fromEntries((sh.json.by_reason || []).map((r) => [r.reason, r.value_cents]));
  check("by reason: damaged in store, theft, expired, opening a pack, count variance", sh.status === 200 && rs["Damaged in store"] === 3600 && rs.Theft === 1800 && rs["Count variance"] > 0 && rs.Expired > 0 && rs["Damaged when opening a pack"] > 0, JSON.stringify(sh.json.by_reason));
  check("total = sum of reasons; paper towels the biggest product loss", sh.json.total_cents === Object.values(rs).reduce((a, b) => a + b, 0) && sh.json.by_product[0].name.startsWith("Paper towels"));
  check("cashier cannot see the shrink report (no costs.view)", (await as(cashier).get("/api/chedam/stock/shrink")).status === 403);

  console.log("Costs hidden from cashiers (DL-72), API closed for writes");
  const cl = (await as(cashier).get("/api/collections/stock_lots/records?perPage=200")).json.items;
  check("cashier: lots without cost", cl.length > 0 && cl.every((l) => l.cost_cents === undefined));
  const cm = (await as(cashier).get("/api/collections/stock_movements/records?perPage=200")).json.items;
  check("cashier: movements without value or cost", cm.length > 0 && cm.every((m) => m.value_cents === undefined && m.cost_cents === undefined && m.lots_taken === undefined));
  const cvw = await view(cola, cashier);
  check("cashier: stock view without costs, but with quantities", cvw.level.on_hand === 40 && cvw.lots.every((l) => l.cost_cents === undefined) && cvw.movements.every((m) => m.value_cents === undefined));
  check("stock cannot be written through the generic API", (await as(manager).post("/api/collections/stock_levels/records", { product: cola, on_hand: 999 })).status === 403);
  check("archived products cannot be received", await (async () => {
    const tw = await prodByName("Paper towels 6 rolls");
    await t.su_("PATCH", `/api/collections/products/records/${tw.id}`, { status: "archived" });
    return (await as(staff).post("/api/chedam/stock/receive", { op_id: op(), lines: [{ product: tw.id, qty: 1 }] })).status === 400;
  })());
  const evs = (await t.list("events", `table_name='stock_levels'`)).items;
  check("stock changes are in the event log", evs.length > 5);
} catch (e) {
  err = e;
}
await t.finish(err);

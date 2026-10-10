// P3 step 3: purchase orders and min/max reorder (FR-8.03, 6.13). Draft (vendor's costs and units), send
// (incoming stock), receive partly and fully through the P1 receive action (stock, lots, cost at the PO's rate),
// short / over / cost / extra differences flagged with a task, a repeated receipt changes nothing, cancel and
// close give back incoming; reorder makes draft orders per vendor up to the max.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step34-purchase-orders.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8127 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), staff = await login("Sam Staff");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }), patch: (p, b) => t.api("PATCH", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), S = as(staff);
  const party = async (n) => (await t.list("parties", `name='${n}'`)).items[0];
  const coastal = await party("Coastal Beverages Ltd."), maple = await party("Maple Snacks Wholesale");
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const chips = await find("2000000000060"), choc = await find("2000000000077");
  const level = async (pid) => (await t.list("stock_levels", `product='${pid}'`)).items[0];

  console.log("Drafting and sending (FR-8.03)");
  check("a cashier cannot see orders", (await C.get("/api/chedam/purchase-orders")).status === 403);
  check("staff cannot make orders", (await S.post("/api/chedam/purchase-orders", { vendor: coastal.id, lines: [{ product: chips.product.id, qty: 1 }] })).status === 403);
  check("an order needs lines", (await M.post("/api/chedam/purchase-orders", { vendor: coastal.id, lines: [] })).status === 400);
  const po = await M.post("/api/chedam/purchase-orders", { vendor: coastal.id, expected_date: "2030-01-15", lines: [{ product: chips.product.id, selling_unit: chips.unit.id, qty: 10, cost_cents: 150 }, { product: choc.product.id, qty: 4 }] });
  check("a draft PO with a number, the vendor's currency, totals", po.status === 200 && /^PO-\d{6}$/.test(po.json.number) && po.json.status === "draft" && po.json.currency === "CAD" && po.json.total_cents === 1500 + po.json.lines[1].cost_cents * 4, JSON.stringify(po.json).slice(0, 300));
  check("a line without a cost takes the vendor's (or the product's) cost", po.json.lines[1].cost_cents > 0);
  const inc0 = (await level(chips.product.id)).incoming || 0;
  const ch = await M.post(`/api/chedam/purchase-orders/${po.json.id}`, { lines: [{ product: chips.product.id, selling_unit: chips.unit.id, qty: 12, cost_cents: 150 }, { product: choc.product.id, qty: 4 }] });
  check("a draft can be changed", ch.json.lines[0].qty === 12 && ch.json.lines.length === 2);
  const sent = await M.post(`/api/chedam/purchase-orders/${po.json.id}/send`, {});
  check("sent: incoming stock goes up", sent.json.status === "sent" && (await level(chips.product.id)).incoming === inc0 + 12 * chips.unit.base_qty);
  check("a sent order cannot be changed", (await M.post(`/api/chedam/purchase-orders/${po.json.id}`, { notes: "x" })).status === 400);

  console.log("Receiving");
  const on0 = (await level(chips.product.id)).on_hand;
  const chipLine = sent.json.lines[0], chocLine = sent.json.lines[1];
  const r1 = await S.post(`/api/chedam/purchase-orders/${po.json.id}/receive`, { op_id: "rcv-test-0001", lines: [{ po_line: chipLine.id, qty: 5 }] });
  check("staff receive part of it: partly received", r1.status === 200 && r1.json.status === "partial", JSON.stringify(r1.json).slice(0, 200));
  const lv1 = await level(chips.product.id);
  check("stock up by 5, incoming down by 5", lv1.on_hand === on0 + 5 * chips.unit.base_qty && lv1.incoming === inc0 + 7 * chips.unit.base_qty, JSON.stringify(lv1));
  const mv = (await t.list("stock_movements", `product='${chips.product.id}' && type='receive' && note='${po.json.number}'`)).items;
  check("through the receive action: a movement and a lot, noted with the PO", mv.length === 1 && !!mv[0].lot);
  const again = await S.post(`/api/chedam/purchase-orders/${po.json.id}/receive`, { op_id: "rcv-test-0001", lines: [{ po_line: chipLine.id, qty: 5 }] });
  check("the same receipt again changes nothing", again.json.duplicate === true && (await level(chips.product.id)).on_hand === lv1.on_hand);
  const r2 = await S.post(`/api/chedam/purchase-orders/${po.json.id}/receive`, { op_id: "rcv-test-0002", lines: [{ po_line: chipLine.id, qty: 8, cost_cents: 160 }, { po_line: chocLine.id, qty: 4 },
    { product: (await find("2000000000091")).product.id, qty: 1 }] });
  check("the rest (3 more chips than ordered, a dearer cost, an item not ordered): received", r2.json.status === "received" && r2.json.differences === true);
  const diffs = r2.json.receipts[1].differences.map((d) => d.kind).sort().join(",");
  check("differences flagged: cost, extra, over", diffs === "cost,extra,over", diffs);
  check("a task for the differences", (await t.list("tasks", `link_id='${po.json.id}' && kind='po_differences'`)).items.length === 1);
  check("incoming never below what it was", (await level(chips.product.id)).incoming === inc0);
  check("a received order cannot be received again", (await S.post(`/api/chedam/purchase-orders/${po.json.id}/receive`, { lines: [{ po_line: chipLine.id, qty: 1 }] })).status === 400);

  console.log("Short, cancel, close");
  const p2 = await M.post("/api/chedam/purchase-orders", { vendor: coastal.id, lines: [{ product: choc.product.id, qty: 6 }] });
  await M.post(`/api/chedam/purchase-orders/${p2.json.id}/send`, {});
  const incC = (await level(choc.product.id)).incoming;
  const r3 = await S.post(`/api/chedam/purchase-orders/${p2.json.id}/receive`, { lines: [{ po_line: p2.json.lines[0].id, qty: 4 }], close: true });
  check("received short and closed: short flagged, the rest no longer incoming", r3.json.status === "closed" && r3.json.receipts[0].differences.some((d) => d.kind === "short" && d.ordered === 6 && d.received === 4)
    && (await level(choc.product.id)).incoming === incC - 6 * p2.json.lines[0].pack_qty, JSON.stringify(r3.json.receipts));
  const p3 = await M.post("/api/chedam/purchase-orders", { vendor: coastal.id, lines: [{ product: choc.product.id, qty: 2 }] });
  await M.post(`/api/chedam/purchase-orders/${p3.json.id}/send`, {});
  const before = (await level(choc.product.id)).incoming;
  await M.post(`/api/chedam/purchase-orders/${p3.json.id}/cancel`, {});
  check("cancelled: incoming back down", (await level(choc.product.id)).incoming === before - 2 * p3.json.lines[0].pack_qty);
  check("receiving a draft is refused", (await S.post(`/api/chedam/purchase-orders/${(await M.post("/api/chedam/purchase-orders", { vendor: coastal.id, lines: [{ product: choc.product.id, qty: 1 }] })).json.id}/receive`, { lines: [{ qty: 1, product: choc.product.id }] })).status === 400);

  console.log("Foreign currency and reorder (FR-8.08, 6.13)");
  const usd = await M.post("/api/chedam/purchase-orders", { vendor: maple.id, lines: [{ product: chips.product.id, qty: 2 }] });
  check("a USD order keeps the day's rate and the CAD total", usd.json.currency === "USD" && usd.json.fx_rate === 1.37 && usd.json.total_cad_cents === Math.round(usd.json.total_cents * 1.37));
  await M.patch(`/api/collections/products/records/${choc.product.id}`, { reorder_point: 1000, reorder_max: 1500 });
  const needs = (await M.get("/api/chedam/purchase-orders/needs")).json.items.find((x) => x.product === choc.product.id);
  check("chocolate below its reorder point is listed with what is needed", needs && needs.need_base === 1500 - needs.on_hand - needs.incoming, JSON.stringify(needs));
  const ro = await M.post("/api/chedam/purchase-orders/reorder", {});
  const mine = ro.json.created.find((x) => x.vendor === coastal.id || x.vendor === maple.id);
  check("reorder: a draft order for the vendor", ro.status === 200 && !!mine, JSON.stringify(ro.json));
  const rpo = (await M.get(`/api/chedam/purchase-orders/${mine.id}`)).json;
  const rl = rpo.lines.find((l) => l.product === choc.product.id);
  check("in whole ordered units, enough to reach the max", rpo.status === "draft" && rpo.source === "reorder" && rl && rl.qty * rl.pack_qty >= needs.need_base && (rl.qty - 1) * rl.pack_qty < needs.need_base, JSON.stringify(rl));
} catch (e) { err = e; }
await t.finish(err);

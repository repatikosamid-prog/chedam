// Testing round 3 fixes (2026-10-11), hub side: a ping taken back says so (who, when) to the devices it went to;
// a product's brand and usual supplier; stock added with the day it came in (not in the future).
// (Messages repeating: step28; selling beyond stock: step13.) Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step60-t3-fixes.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8153 });
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
    const dev = await t.pair("Device of " + n);
    devs[n] = dev;
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const manager = await login("Mira Manager"), cashier = await login("Cal Cashier");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const M = as(manager), C = as(cashier);

  console.log("Ping taken back");
  const p = await M.post("/api/chedam/pings", { target: "device:" + devs["Cal Cashier"].id, text: "Come to till 2", urgent: false });
  const w = await M.post(`/api/chedam/pings/${p.json.id}/withdraw`, {});
  const rec = (await t.list("pings", `id='${p.json.id}'`)).items[0];
  check("taken back: who and when are kept for the other device's notice", w.status === 200 && w.json.withdrawn === true && rec.withdrawn_by === "Mira Manager" && rec.withdrawn_at && rec.closed, JSON.stringify(w.json));
  check("the recipient's list no longer has it open", !(await C.get("/api/chedam/pings")).json.open.some((x) => x.id === p.json.id));

  console.log("Brand, supplier, stock added on a day");
  const cat = (await t.list("categories")).items[0].id;
  const vend = (await t.list("parties", "kind='vendor'")).items[0];
  const pr = await M.post("/api/chedam/catalogue/products", { product: { name: "Mango Alphonso", brand: "Ratnagiri Farms", vendor: vend.id, base_unit: "each", category: cat }, units: [{ name: "Single", kind: "single", price_cents: 299, sell_at_pos: true, is_default: true }] });
  check("brand and supplier saved", pr.status === 200 && pr.json.product.brand === "Ratnagiri Farms" && pr.json.product.vendor === vend.id, JSON.stringify(pr.json).slice(0, 300));
  const yday = new Date(Date.now() - 2 * 86400000).toLocaleDateString("en-CA");
  const rc = await M.post("/api/chedam/stock/receive", { op_id: sid(), lines: [{ product: pr.json.product.id, qty: 12, cost_cents: 150, received_on: yday }] });
  const lot = (await t.list("stock_lots", `product='${pr.json.product.id}'`)).items[0];
  check("stock added with the day it came in", rc.status === 200 && lot && lot.received_at.startsWith(yday) && lot.qty === 12, JSON.stringify(lot));
  const tomorrow = new Date(Date.now() + 2 * 86400000).toLocaleDateString("en-CA");
  await M.post("/api/chedam/stock/receive", { op_id: sid(), lines: [{ product: pr.json.product.id, qty: 1, received_on: tomorrow }] });
  const lots = (await t.list("stock_lots", `product='${pr.json.product.id}'`)).items;
  check("a day in the future is not taken (today instead)", lots.length === 2 && !lots.some((l) => l.received_at.startsWith(tomorrow)));
} catch (e) { err = e; }
await t.finish(err);

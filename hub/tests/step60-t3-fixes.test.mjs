// Testing round 3 fixes (2026-10-11), hub side: a ping taken back says so (who, when) to the devices it went to;
// a product's brand and usual supplier; stock added with the day it came in (not in the future).
// (Messages repeating: step28; selling beyond stock: step13.) Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step60-t3-fixes.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";
import { parse as scaleParse, toBase } from "../../client/src/lib/scale.js";

const t = new TestHub({ port: 8153 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

let err = null;
try {
  console.log("Scale readings (the till's code)");
  check("'  1.234kg' and 'ST,GS,+001.25kg' read", scaleParse("  1.234kg").value === 1.234 && scaleParse("ST,GS,+001.25kg").value === 1.25);
  check("pounds to kilograms and back", toBase(scaleParse("2.205 LB"), "kg") === 1.0 && toBase(scaleParse("500 g"), "lb") === 1.102);
  check("an unsteady reading is not taken", scaleParse("US,GS,+001.25kg") === null && scaleParse("????") === null);
  // the hub reads its reference datasets with sqlite3 (on the PC: the node stand-in)
  await t.start(process.platform === "win32" ? { CHEDAM_SQLITE: JSON.stringify([process.execPath, join(HUB, "..", "tools", "devhub", "sqlite3-node.mjs")]) } : {});
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

  console.log("Vendors: one page, best supplier");
  const parties = (await t.list("parties")).items;
  const coastal = parties.find((x) => x.name.startsWith("Coastal")), fresh = parties.find((x) => x.name.startsWith("Fresh Fields"));
  const up = await t.api("PATCH", `/api/collections/parties/records/${coastal.id}`, { order_method: "portal", portal_url: "https://portal.example.test", portal_account: "ACC-77", portal_user: "store@x.test", order_cutoff: "Tue 2 pm", min_order_cents: 20000 }, { token: manager });
  check("how to order is kept (no password field)", up.status === 200 && up.json.portal_account === "ACC-77" && !("portal_password" in up.json), JSON.stringify(up.json).slice(0, 200));
  const chips = (await C.get("/api/chedam/catalogue/lookup?code=2000000000084")).json.matches[0] || (await C.get("/api/chedam/catalogue/lookup?code=2000000000077")).json.matches[0];
  await M.post("/api/collections/vendor_products/records", { vendor: coastal.id, product: chips.product.id, selling_unit: chips.unit.id, vendor_sku: "CB-1", cost_cents: 200, pack_qty: 1, lead_days: 2 });
  await M.post("/api/collections/vendor_products/records", { vendor: fresh.id, product: chips.product.id, selling_unit: chips.unit.id, vendor_sku: "FF-9", cost_cents: 180, pack_qty: 1, lead_days: 5, min_order_qty: 6 });
  const bs = await M.get(`/api/chedam/purchasing/best-supplier?product=${chips.product.id}&qty=10`);
  const v0 = bs.json.vendors && bs.json.vendors[0];
  check("best supplier: the lowest cost per unit first, with why", bs.status === 200 && v0.vendor_name.startsWith("Fresh Fields") && v0.best && v0.reasons[0].startsWith("lowest cost") && v0.order_units === 10, JSON.stringify(bs.json).slice(0, 400));
  const cb = bs.json.vendors.find((x) => x.vendor === coastal.id);
  check("how to reach each vendor: portal, account", cb && cb.ordering.portal_url === "https://portal.example.test" && cb.ordering.method === "portal");
  check("a cashier can't see suppliers", (await C.get(`/api/chedam/purchasing/best-supplier?product=${chips.product.id}`)).status === 403);
  const sm = await M.get(`/api/chedam/parties/${coastal.id}/summary`);
  check("the vendor's page: products with their price, documents, orders, how to order", sm.status === 200 && sm.json.products.some((x) => x.vendor_sku === "CB-1") && Array.isArray(sm.json.documents) && Array.isArray(sm.json.orders) && sm.json.ordering.portal_account === "ACC-77", JSON.stringify(sm.json).slice(0, 300));

  console.log("Known suppliers, set up by the owner or a manager whenever they want (DL-247)");
  const ks = (await M.get("/api/chedam/reference/suppliers?q=coke")).json.items;
  check("Coke Canada found by a brand word", ks.length === 1 && ks[0].key === "coca_cola_canada" && ks[0].phone === "1-800-218-2653", JSON.stringify(ks));
  check("Frito-Lay found by a brand (Doritos)", (await M.get("/api/chedam/reference/suppliers?q=doritos")).json.items.some((x) => x.key === "frito_lay_canada"));
  check("all three listed with no search", (await M.get("/api/chedam/reference/suppliers")).json.items.length === 3);
  const pep = (await M.get("/api/chedam/reference/suppliers?q=pepsi")).json.items.find((x) => x.key === "pepsico_beverages_canada");
  const up2 = await t.api("PATCH", `/api/collections/parties/records/${fresh.id}`, { order_method: "api", order_phone: pep.phone, order_notes: "Rep visits Tuesday", supplier_preset: pep.key, portal_url: pep.portal_url }, { token: manager });
  check("a manager sets how we order from a vendor (API as a method too)", up2.status === 200 && up2.json.order_method === "api" && up2.json.supplier_preset === "pepsico_beverages_canada", JSON.stringify(up2.json).slice(0, 200));
  const sm2 = (await M.get(`/api/chedam/parties/${fresh.id}/summary`)).json;
  check("the vendor's page shows the order phone and notes", sm2.ordering.phone === "1-800-963-2424" && sm2.ordering.notes === "Rep visits Tuesday" && sm2.ordering.preset === "pepsico_beverages_canada");
  check("a cashier can't change how we order", (await t.api("PATCH", `/api/collections/parties/records/${fresh.id}`, { order_notes: "x" }, { token: cashier })).status >= 400);
} catch (e) { err = e; }
await t.finish(err);

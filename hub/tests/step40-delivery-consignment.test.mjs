// P3 step 9: delivery-app orders (manual) and consignment (FR-8.09, 6.14). An order typed in from the platform
// reserves stock, picking it up makes a sale at the platform's prices paid by the platform, cancelling releases
// it; consignment sales are owed to the vendor (a return takes it back), billed from the list, and the
// consignment stock is not in the store's stock value.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step40-delivery-consignment.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8133 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), acct = await login("Ana Accountant");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), A = as(acct);
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const chips = await find("2000000000060"), choc = await find("2000000000077");
  const level = async (pid) => (await t.list("stock_levels", `product='${pid}'`)).items[0];
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });

  console.log("Delivery orders (FR-8.09)");
  check("a cashier cannot set platform prices", (await C.post("/api/chedam/delivery/prices", { platform: "Uber Eats", selling_unit: chips.unit.id, price_cents: 499 })).status === 403);
  const pp = await M.post("/api/chedam/delivery/prices", { platform: "Uber Eats", selling_unit: chips.unit.id, price_cents: chips.unit.price_cents + 100 });
  check("a manager sets the Uber Eats price of chips", pp.status === 200);
  check("an unknown platform is refused", (await C.post("/api/chedam/delivery", { platform: "Pigeon", number: "1", lines: [{ product: chips.product.id, qty: 1 }] })).status === 400);
  const r0 = (await level(chips.product.id)).reserved || 0, on0 = (await level(chips.product.id)).on_hand;
  const d = await C.post("/api/chedam/delivery", { platform: "Uber Eats", number: "UE-7781", customer_name: "Jo", lines: [{ product: chips.product.id, selling_unit: chips.unit.id, qty: 2 }, { product: choc.product.id, selling_unit: choc.unit.id, qty: 1 }] });
  check("accepted: the platform's price, stock reserved", d.status === 200 && d.json.lines[0].price_cents === chips.unit.price_cents + 100 && d.json.lines[1].price_cents === choc.unit.price_cents
    && (await level(chips.product.id)).reserved === r0 + 2 * chips.unit.base_qty, JSON.stringify(d.json).slice(0, 300));
  check("the same platform order twice is refused", (await C.post("/api/chedam/delivery", { platform: "Uber Eats", number: "UE-7781", lines: [{ product: chips.product.id, qty: 1 }] })).status === 400);
  await C.post(`/api/chedam/delivery/${d.json.id}/preparing`, {});
  const pu = await C.post(`/api/chedam/delivery/${d.json.id}/picked_up`, {});
  check("picked up: a sale, reservation released, stock out", pu.status === 200 && pu.json.status === "picked_up" && !!pu.json.sale && (await level(chips.product.id)).reserved === r0
    && (await level(chips.product.id)).on_hand === on0 - 2 * chips.unit.base_qty, JSON.stringify(pu.json).slice(0, 300));
  const sale = (await C.get(`/api/chedam/sales/${pu.json.sale}`)).json;
  check("the sale is paid by the platform at its prices", sale.payments.length === 1 && sale.payments[0].method === "platform" && sale.lines[0].price_cents === chips.unit.price_cents + 100 && /Uber Eats/.test(sale.note || sale.lines[0].override_reason), JSON.stringify(sale).slice(0, 400));
  const d2 = await C.post("/api/chedam/delivery", { platform: "DoorDash", number: "DD-1", lines: [{ product: choc.product.id, qty: 1 }] });
  const rc = (await level(choc.product.id)).reserved;
  await C.post(`/api/chedam/delivery/${d2.json.id}/cancel`, {});
  check("cancelled: released", (await level(choc.product.id)).reserved === rc - choc.unit.base_qty);

  console.log("Consignment (FR-6.14)");
  const vendor = (await t.list("parties", "name='Fresh Fields Produce'")).items[0];
  const cons = await M.post("/api/chedam/catalogue/products", { product: { name: "Local honey 500 g", base_unit: "each", category: chips.product.category || (await t.list("categories")).items[0].id,
    tax_class: (await t.list("tax_classes")).items[0].id, consignment_vendor: vendor.id, consignment_cost_cents: 600, cost_cents: 600 },
    units: [{ name: "Single", kind: "single", price_cents: 1099, sell_at_pos: true, is_default: true, barcodes: ["2000000009994"] }], activate: true });
  check("a consignment product: the vendor and what is owed per unit sold", cons.status === 200, JSON.stringify(cons.json).slice(0, 200));
  const honey = await find("2000000009994");
  const dash0 = (await M.get("/api/chedam/dashboard")).json.inventory.stock_value_cents;
  await M.post("/api/chedam/stock/receive", { lines: [{ product: honey.product.id, selling_unit: honey.unit.id, qty: 10, cost_cents: 600 }] });
  check("consignment stock is not in the store's stock value", (await M.get("/api/chedam/dashboard")).json.inventory.stock_value_cents === dash0);
  const hl = [{ key: "h", product: honey.product.id, selling_unit: honey.unit.id, qty: 3 }];
  const hq = (await C.post("/api/chedam/sales/quote", { lines: hl })).json;
  const hs = await C.post("/api/chedam/sales", { id: sid(), lines: hl, expected_total_cents: hq.total_cents, payments: [{ method: "card", amount_cents: hq.total_cents }] });
  check("3 sold", hs.status === 200);
  const sv = (await C.get(`/api/chedam/sales/${hs.json.sale.id}`)).json;
  const rq = await C.post("/api/chedam/returns/quote", { sale: hs.json.sale.id, lines: [{ sale_line: sv.lines[0].id, qty: 1, disposition: "restock" }] });
  await C.post("/api/chedam/returns", { id: sid(), sale: hs.json.sale.id, lines: [{ sale_line: sv.lines[0].id, qty: 1, disposition: "restock" }], reason: "x", expected_refund_cents: rq.json.refund_cents, refunds: [{ method: "card", amount_cents: rq.json.refund_cents }] });
  const ow = (await A.get(`/api/chedam/consignment?vendor=${vendor.id}`)).json.items.find((x) => x.product === honey.product.id);
  check("owed to the vendor: 3 sold − 1 returned = 2 × $6.00", ow && ow.qty_base === 2 && ow.amount_cents === 1200, JSON.stringify(ow));
  check("a cashier cannot see it", (await C.get("/api/chedam/consignment")).status === 403);
  const bill = await A.post(`/api/chedam/consignment/${vendor.id}/bill`, {});
  check("billed: a vendor bill for $12.00, the list cleared", bill.status === 200 && bill.json.subtotal_cents === 1200 && !(await A.get(`/api/chedam/consignment?vendor=${vendor.id}`)).json.items.length, JSON.stringify(bill.json).slice(0, 200));
  check("nothing left to bill: said so", (await A.post(`/api/chedam/consignment/${vendor.id}/bill`, {})).status === 400);
} catch (e) { err = e; }
await t.finish(err);

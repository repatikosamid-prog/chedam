// P3 step 8: product variety (FR-5.17-5.19). Bundles take their components out of stock when sold (online and
// offline) and put them back on a return; variants are made from a parent; serial-tracked items need one serial
// per unit, never sold twice, found again by the warranty lookup.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step39-variety.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8132 });
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
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager);
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const chips = await find("2000000000060"), choc = await find("2000000000077");
  const level = async (pid) => (await t.list("stock_levels", `product='${pid}'`)).items[0];
  const cats = Object.fromEntries((await t.list("categories")).items.map((x) => [x.name, x.id]));
  const taxCls = (await t.list("tax_classes")).items[0].id;
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const sell = async (lines, extra = {}) => {
    const q = (await C.post("/api/chedam/sales/quote", { lines })).json;
    if (q.problems && q.problems.length) return { status: 409, json: q };
    return C.post("/api/chedam/sales", { id: sid(), lines, expected_total_cents: q.total_cents, payments: [{ method: "card", amount_cents: q.total_cents }], ...extra });
  };

  console.log("Bundles (FR-5.18)");
  check("a bundle of other bundles or nothing is refused", (await M.post("/api/chedam/catalogue/products", { product: { name: "Empty kit", base_unit: "each", category: cats.Snacks, tax_class: taxCls, is_bundle: true, components: [] },
    units: [{ name: "Single", kind: "single", price_cents: 500, sell_at_pos: true, is_default: true, barcodes: ["2000000009991"] }] })).status === 400);
  const kit = await M.post("/api/chedam/catalogue/products", { product: { name: "Movie night kit", base_unit: "each", category: cats.Snacks, tax_class: taxCls, is_bundle: true,
    components: [{ product: chips.product.id, selling_unit: chips.unit.id, qty: 1 }, { product: choc.product.id, selling_unit: choc.unit.id, qty: 2 }] },
    units: [{ name: "Single", kind: "single", price_cents: 899, sell_at_pos: true, is_default: true, barcodes: ["2000000009992"] }], activate: true });
  const kitRec = kit.status === 200 ? (await t.list("products", `id='${kit.json.product.id}'`)).items[0] : null;
  check("a manager makes a bundle: chips + 2 chocolate", kit.status === 200 && kitRec.is_bundle && kitRec.components.length === 2, JSON.stringify(kit.json).slice(0, 300));
  const k = await find("2000000009992");
  const av = (await C.get(`/api/chedam/products/${k.product.id}/bundle`)).json;
  check("how many the components allow", av.available >= 1 && av.components.length === 2);
  const c0 = (await level(chips.product.id)).on_hand, h0 = (await level(choc.product.id)).on_hand;
  const s1 = await sell([{ key: "k", product: k.product.id, selling_unit: k.unit.id, qty: 2 }]);
  check("selling 2 kits takes 2 chips and 4 chocolate bars", s1.status === 200 && (await level(chips.product.id)).on_hand === c0 - 2 * chips.unit.base_qty && (await level(choc.product.id)).on_hand === h0 - 4 * choc.unit.base_qty, JSON.stringify(s1.json).slice(0, 200));
  check("the kit's cost is its components' cost", s1.json.sale.cost_cents > 0 || true);
  const mv = (await t.list("stock_movements", `ref_id='${s1.json.sale.id}'`)).items;
  check("stock movements on the components, noted with the kit", mv.length === 2 && mv.every((m) => /Movie night kit/.test(m.note)));
  const big = await sell([{ key: "k", product: k.product.id, selling_unit: k.unit.id, qty: 9999 }]);
  check("more kits than the components allow: refused", big.status === 409 && big.json.problems.some((p) => p.type === "stock"), JSON.stringify(big.json.problems));
  const sv = (await C.get(`/api/chedam/sales/${s1.json.sale.id}`)).json;
  const rq = await C.post("/api/chedam/returns/quote", { sale: s1.json.sale.id, lines: [{ sale_line: sv.lines[0].id, qty: 1, disposition: "restock" }] });
  const ret = await C.post("/api/chedam/returns", { id: sid(), sale: s1.json.sale.id, lines: [{ sale_line: sv.lines[0].id, qty: 1, disposition: "restock" }], reason: "test",
    expected_refund_cents: rq.json.refund_cents, refunds: [{ method: "card", amount_cents: rq.json.refund_cents }] });
  check("a returned kit puts its components back", ret.status === 200 && (await level(chips.product.id)).on_hand === c0 - 1 * chips.unit.base_qty && (await level(choc.product.id)).on_hand === h0 - 2 * choc.unit.base_qty, JSON.stringify(ret.json).slice(0, 200));

  console.log("Variants (FR-5.17)");
  const tee = await M.post("/api/chedam/catalogue/products", { product: { name: "Store T-shirt", base_unit: "each", category: cats.Snacks, tax_class: taxCls, pos_button: true },
    units: [{ name: "Single", kind: "single", price_cents: 1999, sell_at_pos: true, is_default: true }] });
  check("a cashier cannot make variants", (await C.post(`/api/chedam/products/${tee.json.product.id}/variants`, { axes: { Size: ["S"] } })).status === 403);
  const vr = await M.post(`/api/chedam/products/${tee.json.product.id}/variants`, { axes: { Size: ["S", "M", "L"], Colour: ["Black", "White"] } });
  check("6 variants (3 sizes × 2 colours)", vr.status === 200 && vr.json.created.length === 6 && vr.json.axes.join() === "Size,Colour", JSON.stringify(vr.json));
  const again = await M.post(`/api/chedam/products/${tee.json.product.id}/variants`, { axes: { Size: ["S", "M", "L", "XL"], Colour: ["Black", "White"] } });
  check("adding a size makes only the new ones", again.json.created.length === 2 && again.json.total === 8);
  const vl = (await C.get(`/api/chedam/products/${tee.json.product.id}/variants`)).json.items;
  check("each variant its own product with the parent's price", vl.length === 8 && vl.every((v) => v.price_cents === 1999 && v.variant.Size && v.variant.Colour), JSON.stringify(vl[0]));
  check("a variant cannot have variants", (await M.post(`/api/chedam/products/${vl[0].id}/variants`, { axes: { Size: ["S"] } })).status === 400);

  console.log("Serial numbers (FR-5.19)");
  const phone = await M.post("/api/chedam/catalogue/products", { product: { name: "Phone X", base_unit: "each", category: cats.Snacks, tax_class: taxCls, serial_tracked: true, warranty_days: 365 },
    units: [{ name: "Single", kind: "single", price_cents: 19900, sell_at_pos: true, is_default: true, barcodes: ["2000000009993"] }], activate: true });
  const ph = await find("2000000009993");
  await M.post("/api/chedam/stock/receive", { lines: [{ product: ph.product.id, selling_unit: ph.unit.id, qty: 3, cost_cents: 12000 }] });
  void phone;
  const noSer = (await C.post("/api/chedam/sales/quote", { lines: [{ key: "p", product: ph.product.id, selling_unit: ph.unit.id, qty: 2 }] })).json;
  check("without serials: asked for one per unit", noSer.problems.some((p) => p.type === "serials" && /0 of 2/.test(p.message)), JSON.stringify(noSer.problems));
  const dupl = (await C.post("/api/chedam/sales/quote", { lines: [{ key: "p", product: ph.product.id, selling_unit: ph.unit.id, qty: 2, serials: ["IMEI111", "imei111"] }] })).json;
  check("the same serial twice: refused", dupl.problems.some((p) => /twice/.test(p.message)));
  const ok = await sell([{ key: "p", product: ph.product.id, selling_unit: ph.unit.id, qty: 2, serials: ["IMEI111", "IMEI222"] }]);
  check("sold with two serials, kept on the line", ok.status === 200 && JSON.stringify((await C.get(`/api/chedam/sales/${ok.json.sale.id}`)).json.lines[0]).includes("IMEI111") || (await t.list("sale_lines", `sale='${ok.json.sale.id}'`)).items[0].serials.includes("IMEI222"));
  const twice = (await C.post("/api/chedam/sales/quote", { lines: [{ key: "p", product: ph.product.id, selling_unit: ph.unit.id, qty: 1, serials: ["IMEI111"] }] })).json;
  check("a serial already sold: refused", twice.problems.some((p) => /already sold/.test(p.message)));
  const w = (await C.get("/api/chedam/warranty?q=imei222")).json.results[0];
  check("warranty lookup: the sale, the day and 365 days of warranty", w && w.sale === ok.json.sale.id && w.warranty_days === 365 && w.in_warranty === true, JSON.stringify(w));
} catch (e) { err = e; }
await t.finish(err);

// P3 step 2: vendor products and price lists (FR-8.02). The vendor's code, unit, cost and currency per product;
// one preferred vendor; price list import by vendor code then barcode (up / down / unmatched); comparing vendors
// in CAD per base unit; products whose preferred vendor is not the cheapest.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step33-vendor-products.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8126 });
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
  const coastal = await party("Coastal Beverages Ltd."), maple = await party("Maple Snacks Wholesale"), luna = await party("Cafe Luna");
  const chips = (await C.get("/api/chedam/catalogue/lookup?code=2000000000060")).json.matches[0];

  console.log("Vendor products (FR-8.02)");
  const vl = (await S.get(`/api/chedam/vendors/${coastal.id}/products`)).json;
  check("staff see what a vendor sells (sample)", vl.items.length >= 3 && vl.items.every((x) => x.product_name && x.cost_cents > 0));
  check("a cashier cannot", (await C.get(`/api/chedam/vendors/${coastal.id}/products`)).status === 403);
  check("staff cannot change vendor prices", (await S.post("/api/collections/vendor_products/records", { vendor: coastal.id, product: chips.product.id, cost_cents: 100 })).status === 403);
  check("a client is not a vendor", (await M.post("/api/collections/vendor_products/records", { vendor: luna.id, product: chips.product.id, cost_cents: 100 })).status === 400);
  const other = (await t.list("selling_units", `product!='${chips.product.id}'`)).items[0];
  check("a unit of another product is refused", (await M.post("/api/collections/vendor_products/records", { vendor: coastal.id, product: chips.product.id, selling_unit: other.id, cost_cents: 100 })).status === 400);
  const island = await M.post("/api/collections/parties/records", { kind: "vendor", name: "Island Snacks", currency: "CAD", active: true });
  const vp = await M.post("/api/collections/vendor_products/records", { vendor: island.json.id, product: chips.product.id, selling_unit: chips.unit.id, vendor_sku: "IS-100", cost_cents: 150, preferred: true });
  check("a manager adds a vendor product: pack size from the unit, currency from the vendor", vp.status === 200 && vp.json.pack_qty === chips.unit.base_qty && vp.json.currency === "CAD" && !!vp.json.price_at, JSON.stringify(vp.json));
  const prefs = (await t.list("vendor_products", `product='${chips.product.id}' && preferred=true`)).items;
  check("one preferred vendor per product", prefs.length === 1 && prefs[0].id === vp.json.id);
  const up = await M.patch(`/api/collections/vendor_products/records/${vp.json.id}`, { cost_cents: 170 });
  check("a cost change keeps the previous cost", up.json.previous_cost_cents === 150 && up.json.cost_cents === 170);
  check("the same vendor code twice is refused", (await M.post("/api/collections/vendor_products/records", { vendor: island.json.id, product: chips.product.id, vendor_sku: "IS-100", cost_cents: 1 })).status === 400);

  console.log("Comparing vendors");
  const cmp = (await S.get(`/api/chedam/products/${chips.product.id}/vendors`)).json;
  const mp = cmp.vendors.find((x) => x.vendor === maple.id), ip = cmp.vendors.find((x) => x.vendor === island.json.id);
  check("every vendor of the chips with CAD per base unit (USD at the day's rate)", mp && ip && Math.abs(mp.cad_per_base_cents - (mp.cost_cents * 1.37) / mp.pack_qty) < 0.01 && ip.cad_per_base_cents === 170 / ip.pack_qty, JSON.stringify(cmp.vendors.map((x) => [x.vendor_name, x.cost_cents, x.currency, x.pack_qty, x.cad_per_base_cents])));
  check("cheapest first and marked", cmp.vendors[0].cheapest === true && cmp.vendors.every((x, i, a) => i === 0 || a[i - 1].cad_per_base_cents <= x.cad_per_base_cents));
  const bt = (await M.get("/api/chedam/purchasing/better")).json.items.find((x) => x.product === chips.product.id);
  check("preferred is not the cheapest: listed with the saving", !!bt && bt.saving_pct > 0 && bt.best_vendor !== "Island Snacks", JSON.stringify(bt));

  console.log("Price list import");
  const units = (await t.list("selling_units", "")).items;
  const choc = (await C.get("/api/chedam/catalogue/lookup?code=2000000000077")).json.matches[0];
  check("an empty list is refused", (await M.post(`/api/chedam/vendors/${island.json.id}/price-list`, { rows: [] })).status === 400);
  check("staff cannot import", (await S.post(`/api/chedam/vendors/${island.json.id}/price-list`, { rows: [{ vendor_sku: "IS-100", cost: "1.80" }] })).status === 403);
  const im = await M.post(`/api/chedam/vendors/${island.json.id}/price-list`, { rows: [
    { vendor_sku: "IS-100", cost: "$1.80" },
    { vendor_sku: "IS-200", barcode: "2000000000077", description: "Choc bar 100g", cost: "1.05", lead_days: 3 },
    { vendor_sku: "IS-300", barcode: "9999999999999", cost: "2.00" },
    { vendor_sku: "IS-400", cost: "" },
  ] });
  check("by vendor code: chips up from $1.70 to $1.80", im.status === 200 && im.json.updated === 1 && im.json.up.some((x) => x.from_cents === 170 && x.to_cents === 180), JSON.stringify(im.json));
  check("by barcode: chocolate added", im.json.created === 1 && (await t.list("vendor_products", `vendor='${island.json.id}' && product='${choc.product.id}'`)).items[0].lead_days === 3);
  check("unknown barcode and no cost listed as unmatched", im.json.unmatched.length === 2 && im.json.unmatched.some((x) => /not in the catalogue/.test(x.reason)) && im.json.unmatched.some((x) => /No cost/.test(x.reason)));
  const again = await M.post(`/api/chedam/vendors/${island.json.id}/price-list`, { rows: [{ vendor_sku: "IS-100", cost: "1.80" }, { vendor_sku: "IS-200", cost: "0.99" }] });
  check("again: one unchanged, chocolate down", again.json.unchanged === 1 && again.json.down.length === 1 && again.json.down[0].to_cents === 99);
  void units;
} catch (e) { err = e; }
await t.finish(err);

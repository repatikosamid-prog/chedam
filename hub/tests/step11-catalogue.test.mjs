// P1 step 1: catalogue and tax tables. Reference data, sample catalogue, BR-07 Draft/Active rules,
// packs and nesting (base_qty), barcode/PLU uniqueness, "packs or singles?" lookup, price history,
// prices.edit (DL-67), the Drafts task (BR-08), tax rates by effective date (FR-4.02, 12.03).
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step11-catalogue.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB, rid } from "./lib/hub.mjs";

const t = new TestHub({ port: 8104 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const newId = () => rid(8).slice(0, 15).replace(/[^a-z0-9]/g, "a").padEnd(15, "0");

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const d = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: d })).json.token;
  };
  const owner = await login("Demo Owner"), manager = await login("Mira Manager"), cashier = await login("Cal Cashier"), staff = await login("Sam Staff");
  const as = (tok) => ({
    get: (p) => t.api("GET", p, null, { token: tok }),
    post: (p, b) => t.api("POST", p, b, { token: tok }),
    patch: (p, b) => t.api("PATCH", p, b, { token: tok }),
  });
  const one = async (col, filter) => (await t.list(col, filter)).items[0];
  const cls = Object.fromEntries((await t.list("tax_classes")).items.map((c) => [c.code, c.id]));
  const cats = Object.fromEntries((await t.list("categories")).items.map((c) => [c.name, c.id]));
  const draftTask = async () => (await t.list("tasks", "rule_key='catalogue:drafts' && status='open'")).items;

  console.log("Reference data");
  check("4 standard tax classes, pending review", Object.keys(cls).length === 4 && (await t.list("tax_classes")).items.every((c) => c.pending_review && !c.is_custom));
  const rates = (await t.list("tax_rates")).items;
  check("GST 5% federal and BC PST 7%, pending review", rates.length === 2 && rates.some((r) => r.rate === 5 && r.province === "") && rates.some((r) => r.rate === 7 && r.province === "BC") && rates.every((r) => r.pending_review));
  const perms = async (tok) => (await as(tok).get("/api/chedam/access/me")).json.permissions;
  const mp = await perms(manager), sp = await perms(staff), cp = await perms(cashier);
  const has = (p, c) => Array.isArray(p) ? p.includes(c) : !!(p && p[c]);
  check("manager: catalogue.edit, prices.edit, tax.manage", has(mp, "catalogue.edit") && has(mp, "prices.edit") && has(mp, "tax.manage"), JSON.stringify(mp).slice(0, 200));
  check("staff: catalogue.edit only", has(sp, "catalogue.edit") && !has(sp, "prices.edit") && !has(sp, "tax.manage"));
  check("cashier: none of them", !has(cp, "catalogue.edit") && !has(cp, "prices.edit"));

  console.log("Sample catalogue");
  const prods = (await t.list("products")).items;
  check("11 active products and 1 draft", prods.filter((p) => p.status === "active").length === 11 && prods.filter((p) => p.status === "draft").length === 1);
  const mango = prods.find((p) => p.name.startsWith("Mangoes"));
  check("draft has its reasons", Array.isArray(mango.draft_reasons) && mango.draft_reasons.some((r) => r.field === "price_cents"), JSON.stringify(mango.draft_reasons));
  let dt = await draftTask();
  check("one open Drafts task (BR-08)", dt.length === 1 && dt[0].title.startsWith("1 product"), JSON.stringify(dt));
  check("cashier can read products", (await as(cashier).get("/api/collections/products/records")).status === 200);

  console.log("Lookup (scan)");
  const cola = await as(cashier).get("/api/chedam/catalogue/lookup?code=2000000000022");
  check("cola single: one sellable match", cola.status === 200 && cola.json.matches.length === 1 && cola.json.matches[0].sellable && cola.json.choose === false, JSON.stringify(cola.json));
  const caseU = (await as(cashier).get("/api/chedam/catalogue/lookup?code=2000000000046")).json.matches[0];
  check("cola case base_qty = 24 (2 x 12-pack x 1)", caseU && caseU.unit.base_qty === 24, JSON.stringify(caseU));
  const water = await as(cashier).get("/api/chedam/catalogue/lookup?code=2000000000053");
  check("shared barcode: packs or singles? (FR-6.03)", water.json.matches.length === 2 && water.json.choose === true);
  const ban = await as(cashier).get("/api/chedam/catalogue/lookup?code=4011");
  check("PLU 4011: bananas per kg", ban.json.matches.length === 1 && ban.json.matches[0].via === "plu" && ban.json.matches[0].unit.kind === "weight");
  const mg = await as(cashier).get("/api/chedam/catalogue/lookup?code=2000000000114");
  check("draft found but not sellable", mg.json.matches.length === 1 && mg.json.matches[0].sellable === false);
  check("unknown code: no match", (await as(cashier).get("/api/chedam/catalogue/lookup?code=9999999999999")).json.matches.length === 0);
  check("bad code refused", (await as(cashier).get("/api/chedam/catalogue/lookup?code=" + encodeURIComponent("12;34"))).status === 400);
  check("signed out: refused", (await t.api("GET", "/api/chedam/catalogue/lookup?code=4011")).status === 401);

  console.log("Product view and taxes");
  const colaId = cola.json.matches[0].product.id;
  const cv = await as(cashier).get("/api/chedam/catalogue/products/" + colaId);
  check("cola: GST 5% + PST 7%, no problems", cv.status === 200 && cv.json.taxes.map((x) => x.code + x.rate).join() === "GST5,PST7" && cv.json.problems.length === 0, JSON.stringify(cv.json.taxes));
  const chips = prods.find((p) => p.name.startsWith("Potato"));
  check("chips: GST only", (await as(cashier).get("/api/chedam/catalogue/products/" + chips.id)).json.taxes.map((x) => x.code).join() === "GST");
  const banId = ban.json.matches[0].product.id;
  check("bananas (zero-rated): no tax", (await as(cashier).get("/api/chedam/catalogue/products/" + banId)).json.taxes.length === 0);

  console.log("Finishing the draft closes the Drafts task");
  const mv = (await as(manager).get("/api/chedam/catalogue/products/" + mango.id)).json;
  const fin = await as(manager).post("/api/chedam/catalogue/products", { product: { id: mango.id }, units: [{ id: mv.units[0].id, price_cents: 199 }], activate: true });
  check("manager prices and activates the draft", fin.status === 200 && fin.json.product.status === "active" && fin.json.problems.length === 0, JSON.stringify(fin.json).slice(0, 300));
  dt = await draftTask();
  check("Drafts task closed", dt.length === 0);

  console.log("Staff adds a product from the phone (draft)");
  const sp1 = await as(staff).post("/api/chedam/catalogue/products", {
    product: { name: "Oat milk 1 L", base_unit: "each", category: cats.Dairy, tax_class: cls.zero_rated, cost_cents: 250, perishable: true, shelf_life_days: 30, storage_area: (await one("storage_areas", "name='Cooler'")).id },
    units: [{ name: "Single", kind: "single", barcodes: ["2000000000121"], price_cents: 449, sell_at_pos: true, is_default: true }], activate: true });
  check("staff cannot activate (403, DL-67)", sp1.status === 403, JSON.stringify(sp1.json));
  const sp2 = await as(staff).post("/api/chedam/catalogue/products", {
    product: { name: "Oat milk 1 L", base_unit: "each", category: cats.Dairy, tax_class: cls.zero_rated, cost_cents: 250, perishable: true, shelf_life_days: 30, storage_area: (await one("storage_areas", "name='Cooler'")).id },
    units: [{ name: "Single", kind: "single", barcodes: ["2000000000121"], price_cents: 449, sell_at_pos: true, is_default: true }] });
  check("staff saves it as a draft, no problems left", sp2.status === 200 && sp2.json.product.status === "draft" && sp2.json.problems.length === 0, JSON.stringify(sp2.json).slice(0, 300));
  check("nothing was half-saved by the refused try", (await t.list("products", "name='Oat milk 1 L'")).items.length === 1);
  dt = await draftTask();
  check("Drafts task open again", dt.length === 1);
  check("it is the same task, reopened (no pile of closed copies)", (await t.list("tasks", "rule_key='catalogue:drafts'")).items.length === 1);
  const oatId = sp2.json.product.id;
  check("cashier cannot add products (403)", (await as(cashier).post("/api/chedam/catalogue/products", { product: { name: "X" }, units: [] })).status === 403);

  console.log("Activation rules (BR-07)");
  const inc = await as(manager).post("/api/chedam/catalogue/products", { product: { name: "Mystery item", base_unit: "each" }, units: [], activate: true });
  check("incomplete product cannot be activated: 400 with the list", inc.status === 400 && /category/i.test(inc.json.message) && (inc.json.data.problems || []).length >= 3, JSON.stringify(inc.json));
  check("refused save leaves nothing behind", (await t.list("products", "name='Mystery item'")).items.length === 0);
  const imp = await as(manager).post("/api/chedam/catalogue/products", { product: { name: "Mystery item", base_unit: "each" }, units: [], activate: true, keep_draft: true });
  check("import mode keeps it as a draft with reasons (DL-66)", imp.status === 200 && imp.json.product.status === "draft" && imp.json.product.draft_reasons.length >= 3);
  const act = await as(manager).patch(`/api/collections/products/records/${imp.json.product.id}`, { status: "active" });
  check("generic API: activating an incomplete product refused", act.status === 400, JSON.stringify(act.json));
  check("generic API: staff activation refused (403)", (await as(staff).patch(`/api/collections/products/records/${oatId}`, { status: "active" })).status === 403);
  check("draft_reasons cannot be set by the client", (await as(manager).patch(`/api/collections/products/records/${oatId}`, { draft_reasons: [] })).status === 403);
  const okAct = await as(manager).patch(`/api/collections/products/records/${oatId}`, { status: "active" });
  check("manager activates the complete draft", okAct.status === 200 && okAct.json.status === "active");

  console.log("Packs, nesting and checks");
  const ids = [newId(), newId(), newId(), newId()];
  const juice = await as(manager).post("/api/chedam/catalogue/products", {
    product: { id: ids[0], name: "Juice box 200 mL", base_unit: "each", category: cats.Beverages, tax_class: cls.standard, cost_cents: 40 },
    units: [
      { id: ids[3], name: "Case", kind: "case", contains_qty: 6, contains_unit: ids[2], barcodes: ["2000000000145"], price_cents: 2499, sell_at_pos: true },
      { id: ids[2], name: "4-pack", kind: "pack", contains_qty: 4, contains_unit: ids[1], barcodes: ["2000000000138"], price_cents: 549, sell_at_pos: true },
      { id: ids[1], name: "Single", kind: "single", barcodes: ["2000000000138"], price_cents: 149, sell_at_pos: true, is_default: true },
    ], activate: true });
  const bq = juice.json && Object.fromEntries(juice.json.units.map((u) => [u.name, u.base_qty]));
  check("units in any order with client ids: case = 6 x 4 = 24", juice.status === 200 && bq.Case === 24 && bq["4-pack"] === 4 && bq.Single === 1, JSON.stringify(juice.json).slice(0, 400));
  check("client-made ids kept (offline creation)", juice.json.product.id === ids[0]);
  const clash = await as(manager).post("/api/chedam/catalogue/products", { product: { name: "Fake cola", base_unit: "each" }, units: [{ name: "Single", kind: "single", barcodes: ["2000000000022"], price_cents: 100, sell_at_pos: true }] });
  check("barcode of another product refused (DL-65)", clash.status === 400 && /Cola/.test(clash.json.message), JSON.stringify(clash.json));
  check("PLU already used refused", (await as(manager).post("/api/chedam/catalogue/products", { product: { name: "Other banana", base_unit: "kg", plu: "4011" }, units: [] })).status === 400);
  check("'single' on a kg product refused", (await as(manager).post("/api/chedam/catalogue/products", { product: { name: "Grapes", base_unit: "kg" }, units: [{ name: "x", kind: "single", price_cents: 1 }] })).status === 400);
  check("'by weight' on an each product refused", (await as(manager).post("/api/chedam/catalogue/products", { product: { name: "Soap", base_unit: "each" }, units: [{ name: "x", kind: "weight", price_cents: 1 }] })).status === 400);
  check("pack of 2.5 singles refused (BR-03)", (await as(manager).post("/api/chedam/catalogue/products", { product: { name: "Gum", base_unit: "each" }, units: [{ name: "x", kind: "pack", contains_qty: 2.5, price_cents: 1 }] })).status === 400);
  const loopA = newId(), loopB = newId();
  const loop = await as(manager).post("/api/chedam/catalogue/products", { product: { name: "Loop", base_unit: "each" },
    units: [{ id: loopA, name: "A", kind: "pack", contains_qty: 2, contains_unit: loopB, price_cents: 1 }, { id: loopB, name: "B", kind: "pack", contains_qty: 2, contains_unit: loopA, price_cents: 1 }] });
  check("packs containing each other refused", loop.status === 400, JSON.stringify(loop.json));
  const juiceUnits = Object.fromEntries(juice.json.units.map((u) => [u.name, u.id]));
  const grow = await as(manager).patch(`/api/collections/selling_units/records/${juiceUnits["4-pack"]}`, { contains_qty: 6 });
  const caseNow = (await as(manager).get("/api/chedam/catalogue/products/" + ids[0])).json.units.find((u) => u.name === "Case");
  check("4-pack becomes a 6-pack: the case follows (6 x 6 = 36)", grow.status === 200 && caseNow.base_qty === 36, JSON.stringify(caseNow));
  check("a unit another unit contains cannot be removed", (await as(manager).patch(`/api/collections/selling_units/records/${juiceUnits["4-pack"]}`, { deleted_at: new Date().toISOString() })).status === 400);
  check("nested pack of 1.5 singles refused (BR-03)", (await as(manager).patch(`/api/collections/selling_units/records/${juiceUnits.Case}`, { contains_qty: 1.5 })).status === 400);
  check("barcode with odd characters refused", (await as(manager).post("/api/chedam/catalogue/products", { product: { name: "Odd", base_unit: "each" }, units: [{ name: "x", kind: "single", barcodes: ["12 34"], price_cents: 1 }] })).status === 400);

  console.log("Price changes (DL-67, FR-5.05)");
  const colaSingle = cv.json.units.find((u) => u.name === "Single");
  check("staff cannot change an active price (403)", (await as(staff).patch(`/api/collections/selling_units/records/${colaSingle.id}`, { price_cents: 159 })).status === 403);
  const pc = await as(manager).patch(`/api/collections/selling_units/records/${colaSingle.id}`, { price_cents: 159 });
  check("manager changes the price", pc.status === 200 && pc.json.price_cents === 159);
  const ph0 = (await t.list("price_history", `selling_unit='${colaSingle.id}'`)).items;
  check("first price recorded when the product was created (0 -> 149)", ph0.some((h) => h.old_cents === 0 && h.new_cents === 149));
  const ph = ph0.filter((h) => h.changed_by !== "system:sample");
  check("price history: 149 -> 159 by the manager, with the device", ph.length === 1 && ph[0].old_cents === 149 && ph[0].new_cents === 159 && ph[0].changed_by === "users:" + people["Mira Manager"] && !!ph[0].device_id, JSON.stringify(ph));
  check("staff may change a product's cost", (await as(staff).patch(`/api/collections/products/records/${colaId}`, { cost_cents: 47 })).status === 200);
  const ch = (await t.list("price_history", `product='${colaId}' && field='cost' && changed_by!='system:sample'`)).items;
  check("cost history: 45 -> 47", ch.length === 1 && ch[0].old_cents === 45 && ch[0].new_cents === 47);
  check("price 0 on an active product refused", (await as(manager).patch(`/api/collections/selling_units/records/${colaSingle.id}`, { price_cents: 0 })).status === 400);
  const chipsUnit = (await as(cashier).get("/api/chedam/catalogue/products/" + chips.id)).json.units[0];
  const delLast = await as(manager).patch(`/api/collections/selling_units/records/${chipsUnit.id}`, { deleted_at: new Date().toISOString() });
  check("removing the last unit of an active product refused", delLast.status === 400, JSON.stringify(delLast.json));
  check("base_qty cannot be set by the client", (await as(manager).patch(`/api/collections/selling_units/records/${colaSingle.id}`, { base_qty: 5 })).status === 403);
  check("price history is read-only", (await as(owner).post("/api/collections/price_history/records", { product: colaId, field: "price", old_cents: 1, new_cents: 2 })).status === 403);
  const evs = (await t.list("events", `table_name='selling_units' && record_id='${colaSingle.id}' && action='update'`)).items;
  check("price change is in the event log", evs.some((ev) => (ev.changed || []).includes("price_cents") && ev.actor === "users:" + people["Mira Manager"]));

  console.log("Costs hidden from cashiers (DL-72)");
  const cList = (await as(cashier).get("/api/collections/products/records?perPage=200")).json.items;
  check("cashier: product list has no cost", cList.length > 0 && cList.every((p) => p.cost_cents === undefined), JSON.stringify(cList[0]));
  check("cashier: one product has no cost", (await as(cashier).get(`/api/collections/products/records/${colaId}`)).json.cost_cents === undefined);
  const cView = (await as(cashier).get("/api/chedam/catalogue/products/" + colaId)).json;
  check("cashier: product view has no cost or cost history", cView.product.cost_cents === undefined && cView.price_history.every((h) => h.field !== "cost") && cView.price_history.length > 0);
  const cHist = (await as(cashier).get(`/api/collections/price_history/records?perPage=200&filter=${encodeURIComponent(`product='${colaId}'`)}`)).json.items;
  check("cashier: cost history rows carry no amounts, price rows do", cHist.filter((h) => h.field === "cost").every((h) => h.old_cents === undefined && h.new_cents === undefined)
    && cHist.filter((h) => h.field === "price").every((h) => typeof h.new_cents === "number"), JSON.stringify(cHist));
  check("staff sees costs (receiving)", (await as(staff).get(`/api/collections/products/records/${colaId}`)).json.cost_cents === 47);
  check("manager sees costs in the view", (await as(manager).get("/api/chedam/catalogue/products/" + colaId)).json.product.cost_cents === 47);
  check("manager holds costs.view; cashier does not", has(await perms(cashier), "costs.view") === false && has(await perms(manager), "costs.view"));

  console.log("Tax tables (FR-4.02, FR-12.03)");
  const gst = await one("tax_types", "code='PST'");
  check("cashier cannot add a tax rate (403)", (await as(cashier).post("/api/collections/tax_rates/records", { tax_type: gst.id, province: "BC", rate: 8, effective_from: "2030-01-01 00:00:00.000Z" })).status === 403);
  check("rate with 4 decimals refused (BR-04)", (await as(manager).post("/api/collections/tax_rates/records", { tax_type: gst.id, province: "BC", rate: 7.0001, effective_from: "2030-01-01 00:00:00.000Z" })).status === 400);
  check("end before start refused", (await as(manager).post("/api/collections/tax_rates/records", { tax_type: gst.id, province: "BC", rate: 8, effective_from: "2030-01-01 00:00:00.000Z", effective_to: "2029-01-01 00:00:00.000Z" })).status === 400);
  const fut = await as(manager).post("/api/collections/tax_rates/records", { tax_type: gst.id, province: "BC", rate: 8, effective_from: "2030-01-01 00:00:00.000Z" });
  check("manager adds a future BC PST rate", fut.status === 200);
  const now = (await as(cashier).get("/api/chedam/catalogue/products/" + colaId)).json.taxes;
  const later = (await as(cashier).get("/api/chedam/catalogue/products/" + colaId + "?at=2030-06-01T12:00:00Z")).json.taxes;
  check("today still 7%, from 2030 8% (switches on by itself)", now.find((x) => x.code === "PST").rate === 7 && later.find((x) => x.code === "PST").rate === 8, JSON.stringify([now, later]));
  check("taxable class without tax types refused", (await as(manager).post("/api/collections/tax_classes/records", { code: "odd", name: "Odd", treatment: "taxable", tax_types: [] })).status === 400);
  check("exempt class with a tax type refused", (await as(manager).post("/api/collections/tax_classes/records", { code: "odd", name: "Odd", treatment: "exempt", tax_types: [gst.id] })).status === 400);
  const custom = await as(manager).post("/api/collections/tax_classes/records", { code: "pst_only", name: "PST only", treatment: "taxable", tax_types: [gst.id], is_custom: false });
  check("custom class added and marked custom", custom.status === 200 && custom.json.is_custom === true, JSON.stringify(custom.json));
  check("standard class code cannot change", (await as(owner).patch(`/api/collections/tax_classes/records/${cls.standard}`, { code: "std" })).status === 400);
} catch (e) {
  err = e;
}
await t.finish(err);

/// <reference path="../../pb_data/types.d.ts" />
// DEV ONLY sample catalogue for the Demo Grocery (P1 step 1). Deployed only with deploy.sh --sample-data.
// Barcodes start with 2 (EAN-13 "in-store" range) so they never clash with real products.
// Tax classes follow DL-68 and are pending the accountant (Q1).

const TAG = "system:sample";

const CATEGORIES = [
  // [name, colour]
  ["Produce", "#3f8f3a"], ["Dairy", "#4a7fc1"], ["Bakery", "#b5813a"], ["Beverages", "#c0392b"],
  ["Snacks", "#d68910"], ["Frozen", "#2e86c1"], ["Household", "#7d6e9c"], ["Tobacco and vape", "#5d6d7e"],
];

// [name, category, base_unit, tax_class, cost_cents, extra fields, units, activate]
// units: [name, kind, contains_qty, contains (index of an earlier unit or -1), barcodes, price_cents, default]
const PRODUCTS = [
  ["Bananas", "Produce", "kg", "zero_rated", 110, { plu: "4011", perishable: true, shelf_life_days: 7, storage: "Shelf", scale_ack: true },
    [["per kg", "weight", 0, -1, [], 174, true]], true],
  ["Tomatoes on the vine", "Produce", "kg", "zero_rated", 290, { plu: "4664", perishable: true, shelf_life_days: 6, storage: "Shelf", scale_ack: true },
    [["per kg", "weight", 0, -1, [], 439, true]], true],
  ["Milk 2% 4 L", "Dairy", "each", "zero_rated", 520, { perishable: true, shelf_life_days: 14, storage: "Cooler" },
    [["Single", "single", 0, -1, ["2000000000015"], 649, true]], true],
  ["Sourdough loaf", "Bakery", "each", "zero_rated", 250, { perishable: true, shelf_life_days: 4, storage: "Shelf", pos_button: true },
    [["Single", "single", 0, -1, [], 549, true]], true],
  ["Cola 355 mL can", "Beverages", "each", "standard", 45, { deposit: true },
    [["Single", "single", 0, -1, ["2000000000022"], 149, true],
     ["12-pack", "pack", 12, 0, ["2000000000039"], 899, false],
     ["Case of 2 x 12", "case", 2, 1, ["2000000000046"], 1699, false]], true],
  ["Sparkling water 500 mL", "Beverages", "each", "standard", 60, { deposit: true },
    [["Single", "single", 0, -1, ["2000000000053"], 179, true],
     ["6-pack", "pack", 6, 0, ["2000000000053"], 949, false]], true],
  ["Potato chips 200 g", "Snacks", "each", "gst_only", 190, {},
    [["Single", "single", 0, -1, ["2000000000060"], 399, true]], true],
  ["Chocolate bar 100 g", "Snacks", "each", "standard", 120, {},
    [["Single", "single", 0, -1, ["2000000000077"], 279, true]], true],
  ["Frozen peas 750 g", "Frozen", "each", "zero_rated", 210, { perishable: true, expiry_at_receiving: true, storage: "Freezer" },
    [["Single", "single", 0, -1, ["2000000000084"], 429, true]], true],
  ["Paper towels 6 rolls", "Household", "each", "standard", 600, {},
    [["Single", "single", 0, -1, ["2000000000091"], 1099, true]], true],
  ["Vape pods 2-pack (demo)", "Tobacco and vape", "each", "standard", 900, { age_restricted: true, min_age: 19 },
    [["Single", "single", 0, -1, ["2000000000107"], 1999, true]], true],
  ["Mangoes (new, no price yet)", "Produce", "each", "zero_rated", 95, { perishable: true, shelf_life_days: 5, storage: "Shelf" },
    [["Single", "single", 0, -1, ["2000000000114"], 0, true]], false],
];

function put(app, name, data) {
  const r = new Record(app.findCollectionByNameOrId(name));
  r.load(data);
  r.set("created_by", TAG); r.set("updated_by", TAG); r.set("@actor", TAG);
  app.save(r);
  return r;
}

migrate((app) => {
  const cls = (code) => app.findFirstRecordByData("tax_classes", "code", code).id;
  const area = (name) => app.findFirstRecordByData("storage_areas", "name", name).id;
  const deposit = put(app, "deposits_fees", { name: "Beverage container up to 1 L", kind: "deposit", amount_cents: 10,
    tax_class: cls("exempt"), refundable: true, province: "BC", active: true });
  const catIds = {};
  CATEGORIES.forEach(([name, colour], i) => { catIds[name] = put(app, "categories", { name: name, colour: colour, sort: i + 1, pos_visible: true }).id; });

  PRODUCTS.forEach(([name, cat, baseUnit, taxClass, cost, extra, units, activate]) => {
    const data = { status: "draft", name: name, category: catIds[cat], base_unit: baseUnit, tax_class: cls(taxClass), cost_cents: cost };
    Object.keys(extra).forEach((k) => {
      if (k === "storage") data.storage_area = area(extra.storage);
      else if (k === "deposit") data.deposits_fees = [deposit.id];
      else data[k] = extra[k];
    });
    const p = put(app, "products", data);
    const ids = [];
    units.forEach(([uname, kind, qty, inner, codes, price, def], i) => {
      ids.push(put(app, "selling_units", { product: p.id, name: uname, kind: kind, contains_qty: qty,
        contains_unit: inner >= 0 ? ids[inner] : "", barcodes: codes, price_cents: price, sell_at_pos: true, is_default: def, sort: i + 1 }).id);
    });
    if (activate) {
      p.set("status", "active"); p.set("updated_by", TAG); p.set("@actor", TAG);
      app.save(p);
    }
  });
}, (app) => {
  const mine = (name) => app.findRecordsByFilter(name, "created_by = {:t}", "", 0, 0, { t: TAG });
  const productIds = mine("products").map((p) => p.id);
  productIds.forEach((id) => app.findRecordsByFilter("price_history", "product = {:p}", "", 0, 0, { p: id }).forEach((r) => app.delete(r)));
  // inner units last: packs point at singles
  mine("selling_units").sort((a, b) => b.getInt("sort") - a.getInt("sort")).forEach((r) => app.delete(r));
  mine("products").forEach((r) => app.delete(r));
  mine("categories").forEach((r) => app.delete(r));
  mine("deposits_fees").forEach((r) => app.delete(r));
  app.findRecordsByFilter("tasks", "rule_key = 'catalogue:drafts'", "", 0, 0).forEach((r) => app.delete(r));
});

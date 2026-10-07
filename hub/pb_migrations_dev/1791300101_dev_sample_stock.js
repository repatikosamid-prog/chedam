/// <reference path="../../pb_data/types.d.ts" />
// DEV ONLY sample stock for the Demo Grocery (P1 step 2): a delivery of each sample product, cola in
// sealed cases and loose cans, and one expired milk lot (FEFO, BR-14). deploy.sh --sample-data only.

const TAG = "system:sample";

// [product name, [[unit name, qty]], expiry days from today (null = from shelf life / none), extra expired lot qty]
const STOCK = [
  ["Bananas", [["per kg", 18.5]], 6],
  ["Tomatoes on the vine", [["per kg", 7.25]], 5],
  ["Milk 2% 4 L", [["Single", 12]], 12, 2],
  ["Sourdough loaf", [["Single", 6]], 3],
  ["Cola 355 mL can", [["Case of 2 x 12", 3], ["Single", 10]], null],
  ["Sparkling water 500 mL", [["6-pack", 8], ["Single", 4]], null],
  ["Potato chips 200 g", [["Single", 20]], null],
  ["Chocolate bar 100 g", [["Single", 36]], null],
  ["Frozen peas 750 g", [["Single", 15]], 200],
  ["Paper towels 6 rolls", [["Single", 3]], null],
  ["Vape pods 2-pack (demo)", [["Single", 5]], null],
];

function day(offset) {
  const d = new Date(Date.now() + offset * 86400000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " 00:00:00.000Z";
}

function put(app, name, data) {
  const r = new Record(app.findCollectionByNameOrId(name));
  r.load(data);
  r.set("created_by", TAG); r.set("updated_by", TAG); r.set("@actor", TAG);
  app.save(r);
  return r;
}

migrate((app) => {
  STOCK.forEach(([pname, lines, expiryDays, expired]) => {
    let p;
    try { p = app.findFirstRecordByData("products", "name", pname); } catch (_) { return; }
    const units = app.findRecordsByFilter("selling_units", "product = {:p} && deleted_at = ''", "", 0, 0, { p: p.id });
    const cost = p.getInt("cost_cents");
    let loose = 0, onHand = 0;
    const sealed = {};
    const lots = [];
    lines.forEach(([uname, qty]) => {
      const u = units.find((x) => x.getString("name") === uname);
      const kind = u.getString("kind");
      const base = qty * u.getFloat("base_qty");
      if (kind === "single" || kind === "weight") loose += qty; else sealed[u.id] = qty;
      onHand += base;
      lots.push([u, qty, base]);
    });
    if (expired) { loose += expired; onHand += expired; }
    put(app, "stock_levels", { product: p.id, loose_qty: loose, sealed: sealed, on_hand: Math.round(onHand * 1000) / 1000,
      reserved: 0, incoming: 0, last_received_at: new DateTime() });
    lots.forEach(([u, qty, base]) => {
      const lot = put(app, "stock_lots", { product: p.id, received_qty: base, qty: base, cost_cents: cost, source: "receive",
        expiry_date: expiryDays === null ? "" : day(expiryDays), storage_area: p.getString("storage_area"), received_at: new DateTime() });
      put(app, "stock_movements", { product: p.id, type: "receive", status: "posted", qty_base: base, selling_unit: u.id, unit_qty: qty,
        lot: lot.id, cost_cents: cost, value_cents: Math.round(base * cost), note: "Sample delivery" });
    });
    if (expired) {
      const single = units.find((x) => x.getString("kind") === "single");
      const lot = put(app, "stock_lots", { product: p.id, lot_code: "OLD", received_qty: expired, qty: expired, cost_cents: cost, source: "receive",
        expiry_date: day(-1), storage_area: p.getString("storage_area"), received_at: new DateTime() });
      put(app, "stock_movements", { product: p.id, type: "receive", status: "posted", qty_base: expired, selling_unit: single.id, unit_qty: expired,
        lot: lot.id, cost_cents: cost, value_cents: expired * cost, note: "Sample delivery (expired lot)" });
    }
  });
}, (app) => {
  ["stock_movements", "stock_lots", "stock_levels"].forEach((name) =>
    app.findRecordsByFilter(name, "created_by = {:t}", "", 0, 0, { t: TAG }).forEach((r) => app.delete(r)));
});

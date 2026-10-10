/// <reference path="../../pb_data/types.d.ts" />
// DEV ONLY (sample data): what the sample vendors sell the store (P3 step 2). Each product comes in its
// largest selling unit (a case or pack when it has one), at its own cost; chips and chocolate also from the
// US vendor (in USD), so the comparison has something to show.

const TAG = "system:sample";
const BY = { "Coastal Beverages Ltd.": ["Cola", "Sparkling water", "Milk"], "Fresh Fields Produce": ["Bananas", "Tomatoes", "Sourdough"], "Maple Snacks Wholesale": ["Potato chips", "Chocolate bar"] };
const ALSO = { "Coastal Beverages Ltd.": ["Potato chips", "Chocolate bar", "Paper towels", "Frozen peas"] };

migrate((app) => {
  let n = 100;
  const vendor = (name) => app.findRecordsByFilter("parties", "name = {:n}", "", 1, 0, { n: name })[0];
  const link = (v, word, preferred, fxDiv) => {
    app.findRecordsByFilter("products", "name ~ {:w} && deleted_at = ''", "", 0, 0, { w: word }).forEach((p) => {
      const units = app.findRecordsByFilter("selling_units", "product = {:p} && deleted_at = ''", "-base_qty", 0, 0, { p: p.id });
      const u = units[0];
      if (!u) return;
      const pack = u.getFloat("base_qty") || 1;
      const r = new Record(app.findCollectionByNameOrId("vendor_products"));
      r.load({ vendor: v.id, product: p.id, selling_unit: u.id, pack_qty: pack, currency: v.getString("currency") || "CAD", active: true, preferred: preferred,
        vendor_sku: v.getString("code") + "-" + (n++), description: p.getString("name") + " · " + u.getString("name"),
        cost_cents: Math.max(1, Math.round((p.getInt("cost_cents") || 100) * pack / fxDiv)), min_order_qty: 1, lead_days: v.getString("currency") === "USD" ? 7 : 2 });
      r.set("price_at", new DateTime());
      r.set("created_by", TAG); r.set("updated_by", TAG);
      app.save(r);
    });
  };
  Object.keys(BY).forEach((name) => { const v = vendor(name); if (v) BY[name].forEach((w) => link(v, w, true, v.getString("currency") === "USD" ? 1.6 : 1)); });
  Object.keys(ALSO).forEach((name) => { const v = vendor(name); if (v) ALSO[name].forEach((w) => link(v, w, !["Potato chips", "Chocolate bar"].includes(w), 1)); });
}, (app) => {
  app.findRecordsByFilter("vendor_products", "created_by = 'system:sample'", "", 0, 0).forEach((r) => app.delete(r));
});

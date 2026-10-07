/// <reference path="../../pb_data/types.d.ts" />
// DEV ONLY (sample data): sizes for the sample products, so shelf labels show unit prices (P1 step 7).
// Only products without a size are changed; saving them does not queue labels (no price changes).

const SIZES = {
  "Cola 355 mL can": [355, "ml"], "Milk 2% 4 L": [4, "l"], "Sparkling water 500 mL": [500, "ml"], "Potato chips 200 g": [200, "g"],
  "Chocolate bar 100 g": [100, "g"], "Frozen peas 750 g": [750, "g"], "Paper towels 6 rolls": [6, "each"], "Sourdough loaf": [680, "g"],
};

migrate((app) => {
  Object.keys(SIZES).forEach((name) => {
    app.findRecordsByFilter("products", "name = {:n} && deleted_at = ''", "", 0, 0, { n: name }).forEach((p) => {
      if (p.getFloat("size_qty")) return;
      p.set("size_qty", SIZES[name][0]);
      p.set("size_unit", SIZES[name][1]);
      p.set("updated_by", "system:sample");
      app.save(p);
    });
  });
}, (app) => {
  Object.keys(SIZES).forEach((name) => {
    app.findRecordsByFilter("products", "name = {:n}", "", 0, 0, { n: name }).forEach((p) => {
      if (p.getFloat("size_qty") !== SIZES[name][0] || p.getString("size_unit") !== SIZES[name][1]) return;
      p.set("size_qty", 0); p.set("size_unit", ""); p.set("updated_by", "system:sample");
      app.save(p);
    });
  });
});

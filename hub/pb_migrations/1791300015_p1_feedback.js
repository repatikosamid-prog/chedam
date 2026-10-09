/// <reference path="../../pb_data/types.d.ts" />
// P1 testing feedback (2026-10-09, DL-109..112):
// - what each discount was ("10% off", "$2.00 off") on sale lines, and the sale's own discount, so the
//   sale screen and the receipt say which product got which discount;
// - a device keeps its till number (register_no: Till 1, Till 2...); `number` stays the count of
//   openings (the Z report number). Existing tills get the number of their device, first device = 1;
// - the hub numbers card settlement batches itself (batch_no B-000001...), never twice.
// Down drops exactly what up adds.

const ADD = {
  sale_lines: [{ name: "discount_label", type: "text", max: 40 }],
  sales: [{ name: "cart_discount_cents", type: "number", onlyInt: true }, { name: "cart_discount_label", type: "text", max: 40 }],
  tills: [{ name: "register_no", type: "number", onlyInt: true, min: 0 }, { name: "batch_no", type: "text", max: 20 }],
};
const BATCH_INDEX = "idx_tills_batch_no";

migrate((app) => {
  Object.keys(ADD).forEach((name) => {
    const c = app.findCollectionByNameOrId(name);
    ADD[name].forEach((f) => c.fields.add(new Field(f)));
    if (name === "tills") c.addIndex(BATCH_INDEX, true, "batch_no", "batch_no != ''");
    app.save(c);
  });
  // Till numbers for the tills already there: devices in the order they first opened a till.
  const order = [];
  app.findRecordsByFilter("tills", "id != ''", "opened_at", 0, 0).forEach((t) => {
    const d = t.getString("device");
    if (order.indexOf(d) < 0) order.push(d);
  });
  app.findRecordsByFilter("tills", "id != ''", "opened_at", 0, 0).forEach((t) => {
    t.set("register_no", order.indexOf(t.getString("device")) + 1);
    t.set("updated_by", "system:migration"); t.set("@actor", "system:migration");
    app.save(t);
  });
}, (app) => {
  Object.keys(ADD).forEach((name) => {
    const c = app.findCollectionByNameOrId(name);
    if (name === "tills") c.removeIndex(BATCH_INDEX);
    ADD[name].forEach((f) => c.fields.removeByName(f.name));
    app.save(c);
  });
});

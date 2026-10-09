/// <reference path="../../pb_data/types.d.ts" />
// P2 step 2: near-expiry markdowns (FR-5.11) and staff discounts (FR-5.20). Both are off until a manager
// sets them. Markdowns: % off by days left, per lot; the lot remembers the step its labels were made for.
// Staff discounts: who bought, how much, kept on the sale for the monthly limit and the record.
// Down drops exactly what up adds.

const SETTINGS = [
  ["promotions.markdowns", { enabled: false, perishable_only: true, steps: [{ days: 3, pct: 25 }, { days: 1, pct: 50 }] },
    "Near-expiry markdowns (FR-5.11): % off by days left before the lot's expiry, applied per lot; labels queued"],
  ["sales.staff_discount", { enabled: false, pct: 10, monthly_limit_cents: 10000, on_promotions: false, exclude_categories: [] },
    "Staff discounts (FR-5.20): % off for staff buying for themselves (their PIN), up to a monthly amount per person"],
];

const ADD = {
  stock_lots: [{ name: "markdown_pct", type: "number", min: 0, max: 100 }],                 // markdown step its labels were made for
  label_batch_items: [{ name: "markdown_pct", type: "number", min: 0, max: 100 }],          // a near-expiry sticker: % off
  sales: [{ name: "staff_user", type: "text", max: 64 }, { name: "staff_name", type: "text", max: 80 },
    { name: "staff_discount_cents", type: "number", onlyInt: true }],
  sale_lines: [{ name: "staff_cents", type: "number", onlyInt: true }],
};

migrate((app) => {
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
  Object.keys(ADD).forEach((name) => {
    const c = app.findCollectionByNameOrId(name);
    ADD[name].forEach((f) => c.fields.add(new Field(f)));
    if (name === "sales") c.addIndex("idx_sales_staff", false, "staff_user, completed_at", "staff_user != ''");
    app.save(c);
  });
}, (app) => {
  Object.keys(ADD).forEach((name) => {
    const c = app.findCollectionByNameOrId(name);
    if (name === "sales") c.removeIndex("idx_sales_staff");
    ADD[name].forEach((f) => c.fields.removeByName(f.name));
    app.save(c);
  });
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
});

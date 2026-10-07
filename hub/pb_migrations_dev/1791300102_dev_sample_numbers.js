/// <reference path="../../pb_data/types.d.ts" />
// DEV ONLY (sample data): TEMPORARY business numbers so receipts can be checked before the store's real
// ones are entered (Sreya, 2026-10-07). 999999999 is a placeholder, not a real business. Only empty
// fields are filled, so real numbers entered in Business profile are never overwritten. Replace them in
// Store setup -> Business profile before selling for real.

const TEMP = { gst_number: "999999999 RT0001", pst_number: "PST-9999-9999", business_number: "999999999" };

migrate((app) => {
  app.findRecordsByFilter("business", "id != ''", "", 0, 0).forEach((b) => {
    let changed = false;
    Object.keys(TEMP).forEach((k) => { if (!b.getString(k)) { b.set(k, TEMP[k]); changed = true; } });
    if (changed) { b.set("updated_by", "system:sample"); app.save(b); }
  });
}, (app) => {
  app.findRecordsByFilter("business", "id != ''", "", 0, 0).forEach((b) => {
    let changed = false;
    Object.keys(TEMP).forEach((k) => { if (b.getString(k) === TEMP[k]) { b.set(k, ""); changed = true; } });
    if (changed) { b.set("updated_by", "system:sample"); app.save(b); }
  });
});

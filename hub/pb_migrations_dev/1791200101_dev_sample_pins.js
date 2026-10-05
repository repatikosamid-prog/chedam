/// <reference path="../../pb_data/types.d.ts" />
// DEV ONLY: sign-in PINs for the sample people, so the dev hub and the client can be tried out.
// These are test values for development hubs only (deploy.sh --sample-data); never used in a store.

const PINS = {
  "Demo Owner": "1357",
  "Mira Manager": "2468",
  "Cal Cashier": "1470",
  "Sam Staff": "3690",
  "Ana Accountant": "2581",
};

migrate((app) => {
  Object.keys(PINS).forEach((name) => {
    const u = app.findFirstRecordByData("users", "name", name);
    u.set("pin", PINS[name]);
    u.set("pin_set", true);
    u.set("updated_by", "system:sample");
    app.save(u);
  });
}, (app) => {
  Object.keys(PINS).forEach((name) => {
    try {
      const u = app.findFirstRecordByData("users", "name", name);
      u.set("pin", "");
      u.set("pin_set", false);
      u.set("updated_by", "system:sample");
      app.save(u);
    } catch (_) { /* sample person already removed */ }
  });
});

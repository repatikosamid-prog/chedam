/// <reference path="../../pb_data/types.d.ts" />
// P1 step 1: costs and margins are hidden from people without costs.view (Sreya, 2026-10-06, DL-72):
// cashiers do not see them; staff do (they enter costs when receiving), managers and the accountant do.

const CODE = "costs.view";
const ROLES = ["manager", "accountant", "staff"];

migrate((app) => {
  const p = new Record(app.findCollectionByNameOrId("permissions"));
  p.load({ code: CODE, area: "catalogue", label: "See product costs, margins and cost history", owner_only: false, sensitive: true });
  p.set("created_by", "system"); p.set("updated_by", "system");
  app.save(p);
  ROLES.forEach((code) => {
    const role = app.findFirstRecordByData("roles", "code", code);
    role.set("permissions", role.get("permissions").concat([p.id]));
    role.set("updated_by", "system");
    app.save(role);
  });
}, (app) => {
  let id = "";
  try { id = app.findFirstRecordByData("permissions", "code", CODE).id; } catch (_) { return; }
  ROLES.forEach((code) => {
    const role = app.findFirstRecordByData("roles", "code", code);
    role.set("permissions", role.get("permissions").filter((x) => x !== id));
    role.set("updated_by", "system");
    app.save(role);
  });
  app.delete(app.findRecordById("permissions", id));
});

/// <reference path="../../pb_data/types.d.ts" />
// P0 step 3, Access (FR-1.03, 1.04, 1.09, 1.10, NFR-11).
// - PIN and owner recovery code become bcrypt "password" fields (hidden; never in API output or the log).
// - API rules: an active, not-deleted Chedam user may reach a table; the permission check itself runs
//   in pb_hooks/access.pb.js (role + overrides + BR-33), so one place decides. null = never via the API.
// - Auth token lifetime 12 h (one long shift). Idle auto-lock is enforced by the client (step 5).

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';

// [list, view, create, update, delete]: true = ACTIVE rule (hook decides), false = never (null)
const RULES = {
  business:             [true, true, true, true, false],
  locations:            [true, true, true, true, false],
  settings:             [true, true, true, true, false],
  modules:              [true, true, false, true, false],
  permissions:          [true, true, false, false, false],
  roles:                [true, true, true, true, true],
  users:                [true, true, true, true, false],
  permission_overrides: [true, true, true, true, true],
  devices:              [true, true, true, true, false],
  storage_areas:        [true, true, true, true, false],
  tasks:                [true, true, true, true, false],
  events:               [true, true, false, false, false],
  backups:              [true, true, false, false, false],
  updates:              [true, true, false, false, false],
};

const KEYS = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"];

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("pin_hash");
  users.fields.removeByName("recovery_code_hash");
  users.fields.add(new Field({ name: "pin", type: "password", hidden: true, cost: 10 }));
  users.fields.add(new Field({ name: "pin_set", type: "bool" }));
  users.fields.add(new Field({ name: "recovery_code", type: "password", hidden: true, cost: 10 }));
  users.fields.add(new Field({ name: "recovery_code_created_at", type: "date" }));
  users.authToken.duration = 12 * 3600;
  app.save(users);

  Object.keys(RULES).forEach((name) => {
    const c = app.findCollectionByNameOrId(name);
    RULES[name].forEach((on, i) => { c[KEYS[i]] = on ? ACTIVE : null; });
    app.save(c);
  });
}, (app) => {
  Object.keys(RULES).forEach((name) => {
    const c = app.findCollectionByNameOrId(name);
    KEYS.forEach((k) => { c[k] = null; });
    app.save(c);
  });
  const users = app.findCollectionByNameOrId("users");
  ["pin", "pin_set", "recovery_code", "recovery_code_created_at"].forEach((f) => users.fields.removeByName(f));
  users.fields.add(new Field({ name: "pin_hash", type: "text", max: 200, hidden: true }));
  users.fields.add(new Field({ name: "recovery_code_hash", type: "text", max: 200, hidden: true }));
  users.authToken.duration = 604800;
  app.save(users);
});

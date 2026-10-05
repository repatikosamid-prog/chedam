// P0 step 3 tests: access rules, BR-33, overrides, PIN sign-in + lockout, recovery code, who-can.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step3-access.test.mjs
// Uses the dev sample store (pb_migrations_dev) and its seed PINs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB, rid } from "./lib/hub.mjs";

const t = new TestHub({ port: 8092 });
const check = t.check.bind(t);

// Test PINs come from the dev seed file, not from this test.
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const roles = Object.fromEntries((await t.list("roles")).items.map((r) => [r.code, r.id]));
  const perms = Object.fromEntries((await t.list("permissions")).items.map((p) => [p.code, p.id]));
  const as = (token) => ({ get: (p) => t.api("GET", p, null, { token }),
    post: (p, b) => t.api("POST", p, b, { token }), patch: (p, b) => t.api("PATCH", p, b, { token }),
    del: (p) => t.api("DELETE", p, null, { token }) });
  const pinLogin = (name, pin) => t.api("POST", "/api/chedam/auth/pin", { user: people[name], pin });
  const login = async (name) => (await pinLogin(name, PIN[name])).json.token;

  console.log("Sign-in by PIN");
  const pu = (await t.api("GET", "/api/chedam/auth/pin-users")).json;
  check("PIN people listed (5 sample people)", Array.isArray(pu) && pu.length === 5, JSON.stringify(pu));
  check("PIN list has no secrets", !JSON.stringify(pu).includes("$2a$") && !JSON.stringify(pu).includes("pin"));
  const ok = await pinLogin("Cal Cashier", PIN["Cal Cashier"]);
  check("cashier signs in with PIN", ok.status === 200 && !!ok.json.token);
  check("auth response hides pin and recovery code", !JSON.stringify(ok.json).includes("$2a$") && ok.json.record.pin === undefined);
  check("wrong PIN refused", (await pinLogin("Cal Cashier", "9999")).status === 400);

  const owner = await login("Demo Owner");
  const manager = await login("Mira Manager");
  const cashier = await login("Cal Cashier");
  const staff = await login("Sam Staff");
  const accountant = await login("Ana Accountant");
  check("all five roles sign in", [owner, manager, cashier, staff, accountant].every(Boolean));

  console.log("Lockout after 5 wrong tries (NFR-11)");
  let last;
  for (let i = 0; i < 5; i++) last = await pinLogin("Sam Staff", "8642");
  check("5th wrong PIN locks the person (423)", last.status === 423, JSON.stringify(last.json));
  check("right PIN still refused while locked", (await pinLogin("Sam Staff", PIN["Sam Staff"])).status === 423);
  check("cashier cannot unlock (403)", (await as(cashier).post(`/api/chedam/users/${people["Sam Staff"]}/unlock`)).status === 403);
  check("manager unlocks staff", (await as(manager).post(`/api/chedam/users/${people["Sam Staff"]}/unlock`)).status === 200);
  check("staff signs in after unlock", (await pinLogin("Sam Staff", PIN["Sam Staff"])).status === 200);

  console.log("PIN rules");
  for (const bad of ["1111", "1234", "9876", "12", "abcd", "1234567"]) {
    check(`PIN ${bad} rejected`, (await as(cashier).post(`/api/chedam/users/${people["Cal Cashier"]}/pin`, { pin: bad })).status === 400);
  }
  check("cashier sets own new PIN", (await as(cashier).post(`/api/chedam/users/${people["Cal Cashier"]}/pin`, { pin: "4826" })).status === 200);
  check("new PIN works", (await pinLogin("Cal Cashier", "4826")).status === 200);
  check("cashier cannot set another person's PIN", (await as(cashier).post(`/api/chedam/users/${people["Sam Staff"]}/pin`, { pin: "5824" })).status === 403);
  check("manager cannot set the owner's PIN", (await as(manager).post(`/api/chedam/users/${people["Demo Owner"]}/pin`, { pin: "5824" })).status === 403);

  console.log("Who may read and change what");
  check("signed-out request refused (401)", (await t.api("GET", "/api/collections/business/records")).status === 401);
  check("cashier reads business profile", (await as(cashier).get("/api/collections/business/records")).status === 200);
  check("cashier cannot list people", (await as(cashier).get("/api/collections/users/records")).status === 403);
  check("cashier views own record", (await as(cashier).get(`/api/collections/users/records/${people["Cal Cashier"]}`)).status === 200);
  check("cashier cannot view someone else", (await as(cashier).get(`/api/collections/users/records/${people["Sam Staff"]}`)).status === 403);
  check("cashier updates own language", (await as(cashier).patch(`/api/collections/users/records/${people["Cal Cashier"]}`, { language: "fr" })).status === 200);
  check("cashier cannot change own role", (await as(cashier).patch(`/api/collections/users/records/${people["Cal Cashier"]}`, { role: roles.manager })).status === 403);
  check("cashier cannot clear own lockout counter", (await as(cashier).patch(`/api/collections/users/records/${people["Cal Cashier"]}`, { pin_failed_count: 0 })).status === 403);
  check("cashier cannot add a storage area", (await as(cashier).post("/api/collections/storage_areas/records", { name: "X", kind: "shelf" })).status === 403);
  check("staff can add a storage area", (await as(staff).post("/api/collections/storage_areas/records", { name: "Back shelf", kind: "shelf" })).status === 200);
  check("cashier cannot read the audit log", (await as(cashier).get("/api/collections/events/records")).status === 403);
  check("accountant reads the audit log", (await as(accountant).get("/api/collections/events/records")).status === 200);
  check("cashier sees tasks", (await as(cashier).get("/api/collections/tasks/records")).status === 200);
  check("nobody hard-deletes people (rule null)", (await as(owner).del(`/api/collections/users/records/${people["Sam Staff"]}`)).status >= 400);

  console.log("People management and BR-33");
  const nc = await as(manager).post("/api/collections/users/records", { name: "New Cashier " + rid(2), role: roles.cashier });
  check("manager adds a cashier (no email, no password needed)", nc.status === 200, JSON.stringify(nc.json));
  check("new person created_by is the manager", nc.json && nc.json.created_by === `users:${people["Mira Manager"]}`);
  check("manager cannot add an owner", (await as(manager).post("/api/collections/users/records", { name: "X", role: roles.owner })).status === 403);
  check("manager cannot add another manager (same level)", (await as(manager).post("/api/collections/users/records", { name: "X", role: roles.manager })).status === 403);
  check("manager edits a cashier", (await as(manager).patch(`/api/collections/users/records/${nc.json.id}`, { phone: "604-555-0199" })).status === 200);
  check("manager cannot edit the owner", (await as(manager).patch(`/api/collections/users/records/${people["Demo Owner"]}`, { phone: "1" })).status === 403);
  check("manager moves cashier to staff", (await as(manager).patch(`/api/collections/users/records/${nc.json.id}`, { role: roles.staff })).status === 200);
  check("manager cannot change own role", (await as(manager).patch(`/api/collections/users/records/${people["Mira Manager"]}`, { role: roles.owner })).status === 403);
  check("cashier cannot add people", (await as(cashier).post("/api/collections/users/records", { name: "X", role: roles.staff })).status === 403);

  // Suspending signs the person out everywhere
  const ac2 = (await pinLogin("Ana Accountant", PIN["Ana Accountant"])).json.token;
  check("manager suspends accountant", (await as(manager).patch(`/api/collections/users/records/${people["Ana Accountant"]}`, { status: "suspended" })).status === 200);
  check("suspended person's token stops working", (await as(ac2).get("/api/collections/business/records")).status === 401);
  check("suspended person cannot sign in", (await pinLogin("Ana Accountant", PIN["Ana Accountant"])).status === 400);
  await as(manager).patch(`/api/collections/users/records/${people["Ana Accountant"]}`, { status: "active" });
  check("manager cannot suspend themselves", (await as(manager).patch(`/api/collections/users/records/${people["Mira Manager"]}`, { status: "suspended" })).status === 403);

  console.log("Permission overrides (FR-1.10)");
  const ov = await as(manager).post("/api/collections/permission_overrides/records",
    { user: people["Cal Cashier"], permission: perms["events.view"], effect: "allow", reason: "month-end check" });
  check("manager grants cashier events.view", ov.status === 200, JSON.stringify(ov.json));
  check("granted_by stamped by hub", ov.json && ov.json.granted_by === `users:${people["Mira Manager"]}`);
  check("cashier can now read the audit log", (await as(cashier).get("/api/collections/events/records")).status === 200);
  check("manager cannot grant owner-only modules.manage",
    (await as(manager).post("/api/collections/permission_overrides/records", { user: people["Cal Cashier"], permission: perms["modules.manage"], effect: "allow" })).status === 403);
  check("manager cannot change own access",
    (await as(manager).post("/api/collections/permission_overrides/records", { user: people["Mira Manager"], permission: perms["events.view"], effect: "deny" })).status === 403);
  check("manager cannot override the owner",
    (await as(manager).post("/api/collections/permission_overrides/records", { user: people["Demo Owner"], permission: perms["events.view"], effect: "deny" })).status === 403);
  // Owner takes backups.run away from the manager; the manager then cannot hand it out (BR-33)
  check("owner denies manager backups.run",
    (await as(owner).post("/api/collections/permission_overrides/records", { user: people["Mira Manager"], permission: perms["backups.run"], effect: "deny" })).status === 200);
  check("manager cannot grant what they no longer hold",
    (await as(manager).post("/api/collections/permission_overrides/records", { user: people["Cal Cashier"], permission: perms["backups.run"], effect: "allow" })).status === 403);
  check("deny override removes a role permission (staff loses tasks.view)",
    (await as(manager).post("/api/collections/permission_overrides/records", { user: people["Sam Staff"], permission: perms["tasks.view"], effect: "deny" })).status === 200
    && (await as(staff).get("/api/collections/tasks/records")).status === 403);
  const past = new Date(Date.now() - 3600e3).toISOString().replace("T", " ");
  await as(manager).post("/api/collections/permission_overrides/records",
    { user: people["Cal Cashier"], permission: perms["devices.view"], effect: "allow", expires_at: past });
  check("expired override has no effect", (await as(cashier).get("/api/collections/devices/records")).status === 403);
  const future = new Date(Date.now() + 3600e3).toISOString().replace("T", " ");
  await as(manager).post("/api/collections/permission_overrides/records",
    { user: people["Cal Cashier"], permission: perms["devices.view"], effect: "allow", expires_at: future });
  check("override with a future end date works", (await as(cashier).get("/api/collections/devices/records")).status === 200);
  check("cashier cannot list overrides", (await as(cashier).get("/api/collections/permission_overrides/records")).status === 403);

  console.log("Roles");
  check("manager cannot create a role above themselves",
    (await as(manager).post("/api/collections/roles/records", { code: "shift_lead", name: "Shift lead", level: 90, permissions: [] })).status === 403);
  const lead = await as(manager).post("/api/collections/roles/records",
    { code: "shift_lead", name: "Shift lead", level: 60, permissions: [perms["tasks.view"], perms["tasks.manage"]], is_template: true });
  check("manager creates a lower role", lead.status === 200, JSON.stringify(lead.json));
  check("new role is never a template", lead.json && lead.json.is_template === false);
  check("manager cannot edit a role template", (await as(manager).patch(`/api/collections/roles/records/${roles.cashier}`, { description: "x" })).status === 403);
  check("owner role permissions cannot be changed", (await as(owner).patch(`/api/collections/roles/records/${roles.owner}`, { permissions: [] })).status === 403);
  check("role templates cannot be deleted", (await as(owner).del(`/api/collections/roles/records/${roles.staff}`)).status === 403);
  check("unused custom role can be deleted", (await as(manager).del(`/api/collections/roles/records/${lead.json.id}`)).status === 204);

  console.log("Modules, settings, business (owner-only parts)");
  const promo = (await t.list("modules", "module='promotions'")).items[0];
  const sell = (await t.list("modules", "module='sell'")).items[0];
  const later = (await t.list("modules", "module='online_store'")).items[0];
  check("manager cannot switch modules", (await as(manager).patch(`/api/collections/modules/records/${promo.id}`, { enabled: false })).status === 403);
  const off = await as(owner).patch(`/api/collections/modules/records/${promo.id}`, { enabled: false });
  check("owner switches a module off; who/when stamped", off.status === 200 && off.json.enabled_by === `users:${people["Demo Owner"]}`);
  check("core module cannot be switched off", (await as(owner).patch(`/api/collections/modules/records/${sell.id}`, { enabled: false })).status === 403);
  check("later module cannot be switched on", (await as(owner).patch(`/api/collections/modules/records/${later.id}`, { enabled: true })).status === 403);
  check("module label cannot be changed", (await as(owner).patch(`/api/collections/modules/records/${promo.id}`, { label: "x" })).status === 403);
  const sec = (await t.list("settings", "key='security.pin_max_attempts'")).items[0];
  const sched = (await t.list("settings", "key='backup.schedule'")).items[0];
  check("manager cannot change security settings", (await as(manager).patch(`/api/collections/settings/records/${sec.id}`, { value: 99 })).status === 403);
  check("manager changes backup time", (await as(manager).patch(`/api/collections/settings/records/${sched.id}`, { value: "03:00" })).status === 200);
  check("second business profile refused", (await as(owner).post("/api/collections/business/records", { trade_name: "X" })).status === 403);

  console.log("Owner password, lockout and recovery code (FR-1.03)");
  const ownerEmail = "demo-owner@chedam.test";
  const pw1 = "Pw-" + rid(8);
  await t.su_("PATCH", `/api/collections/users/records/${people["Demo Owner"]}`, { password: pw1, passwordConfirm: pw1 });
  const pwLogin = (p) => t.api("POST", "/api/collections/users/auth-with-password", { identity: ownerEmail, password: p });
  check("owner signs in with password", (await pwLogin(pw1)).status === 200);
  for (let i = 0; i < 5; i++) last = await pwLogin("wrong-" + i);
  check("5 wrong passwords lock the owner too", last.status === 423, JSON.stringify(last.json));
  check("superuser unlocks", (await t.su_("POST", `/api/chedam/users/${people["Demo Owner"]}/unlock`)).status === 200);
  const owner2 = (await pwLogin(pw1)).json.token;
  check("cashier has no recovery code", (await as(cashier).post("/api/chedam/owner/recovery-code")).status === 403);
  const rc = await as(owner2).post("/api/chedam/owner/recovery-code");
  check("owner gets a printable recovery code once", rc.status === 200 && /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/.test(rc.json.code), JSON.stringify(rc.json));
  const pw2 = "Pw-" + rid(8);
  check("wrong recovery code refused", (await t.api("POST", "/api/chedam/auth/recover", { email: ownerEmail, code: "AAAAA-AAAAA-AAAAA-AAAAA", new_password: pw2 })).status === 400);
  const rec = await t.api("POST", "/api/chedam/auth/recover", { email: ownerEmail, code: rc.json.code.toLowerCase(), new_password: pw2 });
  check("recovery code + new password signs the owner in", rec.status === 200 && !!rec.json.token, JSON.stringify(rec.json));
  check("new password works", (await pwLogin(pw2)).status === 200);
  check("recovery code works only once", (await t.api("POST", "/api/chedam/auth/recover", { email: ownerEmail, code: rc.json.code, new_password: pw1 })).status === 400);

  console.log("Who can do this? and my permissions");
  const who = await as(manager).get("/api/chedam/access/who-can/events.view");
  const names = (who.json || []).map((w) => w.name + ":" + w.via);
  check("who-can events.view: owner, manager, accountant by role; cashier by override",
    names.includes("Demo Owner:role") && names.includes("Mira Manager:role") && names.includes("Ana Accountant:role") && names.includes("Cal Cashier:override"),
    names.join(", "));
  check("cashier cannot ask who-can", (await as(cashier).get("/api/chedam/access/who-can/events.view")).status === 403);
  const me = await as(cashier).get("/api/chedam/access/me");
  check("my permissions: cashier has tasks.view (role) and events.view (override)",
    me.status === 200 && me.json.permissions["tasks.view"].via === "role" && me.json.permissions["events.view"].via === "override");
  const mgr = await as(manager).get(`/api/chedam/access/users/${people["Mira Manager"]}`);
  check("manager's backups.run is gone (deny override)", mgr.status === 200 && !mgr.json.permissions["backups.run"]);

  console.log("Audit trail");
  const evs = (await t.list("events")).items;
  const dump = JSON.stringify(evs);
  check("no bcrypt hashes anywhere in the log", !dump.includes("$2a$") && !dump.includes("$2b$"));
  check("lockouts are in the log (pin_locked_until changes)", evs.some((e) => e.table_name === "users" && (e.changed || []).includes("pin_locked_until")));
  check("overrides are in the log", evs.filter((e) => e.table_name === "permission_overrides" && e.action === "create").length >= 4);
  check("module switch logged with the owner as actor",
    evs.some((e) => e.table_name === "modules" && e.record_id === promo.id && e.actor === `users:${people["Demo Owner"]}`));
} catch (e) {
  err = e;
}
await t.finish(err);

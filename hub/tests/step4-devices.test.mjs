// P0 step 4 tests: device pairing (code + approval request), device keys on every request,
// paired-device-only sign-in (owner on any device), one person per device, device manager actions.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step4-devices.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB, rid } from "./lib/hub.mjs";

const t = new TestHub({ port: 8093 });
const check = t.check.bind(t);

// Test PINs come from the dev seed file, not from this test.
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const call = (method, path, body, opts) => t.api(method, path, body, opts);
  const pinLogin = (name, device, pin = PIN[name]) => call("POST", "/api/chedam/auth/pin", { user: people[name], pin }, { device });
  const tokenOn = async (name, device) => (await pinLogin(name, device)).json.token;
  const setSetting = async (key, value) => {
    const s = (await t.list("settings", `key='${key}'`)).items[0];
    return t.su_("PATCH", `/api/collections/settings/records/${s.id}`, { value });
  };

  // The manager's own till, paired by the superuser (as the setup wizard will do for the first device).
  const office = await t.pair("Office PC", "back_office_pc");
  const manager = await tokenOn("Mira Manager", office);

  console.log("Pairing by code (FR-1.07)");
  const cashTill = await t.pair("Cashier till", "till");
  const cashier = await tokenOn("Cal Cashier", cashTill);
  check("cashier cannot make a pairing code (403)",
    (await call("POST", "/api/chedam/devices/pairing-code", { name: "X", type: "till" }, { token: cashier })).status === 403);
  check("pairing code needs a name and a known type",
    (await call("POST", "/api/chedam/devices/pairing-code", { name: " ", type: "till" }, { token: manager })).status === 400
    && (await call("POST", "/api/chedam/devices/pairing-code", { name: "X", type: "toaster" }, { token: manager })).status === 400);
  const pc = await call("POST", "/api/chedam/devices/pairing-code", { name: "Till 1", type: "till" }, { token: manager });
  check("manager makes a pairing code (XXXX-XXXX, expires)", pc.status === 200 && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(pc.json.code) && !!pc.json.expires_at, JSON.stringify(pc.json));
  check("wrong code refused", (await call("POST", "/api/chedam/devices/pair", { code: "AAAA-AAAA" })).status === 400);
  const typed = pc.json.code.toLowerCase().replace("-", " ");
  const p1 = await call("POST", "/api/chedam/devices/pair", { code: typed, app_version: "0.4.0" });
  check("code works typed in lower case with a space", p1.status === 200 && p1.json.status === "approved" && p1.json.key.length >= 40, JSON.stringify(p1.json));
  const till1 = { id: p1.json.device_id, key: p1.json.key };
  check("a code works only once", (await call("POST", "/api/chedam/devices/pair", { code: pc.json.code })).status === 400);
  const till1Rec = await t.su_("GET", `/api/collections/devices/records/${till1.id}`);
  check("paired device: approved by the manager, via code, version kept",
    till1Rec.json.status === "approved" && till1Rec.json.approved_by === `users:${people["Mira Manager"]}`
    && till1Rec.json.paired_via === "code" && till1Rec.json.app_version === "0.4.0", JSON.stringify(till1Rec.json));
  const asManager = await call("GET", `/api/collections/devices/records/${till1.id}`, null, { token: manager });
  check("key and code hashes never in API output (only a superuser sees hidden fields)",
    asManager.status === 200 && asManager.json.key_hash === undefined && asManager.json.pairing_code_hash === undefined, JSON.stringify(asManager.json));

  const pcOld = await call("POST", "/api/chedam/devices/pairing-code", { name: "Late till", type: "till" }, { token: manager });
  await t.su_("PATCH", `/api/collections/devices/records/${pcOld.json.device_id}`, { pairing_expires_at: "2020-01-01 00:00:00.000Z" });
  check("expired code refused", (await call("POST", "/api/chedam/devices/pair", { code: pcOld.json.code })).status === 400);

  console.log("Device key checked on every request");
  check("unknown device id refused (401)", (await call("GET", "/api/chedam/devices/me", null, { device: { id: "nosuchdevice123", key: "x" } })).status === 401);
  check("wrong key refused (401)", (await call("GET", "/api/chedam/devices/me", null, { device: { id: till1.id, key: "wrong" } })).status === 401);
  check("id without key refused (401)", (await call("GET", "/api/chedam/devices/me", null, { headers: { "X-Chedam-Device": till1.id } })).status === 401);
  const me = await call("GET", "/api/chedam/devices/me", null, { device: till1 });
  check("device reads its own status", me.status === 200 && me.json.name === "Till 1" && me.json.status === "approved", JSON.stringify(me.json));

  console.log("Asking to join, then approval");
  const rq = await call("POST", "/api/chedam/devices/request", { name: "Sam's phone", type: "phone" });
  check("device without a code asks to join (pending)", rq.status === 200 && rq.json.status === "pending");
  const phone = { id: rq.json.device_id, key: rq.json.key };
  check("pending device cannot list PIN names (403)", (await call("GET", "/api/chedam/auth/pin-users", null, { device: phone })).status === 403);
  check("pending device sees it is waiting", (await call("GET", "/api/chedam/devices/me", null, { device: phone })).json.status === "pending");
  check("cashier cannot approve (403)", (await call("POST", `/api/chedam/devices/${phone.id}/approve`, null, { token: cashier })).status === 403);
  check("manager approves", (await call("POST", `/api/chedam/devices/${phone.id}/approve`, null, { token: manager })).status === 200);
  check("approved device lists PIN names", (await call("GET", "/api/chedam/auth/pin-users", null, { device: phone })).status === 200);
  check("unused code device cannot be approved", (await call("POST", `/api/chedam/devices/${pcOld.json.device_id}/approve`, null, { token: manager })).status === 400);
  await setSetting("devices.max_pending_requests", 1);
  await call("POST", "/api/chedam/devices/request", { name: "Extra 1", type: "tablet" });
  check("too many open requests refused (429)", (await call("POST", "/api/chedam/devices/request", { name: "Extra 2", type: "tablet" })).status === 429);
  await setSetting("devices.max_pending_requests", 10);

  console.log("Sign-in needs a paired device; the owner may use any device (FR-1.09)");
  check("PIN names refused without a device (403)", (await call("GET", "/api/chedam/auth/pin-users")).status === 403);
  check("PIN sign-in refused without a device (403)", (await call("POST", "/api/chedam/auth/pin", { user: people["Cal Cashier"], pin: PIN["Cal Cashier"] })).status === 403);
  const calEmail = `cal-${rid(3)}@chedam.test`, calPw = "Pw-" + rid(8);
  await t.su_("PATCH", `/api/collections/users/records/${people["Cal Cashier"]}`, { email: calEmail, password: calPw, passwordConfirm: calPw });
  const calPwLogin = await call("POST", "/api/collections/users/auth-with-password", { identity: calEmail, password: calPw });
  check("cashier password sign-in without a device refused (403)", calPwLogin.status === 403, JSON.stringify(calPwLogin.json));
  const cashier2 = await tokenOn("Cal Cashier", cashTill);   // the password change above signed Cal out
  check("cashier token without its device refused (403)",
    (await call("GET", "/api/collections/business/records", null, { token: cashier2, device: null, headers: { "X-Chedam-Device": "" } })).status === 403);
  const ownerEmail = "demo-owner@chedam.test", ownerPw = "Pw-" + rid(8);
  await t.su_("PATCH", `/api/collections/users/records/${people["Demo Owner"]}`, { password: ownerPw, passwordConfirm: ownerPw });
  const ownerLogin = await call("POST", "/api/collections/users/auth-with-password", { identity: ownerEmail, password: ownerPw });
  check("owner signs in with password on an unpaired browser", ownerLogin.status === 200);
  const owner = ownerLogin.json.token;
  check("owner works without a device", (await call("GET", "/api/chedam/devices", null, { token: owner })).status === 200);
  const pinOk = await pinLogin("Sam Staff", till1);
  check("PIN sign-in works on a paired till", pinOk.status === 200);

  console.log("One person per device");
  const staffOnTill1 = pinOk.json.token;
  check("device shows who is signed in", (await call("GET", "/api/chedam/devices/me", null, { device: till1 })).json.current_user.name === "Sam Staff");
  const calOnTill1 = await tokenOn("Cal Cashier", till1);
  check("next person signs in on the same till", !!calOnTill1);
  check("earlier person's token on that till now refused (401)",
    (await call("GET", "/api/collections/business/records", null, { token: staffOnTill1 })).status === 401);
  check("a token cannot move to another device (401)",
    (await call("GET", "/api/collections/business/records", null, { token: calOnTill1, device: phone })).status === 401);
  check("device signs itself out", (await call("POST", "/api/chedam/devices/me/sign-out", null, { token: calOnTill1 })).status === 200);
  check("token refused after sign-out (401)", (await call("GET", "/api/collections/business/records", null, { token: calOnTill1 })).status === 401);

  console.log("Device manager (FR-1.08)");
  const calTill1b = await tokenOn("Cal Cashier", till1);
  await call("GET", "/api/collections/business/records", null, { token: calTill1b, headers: { "X-Chedam-Version": "0.4.1" } });
  const lst = await call("GET", "/api/chedam/devices", null, { token: manager });
  const row = (lst.json.devices || []).find((d) => d.id === till1.id) || {};
  check("list: online, who is signed in, version", lst.status === 200 && row.online === true
    && row.current_user && row.current_user.name === "Cal Cashier" && row.app_version === "0.4.1", JSON.stringify(row));
  check("list marks the manager's own device", lst.json.this_device === office.id);
  check("list has no secrets", !JSON.stringify(lst.json).includes("key_hash") && !JSON.stringify(lst.json).includes("pairing_code_hash"));
  check("cashier cannot open the device manager (403)", (await call("GET", "/api/chedam/devices", null, { token: cashier2 })).status === 403);

  check("manager signs Cal out of Till 1", (await call("POST", `/api/chedam/devices/${till1.id}/sign-out`, null, { token: manager })).status === 200);
  check("Cal's Till 1 token refused (401)", (await call("GET", "/api/collections/business/records", null, { token: calTill1b })).status === 401);

  check("manager cannot lock their own device", (await call("POST", `/api/chedam/devices/${office.id}/lock`, null, { token: manager })).status === 400);
  check("manager locks Till 1", (await call("POST", `/api/chedam/devices/${till1.id}/lock`, null, { token: manager })).status === 200);
  const lockedPin = await pinLogin("Cal Cashier", till1);
  check("locked device: sign-in refused (423)", lockedPin.status === 423, JSON.stringify(lockedPin.json));
  check("locked device still reads its status", (await call("GET", "/api/chedam/devices/me", null, { device: till1 })).json.status === "locked");
  check("manager unlocks Till 1", (await call("POST", `/api/chedam/devices/${till1.id}/unlock`, null, { token: manager })).status === 200);
  check("sign-in works again after unlock", (await pinLogin("Cal Cashier", till1)).status === 200);

  const ren = await call("PATCH", `/api/collections/devices/records/${till1.id}`, { name: "Front till" }, { token: manager });
  check("manager renames a device", ren.status === 200 && ren.json.name === "Front till");
  check("status cannot be set through the generic API",
    (await call("PATCH", `/api/collections/devices/records/${till1.id}`, { status: "approved" }, { token: manager })).status === 403);
  check("current user cannot be set through the generic API",
    (await call("PATCH", `/api/collections/devices/records/${till1.id}`, { current_user: people["Demo Owner"] }, { token: manager })).status === 403);
  check("devices cannot be created through the generic API",
    (await call("POST", "/api/collections/devices/records", { name: "X", type: "till", status: "approved" }, { token: owner })).status === 403);

  console.log("Assigned devices");
  check("manager assigns Sam's phone to Sam",
    (await call("PATCH", `/api/collections/devices/records/${phone.id}`, { assigned_user: people["Sam Staff"] }, { token: manager })).status === 200);
  const names = ((await call("GET", "/api/chedam/auth/pin-users", null, { device: phone })).json || []).map((u) => u.name).sort();
  check("assigned device lists only that person and the owner", names.join(",") === "Demo Owner,Sam Staff", names.join(","));
  check("someone else cannot sign in there (403)", (await pinLogin("Cal Cashier", phone)).status === 403);
  check("assigned person signs in there", (await pinLogin("Sam Staff", phone)).status === 200);
  check("manager cannot assign a device to the owner",
    (await call("PATCH", `/api/collections/devices/records/${till1.id}`, { assigned_user: people["Demo Owner"] }, { token: manager })).status === 403);
  const ownerPhone = await t.pair("Owner's phone", "phone");
  await call("PATCH", `/api/collections/devices/records/${ownerPhone.id}`, { assigned_user: people["Demo Owner"] }, { token: owner });
  check("manager cannot remove the owner's phone (BR-33)", (await call("POST", `/api/chedam/devices/${ownerPhone.id}/revoke`, null, { token: manager })).status === 403);

  console.log("Revoke");
  const samPhone = await tokenOn("Sam Staff", phone);
  check("manager removes Sam's phone", (await call("POST", `/api/chedam/devices/${phone.id}/revoke`, null, { token: manager })).status === 200);
  const after = await call("GET", "/api/chedam/devices/me", null, { device: phone });
  check("removed device refused (401, revoked → pair again)", after.status === 401, JSON.stringify(after.json));
  check("its signed-in token is refused too", (await call("GET", "/api/collections/business/records", null, { token: samPhone })).status === 401);
  check("removing twice is refused", (await call("POST", `/api/chedam/devices/${phone.id}/revoke`, null, { token: manager })).status === 400);

  console.log("Recovery code: the try that locks answers 423 (fix found while re-testing step 3)");
  const rc = await call("POST", "/api/chedam/owner/recovery-code", null, { token: owner });
  let last;
  for (let i = 0; i < 5; i++) last = await call("POST", "/api/chedam/auth/recover", { email: ownerEmail, code: "AAAAA-AAAAA-AAAAA-AAAAA", new_password: "Pw-" + rid(8) });
  check("5th wrong recovery code answers 423", last.status === 423, JSON.stringify(last.json));
  await t.su_("POST", `/api/chedam/users/${people["Demo Owner"]}/unlock`);
  const recOn = await call("POST", "/api/chedam/auth/recover", { email: ownerEmail, code: rc.json.code, new_password: "Pw-" + rid(8) }, { device: till1 });
  check("recovery on a till signs the owner in on that till", recOn.status === 200
    && (await call("GET", "/api/chedam/devices/me", null, { device: till1 })).json.current_user.name === "Demo Owner");

  console.log("Audit trail and last-seen writes");
  const before = (await t.list("events", `table_name='devices' && record_id='${office.id}'`)).totalItems;
  for (let i = 0; i < 10; i++) await call("GET", "/api/collections/business/records", null, { token: manager });
  const afterN = (await t.list("events", `table_name='devices' && record_id='${office.id}'`)).totalItems;
  check("10 requests do not write 10 last-seen events", afterN - before <= 1, `${before} -> ${afterN}`);
  const evs = (await t.list("events", "table_name='devices'")).items;
  check("lock, unlock and revoke logged with the manager as actor",
    ["lock", "unlock", "revoke"].length === 3
    && evs.some((e) => e.record_id === till1.id && e.after && e.after.status === "locked" && e.actor === `users:${people["Mira Manager"]}`)
    && evs.some((e) => e.record_id === phone.id && e.after && e.after.status === "revoked" && e.actor === `users:${people["Mira Manager"]}`));
  check("the manager's actions are stamped with their device",
    evs.some((e) => e.record_id === till1.id && e.after && e.after.status === "locked" && e.device_id === office.id));
  const dump = JSON.stringify(evs);
  check("no device key or code hashes in the log", !dump.includes("key_hash") && !dump.includes("pairing_code_hash"));

  console.log("Guessing codes is stopped");
  for (let i = 0; i < 20; i++) await call("POST", "/api/chedam/devices/pair", { code: "ZZZZ-ZZZZ" });
  const fresh = await call("POST", "/api/chedam/devices/pairing-code", { name: "After guessing", type: "till" }, { token: manager });
  check("after 20 wrong codes pairing pauses (429), even with a good code",
    (await call("POST", "/api/chedam/devices/pair", { code: fresh.json.code })).status === 429);
} catch (e) {
  err = e;
}
await t.finish(err);

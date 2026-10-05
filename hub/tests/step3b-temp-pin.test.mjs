// Forgot PIN (Sreya, 2026-10-05): a manager sets a temporary PIN; the person must choose their own
// new PIN at the next sign-in before doing anything else. The temporary PIN expires.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step3b-temp-pin.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8094 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const dev = {};
  for (const n of Object.keys(people)) dev[n] = await t.pair("Till of " + n);
  const pinLogin = (name, pin) => t.api("POST", "/api/chedam/auth/pin", { user: people[name], pin }, { device: dev[name] });
  const as = (token) => ({ get: (p) => t.api("GET", p, null, { token }), post: (p, b) => t.api("POST", p, b, { token }) });
  const manager = (await pinLogin("Mira Manager", PIN["Mira Manager"])).json.token;
  const sam = people["Sam Staff"];

  console.log("Manager sets a temporary PIN");
  const set = await as(manager).post(`/api/chedam/users/${sam}/pin`, { pin: "5824" });
  check("manager sets Sam's PIN; it is temporary", set.status === 200 && set.json.temporary === true, JSON.stringify(set.json));
  check("Sam's old PIN stops working", (await pinLogin("Sam Staff", PIN["Sam Staff"])).status === 400);
  const tmp = await pinLogin("Sam Staff", "5824");
  check("temporary PIN signs Sam in and says a new PIN is needed", tmp.status === 200 && tmp.json.record.pin_must_change === true, JSON.stringify(tmp.json && tmp.json.record));
  const samTok = tmp.json.token;
  const blocked = await as(samTok).get("/api/collections/tasks/records");
  check("with the temporary PIN nothing else works (403)", blocked.status === 403 && /new PIN/.test(blocked.json.message), JSON.stringify(blocked.json));
  check("Sam can still read who he is", (await as(samTok).get("/api/chedam/access/me")).status === 200);
  check("Sam cannot keep the temporary PIN", (await as(samTok).post(`/api/chedam/users/${sam}/pin`, { pin: "5824" })).status === 400);
  check("PIN rules still apply to the new PIN", (await as(samTok).post(`/api/chedam/users/${sam}/pin`, { pin: "1234" })).status === 400);
  const own = await as(samTok).post(`/api/chedam/users/${sam}/pin`, { pin: "7193" });
  check("Sam chooses his own new PIN", own.status === 200 && own.json.temporary === false);
  check("everything works again with the same sign-in", (await as(samTok).get("/api/collections/tasks/records")).status === 200);
  check("temporary PIN no longer works", (await pinLogin("Sam Staff", "5824")).status === 400);
  const again = await pinLogin("Sam Staff", "7193");
  check("new PIN signs in with no change needed", again.status === 200 && again.json.record.pin_must_change === false);

  console.log("Temporary PIN expires");
  await as(manager).post(`/api/chedam/users/${sam}/pin`, { pin: "5824" });
  await t.su_("PATCH", `/api/collections/users/records/${sam}`, { pin_temp_expires_at: "2020-01-01 00:00:00.000Z" });
  const old = await pinLogin("Sam Staff", "5824");
  check("expired temporary PIN refused with a clear message", old.status === 400 && /expired/.test(old.json.message), JSON.stringify(old.json));

  console.log("Only the hub sets these fields");
  check("Sam cannot clear pin_must_change himself (only by choosing a PIN)",
    (await t.api("PATCH", `/api/collections/users/records/${sam}`, { pin_must_change: false }, { token: again.json.token })).status === 403);
  const evs = JSON.stringify((await t.list("events", `table_name='users' && record_id='${sam}'`)).items);
  check("temporary PIN and change are in the audit log, without hashes",
    evs.includes("pin_must_change") && !evs.includes("$2a$"));
} catch (e) {
  err = e;
}
await t.finish(err);

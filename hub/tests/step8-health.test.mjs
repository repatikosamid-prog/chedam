// P0 step 8: hub health page (FR-12.09). On the PC some readings (temperature, chrony) are not
// available and must show as "unknown" without breaking the page; the Pi is checked after deploy.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step8-health.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8101 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const d = await t.pair("Till of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: d })).json.token;
  };
  const manager = await login("Mira Manager"), cashier = await login("Cal Cashier");

  console.log("Access");
  check("signed out: 401", (await t.api("GET", "/api/chedam/health")).status === 401);
  check("cashier: 403 (no health.view)", (await t.api("GET", "/api/chedam/health", null, { token: cashier })).status === 403);
  const h = await t.api("GET", "/api/chedam/health", null, { token: manager });
  check("manager sees the health page", h.status === 200 && Array.isArray(h.json.items), JSON.stringify(h.json).slice(0, 300));

  console.log("Content");
  const byId = Object.fromEntries((h.json.items || []).map((i) => [i.id, i]));
  for (const id of ["uptime", "temperature", "power", "clock", "internet", "backup", "devices", "queue", "versions", "updates"]) {
    check(`item "${id}" present with a status`, !!byId[id] && ["ok", "warn", "bad", "info"].includes(byId[id].status), JSON.stringify(byId[id]));
  }
  check("writes are saved before they are confirmed (synchronous=FULL)", byId.durability && byId.durability.value === "Yes" && byId.durability.status === "ok", JSON.stringify(byId.durability));
  check("no backup drive yet -> backup is bad and overall is bad", byId.backup.status === "bad" && h.json.overall === "bad");
  check("devices online counts this session's tills", /\d+ of \d+/.test(byId.devices.value) && Number(byId.devices.value.split(" of ")[1]) >= 2);
  check("versions show the schema migration", /Schema 1791\d{6}_/.test(byId.versions.detail), byId.versions.detail);
  check("readings missing on this PC show as unknown or info, never an error", ["unknown"].includes(byId.temperature.value) || /°C/.test(byId.temperature.value));

  console.log("Backup states drive the status");
  const drive = (await t.list("settings", "key='backup.drive'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${drive.id}`, { value: { uuid: "1234-ABCD", label: "Test" } });
  const old = new Date(Date.now() - 30 * 3600e3).toISOString().replace("T", " ");
  await t.su_("POST", "/api/collections/backups/records", { kind: "scheduled", target: "usb", status: "verified", started_at: old, finished_at: old, encrypted: true });
  let b = Object.fromEntries((await t.api("GET", "/api/chedam/health?fresh=1", null, { token: manager })).json.items.map((i) => [i.id, i]));
  check("last good backup 30 h ago -> warn", b.backup.status === "warn" && /30 h ago/.test(b.backup.value), JSON.stringify(b.backup));
  const now = new Date().toISOString().replace("T", " ");
  await t.su_("POST", "/api/collections/backups/records", { kind: "manual", target: "usb", status: "verified", started_at: now, finished_at: now, encrypted: true });
  b = Object.fromEntries((await t.api("GET", "/api/chedam/health?fresh=1", null, { token: manager })).json.items.map((i) => [i.id, i]));
  check("fresh backup -> ok", b.backup.status === "ok", JSON.stringify(b.backup));
  check("restore test never done -> shown as never", b.restore_test.value === "never");

  console.log("Caching");
  const a1 = (await t.api("GET", "/api/chedam/health", null, { token: manager })).json.checked_at;
  const a2 = (await t.api("GET", "/api/chedam/health", null, { token: manager })).json.checked_at;
  check("answers are cached for a few seconds", a1 === a2);
} catch (e) {
  err = e;
}
await t.finish(err);

// P0 step 2 tests: schema v1, reference data, dev sample data, event log.
// Runs a throwaway PocketBase on 127.0.0.1 with a temp data folder; nothing is left behind.
//
// Usage:  node hub/tests/step2-schema-eventlog.test.mjs
// Env:    PB_BIN  path to pocketbase(.exe)  (default: "pocketbase" on PATH)
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const HUB = join(dirname(fileURLToPath(import.meta.url)), "..");
const PB = process.env.PB_BIN || "pocketbase";
const PORT = 8091;
const BASE = `http://127.0.0.1:${PORT}`;

const work = mkdtempSync(join(tmpdir(), "chedam-step2-"));
const dataDir = join(work, "pb_data");
const migDir = join(work, "pb_migrations");
mkdirSync(migDir);
cpSync(join(HUB, "pb_migrations"), migDir, { recursive: true });
cpSync(join(HUB, "pb_migrations_dev"), migDir, { recursive: true });

let failed = 0, passed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${detail}`); }
}

const pbArgs = (extra) => [...extra, `--dir=${dataDir}`, `--migrationsDir=${migDir}`, `--hooksDir=${join(HUB, "pb_hooks")}`];

function startServer(env = {}) {
  const p = spawn(PB, pbArgs(["serve", "--dev", `--http=127.0.0.1:${PORT}`]), {
    env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  p.log = "";
  p.stdout.on("data", (d) => (p.log += d));
  p.stderr.on("data", (d) => (p.log += d));
  return p;
}
async function waitHealthy(p) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("PocketBase did not start:\n" + p.log);
}
async function stopServer(p) {
  if (p.exitCode !== null || p.signalCode !== null) return;
  p.kill();
  await new Promise((r) => p.on("exit", r));
}

let token = "";
async function api(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: token, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty body */ }
  return { status: res.status, json };
}
const list = async (col, filter = "", sort = "") =>
  (await api("GET", `/api/collections/${col}/records?perPage=500&filter=${encodeURIComponent(filter)}&sort=${encodeURIComponent(sort)}`)).json;
const eventsFor = async (table, id) =>
  (await list("events", `table_name='${table}' && record_id='${id}'`, "at")).items;

let server;
try {
  // Superuser with a random password that only this test run knows
  const suEmail = "test@chedam.test";
  const suPass = randomBytes(18).toString("base64url");
  const up = spawnSync(PB, pbArgs(["superuser", "upsert", suEmail, suPass]), { encoding: "utf8" });
  if (up.status !== 0) throw new Error("superuser upsert failed: " + up.stderr + up.stdout);

  server = startServer();
  await waitHealthy(server);
  const auth = await api("POST", "/api/collections/_superusers/auth-with-password", { identity: suEmail, password: suPass });
  token = auth.json.token;
  const suId = auth.json.record.id;

  console.log("Schema and reference data");
  const counts = {};
  for (const c of ["modules", "permissions", "roles", "settings", "business", "locations", "storage_areas", "users", "tasks"]) {
    counts[c] = (await list(c)).totalItems;
  }
  check("22 modules (3 core, 15 switchable, 4 later)", counts.modules === 22, JSON.stringify(counts));
  const mods = (await list("modules")).items;
  check("3 core modules, all on", mods.filter((m) => m.kind === "core" && m.enabled).length === 3);
  check("15 switchable modules", mods.filter((m) => m.kind === "switchable").length === 15);
  check("20 P0 permissions", counts.permissions === 20);
  check("5 role templates", counts.roles === 5);
  const owner = (await list("roles", "code='owner'")).items[0];
  const manager = (await list("roles", "code='manager'")).items[0];
  check("owner has every permission", owner.permissions.length === 20);
  const ownerOnly = (await list("permissions", "owner_only=true")).items.map((p) => p.id);
  check("manager holds no owner-only permission (BR-33)", manager.permissions.every((p) => !ownerOnly.includes(p)));
  // The 12 step-2 keys by name (later steps add their own settings)
  const STEP2_KEYS = ["store.country", "store.province", "store.currency", "store.time_zone", "store.language", "shop_presets",
    "security.pin_max_attempts", "security.pin_lockout_minutes", "security.auto_lock_minutes", "backup.schedule",
    "backup.retention", "updates.install_window"];
  const have = (await list("settings")).items.map((x) => x.key);
  check("12 default settings", STEP2_KEYS.every((k) => have.includes(k)), STEP2_KEYS.filter((k) => !have.includes(k)).join(","));

  console.log("Dev sample data");
  check("sample business + location", counts.business === 1 && counts.locations === 1);
  check("4 storage areas, 5 people, 1 setup task", counts.storage_areas === 4 && counts.users === 5 && counts.tasks === 1);
  const grocery = mods.filter((m) => m.enabled && m.kind === "switchable").map((m) => m.module).sort();
  check("grocery preset modules on (7)", grocery.length === 7, grocery.join(","));

  console.log("Event log");
  // A paired device (step 4): the hub stamps only devices whose key it has checked.
  const code = (await api("POST", "/api/chedam/devices/pairing-code", { name: "Step 2 till", type: "till" })).json.code;
  const paired = (await api("POST", "/api/chedam/devices/pair", { code })).json;
  const DEVICE = paired.device_id;
  const DEV_HEADERS = { "X-Chedam-Device": DEVICE, "X-Chedam-Device-Key": paired.key };
  check("made-up device header refused (401)",
    (await api("GET", "/api/collections/storage_areas/records", null, { "X-Chedam-Device": "testdevice00001" })).status === 401);
  // Client-made id (offline devices create ids) and a forged created_by that must be overwritten
  const cid = "dev" + randomBytes(6).toString("hex");
  const created = await api("POST", "/api/collections/storage_areas/records",
    { id: cid, name: "Back cooler", kind: "cooler", temp_min_c: 1, temp_max_c: 4, active: true, created_by: "forged" },
    DEV_HEADERS);
  check("create with device-made id", created.status === 200 && created.json.id === cid, JSON.stringify(created.json));
  check("created_by stamped by hub, not client", created.json.created_by === `_superusers:${suId}`);
  check("device_id stamped from the verified device", created.json.device_id === DEVICE);

  await api("PATCH", `/api/collections/storage_areas/records/${cid}`, { name: "Back cooler 2", created_by: "forged" },
    DEV_HEADERS);
  await api("PATCH", `/api/collections/storage_areas/records/${cid}`, { deleted_at: new Date().toISOString() });
  const del = await api("DELETE", `/api/collections/storage_areas/records/${cid}`);
  check("hard delete (superuser) allowed", del.status === 204);

  const ev = await eventsFor("storage_areas", cid);
  check("4 events: create, update, update (soft delete), delete",
    ev.map((e) => e.action).join(",") === "create,update,update,delete", ev.map((e) => e.action).join(","));
  check("create event: actor, device, after", ev[0].actor === `_superusers:${suId}` && ev[0].device_id === DEVICE
    && ev[0].before === null && ev[0].after.name === "Back cooler");
  check("update event: before/after and changed fields",
    ev[1].before.name === "Back cooler" && ev[1].after.name === "Back cooler 2"
    && JSON.stringify(ev[1].changed) === '["name"]', JSON.stringify(ev[1].changed));
  check("created_by unchanged by update", ev[1].after.created_by === `_superusers:${suId}`);
  check("soft delete recorded as update of deleted_at", ev[2].changed.includes("deleted_at"));
  check("delete event keeps the last state", ev[3].after === null && ev[3].before.name === "Back cooler 2");
  check("device header missing -> empty device on event", ev[2].device_id === "");

  // Secrets never reach the log
  const pw = randomBytes(12).toString("hex");
  const u = await api("POST", "/api/collections/users/records",
    { name: "Secret Test", password: pw, passwordConfirm: pw, pin: "4826", status: "active" });
  const uev = await eventsFor("users", u.json.id);
  const dump = JSON.stringify(uev);
  check("user create logged", uev.length === 1 && uev[0].action === "create");
  check("hidden fields (PIN bcrypt hash) not in log", !dump.includes("$2a$") && !dump.includes("4826"));
  check("password / tokenKey not in log", !dump.includes(pw) && !dump.includes("tokenKey"));

  // Append-only
  const e0 = ev[0].id;
  const tryPatch = await api("PATCH", `/api/collections/events/records/${e0}`, { actor: "x" });
  const tryDel = await api("DELETE", `/api/collections/events/records/${e0}`);
  check("event cannot be edited (even by superuser)", tryPatch.status === 400);
  check("event cannot be deleted (even by superuser)", tryDel.status === 400);

  // Every logged table write has an event: compare event counts with migration + test writes
  const all = (await list("events", "", "at")).totalItems;
  check("events exist for reference and sample data", all > 80, `total=${all}`);

  console.log("Atomicity (event write fails -> change rolled back)");
  await stopServer(server);
  server = startServer({ CHEDAM_TEST_FAIL_EVENTS: "1" });
  await waitHealthy(server);
  const bad = await api("POST", "/api/collections/storage_areas/records", { name: "Must not exist", kind: "shelf" });
  check("create fails when its event cannot be written", bad.status >= 400, `status=${bad.status}`);
  await stopServer(server);
  server = startServer();
  await waitHealthy(server);
  const ghost = await list("storage_areas", "name='Must not exist'");
  check("record was rolled back (not in table)", ghost.totalItems === 0);
  await stopServer(server);
  server = null;

  console.log("Reversible migrations (NFR-20)");
  // Every Chedam migration: dev pins, dev sample, access, reference data, schema
  const ours = readdirSync(migDir).filter((f) => f.startsWith("17912")).length;
  const down = spawnSync(PB, pbArgs(["migrate", "down", String(ours)]), { input: "y\n", encoding: "utf8" });
  check(`migrate down ${ours} (all Chedam migrations)`, down.status === 0
    && (down.stdout.match(/Reverted/g) || []).length === ours, down.stdout + down.stderr);
  const reup = spawnSync(PB, pbArgs(["migrate", "up"]), { encoding: "utf8" });
  check("migrate up again", reup.status === 0 && reup.stdout.includes("1791200101"), reup.stdout + reup.stderr);
} catch (err) {
  failed++;
  console.log("  FAIL unexpected error:", err.message);
} finally {
  if (failed && server && server.log) {
    console.log("\n--- PocketBase log (last 40 lines) ---\n" + server.log.split("\n").slice(-40).join("\n"));
  }
  if (server) await stopServer(server);
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

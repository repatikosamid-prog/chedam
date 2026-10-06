// Load test for the hub (P0 gate: memory < 150 MB under load, NFR-07/08). Simulates N paired devices
// doing what tills and phones do: connectivity polls, device status, PIN sign-ins (bcrypt), reading
// settings/modules/people, writing records (each write also writes an event), health page, plus bursts.
// Usage: node tools/loadtest/hub-load.mjs <base-url> <superuser-token-file> [devices=10] [minutes=5] [burst=50]
// Run against a throwaway hub (tools/loadtest/pi-loadtest.sh starts one on the Pi), never a store.
import { readFileSync } from "node:fs";

const [base, tokenFile, nDev = "10", minutes = "5", burstArg = "50"] = process.argv.slice(2);
const BURST = Number(burstArg);   // simultaneous audit-log page loads every 30 s
const SU = readFileSync(tokenFile, "utf8").trim();
const DEVICES = Number(nDev), END = Date.now() + Number(minutes) * 60000;
const seed = readFileSync(new URL("../../hub/pb_migrations_dev/1791200101_dev_sample_pins.js", import.meta.url), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

const stats = { ok: 0, err: 0, byStatus: {}, lat: [], fails: {} };
// Each simulated device has its own LAN address, as Caddy reports it to the hub (X-Forwarded-For)
async function call(method, path, body, { token = "", dev = null } = {}) {
  const h = { "Content-Type": "application/json" };
  if (dev && dev.ip) h["X-Forwarded-For"] = dev.ip;
  if (token) h.Authorization = token;
  if (dev) { h["X-Chedam-Device"] = dev.id; h["X-Chedam-Device-Key"] = dev.key; }
  const t0 = performance.now();
  try {
    const r = await fetch(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const json = await r.json().catch(() => null);
    stats.lat.push(performance.now() - t0);
    stats.byStatus[r.status] = (stats.byStatus[r.status] || 0) + 1;
    if (r.ok) stats.ok++;
    else {
      stats.err++;
      const k = `${r.status} ${method} ${path.replace(/[a-z0-9]{15}/g, ":id").replace(/\?.*/, "")} - ${(json && json.message) || ""}`;
      stats.fails[k] = (stats.fails[k] || 0) + 1;
    }
    return { status: r.status, json };
  } catch (e) {
    stats.err++; stats.byStatus.network = (stats.byStatus.network || 0) + 1;
    return { status: 0, json: null };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const su = (m, p, b) => call(m, p, b, { token: SU });

// Setup: people, one paired device per simulated till, PIN sign-in
const people = (await su("GET", "/api/collections/users/records?perPage=50")).json.items;
const names = people.filter((p) => PIN[p.name]).map((p) => p.name);
const tills = [];
for (let i = 0; i < DEVICES; i++) {
  const code = (await su("POST", "/api/chedam/devices/pairing-code", { name: "Load till " + (i + 1), type: "till" })).json.code;
  const p = (await call("POST", "/api/chedam/devices/pair", { code })).json;
  const dev = { id: p.device_id, key: p.key, ip: "192.168.50." + (150 + i) };
  const name = names[i % names.length];
  const user = people.find((x) => x.name === name);
  const tok = (await call("POST", "/api/chedam/auth/pin", { user: user.id, pin: PIN[name] }, { dev })).json.token;
  const perms = (await call("GET", "/api/chedam/access/me", null, { token: tok, dev })).json.permissions || {};
  tills.push({ dev, tok, name, user, canWrite: !!perms["storage.manage"] });
}
console.log(`setup: ${tills.length} devices paired and signed in (${[...new Set(tills.map((t) => t.name))].join(", ")}); ${tills.filter((t) => t.canWrite).length} of them write`);

async function till(t, i) {
  let n = 0;
  while (Date.now() < END) {
    n++;
    const o = { token: t.tok, dev: t.dev };
    await call("GET", "/api/chedam/status", null, { dev: t.dev });
    await call("GET", "/api/chedam/devices/me", null, o);
    await call("GET", "/api/chedam/access/me", null, o);
    await call("GET", "/api/collections/settings/records?perPage=50", null, o);
    await call("GET", "/api/collections/modules/records?perPage=50", null, o);
    await call("GET", "/api/collections/storage_areas/records?perPage=50", null, o);
    // writes (each also writes an event in the same transaction); only roles allowed to (storage.manage)
    const w = !t.canWrite ? {} : await call("POST", "/api/collections/storage_areas/records", { name: `Load ${i}-${n}`, kind: "shelf", active: true }, o);
    if (w.json && w.json.id) await call("PATCH", `/api/collections/storage_areas/records/${w.json.id}`, { active: false }, o);
    if (n % 10 === 0) {     // sign in again now and then (bcrypt, the heaviest request)
      const r = await call("POST", "/api/chedam/auth/pin", { user: t.user.id, pin: PIN[t.name] }, { dev: t.dev });
      if (r.json && r.json.token) t.tok = r.json.token;
    }
    if (i === 0 && n % 5 === 0) await su("GET", "/api/chedam/health?fresh=1");
    await sleep(1000 + Math.random() * 1000);
  }
}

async function bursts() {
  while (Date.now() < END) {
    await sleep(30000);
    if (Date.now() >= END) break;
    const t = tills[0];
    await Promise.all(Array.from({ length: BURST }, (_, k) => call("GET", "/api/collections/events/records?perPage=100&sort=-at&page=" + (1 + (k % 5)), null, { token: t.tok, dev: t.dev })));
  }
}

const t0 = Date.now();
await Promise.all([...tills.map(till), bursts()]);
stats.lat.sort((a, b) => a - b);
const q = (p) => Math.round(stats.lat[Math.min(stats.lat.length - 1, Math.floor(stats.lat.length * p))]);
console.log(JSON.stringify({
  seconds: Math.round((Date.now() - t0) / 1000), devices: DEVICES, requests: stats.ok + stats.err,
  ok: stats.ok, errors: stats.err, by_status: stats.byStatus, failures: stats.fails,
  latency_ms: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round(stats.lat.at(-1) || 0) },
}, null, 2));

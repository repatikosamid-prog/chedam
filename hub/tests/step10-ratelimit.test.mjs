// P0 gate (NFR-08): per-device rate limits keep a flooding device from pushing the hub's memory up.
// Device addresses come from X-Forwarded-For (set by Caddy in front of the hub); 127.0.0.1 is exempt.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step10-ratelimit.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8103 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const dev = await t.pair("Owner till");
  const tok = (await t.api("POST", "/api/chedam/auth/pin", { user: people["Demo Owner"], pin: PIN["Demo Owner"] }, { device: dev })).json.token;
  const get = (path, ip) => t.api("GET", path, null, { token: tok, headers: ip ? { "X-Forwarded-For": ip } : {} });

  console.log("Flooding device (via Caddy, its own address)");
  const flood = await Promise.all(Array.from({ length: 30 }, () => get("/api/collections/events/records?perPage=50&sort=-at", "192.168.50.77")));
  const codes = flood.map((r) => r.status);
  check("audit-log flood: about 10 answered, the rest 429", codes.filter((c) => c === 200).length <= 11 && codes.filter((c) => c === 429).length >= 19,
    JSON.stringify(codes.reduce((a, c) => ((a[c] = (a[c] || 0) + 1), a), {})));
  check("another device is not affected by the flooder", (await get("/api/collections/events/records?perPage=50&sort=-at", "192.168.50.78")).status === 200);
  await sleep(3100);
  check("the flooder is served again after 3 s", (await get("/api/collections/events/records?perPage=50&sort=-at", "192.168.50.77")).status === 200);

  console.log("Normal till pace is never limited");
  let limited = 0;
  for (let i = 0; i < 12; i++) {   // ~4 requests per second for 3 s: above a real till
    for (const p of ["/api/collections/settings/records", "/api/collections/modules/records", "/api/chedam/access/me"]) {
      if ((await get(p, "192.168.50.80")).status === 429) limited++;
    }
    await sleep(250);
  }
  check("a busy till (36 requests in 3 s) gets no 429", limited === 0, "limited " + limited);

  console.log("The hub itself is exempt");
  const local = await Promise.all(Array.from({ length: 30 }, () => get("/api/collections/events/records?perPage=50&sort=-at", "")));
  check("requests from 127.0.0.1 (scripts, health) are not limited", local.every((r) => r.status === 200));
} catch (e) {
  err = e;
}
await t.finish(err);

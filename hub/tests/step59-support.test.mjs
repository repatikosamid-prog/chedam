// P5 step 8: remote support session (FR-12.10). The hub's side, with the root helper played by this test (it
// answers pb_data/support/request.json like /opt/chedam/bin/chedam-support; the helper's own checks run with
// `python hub/system/chedam-support --self-test`): owner only, the support person's key, start for some hours,
// the address and command, logins seen, end now, the end time, a helper that is missing or fails.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step59-support.test.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8152 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM2v3c9yQfJ0hX0eD0wq1o5w8m6l9xYtP0kq3v7uN2aB support@chedam";

// The helper, played here
const H = { mode: "ok", active: false, logins: [], seen: [] };
let last = "", timer = null;
function helper(dir) {
  timer = setInterval(() => {
    const p = join(dir, "request.json");
    if (!existsSync(p)) return;
    const raw = readFileSync(p, "utf8");
    if (raw === last) return;
    last = raw;
    const req = JSON.parse(raw);
    H.seen.push(req);
    let res = { id: req.id, action: req.action, ok: true };
    if (H.mode === "silent") return;
    if (req.action === "start") {
      if (H.mode === "no_cloudflared") res = { id: req.id, ok: false, code: "no_cloudflared", error: "The tunnel program (cloudflared) is not installed on the hub yet." };
      else { H.active = true; Object.assign(res, { host: "quiet-river-sun.trycloudflare.com", user: "chedam-support", until: new Date(Date.now() + req.hours * 3600000).toISOString(), hours: req.hours, started_at: "2026-10-11 10:00:00",
        command: 'ssh -o ProxyCommand="cloudflared access ssh --hostname %h" chedam-support@quiet-river-sun.trycloudflare.com' }); }
    }
    if (req.action === "status") Object.assign(res, { active: H.active, logins: H.logins });
    if (req.action === "stop") { H.active = false; res.stopped = true; }
    writeFileSync(join(dir, "result.json"), JSON.stringify(res));
  }, 100);
}

let err = null;
try {
  check("the helper's own checks (keys, expiry line, tunnel address, logins)", spawnSync("python", [join(HUB, "system", "chedam-support"), "--self-test"], { encoding: "utf8" }).stdout.includes("self-test ok"));
  await t.start();
  const dir = join(t.dataDir, "support");
  mkdirSync(dir, { recursive: true });
  helper(dir);
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const owner = await login("Demo Owner"), manager = await login("Mira Manager");
  const O = { get: (p) => t.api("GET", p, null, { token: owner }), post: (p, b) => t.api("POST", p, b, { token: owner }) };
  const M = { get: (p) => t.api("GET", p, null, { token: manager }), post: (p, b) => t.api("POST", p, b, { token: manager }) };

  console.log("Owner only, the support person's key");
  check("a manager can't see or start support", (await M.get("/api/chedam/support")).status === 403 && (await M.post("/api/chedam/support/start", { hours: 2 })).status === 403);
  check("no key yet: refused", (await O.post("/api/chedam/support/start", { hours: 2 })).status === 400);
  check("not an SSH key: refused", (await O.post("/api/chedam/support/keys", { keys: [{ name: "Sreya", key: "hello" }] })).status === 400);
  const k = await O.post("/api/chedam/support/keys", { keys: [{ name: "Sreya (Chedam support)", key: KEY }] });
  const k2 = await O.post("/api/chedam/support/keys", { add: { name: "Helper two", key: KEY.replace("support@chedam", "two") } });
  const k3 = await O.post("/api/chedam/support/keys", { remove: 1 });
  check("add one, remove one (the others stay)", k2.json.keys.length === 2 && k3.json.keys.length === 1 && k3.json.keys[0].name === "Sreya (Chedam support)");
  check("the key saved, shown by its end only", k.status === 200 && k.json.keys[0].name === "Sreya (Chedam support)" && k.json.keys[0].type === "ssh-ed25519" && !JSON.stringify(k.json).includes("AAAAC3NzaC1lZDI1NTE5AAAAIM2v"));

  console.log("A session");
  H.mode = "no_cloudflared";
  const f = await O.post("/api/chedam/support/start", { hours: 2 });
  check("tunnel program missing: said so, recorded as failed", f.status === 400 && /cloudflared/.test(f.json.message) && (await O.get("/api/chedam/support")).json.history[0].status === "failed");
  H.mode = "ok";
  const s = await O.post("/api/chedam/support/start", { hours: 12 });
  check("on: the address and the command for support", s.status === 200 && s.json.current.status === "active" && s.json.current.host === "quiet-river-sun.trycloudflare.com" && /cloudflared access ssh/.test(s.json.current.command), JSON.stringify(s.json).slice(0, 300));
  const req = H.seen.findLast((x) => x.action === "start");
  check("at most 8 hours; the key is passed to the helper", req.hours === 8 && req.keys[0] === KEY);
  check("one session at a time", (await O.post("/api/chedam/support/start", { hours: 1 })).status === 400);
  H.logins = [{ line: "Oct 11 10:05", from: "::1" }];
  const st = (await O.get("/api/chedam/support?refresh=1")).json;
  check("the support login is seen", st.current.logins.length === 1);
  const stop = await O.post("/api/chedam/support/stop", {});
  check("ended now, by the owner", stop.json.current === null && stop.json.history[0].status === "ended" && stop.json.history[0].ended_by === "Demo Owner" && !H.active);

  console.log("The end time, a silent helper");
  await O.post("/api/chedam/support/start", { hours: 1 });
  const cur = (await t.list("support_sessions", "status='active'")).items[0];
  await t.su_("PATCH", `/api/collections/support_sessions/records/${cur.id}`, { until: new Date(Date.now() - 60000).toISOString().replace("T", " ") });
  const ex = (await O.get("/api/chedam/support")).json;
  check("past the end time: over", ex.current === null && ex.history[0].ended_by === "the end time");
  H.mode = "silent";
  const sl = await O.post("/api/chedam/support/start", { hours: 1 });
  check("no answer from the helper: said so", sl.status === 400 && /did not answer/.test(sl.json.message), JSON.stringify(sl.json));
  const evs = JSON.stringify((await t.list("events", "table_name='support_sessions'")).items);
  check("every session is in the event log", (evs.match(/"action":"create"/g) || []).length >= 4);
} catch (e) { err = e; }
clearInterval(timer);
await t.finish(err);

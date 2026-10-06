// P0 step 9 (hub side): update check (online/USB), install now or in the window, results after the
// restart, automatic rollback reported, failure task, background daily check. A fake helper answers
// like hub/system/chedam-update (request.json -> result.json); the real helper is tested on the Pi.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step9-updates.test.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8102 });
const check = t.check.bind(t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

const helper = { offline: false, installResult: "ok", seen: [] };
let lastId = "";
const pkg = (v) => ({ file: `chedam-app-${v}.tar.gz`, version: v, notes: "Test notes " + v, size: 300000, sha256: "cd".repeat(32), source: "online" });
function startHelper(dir) {
  return setInterval(() => {
    let req;
    try { req = JSON.parse(readFileSync(join(dir, "request.json"), "utf8")); } catch { return; }
    if (req.id === lastId) return;
    lastId = req.id;
    helper.seen.push(req);
    const res = { id: req.id, action: req.action, ok: true };
    if (req.action === "check") {
      if (helper.offline) Object.assign(res, { ok: false, code: "offline", error: "Could not reach the update channel." });
      else Object.assign(res, { latest: "0.9.1", packages: [pkg("0.9.0"), pkg("0.9.1")] });
    }
    if (req.action === "scan") Object.assign(res, { packages: [{ ...pkg("0.9.2"), source: "usb" }], errors: [] });
    if (req.action === "install") {
      if (helper.installResult === "ok") Object.assign(res, { version: req.file.match(/\d+\.\d+\.\d+/)[0], snapshot: "pre-update-x.db", seconds: 12 });
      else Object.assign(res, { ok: false, code: "rolled_back", error: "Update failed and was rolled back: migration error" });
    }
    // An install takes a while (stop, swap, restart, health check)
    setTimeout(() => writeFileSync(join(dir, "result.json"), JSON.stringify(res)), req.action === "install" ? 1500 : 200);
  }, 100);
}

let err = null, timer = null;
try {
  await t.start();
  const udir = join(t.dataDir, "update");
  mkdirSync(udir, { recursive: true });
  timer = startHelper(udir);
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const d = await t.pair("Till of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: d })).json.token;
  };
  const owner = await login("Demo Owner"), manager = await login("Mira Manager"), cashier = await login("Cal Cashier");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const status = async () => (await as(manager).get("/api/chedam/updates/status")).json;
  const waitFor = async (pred) => { for (let i = 0; i < 40; i++) { const s = await status(); if (pred(s)) return s; await sleep(150); } return status(); };

  console.log("Access and online check");
  check("cashier cannot see updates (403)", (await as(cashier).get("/api/chedam/updates/status")).status === 403);
  const c1 = await as(manager).post("/api/chedam/updates/check", {});
  check("manager checks online: 2 updates available", c1.status === 200 && c1.json.available.length === 2, JSON.stringify(c1.json).slice(0, 300));
  check("helper got the channel address (DL-54)", /chedam-releases/.test(helper.seen.at(-1).channel_url || ""));
  check("last check recorded", c1.json.last_check.ok === true && c1.json.last_check.latest === "0.9.1");
  await as(manager).post("/api/chedam/updates/check", {});
  check("checking again does not duplicate records", (await status()).available.length === 2);
  helper.offline = true;
  const off = await as(manager).post("/api/chedam/updates/check", {});
  check("offline check: clear error, recorded", off.status === 400 && /reach/.test(off.json.message) && (await status()).last_check.ok === false);
  helper.offline = false;

  console.log("USB");
  const u = await as(manager).post("/api/chedam/updates/check", { source: "usb" });
  check("USB scan adds 0.9.2 from USB", u.status === 200 && u.json.available.some((x) => x.version === "0.9.2" && x.source === "usb"));

  console.log("Install now (owner only)");
  const v090 = (await status()).available.find((x) => x.version === "0.9.0");
  check("manager cannot install (403)", (await as(manager).post(`/api/chedam/updates/${v090.id}/install`, { when: "now" })).status === 403);
  const inst = await as(owner).post(`/api/chedam/updates/${v090.id}/install`, { when: "now" });
  check("owner installs now: installing", inst.status === 200 && inst.json.status === "installing", JSON.stringify(inst.json));
  const v091id = (await status()).available.find((x) => x.version === "0.9.1").id;
  check("second install refused while one runs (409)", (await as(owner).post(`/api/chedam/updates/${v091id}/install`, { when: "now" })).status === 409);
  await sleep(500);
  check("helper asked to install chedam-app-0.9.0", helper.seen.at(-1).action === "install" && helper.seen.at(-1).file === "chedam-app-0.9.0.tar.gz");
  let s = await waitFor((x) => x.history.find((h) => h.version === "0.9.0").status !== "installing");
  check("result after restart: installed", s.history.find((h) => h.version === "0.9.0").status === "installed");

  console.log("Failed install rolls back and raises a task");
  helper.installResult = "rolled_back";
  const v091 = s.available.find((x) => x.version === "0.9.1");
  await as(owner).post(`/api/chedam/updates/${v091.id}/install`, { when: "now" });
  s = await waitFor((x) => x.history.find((h) => h.version === "0.9.1").status !== "installing");
  const h091 = s.history.find((h) => h.version === "0.9.1");
  check("status rolled_back with the reason", h091.status === "rolled_back" && /rolled back/.test(h091.error) && !!h091.rolled_back_at, JSON.stringify(h091));
  const tasks = (await t.list("tasks", "rule_key='update:failed'")).items;
  check("one urgent task", tasks.length === 1 && tasks[0].priority === "urgent" && tasks[0].status === "open");
  helper.installResult = "ok";

  console.log("Tonight, in the install window");
  const v092 = s.available.find((x) => x.version === "0.9.2");
  const sch = await as(owner).post(`/api/chedam/updates/${v092.id}/install`, { when: "tonight" });
  check("scheduled for the window", sch.status === 200 && sch.json.status === "scheduled");
  const win = (await t.list("settings", "key='updates.install_window'")).items[0];
  await t.su_("POST", "/api/chedam/updates/tick");
  check("outside the window nothing starts", (await status()).history.find((h) => h.version === "0.9.2").status === "scheduled" ||
    (new Date().getHours() >= 2 && new Date().getHours() < 5));
  await t.su_("PATCH", `/api/collections/settings/records/${win.id}`, { value: { start: "00:00", end: "23:59" } });
  await t.su_("POST", "/api/chedam/updates/tick");
  s = await waitFor((x) => x.history.find((h) => h.version === "0.9.2").status === "installed");
  check("inside the window it installs", s.history.find((h) => h.version === "0.9.2").status === "installed");
  check("a good install closes the failure task", (await t.list("tasks", "rule_key='update:failed'")).items.every((x) => x.status === "done"));

  console.log("Daily background check");
  const lc = (await t.list("settings", "key='updates.last_check'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${lc.id}`, { value: { at: "2020-01-01T00:00:00Z", ok: true } });
  const nu = (await t.list("settings", "key='network.check_url'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${nu.id}`, { value: `${t.base}/api/health` });
  await t.su_("GET", "/api/chedam/status?check=1");
  const n0 = helper.seen.length;
  await t.su_("POST", "/api/chedam/updates/tick");
  await sleep(700);
  check("tick sends a background check without waiting", helper.seen.length === n0 + 1 && helper.seen.at(-1).action === "check");
  await t.su_("POST", "/api/chedam/updates/tick");
  const lc2 = (await t.list("settings", "key='updates.last_check'")).items[0].value;
  check("its answer is recorded on the next tick", lc2.ok === true && lc2.latest === "0.9.1", JSON.stringify(lc2));

  console.log("Audit trail");
  const evs = (await t.list("events", "table_name='updates'")).items;
  check("installs and rollbacks are logged", evs.some((e) => e.after && e.after.status === "installed") && evs.some((e) => e.after && e.after.status === "rolled_back"));
} catch (e) {
  err = e;
}
clearInterval(timer);
await t.finish(err);

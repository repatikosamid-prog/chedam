// P0 step 7 (hub side): backup requests and results, records, tasks, schedule, key, restore test.
// The root helper (hub/system/chedam-backup) runs only on the Pi; here a fake helper in this test
// answers the hub's requests the same way (request.json -> result.json).
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step7-backups.test.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8100 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Fake root helper ----------------------------------------------------------------------------
const helper = { mode: "ok", seen: [], on: true };
let lastId = "";
function startHelper(dir) {
  return setInterval(() => {
    if (!helper.on) return;
    let req;
    try { req = JSON.parse(readFileSync(join(dir, "request.json"), "utf8")); } catch { return; }
    if (req.id === lastId) return;
    lastId = req.id;
    helper.seen.push(req);
    const res = { id: req.id, action: req.action, ok: true };
    if (req.action === "drives") res.drives = [{ uuid: "1234-ABCD", label: "SREYA HDD", fstype: "ntfs", size_bytes: 1e12, free_bytes: 5e11, supported: true }];
    if (req.action === "key-init") { writeFileSync(join(dir, "recipient.txt"), "age1testrecipient\n"); Object.assign(res, { created: true, secret: "AGE-SECRET-KEY-1TEST", recipient: "age1testrecipient" }); }
    if (req.action === "key-show") Object.assign(res, { secret: "AGE-SECRET-KEY-1TEST", recipient: "age1testrecipient" });
    if (req.action === "run") {
      if (helper.mode === "missing") Object.assign(res, { ok: false, code: "drive_missing", error: "The backup drive is not plugged in (or not found)." });
      else Object.assign(res, { file_name: "Chedam-Backups/x/chedam-20261005-023000-" + req.kind + ".db.gz.age", size_bytes: 123456, sha256: "ab".repeat(32), free_bytes: 4e11, verified: true });
    }
    if (req.action === "test-restore") Object.assign(res, { file_name: "chedam-20261005-023000-manual.db.gz.age", consistent: true, seconds: 2.5, restored_counts: { users: 5 }, live_counts: { users: 5 } });
    writeFileSync(join(dir, "result.json"), JSON.stringify(res));
  }, 100);
}

let err = null, timer = null;
try {
  await t.start({ CHEDAM_TEST_NO_BACKUP_CRON: "1" });   // the test calls the tick itself
  const bdir = join(t.dataDir, "backup");
  mkdirSync(bdir, { recursive: true });
  timer = startHelper(bdir);
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const dev = {};
  for (const n of ["Demo Owner", "Mira Manager", "Cal Cashier"]) dev[n] = await t.pair("Till of " + n);
  const login = async (n) => (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev[n] })).json.token;
  const owner = await login("Demo Owner"), manager = await login("Mira Manager"), cashier = await login("Cal Cashier");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const waitStatus = async (tok, pred) => {
    for (let i = 0; i < 40; i++) { const s = (await as(tok).get("/api/chedam/backups/status")).json; if (pred(s)) return s; await sleep(150); }
    return (await as(tok).get("/api/chedam/backups/status")).json;
  };

  console.log("Who may see and do what");
  check("cashier cannot see backups (403)", (await as(cashier).get("/api/chedam/backups/status")).status === 403);
  const st0 = await as(manager).get("/api/chedam/backups/status");
  check("manager sees status: no drive, no key yet", st0.status === 200 && !st0.json.drive.uuid && st0.json.key_ready === false, JSON.stringify(st0.json));
  check("backup refused without a drive", (await as(manager).post("/api/chedam/backups/run", {})).status === 400);

  console.log("Drive and key");
  const dr = await as(manager).post("/api/chedam/backups/drives", {});
  check("drive list comes from the helper", dr.status === 200 && dr.json.drives[0].label === "SREYA HDD", JSON.stringify(dr.json));
  check("cashier cannot list drives", (await as(cashier).post("/api/chedam/backups/drives", {})).status === 403);
  check("bad drive id refused", (await as(manager).post("/api/chedam/backups/drive", { uuid: "x; rm -rf /" })).status === 400);
  check("manager chooses the drive", (await as(manager).post("/api/chedam/backups/drive", { uuid: "1234-ABCD", label: "SREYA HDD", fstype: "ntfs" })).status === 200);
  check("backup refused without a key", (await as(manager).post("/api/chedam/backups/run", {})).status === 400);
  check("manager cannot make or see the key (owner only)", (await as(manager).post("/api/chedam/backups/key", {})).status === 403);
  const key = await as(owner).post("/api/chedam/backups/key", {});
  check("owner makes the key and gets the secret once", key.status === 200 && key.json.created && key.json.secret.startsWith("AGE-SECRET-KEY-"), JSON.stringify(key.json));
  check("the secret is not left in the result file", !existsSync(join(bdir, "result.json")) || !readFileSync(join(bdir, "result.json"), "utf8").includes("SECRET"));
  check("owner can show the key again", (await as(owner).post("/api/chedam/backups/key", { show: true })).json.secret === "AGE-SECRET-KEY-1TEST");

  console.log("Back up now");
  const run = await as(manager).post("/api/chedam/backups/run", {});
  check("manager starts a backup (running)", run.status === 200 && run.json.status === "running", JSON.stringify(run.json));
  await sleep(400);   // the fake helper looks every 100 ms
  check("request went to the helper with drive and store", helper.seen.at(-1).action === "run" && helper.seen.at(-1).drive === "1234-ABCD" && !!helper.seen.at(-1).store);
  const s1 = await waitStatus(manager, (s) => s.latest && s.latest.status !== "running");
  check("result recorded: verified, encrypted, file, size", s1.latest.status === "verified" && s1.latest.encrypted && s1.latest.size_bytes === 123456 && /\.db\.gz\.age$/.test(s1.latest.file_name), JSON.stringify(s1.latest));
  check("last good backup shown", s1.last_good && s1.last_good.id === run.json.id);

  console.log("Failure raises one urgent task; success closes it");
  helper.mode = "missing";
  await as(manager).post("/api/chedam/backups/run", {});
  const s2 = await waitStatus(manager, (s) => s.latest && s.latest.status !== "running");
  check("failed backup recorded with the reason", s2.latest.status === "failed" && /not plugged in/.test(s2.latest.error));
  await as(manager).post("/api/chedam/backups/run", {});
  await waitStatus(manager, (s) => s.latest && s.latest.status !== "running");
  let tasks = (await t.list("tasks", "rule_key='backup:failed'")).items;
  check("one open urgent task (not two)", tasks.filter((x) => x.status === "open").length === 1 && tasks[0].priority === "urgent" && /plug in/.test(tasks[0].title), JSON.stringify(tasks));
  helper.mode = "ok";
  await as(manager).post("/api/chedam/backups/run", {});
  await waitStatus(manager, (s) => s.latest && s.latest.status !== "running");
  tasks = (await t.list("tasks", "rule_key='backup:failed'")).items;
  check("next good backup closes the task", tasks.every((x) => x.status === "done"));

  console.log("Nightly schedule");
  const sched = (await t.list("settings", "key='backup.schedule'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${sched.id}`, { value: "00:00" });
  const tick1 = await t.su_("POST", "/api/chedam/backups/tick");
  check("after the scheduled time a nightly backup starts", !!tick1.json.started, JSON.stringify(tick1.json));
  await waitStatus(manager, (s) => s.latest && s.latest.status !== "running");
  check("only once per day", !(await t.su_("POST", "/api/chedam/backups/tick")).json.started);
  await t.su_("PATCH", `/api/collections/settings/records/${sched.id}`, { value: "23:59" });

  console.log("Running job and lost helper");
  helper.on = false;
  const r5 = await as(manager).post("/api/chedam/backups/run", {});
  check("second backup refused while one is running (409)", (await as(manager).post("/api/chedam/backups/run", {})).status === 409);
  await t.su_("PATCH", `/api/collections/backups/records/${r5.json.id}`, { started_at: "2020-01-01 00:00:00.000Z" });
  await t.su_("POST", "/api/chedam/backups/tick");
  const lost = (await t.su_("GET", `/api/collections/backups/records/${r5.json.id}`)).json;
  check("job without an answer for 30 min is marked failed", lost.status === "failed" && /no answer/i.test(lost.error), JSON.stringify(lost));
  helper.on = true;

  console.log("Restore test (owner only)");
  check("manager cannot run a restore test", (await as(manager).post("/api/chedam/backups/test-restore", {})).status === 403);
  const tr = await as(owner).post("/api/chedam/backups/test-restore", {});
  check("owner runs a restore test: consistent", tr.status === 200 && tr.json.ok && tr.json.consistent, JSON.stringify(tr.json));
  const st3 = (await as(manager).get("/api/chedam/backups/status")).json;
  check("last restore test kept for the health page", st3.last_restore_test.ok === true && !!st3.last_restore_test.at);

  console.log("Wizard: first backup completes the setup step");
  const first = await as(owner).post("/api/chedam/backups/run", { first: true });
  check("first backup started", first.status === 200 && first.json.kind === "first_backup");
  await waitStatus(owner, (s) => s.latest && s.latest.status !== "running");
  const steps = Object.fromEntries((await as(owner).get("/api/chedam/setup/status")).json.steps.map((x) => [x.id, x.status]));
  check("setup step 'backup' is done", steps.backup === "done", JSON.stringify(steps));

  console.log("Audit trail");
  const evs = JSON.stringify((await t.list("events", "table_name='backups'")).items);
  check("backup records are in the log", evs.includes("verified") && evs.includes("failed"));
  check("no secret key anywhere in the log", !JSON.stringify((await t.list("events")).items).includes("AGE-SECRET-KEY"));
} catch (e) {
  err = e;
}
clearInterval(timer);
await t.finish(err);

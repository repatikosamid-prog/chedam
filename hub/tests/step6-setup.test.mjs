// P0 step 6: setup wizard on a NEW hub (no sample store): one-time setup code, start (business, owner,
// first device), steps done/skipped, skipped steps become tasks, re-run, the code cannot be reused.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step6-setup.test.mjs
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TestHub, rid } from "./lib/hub.mjs";

const t = new TestHub({ port: 8097, sample: false });
const check = t.check.bind(t);

let err = null;
try {
  await t.start();
  const codeFile = join(t.dataDir, "setup-code");
  console.log("New hub");
  const st = await t.api("GET", "/api/chedam/setup/status");
  check("status says setup is needed (open, no sign-in)", st.status === 200 && st.json.needs_setup === true && st.json.steps === undefined, JSON.stringify(st.json));
  check("setup code file exists", existsSync(codeFile));
  const code = readFileSync(codeFile, "utf8").trim();
  check("code looks like XXXX-XXXX", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), code);
  const issue = readFileSync(join(t.dataDir, "console.issue"), "utf8");
  check("monitor message shows the code and the address", issue.includes(code) && issue.includes("https://\\4"), issue);
  await t.stop();
  await t.start();
  check("code stays the same after a restart", readFileSync(codeFile, "utf8").trim() === code);

  console.log("Start: owner + first device");
  const owner = { name: "Sreya Test", email: `owner-${rid(3)}@chedam.test`, password: "Pw-" + rid(8), pin: "4826" };
  const base = { code, owner, device_name: "Owner phone", device_type: "phone", language: "en" };
  check("wrong code refused", (await t.api("POST", "/api/chedam/setup/start", { ...base, code: "AAAA-AAAA" })).status === 400);
  check("short password refused", (await t.api("POST", "/api/chedam/setup/start", { ...base, owner: { ...owner, password: "short" } })).status === 400);
  check("guessable PIN refused", (await t.api("POST", "/api/chedam/setup/start", { ...base, owner: { ...owner, pin: "1234" } })).status === 400);
  check("bad email refused", (await t.api("POST", "/api/chedam/setup/start", { ...base, owner: { ...owner, email: "nope" } })).status === 400);
  const s1 = await t.api("POST", "/api/chedam/setup/start", { ...base, code: code.toLowerCase() });
  check("start works (code case does not matter)", s1.status === 200 && !!s1.json.token, JSON.stringify(s1.json));
  const meta = (s1.json && s1.json.meta) || {};
  check("returns device id + key and a recovery code once",
    !!meta.device_id && String(meta.key || "").length >= 40 && /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/.test(meta.recovery_code || ""), JSON.stringify(meta));
  check("owner record has no secrets", !JSON.stringify(s1.json.record).includes("$2a$"));
  const dev = { id: meta.device_id, key: meta.key };
  t.tokenDevice.set(s1.json.token, dev);
  const tok = s1.json.token;
  check("code file deleted", !existsSync(codeFile));
  check("monitor message no longer shows the code", !readFileSync(join(t.dataDir, "console.issue"), "utf8").includes(code));
  check("the code cannot be used again", (await t.api("POST", "/api/chedam/setup/start", base)).status === 400);
  const st2 = await t.api("GET", "/api/chedam/setup/status");
  check("status: no longer needs setup", st2.json.needs_setup === false && st2.json.steps === undefined);

  const me = await t.api("GET", "/api/chedam/access/me", null, { token: tok });
  check("signed in as owner on the new device", me.status === 200 && me.json.role.code === "owner" && me.json.user.pin_must_change === false, JSON.stringify(me.json));
  const devMe = await t.api("GET", "/api/chedam/devices/me", null, { device: dev });
  check("first device is approved, paired via setup, owner signed in",
    devMe.json.status === "approved" && devMe.json.paired_via === "setup" && devMe.json.current_user && devMe.json.current_user.name === owner.name, JSON.stringify(devMe.json));
  check("owner PIN works on that device", (await t.api("POST", "/api/chedam/auth/pin", { user: s1.json.record.id, pin: owner.pin }, { device: dev })).status === 200);
  const pw = await t.api("POST", "/api/collections/users/auth-with-password", { identity: owner.email, password: owner.password });
  check("owner password works", pw.status === 200);
  const rec = await t.api("POST", "/api/chedam/auth/recover", { email: owner.email, code: meta.recovery_code, new_password: "Pw-" + rid(8) });
  check("recovery code works", rec.status === 200);
  const otok = rec.json.token;

  console.log("Business, location, steps");
  const biz = (await t.list("business")).items;
  check("one business, language set, Canadian defaults",
    biz.length === 1 && biz[0].language === "en" && biz[0].currency === "CAD" && biz[0].time_zone === "America/Vancouver", JSON.stringify(biz[0]));
  check("primary location created", (await t.list("locations")).items.filter((l) => l.is_primary).length === 1);
  const st3 = await t.api("GET", "/api/chedam/setup/status", null, { token: otok });
  const steps = Object.fromEntries((st3.json.steps || []).map((s) => [s.id, s.status]));
  check("owner sees steps; language, time, owner done", steps.language === "done" && steps.time === "done" && steps.owner === "done" && steps.business === "", JSON.stringify(steps));
  const p = await t.api("PATCH", `/api/collections/business/records/${biz[0].id}`, { trade_name: "Test Mart", legal_name: "Test Mart Ltd." }, { token: otok });
  check("owner edits the business profile", p.status === 200 && p.json.trade_name === "Test Mart");
  check("setup_state cannot be edited directly",
    (await t.api("PATCH", `/api/collections/business/records/${biz[0].id}`, { setup_state: {} }, { token: otok })).status === 403);
  check("step marked done", (await t.api("POST", "/api/chedam/setup/step", { step: "business", status: "done" }, { token: otok })).status === 200);
  check("unknown step refused", (await t.api("POST", "/api/chedam/setup/step", { step: "x", status: "done" }, { token: otok })).status === 400);
  check("step skipped", (await t.api("POST", "/api/chedam/setup/step", { step: "backup", status: "skipped" }, { token: otok })).status === 200);
  await t.api("POST", "/api/chedam/setup/step", { step: "backup", status: "skipped" }, { token: otok });
  let tasks = (await t.list("tasks", "rule_key='setup:backup'")).items;
  check("skipped step became ONE open task", tasks.length === 1 && tasks[0].status === "open" && /backup/i.test(tasks[0].title), JSON.stringify(tasks));
  await t.api("POST", "/api/chedam/setup/step", { step: "backup", status: "done" }, { token: otok });
  tasks = (await t.list("tasks", "rule_key='setup:backup'")).items;
  check("doing it later closes the task", tasks[0].status === "done" && !!tasks[0].closed_at);

  for (const s of ["branding", "people", "storage", "modules", "references"]) {
    await t.api("POST", "/api/chedam/setup/step", { step: s, status: "done" }, { token: otok });
  }
  const fin = await t.api("GET", "/api/chedam/setup/status", null, { token: otok });
  check("all steps done: setup completed", !!fin.json.completed_at, JSON.stringify(fin.json));

  console.log("Who may run it");
  const mgrRole = (await t.list("roles", "code='manager'")).items[0].id;
  const mgr = await t.api("POST", "/api/collections/users/records", { name: "Max Manager", role: mgrRole }, { token: otok });
  check("owner adds a manager", mgr.status === 200, JSON.stringify(mgr.json));
  const tp = await t.api("POST", `/api/chedam/users/${mgr.json.id}/pin`, { pin: "5824" }, { token: otok });
  check("a PIN the owner sets for someone is temporary", tp.json && tp.json.temporary === true);
  const mdev = await t.pair("Office", "back_office_pc");
  const ml = await t.api("POST", "/api/chedam/auth/pin", { user: mgr.json.id, pin: "5824" }, { device: mdev });
  await t.api("POST", `/api/chedam/users/${mgr.json.id}/pin`, { pin: "7193" }, { token: ml.json.token });
  check("a manager cannot mark setup steps (owner only)",
    (await t.api("POST", "/api/chedam/setup/step", { step: "people", status: "done" }, { token: ml.json.token })).status === 403);
  check("start refused once set up", (await t.api("POST", "/api/chedam/setup/start", base)).status === 400);

  console.log("Audit trail");
  const evs = (await t.list("events", "actor='system:setup'")).items;
  const tables = [...new Set(evs.map((e) => e.table_name))].sort().join(",");
  check("setup writes are logged as system:setup", tables === "business,devices,locations,users", tables);
  check("no secrets in the log", !JSON.stringify(evs).includes("$2a$") && !JSON.stringify(evs).includes(meta.key));
} catch (e) {
  err = e;
}
await t.finish(err);

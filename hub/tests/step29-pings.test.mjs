// P2 step 9: pings and the till overlay (FR-2.06, 2.07, BR-42). To one device, all tills, everyone; templates;
// normal pings close per device, urgent ones for all on the first confirmation; replies; withdrawing; urgent
// pings not confirmed in time go to the managers' devices and become a task. Customer displays never get pings.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step29-pings.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8122 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n, name, type = "till") => {
    const code = await t.su_("POST", "/api/chedam/devices/pairing-code", { name, type });
    const p = await t.api("POST", "/api/chedam/devices/pair", { code: code.json.code });
    const dev = { id: p.json.device_id, key: p.json.key, name };
    const tok = (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
    return { dev, tok };
  };
  const t1 = await login("Cal Cashier", "Till 1"), t2 = await login("Sam Staff", "Till 2"), ph = await login("Mira Manager", "Mira's phone", "phone");
  await t.pair("Counter screen", "customer_display");
  const as = (x) => ({ get: (p) => t.api("GET", p, null, { token: x.tok }), post: (p, b) => t.api("POST", p, b, { token: x.tok }) });
  const A = as(t1), B = as(t2), M = as(ph);

  console.log("Sending (FR-2.06, 2.07)");
  const tg = (await A.get("/api/chedam/pings/targets")).json;
  check("targets: groups, other devices (not this one, never the customer display), templates", tg.groups.some((g) => g.target === "till" && g.count === 1)
    && tg.devices.some((d) => d.label === "Till 2") && !tg.devices.some((d) => d.label === "Till 1" || d.label === "Counter screen") && tg.templates.includes("Need help at the till"), JSON.stringify(tg));
  check("an empty ping is refused", (await A.post("/api/chedam/pings", { target: "till", text: "" })).status === 400);
  check("an unknown target is refused", (await A.post("/api/chedam/pings", { target: "printers", text: "x" })).status === 400);
  const p1 = await A.post("/api/chedam/pings", { target: "device:" + t2.dev.id, text: "Price check, please" });
  check("Till 1 pings Till 2", p1.status === 200 && p1.json.to === "Till 2" && p1.json.from === "Cal Cashier");
  const b1 = (await B.get("/api/chedam/pings")).json;
  check("Till 2 has it open", b1.open.some((x) => x.id === p1.json.id));
  check("the phone does not", !(await M.get("/api/chedam/pings")).json.open.some((x) => x.id === p1.json.id));
  check("only a recipient can confirm", (await M.post(`/api/chedam/pings/${p1.json.id}/ack`, {})).status === 403);
  const r1 = await B.post(`/api/chedam/pings/${p1.json.id}/ack`, { reply: "On my way" });
  check("Till 2 replies 'On my way': the sender sees who and the reply", r1.status === 200 && (await A.get("/api/chedam/pings")).json.sent.find((x) => x.id === p1.json.id).acks.some((a) => a.reply === "On my way" && a.name === "Sam Staff"));
  check("closed on Till 2", !(await B.get("/api/chedam/pings")).json.open.some((x) => x.id === p1.json.id));

  console.log("Everyone, urgent");
  const p2 = await A.post("/api/chedam/pings", { target: "everyone", text: "Spill in aisle 3" });
  check("to everyone: Till 2 and the phone, not the sender", (await B.get("/api/chedam/pings")).json.open.some((x) => x.id === p2.json.id) && (await M.get("/api/chedam/pings")).json.open.some((x) => x.id === p2.json.id)
    && !(await A.get("/api/chedam/pings")).json.open.some((x) => x.id === p2.json.id));
  await B.post(`/api/chedam/pings/${p2.json.id}/ack`, {});
  check("a normal ping closes per device: still open on the phone", (await M.get("/api/chedam/pings")).json.open.some((x) => x.id === p2.json.id));
  const p3 = await A.post("/api/chedam/pings", { target: "everyone", text: "Manager to the front", urgent: true });
  await B.post(`/api/chedam/pings/${p3.json.id}/ack`, {});
  check("an urgent ping confirmed by one device is closed for all", !(await M.get("/api/chedam/pings")).json.open.some((x) => x.id === p3.json.id));
  const p4 = await A.post("/api/chedam/pings", { target: "device:" + t2.dev.id, text: "Back-up to the tills", urgent: true });
  check("only who sent it can take it back", (await B.post(`/api/chedam/pings/${p4.json.id}/withdraw`, {})).status === 403);
  await A.post(`/api/chedam/pings/${p4.json.id}/withdraw`, {});
  check("taken back: gone from Till 2", !(await B.get("/api/chedam/pings")).json.open.some((x) => x.id === p4.json.id));

  console.log("Escalation (BR-42)");
  const set = (await t.list("settings", "key='pings.escalate_minutes'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${set.id}`, { value: 0.01 });
  const p5 = await A.post("/api/chedam/pings", { target: "device:" + t2.dev.id, text: "Need help at the till", urgent: true });
  check("not yet escalated: the phone does not have it", !(await M.get("/api/chedam/pings")).json.open.some((x) => x.id === p5.json.id));
  await new Promise((r) => setTimeout(r, 1500));
  const es = await M.post("/api/chedam/pings/escalate", {});
  // (the minute job may have escalated it already; either way it is escalated once)
  check("not confirmed in time: escalated", es.status === 200 && (await t.list("pings", `id='${p5.json.id}'`)).items[0].escalated_at !== "", JSON.stringify(es.json));
  const mp = (await M.get("/api/chedam/pings")).json.open.find((x) => x.id === p5.json.id);
  check("now on the manager's phone, marked escalated", mp && mp.escalated === true);
  check("and an urgent task", (await t.list("tasks", `rule_key='ping:${p5.json.id}' && status='open'`)).items.length === 1);
  await M.post(`/api/chedam/pings/${p5.json.id}/ack`, { reply: "Coming" });
  check("the manager confirms: closed, task closed", !(await B.get("/api/chedam/pings")).json.open.some((x) => x.id === p5.json.id)
    && (await t.list("tasks", `rule_key='ping:${p5.json.id}' && status='open'`)).items.length === 0);
} catch (e) { err = e; }
await t.finish(err);

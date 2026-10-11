// P5 step 1: the common payment interface and the Square adapter (against a fake Square): connect with a token
// (sealed, never in the API or the event log), choose the location, pair a terminal with a code and link it to
// a till, what the till is told, disconnect. Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step52-payproc.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";
import { startFakeSquare, FAKE_TOKEN } from "../../tools/devhub/fake-square.mjs";

const t = new TestHub({ port: 8145 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null, fake = null;
try {
  fake = await startFakeSquare();
  await t.start({ CHEDAM_SQUARE_BASE: fake.url });
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const devs = {};
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    devs[n] = dev;
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const owner = await login("Demo Owner"), manager = await login("Mira Manager"), cashier = await login("Cal Cashier");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const O = as(owner), M = as(manager), C = as(cashier);

  console.log("Who may connect");
  check("a manager cannot see or connect the processor", (await M.get("/api/chedam/payproc")).status === 403 && (await M.post("/api/chedam/payproc/connect", { kind: "square", token: FAKE_TOKEN })).status === 403);
  check("the tables are closed to the API", (await t.api("GET", "/api/collections/payment_processors/records", null, { token: owner })).status >= 400);
  const s0 = (await O.get("/api/chedam/payproc")).json;
  check("nothing connected yet; Square offered", s0.processor === null && s0.kinds.some((k) => k.kind === "square"));

  console.log("Connect (P5-a, P5-c)");
  const wrong = await O.post("/api/chedam/payproc/connect", { kind: "square", environment: "sandbox", token: "EAAA-wrong-token-wrong-token-000" });
  check("a wrong token is refused with Square's answer", wrong.status === 400 && /token/i.test(wrong.json.message), JSON.stringify(wrong.json));
  const con = await O.post("/api/chedam/payproc/connect", { kind: "square", environment: "sandbox", token: FAKE_TOKEN });
  check("connected: account name and the main location chosen", con.status === 200 && con.json.processor.account_name.startsWith("Sample Store") && con.json.processor.location_id === "LOC1" && con.json.processor.locations.length === 2, JSON.stringify(con.json).slice(0, 300));
  check("the token is never in the answer", !JSON.stringify(con.json).includes(FAKE_TOKEN) && !("token_enc" in con.json.processor));
  const rec = (await t.list("payment_processors")).items[0];
  check("stored sealed (not the token)", rec.token_enc && !rec.token_enc.includes(FAKE_TOKEN), JSON.stringify(rec).slice(0, 200));
  const evs = JSON.stringify((await t.list("events", "table_name='payment_processors'")).items);
  check("the event log has neither the token nor the sealed value", evs.length > 10 && !evs.includes(FAKE_TOKEN) && !evs.includes(rec.token_enc));
  const loc = await O.post("/api/chedam/payproc/location", { location_id: "LOC2" });
  check("the owner can pick another location", loc.json.processor.location_name === "Warehouse");
  check("not a location of the account", (await O.post("/api/chedam/payproc/location", { location_id: "NOPE" })).status === 400);
  await O.post("/api/chedam/payproc/location", { location_id: "LOC1" });

  console.log("Pair a terminal and link it to a till");
  const till = devs["Cal Cashier"].id;
  check("a name is needed", (await O.post("/api/chedam/payproc/terminals", { name: "", till_device: till })).status === 400);
  const tm = await O.post("/api/chedam/payproc/terminals", { name: "Front terminal", till_device: till });
  check("pairing: a code to type on the terminal", tm.status === 200 && tm.json.status === "pairing" && /^[0-9A-F]{6}$/.test(tm.json.code) && tm.json.till_name === "Device of Cal Cashier", JSON.stringify(tm.json));
  check("not linked before it is paired", (await C.get("/api/chedam/payproc/till")).json.linked === false);
  const r1 = await O.post(`/api/chedam/payproc/terminals/${tm.json.id}/refresh`, {});
  check("still waiting until the terminal signs in", r1.json.status === "pairing");
  const codeId = Object.keys(fake.st.codes)[0];
  fake.pair(codeId);
  const r2 = await O.post(`/api/chedam/payproc/terminals/${tm.json.id}/refresh`, {});
  check("paired: the code is gone", r2.json.status === "paired" && r2.json.code === "" && r2.json.paired_at, JSON.stringify(r2.json));
  const ti = (await C.get("/api/chedam/payproc/till")).json;
  check("the till is told Card is linked (no account details)", ti.linked === true && ti.terminal === "Front terminal" && ti.processor === "Square" && !JSON.stringify(ti).includes("LOC1"), JSON.stringify(ti));
  check("another till is not linked", (await M.get("/api/chedam/payproc/till")).json.linked === false);
  check("a cashier cannot pair terminals", (await C.post("/api/chedam/payproc/terminals", { name: "X", till_device: till })).status === 403);

  console.log("One terminal per till");
  const tm2 = await O.post("/api/chedam/payproc/terminals", { name: "Spare terminal", till_device: "" });
  fake.pair(Object.keys(fake.st.codes)[1]);
  await O.post(`/api/chedam/payproc/terminals/${tm2.json.id}/refresh`, {});
  const as2 = await O.post(`/api/chedam/payproc/terminals/${tm2.json.id}/assign`, { till_device: till });
  const st2 = (await O.get("/api/chedam/payproc")).json;
  check("linking the spare to Cal's till frees the first", as2.json.till_device === till && st2.terminals.find((x) => x.id === tm.json.id).till_device === "", JSON.stringify(st2.terminals));
  check("the till now uses the spare", (await C.get("/api/chedam/payproc/till")).json.terminal === "Spare terminal");
  const expiring = await O.post("/api/chedam/payproc/terminals", { name: "Old code", till_device: "" });
  fake.expire(Object.keys(fake.st.codes)[2]);
  check("an unused code expires", (await O.post(`/api/chedam/payproc/terminals/${expiring.json.id}/refresh`, {})).json.status === "expired");
  await O.post(`/api/chedam/payproc/terminals/${expiring.json.id}/remove`, {});
  check("a removed terminal is not listed", !(await O.get("/api/chedam/payproc")).json.terminals.some((x) => x.id === expiring.json.id));

  console.log("Linked mode off, processor down, disconnect (P5-d)");
  const setRec = (await t.list("settings", "key='payments.linked'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${setRec.id}`, { value: { enabled: false, poll_seconds: 2, wait_seconds: 300 } });
  check("setting off: the till uses the standalone dialog", (await C.get("/api/chedam/payproc/till")).json.linked === false);
  await t.su_("PATCH", `/api/collections/settings/records/${setRec.id}`, { value: { enabled: true, poll_seconds: 2, wait_seconds: 300 } });
  fake.down = true;
  const t3 = await O.post("/api/chedam/payproc/terminals", { name: "While down", till_device: "" });
  check("Square down: a clear message", t3.status === 400 && /Square/.test(t3.json.message), JSON.stringify(t3.json));
  check("the problem is kept on the processor", /down/.test((await O.get("/api/chedam/payproc")).json.processor.last_error));
  fake.down = false;
  const dis = await O.post("/api/chedam/payproc/disconnect", {});
  check("disconnected: nothing connected, the till falls back", dis.json.processor === null && (await C.get("/api/chedam/payproc/till")).json.linked === false);
  const old = (await t.list("payment_processors")).items[0];
  check("the sealed token is wiped on disconnect", old.status === "disconnected" && old.token_enc === "");
} catch (e) { err = e; }
if (fake) await fake.close();
await t.finish(err);

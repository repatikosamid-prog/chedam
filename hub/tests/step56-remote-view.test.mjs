// P5 step 5: the owner's remote view (FR-12.05) against a fake Google and Microsoft: the summary, encrypted on the
// hub and put on the cloud drive; an owner's device enrolled at the store reads it away from the store with the
// app's own reader (client/src/lib/remote_read.js: refresh the sign-in, download, decrypt with WebCrypto); a new
// key locks out devices enrolled before; OneDrive. Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step56-remote-view.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";
import { startFakeCloud } from "../../tools/devhub/fake-cloud.mjs";
import { readSummary, decrypt } from "../../client/src/lib/remote_read.js";

const t = new TestHub({ port: 8149 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

let err = null, fake = null;
try {
  fake = await startFakeCloud();
  await t.start({ CHEDAM_CLOUD_BASE: fake.url, CHEDAM_TEST_NO_BACKUP_CRON: "1" });
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const owner = await login("Demo Owner"), manager = await login("Mira Manager"), cashier = await login("Cal Cashier");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const O = as(owner), M = as(manager), C = as(cashier);
  const connect = async (provider) => {
    await O.post("/api/chedam/cloud/app", provider === "google" ? { provider, client_id: "1234567890-abc.apps.googleusercontent.com", client_secret: fake.st.secret } : { provider, client_id: "00000000-1111-2222-3333-444444444444" });
    await O.post("/api/chedam/cloud/connect", { provider });
    fake.approve(provider);
    return (await O.post("/api/chedam/cloud/poll", { provider })).json;
  };

  // A sale today, a till open
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const choc = (await C.get("/api/chedam/catalogue/lookup?code=2000000000077")).json.matches[0];
  const lines = [{ key: "a", product: choc.product.id, selling_unit: choc.unit.id, qty: 1 }];
  const total = (await C.post("/api/chedam/sales/quote", { lines })).json.total_cents;
  await C.post("/api/chedam/sales", { id: sid(), lines, expected_total_cents: total, payments: [{ method: "cash", amount_cents: total + 1000 }] });

  console.log("The summary (FR-12.05)");
  check("a manager can't see or enrol", (await M.get("/api/chedam/remote")).status === 403 && (await M.post("/api/chedam/remote/enrol", {})).status === 403);
  check("enrolling needs the cloud drive", (await O.post("/api/chedam/remote/enrol", {})).status === 400);
  const r0 = (await O.get("/api/chedam/remote")).json;
  const sm = r0.summary;
  check("the summary: today's sales, the till, attention, stock, backup, health", sm && sm.kpis && sm.kpis.today.transactions >= 1 && sm.tills.length === 1 && sm.tills[0].by === "Cal Cashier"
    && Array.isArray(sm.attention) && typeof sm.stock.low_stock === "number" && sm.health && sm.business.name !== undefined, JSON.stringify(sm).slice(0, 400));
  check("not connected yet: nothing published", r0.connected === false && (await O.post("/api/chedam/remote/publish", {})).json.skipped === "off");
  await connect("google");
  const pub = (await O.post("/api/chedam/remote/publish", {})).json;
  const f1 = fake.files.filter((f) => f.name === "chedam-summary.enc");
  check("published to the cloud drive, encrypted", pub.uploaded && f1.length === 1 && !String(f1[0].content).includes("Cal Cashier"), JSON.stringify(pub));
  check("the time it went is kept", !!pub.status.summary_at);

  console.log("Away from the store");
  const en = (await O.post("/api/chedam/remote/enrol", {})).json;
  check("enrol: the key and a way to read (not in the event log)", en.key && en.key.length === 32 && en.read.provider === "google" && en.read.refresh_token
    && !JSON.stringify((await t.list("events", "")).items.slice(-50)).includes(en.read.refresh_token));
  const away = await readSummary(en, () => {});
  check("the owner's device reads and decrypts it (WebCrypto)", away.kpis.today.transactions >= 1 && away.tills[0].by === "Cal Cashier" && away.generated_at, JSON.stringify(away).slice(0, 200));
  await O.post("/api/chedam/remote/publish", {});
  check("published again: still one file", fake.files.filter((f) => f.name === "chedam-summary.enc").length === 1);
  const away2 = await readSummary(en, () => {});
  check("the newer summary", away2.generated_at >= away.generated_at);
  check("a wrong key can't open it", await decrypt(fake.files.find((f) => f.name === "chedam-summary.enc").content.toString(), "x".repeat(32)).then(() => false, () => true));

  console.log("A new key; a removed sign-in");
  await O.post("/api/chedam/remote/forget", {});
  await O.post("/api/chedam/remote/publish", {});
  const locked = await readSummary(en, () => {}).then(() => "", (e) => e.message);
  check("devices enrolled before can't read the new summaries", /Enrol this device again/.test(locked), locked);
  const en2 = (await O.post("/api/chedam/remote/enrol", {})).json;
  check("enrolled again: readable", (await readSummary(en2, () => {})).generated_at);
  fake.revoke();
  const gone = await readSummary(en2, () => {}).then(() => "", (e) => e.message);
  check("sign-in removed: the device is told to enrol again", /enrol this device again/i.test(gone), gone);

  console.log("OneDrive");
  await O.post("/api/chedam/cloud/disconnect", {});
  await connect("microsoft");
  const pm = (await O.post("/api/chedam/remote/publish", {})).json;
  const en3 = (await O.post("/api/chedam/remote/enrol", {})).json;
  let newRefresh = "";
  const away3 = await readSummary(en3, (x) => (newRefresh = x));
  check("published to the OneDrive app folder and read from there", pm.uploaded && en3.read.provider === "microsoft" && away3.kpis.today.transactions >= 1, JSON.stringify(pm));
  check("a new refresh token handed out is kept by the device", newRefresh && newRefresh !== en3.read.refresh_token);
} catch (e) { err = e; }
if (fake) await fake.close();
await t.finish(err);

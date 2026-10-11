// P5 step 4: the owner's cloud drive (against a fake Google and Microsoft): app registration, device-code
// sign-in, tokens sealed, the off-site backup copy from the outbox (binary files, retention, refreshing the
// sign-in, a revoked sign-in), disconnect, OneDrive. Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step55-cloud.test.mjs
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";
import { startFakeCloud } from "../../tools/devhub/fake-cloud.mjs";

const t = new TestHub({ port: 8148 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null, fake = null;
try {
  fake = await startFakeCloud();
  await t.start({ CHEDAM_CLOUD_BASE: fake.url, CHEDAM_TEST_NO_BACKUP_CRON: "1" });
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const owner = await login("Demo Owner"), manager = await login("Mira Manager");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const O = as(owner), M = as(manager);
  const outbox = join(t.dataDir, "backup", "outbox");
  let n = 0;
  const backupSet = () => {
    mkdirSync(outbox, { recursive: true });
    const name = `chedam-20261011-0${String(++n).padStart(5, "0")}-scheduled.db.gz.age`;
    const data = randomBytes(5000 + n);                    // binary, with every byte value
    writeFileSync(join(outbox, name), data);
    writeFileSync(join(outbox, name + ".keys"), randomBytes(300));
    writeFileSync(join(outbox, name + ".sha256"), "abc  " + name + "\n");
    return { name, data };
  };

  console.log("Who, and the app registration (D2)");
  check("a manager cannot see the cloud drive", (await M.get("/api/chedam/cloud")).status === 403);
  const s0 = (await O.get("/api/chedam/cloud")).json;
  check("Google Drive and OneDrive offered, none connected", s0.providers.length === 2 && s0.connected === null, JSON.stringify(s0));
  check("signing in needs the app registration first", (await O.post("/api/chedam/cloud/connect", { provider: "google" })).status === 400);
  check("Google needs its client secret too", (await O.post("/api/chedam/cloud/app", { provider: "google", client_id: "1234567890-abc.apps.googleusercontent.com" })).status === 400);
  const ap = await O.post("/api/chedam/cloud/app", { provider: "google", client_id: "1234567890-abc.apps.googleusercontent.com", client_secret: fake.st.secret });
  check("saved; the secret is never shown", ap.status === 200 && ap.json.providers[0].link.has_app && !JSON.stringify(ap.json).includes(fake.st.secret));

  console.log("Device-code sign-in (P5-e)");
  const c1 = await O.post("/api/chedam/cloud/connect", { provider: "google" });
  const g1 = c1.json.providers.find((p) => p.provider === "google").link;
  check("a code to type on google.com/device", c1.status === 200 && g1.status === "waiting" && /^[0-9A-F]{6}$/.test(g1.user_code) && /google\.com\/device/.test(g1.verify_url), JSON.stringify(c1.json));
  check("still waiting until the owner signs in", (await O.post("/api/chedam/cloud/poll", { provider: "google" })).json.connected === null);
  fake.approve("google");
  const p2 = (await O.post("/api/chedam/cloud/poll", { provider: "google" })).json;
  check("connected, with the owner's account", p2.connected && p2.connected.provider === "google" && p2.connected.account === "owner@example.test", JSON.stringify(p2));
  const rec = (await t.list("cloud_links", "provider='google'")).items[0];
  const evs = JSON.stringify((await t.list("events", "table_name='cloud_links'")).items);
  check("tokens and secret sealed, never in the event log", rec.refresh_enc && !rec.refresh_enc.includes("ref-") && !evs.includes("ref-") && !evs.includes("acc-") && !evs.includes(fake.st.secret) && !evs.includes(rec.refresh_enc));

  console.log("Off-site backup copy (FR-12.08)");
  const b1 = backupSet();
  const u1 = (await O.post("/api/chedam/cloud/upload-now", {})).json;
  const up1 = fake.files.find((f) => f.name === b1.name);
  check("the backup set goes up to the Chedam folder", u1.uploaded === 3 && up1 && fake.files.find((f) => f.name === "Chedam" && up1.parents.includes(f.id)), JSON.stringify(u1));
  check("byte for byte (binary)", up1 && Buffer.compare(Buffer.from(up1.content), b1.data) === 0);
  check("the outbox is emptied", readdirSync(outbox).length === 0 && u1.status.connected.last_upload_name === b1.name);
  const keepRec = (await t.list("settings", "key='cloud.backup_keep'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${keepRec.id}`, { value: 2 });
  backupSet(); await O.post("/api/chedam/cloud/upload-now", {});
  fake.expire();                                            // the access token runs out: refreshed by itself
  const b3 = backupSet();
  const u3 = (await O.post("/api/chedam/cloud/upload-now", {})).json;
  const ages = fake.files.filter((f) => f.name.endsWith(".age")).map((f) => f.name).sort();
  check("the sign-in is refreshed by itself", u3.uploaded === 3 && !u3.error, JSON.stringify(u3));
  check("only the newest 2 backups are kept in the cloud (with their files)", ages.length === 2 && ages[1] === b3.name && !fake.files.some((f) => f.name.startsWith(b1.name)), JSON.stringify(fake.files.map((f) => f.name)));
  fake.revoke();
  const b4 = backupSet();
  const u4 = (await O.post("/api/chedam/cloud/upload-now", {})).json;
  check("a removed sign-in: kept in the outbox, the owner is told", u4.error && /connect the cloud drive again/.test(u4.status.connected.last_error) && readdirSync(outbox).includes(b4.name), JSON.stringify(u4));

  console.log("Disconnect, OneDrive");
  await O.post("/api/chedam/cloud/app", { provider: "microsoft", client_id: "00000000-1111-2222-3333-444444444444" });
  check("one cloud drive at a time", (await O.post("/api/chedam/cloud/connect", { provider: "microsoft" })).status === 400);
  const d = (await O.post("/api/chedam/cloud/disconnect", {})).json;
  check("disconnected; tokens wiped", d.connected === null && (await t.list("cloud_links", "provider='google'")).items[0].refresh_enc === "");
  await O.post("/api/chedam/cloud/connect", { provider: "microsoft" });
  fake.deny("microsoft");
  const dn = (await O.post("/api/chedam/cloud/poll", { provider: "microsoft" })).json;
  check("a refused sign-in is said so", dn.connected === null && /refused/.test(dn.providers.find((p) => p.provider === "microsoft").link.last_error));
  const m1 = (await O.post("/api/chedam/cloud/connect", { provider: "microsoft" })).json;
  check("Microsoft's page and code", /microsoft\.com\/devicelogin/.test(m1.providers.find((p) => p.provider === "microsoft").link.verify_url));
  fake.approve("microsoft");
  const m2 = (await O.post("/api/chedam/cloud/poll", { provider: "microsoft" })).json;
  check("OneDrive connected", m2.connected && m2.connected.provider === "microsoft");
  const u5 = (await O.post("/api/chedam/cloud/upload-now", {})).json;
  check("the waiting backup goes to the OneDrive app folder", u5.uploaded === 3 && fake.files.some((f) => f.provider === "microsoft" && f.name === b4.name && f.size === b4.data.length), JSON.stringify(u5));
} catch (e) { err = e; }
if (fake) await fake.close();
await t.finish(err);

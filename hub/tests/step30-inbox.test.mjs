// P2 step 10: inbox, end-of-day report, email fallback (FR-2.08-2.10, 12.07, BR-40, 41). The day's report for
// the owner and chosen people (margin only for those who see costs), once a day; urgent problems as alerts for
// task managers; per-person choices; unread past the deadline marked for email once (not connected yet).
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step30-inbox.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8123 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), owner = await login("Demo Owner"), staff = await login("Sam Staff");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }), patch: (p, b) => t.api("PATCH", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), O = as(owner), S = as(staff);
  const chips = (await C.get("/api/chedam/catalogue/lookup?code=2000000000060")).json.matches[0];
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const lines = [{ key: "a", product: chips.product.id, selling_unit: chips.unit.id, qty: 2 }];
  const q = (await C.post("/api/chedam/sales/quote", { lines })).json;
  const sale = await C.post("/api/chedam/sales", { id: sid(), lines, expected_total_cents: q.total_cents, payments: [{ method: "cash", amount_cents: q.total_cents + 100 }] });
  check("a sale today", sale.status === 200);

  console.log("End-of-day report (FR-2.09)");
  check("only the owner (and settings managers) set who gets it", (await C.post("/api/chedam/inbox/settings", { eod: { time: "22:00" } })).json.eod === null);
  const set = await O.post("/api/chedam/inbox/settings", { eod: { enabled: true, time: "23:00", recipients: [people["Mira Manager"], people["Sam Staff"]], email_by: "07:30" } });
  check("the owner adds Mira and Sam, report at 23:00, email by 07:30", set.status === 200 && set.json.eod.recipients.length === 2 && set.json.deadlines.eod_report === "next 07:30", JSON.stringify(set.json));
  check("a cashier cannot make the report", (await C.post("/api/chedam/inbox/eod", {})).status === 403);
  const mk = await O.post("/api/chedam/inbox/eod", {});
  check("made for the owner, Mira and Sam", mk.status === 200 && mk.json.made === 3, JSON.stringify(mk.json));
  check("once a day: making it again adds nothing", (await O.post("/api/chedam/inbox/eod", {})).json.made === 0);
  const oi = (await O.get("/api/chedam/inbox")).json;
  const rep = oi.items.find((x) => x.kind === "eod_report");
  check("the owner's report: sales, payments, tills, margin", rep && rep.data.transactions >= 1 && rep.data.payments.some((p) => p.method === "cash") && rep.data.margin_pct !== undefined
    && /Sales \$/.test(rep.body) && /Margin/.test(rep.body) && /Tills:/.test(rep.body), JSON.stringify(rep && rep.data).slice(0, 300));
  check("unread, with an email deadline the next morning", oi.unread >= 1 && rep.read === false && rep.email_status === "waiting" && rep.deadline_at > new Date().toISOString().replace("T", " "));
  const si = (await S.get("/api/chedam/inbox")).json.items.find((x) => x.kind === "eod_report");
  check("Sam (staff, sees costs: DL-72) gets it too", !!si);
  check("Cal (not chosen) has none", !(await C.get("/api/chedam/inbox")).json.items.some((x) => x.kind === "eod_report"));
  check("nobody reads another person's inbox", (await C.get(`/api/collections/inbox_items/records/${rep.id}`)).status === 404 && (await C.post(`/api/chedam/inbox/${rep.id}/read`, {})).status === 404);
  const rd = await O.post(`/api/chedam/inbox/${rep.id}/read`, {});
  check("read: no email needed any more", rd.json.read === true && rd.json.email_status === "none");

  console.log("Email fallback (BR-40, 41)");
  const mi = (await M.get("/api/chedam/inbox")).json.items.find((x) => x.kind === "eod_report");
  await t.su_("PATCH", `/api/collections/inbox_items/records/${mi.id}`, { deadline_at: new Date(Date.now() - 60000).toISOString().replace("T", " ") });
  const jb = await M.post("/api/chedam/inbox/jobs", {});
  const after = (await M.get("/api/chedam/inbox")).json;
  const mi2 = after.items.find((x) => x.id === mi.id);
  check("unread past its deadline: marked for email once; not connected yet (P2-f) or waiting while offline", jb.status === 200 && ["not_connected", "waiting"].includes(mi2.email_status) && after.email_connected === false, JSON.stringify(mi2));
  if (mi2.email_status === "not_connected") {
    await M.post("/api/chedam/inbox/jobs", {});
    check("never twice", (await M.get("/api/chedam/inbox")).json.items.find((x) => x.id === mi.id).email_status === "not_connected");
  }

  console.log("Alerts and choices (FR-2.08, 2.10)");
  const areas = Object.fromEntries((await t.list("storage_areas")).items.map((a) => [a.name, a.id]));
  const milk = (await t.list("products", "name~'Milk'")).items[0];
  await M.patch(`/api/collections/products/records/${milk.id}`, { temp_min_c: 0, temp_max_c: 4, storage_area: areas["Dry store"] });
  await M.post("/api/chedam/reminders/run", {});
  const al = (await M.get("/api/chedam/inbox")).json.items.find((x) => x.kind === "alert");
  check("an urgent problem: an alert in the manager's inbox", al && /needs 0–4 °C/.test(al.title), JSON.stringify((await M.get("/api/chedam/inbox")).json.items.map((x) => x.title)));
  check("and not in the cashier's", !(await C.get("/api/chedam/inbox")).json.items.some((x) => x.kind === "alert"));
  const mine = await M.post("/api/chedam/inbox/settings", { mine: [{ kind: "alert", in_app: false, email: false }] });
  check("each person chooses per kind", mine.json.mine.find((x) => x.kind === "alert").in_app === false);
  await M.patch(`/api/collections/products/records/${milk.id}`, { storage_area: areas["Cooler"] });
  await M.post("/api/chedam/reminders/run", {});
  await M.patch(`/api/collections/products/records/${milk.id}`, { storage_area: areas["Freezer"] });
  await M.post("/api/chedam/reminders/run", {});
  const ownerAlerts = (await O.get("/api/chedam/inbox")).json.items.filter((x) => x.kind === "alert").length;
  check("switched off: no new alert for Mira (the owner still gets them)", (await M.get("/api/chedam/inbox")).json.items.filter((x) => x.kind === "alert").length === 1 && ownerAlerts >= 1);
  const ra = await O.post("/api/chedam/inbox/read-all", {});
  check("read all", ra.status === 200 && (await O.get("/api/chedam/inbox")).json.unread === 0);
} catch (e) { err = e; }
await t.finish(err);

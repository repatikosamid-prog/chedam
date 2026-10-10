// P3 step 1: parties (FR-8.01, 8.07, 8.08). Vendors and clients with contacts, addresses, terms, currency, tax
// and importer details; who may see and change them; the communication log with follow-up tasks; exchange rates.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step32-parties.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8125 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), staff = await login("Sam Staff"), acct = await login("Ana Accountant");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }), patch: (p, b) => t.api("PATCH", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), S = as(staff), A = as(acct);

  console.log("Parties (FR-8.01)");
  check("sample vendors and a client", (await M.get("/api/collections/parties/records?perPage=50")).json.items.length >= 4);
  check("a cashier cannot see vendors", (await C.get("/api/collections/parties/records")).status === 403);
  check("staff and the accountant can see them (receiving, bills)", (await S.get("/api/collections/parties/records")).status === 200 && (await A.get("/api/collections/parties/records")).status === 200);
  check("staff cannot add one", (await S.post("/api/collections/parties/records", { kind: "vendor", name: "X" })).status === 403);
  check("a name is needed", (await M.post("/api/collections/parties/records", { kind: "vendor", name: "  " })).status === 400);
  check("a bad currency is refused", (await M.post("/api/collections/parties/records", { kind: "vendor", name: "Bad", currency: "DOLLARS" })).status === 400);
  const v = await M.post("/api/collections/parties/records", { kind: "both", name: "  Island  Bakery ", code: "isl bak", currency: "cad", payment_terms_days: 15, tax_id: "834567890RT0001",
    importer: false, street: "12 Oak St", city: "Victoria", province: "BC", postal_code: "V8W 1A1", email: "hi@islandbakery.example", active: true });
  check("a manager adds a vendor that is also a client; name, code and currency tidied", v.status === 200 && v.json.name === "Island Bakery" && v.json.code === "ISLBAK" && v.json.currency === "CAD" && v.json.country === "CA", JSON.stringify(v.json));
  check("codes are unique", (await M.post("/api/collections/parties/records", { kind: "vendor", name: "Other", code: "ISLBAK" })).status === 400);
  const ct = await M.post("/api/collections/party_contacts/records", { party: v.json.id, name: "Rosa", role: "Orders", email: "rosa@islandbakery.example", primary: true });
  check("a contact", ct.status === 200);
  check("a contact with a bad email is refused", (await M.post("/api/collections/party_contacts/records", { party: v.json.id, name: "Bad", email: "nope" })).status === 400);

  console.log("Communication log and follow-ups (FR-8.07)");
  check("an empty log entry is refused", (await S.post(`/api/chedam/parties/${v.json.id}/log`, { kind: "call", text: "" })).status === 400);
  const due = new Date(Date.now() + 2 * 86400000).toISOString();
  const lg = await S.post(`/api/chedam/parties/${v.json.id}/log`, { kind: "call", text: "Asked for the new bread price list", contact: "Rosa", follow_up_at: due });
  check("Sam logs a call with a follow-up date", lg.status === 200 && lg.json.by === "Sam Staff" && lg.json.follow_up && lg.json.follow_up.status === "open", JSON.stringify(lg.json));
  const task = (await t.list("tasks", `id='${lg.json.follow_up.id}'`)).items[0];
  check("the follow-up is a task for Sam, due then, linked to the party", task.owner === people["Sam Staff"] && task.link_collection === "parties" && task.link_id === v.json.id && /Follow up with Island Bakery/.test(task.title));
  const pv = (await A.get(`/api/chedam/parties/${v.json.id}`)).json;
  check("the party with its contacts and log", pv.party.name === "Island Bakery" && pv.contacts.length === 1 && pv.log.length === 1 && pv.log[0].contact === "Rosa");
  check("a cashier cannot read it", (await C.get(`/api/chedam/parties/${v.json.id}`)).status === 403);

  console.log("Exchange rates (FR-8.08)");
  check("CAD is always 1", (await C.get("/api/chedam/fx?currency=CAD")).json.rate === 1);
  check("the sample USD rate", (await C.get("/api/chedam/fx?currency=USD")).json.rate === 1.37);
  check("staff cannot enter rates", (await S.post("/api/collections/fx_rates/records", { currency: "EUR", day: "2026-01-01", rate: 1.5 })).status === 403);
  await M.post("/api/collections/fx_rates/records", { currency: "eur", day: "2026-01-01", rate: 1.5, source: "manual" });
  await M.post("/api/collections/fx_rates/records", { currency: "EUR", day: "2026-06-01", rate: 1.6, source: "manual" });
  check("the rate on a day is the latest on or before it", (await C.get("/api/chedam/fx?currency=EUR&day=2026-03-15")).json.rate === 1.5 && (await C.get("/api/chedam/fx?currency=EUR&day=2026-07-01")).json.rate === 1.6);
  check("none before the first: said so", (await C.get("/api/chedam/fx?currency=EUR&day=2025-12-31")).status === 404);
  check("one rate per currency and day", (await M.post("/api/collections/fx_rates/records", { currency: "EUR", day: "2026-01-01", rate: 1.7 })).status === 400);
} catch (e) { err = e; }
await t.finish(err);

// P5 step 7: reference data that only suggests (FR-11.10, 11.11): the datasets shipped with the hub (units, tax
// presets, shelf life, HS chapters) read with sqlite3 (on the PC: tools/devhub/sqlite3-node.mjs), Open Food Facts
// by barcode and Bank of Canada rates online (a fake here), nothing written; licences listed.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step58-reference.test.mjs
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8151 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

// Fake Open Food Facts and Bank of Canada
let calls = 0;
const fake = createServer((req, res) => {
  calls++;
  const u = new URL(req.url, "http://x");
  res.setHeader("Content-Type", "application/json");
  if (u.pathname === "/off/api/v2/product/0064200116473.json") return res.end(JSON.stringify({ status: 1, product: { product_name: "Original Crackers", product_name_fr: "Craquelins originaux", brands: "Crispy Co,Other", quantity: "225 g", categories_tags: ["en:snacks", "en:crackers"] } }));
  if (u.pathname.startsWith("/off/")) return res.end(JSON.stringify({ status: 0 }));
  if (u.pathname === "/boc/observations/FXUSDCAD/json") return res.end(JSON.stringify({ observations: [{ d: "2026-10-08", FXUSDCAD: { v: "1.3690" } }, { d: "2026-10-09", FXUSDCAD: { v: "1.3712" } }] }));
  res.statusCode = 404; res.end("{}");
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const FAKE = "http://127.0.0.1:" + fake.address().port;

// Downloaded datasets (DL-246): tiny copies in their own folder, as tools/datasets/download.mjs makes them
const EXT = mkdtempSync(join(tmpdir(), "chedam-ref-"));
const mk = (id, table, ddl, rows, extra) => {
  const db = new DatabaseSync(join(EXT, id + ".db"));
  db.exec(`CREATE TABLE ${table} (${ddl})`);
  const n = rows[0].length;
  const ins = db.prepare(`INSERT INTO ${table} VALUES (${Array(n).fill("?").join(",")})`);
  rows.forEach((r) => ins.run(...r));
  db.close();
  writeFileSync(join(EXT, id + ".json"), JSON.stringify({ id, name: id, version: "2026-10-11", source: "test", licence: "test licence", rows: rows.length, bytes: 4096, table, ...extra }));
};
mk("off_ca", "products", "barcode TEXT PRIMARY KEY, name TEXT, name_fr TEXT, brand TEXT, quantity TEXT, category TEXT", [["0068000000017", "Ginger Ale", "Soda gingembre", "Canada Dry", "2 L", "Sodas"]]);
mk("cbsa_tariff", "tariff", "code TEXT PRIMARY KEY, description TEXT, uom TEXT, mfn TEXT, ust TEXT, general TEXT", [["2202.10.00", "Waters › Carbonated soft drinks", "", "11 %", "Free", "35%"], ["2202.10.00.19", "Waters › Carbonated soft drinks › Other", "LTR", "11 %", "Free", "35%"], ["1806.32.00", "Chocolate › Other, in blocks", "", "6 %", "Free", "35%"]]);
mk("boc_fx", "rates", "day TEXT, currency TEXT, rate REAL", [["2026-10-06", "EUR", 1.6011], ["2026-10-09", "EUR", 1.6102]]);

let err = null;
try {
  await t.start({ CHEDAM_SQLITE: JSON.stringify([process.execPath, join(HUB, "..", "tools", "devhub", "sqlite3-node.mjs")]), CHEDAM_REFERENCE_BASE: FAKE, CHEDAM_REFERENCE_DIR: EXT });
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const staff = await login("Sam Staff");
  const S = { get: (p) => t.api("GET", p, null, { token: staff }) };
  const eventsBefore = (await t.list("events")).totalItems;

  console.log("Datasets and licences (FR-11.11)");
  check("signed in only", (await t.api("GET", "/api/chedam/reference")).status === 401);
  const ab = (await S.get("/api/chedam/reference")).json;
  check("the shipped datasets with source and licence", ["units", "tax_presets", "shelf_life", "hs_chapters"].every((id) => ab.datasets.some((d) => d.id === id && d.rows > 0 && d.licence)), JSON.stringify(ab).slice(0, 300));
  check("online sources credited (Open Food Facts: ODbL)", ab.online.some((o) => o.id === "open_food_facts" && /ODbL/.test(o.licence)) && ab.online.some((o) => o.id === "bank_of_canada"));

  console.log("Suggestions");
  check("downloaded datasets listed, with their size", ["off_ca", "cbsa_tariff", "boc_fx"].every((id) => ab.datasets.some((d) => d.id === id)) && ab.bytes >= 3 * 4096);
  const off = (await S.get("/api/chedam/reference/product?barcode=0068000000017")).json;
  check("a barcode from the hub's Open Food Facts copy, no internet asked", off.found && off.suggestions.name === "Canada Dry Ginger Ale" && off.suggestions.size_qty === 2 && /on the hub/.test(off.source), JSON.stringify(off));
  const hsT = (await S.get("/api/chedam/reference/hs?q=carbonated soft")).json.items.filter((x) => x.source === "CBSA Customs Tariff");
  check("tariff items by words, with the duty rates", hsT.length === 2 && hsT[0].code === "2202.10.00" && hsT[0].mfn === "11 %" && hsT[0].ust === "Free", JSON.stringify(hsT));
  check("tariff items by digits (no dots needed)", (await S.get("/api/chedam/reference/hs?q=220210")).json.items.some((x) => x.code === "2202.10.00.19"));
  const sl = (await S.get("/api/chedam/reference/shelf-life?name=" + encodeURIComponent("Dairyland 2% Milk 4L"))).json;
  check("shelf life: milk, 7 days in the fridge", sl.items[0] && sl.items[0].item === "Milk" && sl.items[0].fridge_days === 7, JSON.stringify(sl));
  check("the longest keyword wins (ice cream, not cream)", (await S.get("/api/chedam/reference/shelf-life?name=" + encodeURIComponent("Vanilla Ice Cream 1.5L"))).json.items[0].item === "Ice cream");
  check("nothing for an unknown item", (await S.get("/api/chedam/reference/shelf-life?name=widget")).json.items.length === 0);
  const tp = (await S.get("/api/chedam/reference/tax-presets")).json.items;
  const bc = tp.find((x) => x.province === "BC"), on = tp.find((x) => x.province === "ON"), ns = tp.find((x) => x.province === "NS");
  check("tax presets: BC 5% GST + 7% PST, ON 13% HST, NS 14% HST", tp.length === 13 && bc.gst === 5 && bc.pst === 7 && on.hst === 13 && ns.hst === 14, JSON.stringify(bc));
  check("units: a pound is 453.59 g", (await S.get("/api/chedam/reference/units")).json.items.find((u) => u.code === "lb").factor === 453.59237);
  check("HS chapter by words", (await S.get("/api/chedam/reference/hs?q=chocolate")).json.items.some((x) => x.code === "18"));
  check("HS chapter by digits", (await S.get("/api/chedam/reference/hs?q=1905.90")).json.items.some((x) => x.code === "19"));
  check("a quote in the search is harmless", (await S.get("/api/chedam/reference/hs?q=" + encodeURIComponent("o'brien")) ).status === 200);

  console.log("Online: Open Food Facts and the Bank of Canada");
  const pr = (await S.get("/api/chedam/reference/product?barcode=0064200116473")).json;
  check("a barcode: name with the brand, French name, size, category", pr.found && pr.suggestions.name === "Crispy Co Original Crackers" && pr.suggestions.name_fr === "Craquelins originaux" && pr.suggestions.size_qty === 225 && pr.suggestions.size_unit === "g" && pr.suggestions.category === "crackers" && /ODbL/.test(pr.licence), JSON.stringify(pr));
  const n0 = calls;
  await S.get("/api/chedam/reference/product?barcode=0064200116473");
  check("asked once a day per barcode", calls === n0);
  check("unknown barcode: not found", (await S.get("/api/chedam/reference/product?barcode=0000000000017")).json.found === false);
  check("not a barcode: refused", (await S.get("/api/chedam/reference/product?barcode=abc")).status === 400);
  const fx = (await S.get("/api/chedam/reference/fx?currency=USD&day=2026-10-11")).json;
  check("USD on a Sunday: Friday's Bank of Canada rate", fx.found && fx.rate === 1.3712 && fx.day === "2026-10-09", JSON.stringify(fx));
  check("CAD is refused", (await S.get("/api/chedam/reference/fx?currency=CAD")).status === 400);
  const eur = (await S.get("/api/chedam/reference/fx?currency=EUR&day=2026-10-11")).json;
  check("not at the Bank online: the hub's history (last business day)", eur.found && eur.rate === 1.6102 && eur.day === "2026-10-09" && /on the hub/.test(eur.source), JSON.stringify(eur));
  const setRec = (await t.list("settings", "key='reference.online'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${setRec.id}`, { value: { open_food_facts: false, bank_of_canada: true } });
  check("switched off: not asked", (await S.get("/api/chedam/reference/product?barcode=0064200116474")).json.offline === true);
  await t.su_("PATCH", `/api/collections/settings/records/${setRec.id}`, { value: { open_food_facts: false, bank_of_canada: false } });
  const c0 = calls;
  const eurOff = (await S.get("/api/chedam/reference/fx?currency=EUR&day=2026-10-07")).json;
  check("offline: exchange rate from the hub's history, nothing asked", eurOff.found && eurOff.rate === 1.6011 && calls === c0, JSON.stringify(eurOff));
  check("nothing was written to the store's data", (await t.list("events")).totalItems === eventsBefore + 2, "only the settings changes");
} catch (e) { err = e; }
await new Promise((r) => fake.close(r));
rmSync(EXT, { recursive: true, force: true });
await t.finish(err);

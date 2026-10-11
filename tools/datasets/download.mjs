// Downloads Chedam's large reference datasets from their publishers and slims them into read-only SQLite files
// (Sreya's OK 2026-10-11, "make sure it is not filling up the data and storage"; DL-246).
//   cd tools/datasets && npm ci && node download.mjs [off_ca] [cbsa_tariff] [boc_fx]      (default: all)
// Output: hub/reference-data/<id>.db + <id>.json (git-ignored). deploy.sh copies the folder to the hub's
// /opt/chedam/reference, outside the code, the store's database, backups and update rollback copies.
// Storage rules:
//   - downloads are streamed and filtered as they arrive; nothing raw is written to disk (the 1.3 GB Open Food Facts
//     file never lands on the PC or the Pi)
//   - only the columns a Chedam screen uses are kept
//   - each dataset has a size limit and all of them together a total limit; over a limit = the build fails and the
//     previous file stays
//   - a new build replaces the old file (one copy per dataset, never history)
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, renameSync, statSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { unzipSync } from "fflate";
import MDBReader from "mdb-reader";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "hub", "reference-data");
const MB = 1024 * 1024;
const TOTAL_LIMIT = 120 * MB;
const UA = "Chedam POS dataset builder (one download per release; contact: store owner)";

const DATASETS = {
  off_ca: {
    name: "Open Food Facts (products sold in Canada)",
    source: "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz",
    licence: "Open Database License (ODbL); © Open Food Facts contributors",
    limit: 80 * MB,
    table: "products",
    ddl: "barcode TEXT PRIMARY KEY, name TEXT, name_fr TEXT, brand TEXT, quantity TEXT, category TEXT",
    build: buildOff,
  },
  cbsa_tariff: {
    name: "CBSA Customs Tariff (T2026-2, effective 2026-09-01)",
    source: "https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/01-99/01-99-2026-2-eng.zip",
    licence: "Canada Border Services Agency; reproduced under the Open Government Licence – Canada / Reproduction of Federal Law Order",
    limit: 15 * MB,
    table: "tariff",
    ddl: "code TEXT PRIMARY KEY, description TEXT, uom TEXT, mfn TEXT, ust TEXT, general TEXT",
    build: buildTariff,
  },
  boc_fx: {
    name: "Bank of Canada daily exchange rates (since 2017)",
    source: "https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json?start_date=2017-01-03",
    licence: "Bank of Canada terms of use; source: Bank of Canada",
    limit: 8 * MB,
    table: "rates",
    ddl: "day TEXT, currency TEXT, rate REAL, PRIMARY KEY (day, currency)",
    build: buildFx,
  },
};

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}

// Open Food Facts: the tab-separated export, streamed through gunzip; only rows sold in Canada, 6 columns
async function buildOff(ins, log) {
  const res = await get(DATASETS.off_ca.source);
  const total = Number(res.headers.get("content-length")) || 0;
  let got = 0, rows = 0, lines = 0, head = null, rest = "", lastLog = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (c) => { got += c.length; });
  const gz = body.pipe(createGunzip());
  gz.setEncoding("utf8");
  const col = (n) => head.indexOf(n);
  let I;
  const pick = (f, i) => (i >= 0 ? (f[i] || "").trim() : "");
  for await (const chunk of gz) {
    const parts = (rest + chunk).split("\n");
    rest = parts.pop();
    for (const line of parts) {
      if (!head) {
        head = line.split("\t");
        I = { code: col("code"), name: col("product_name"), en: col("product_name_en"), fr: col("product_name_fr"), brands: col("brands"), qty: col("quantity"),
          countries: col("countries_tags"), cat: col("main_category_en") };
        if (I.code < 0 || I.countries < 0) throw new Error("Open Food Facts changed its columns: " + head.slice(0, 20).join(","));
        continue;
      }
      lines++;
      const f = line.split("\t");
      if (f.length < head.length - 5) continue;                      // a broken line
      if (f[I.countries].indexOf("en:canada") < 0) continue;
      const code = f[I.code].trim();
      const name = pick(f, I.en) || pick(f, I.name);
      if (!/^\d{6,14}$/.test(code) || !name) continue;
      ins.run(code, name.slice(0, 160), pick(f, I.fr).slice(0, 160), pick(f, I.brands).split(",")[0].trim().slice(0, 80), pick(f, I.qty).slice(0, 40), pick(f, I.cat).slice(0, 80));
      rows++;
    }
    if (Date.now() - lastLog > 30000) { lastLog = Date.now(); log(`${(got / MB).toFixed(0)} of ${(total / MB).toFixed(0)} MB read, ${lines} products checked, ${rows} sold in Canada`); }
  }
  return rows;
}

// CBSA: the Access database in the zip, in memory; each tariff item with the descriptions of the headings above it
async function buildTariff(ins) {
  const zip = new Uint8Array(await (await get(DATASETS.cbsa_tariff.source)).arrayBuffer());
  const files = unzipSync(zip, { filter: (f) => /\.(accdb|mdb)$/i.test(f.name) });
  const buf = Object.values(files)[0];
  if (!buf) throw new Error("no Access database in the CBSA zip");
  const t = new MDBReader(Buffer.from(buf)).getTable("TPHS");
  const data = t.getData({ columns: ["TARIFF", "DESC1", "DESC2", "DESC3", "UOM", "MFN", "UST", "General Tariff"] })
    .filter((r) => r.TARIFF).sort((a, b) => (a.TARIFF < b.TARIFF ? -1 : a.TARIFF > b.TARIFF ? 1 : 0));
  const stack = [];
  const seen = new Set();
  let rows = 0;
  for (const r of data) {
    const code = String(r.TARIFF).trim();
    const own = [r.DESC1, r.DESC2, r.DESC3].filter(Boolean).map((s) => String(s).trim()).join(" ").replace(/\s+/g, " ");
    while (stack.length && !code.startsWith(stack[stack.length - 1].code)) stack.pop();
    const path = stack.map((s) => s.desc).filter(Boolean);
    // "Other" alone says nothing: keep the headings above it
    const desc = (path.length ? path.slice(-3).join(" › ") + " › " : "") + own;
    // the rates are on the 8-digit item; its 10-digit statistical lines take them from there
    const up = stack.length ? stack[stack.length - 1] : {};
    const rate = { mfn: r.MFN || up.mfn || "", ust: r.UST || up.ust || "", general: r["General Tariff"] || up.general || "" };
    stack.push({ code, desc: own.replace(/:$/, ""), ...rate });
    if (seen.has(code)) continue;
    seen.add(code);
    ins.run(code, desc.slice(0, 400), r.UOM || "", rate.mfn, rate.ust, rate.general);
    rows++;
  }
  return rows;
}

// Bank of Canada: the daily rates (CAD for one unit) since the series began; the hub uses them when it is offline
async function buildFx(ins) {
  const j = await (await get(DATASETS.boc_fx.source)).json();
  let rows = 0;
  for (const o of j.observations || []) {
    for (const [k, v] of Object.entries(o)) {
      const m = k.match(/^FX([A-Z]{3})CAD$/);
      if (!m || !v || v.v === undefined || v.v === "") continue;
      ins.run(o.d, m[1], Number(v.v));
      rows++;
    }
  }
  return rows;
}

const want = process.argv.slice(2).filter((a) => DATASETS[a]);
mkdirSync(OUT, { recursive: true });
for (const id of want.length ? want : Object.keys(DATASETS)) {
  const d = DATASETS[id];
  const log = (m) => console.log(`${id}: ${m}`);
  const tmp = join(OUT, id + ".db.part");
  if (existsSync(tmp)) rmSync(tmp);
  const db = new DatabaseSync(tmp);
  db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA page_size=4096");
  db.exec(`CREATE TABLE ${d.table} (${d.ddl}) WITHOUT ROWID`);
  const cols = d.ddl.replace(/,\s*PRIMARY KEY \(.*\)$/, "").split(",").map((c) => c.trim().split(" ")[0]);
  const ins = db.prepare(`INSERT OR IGNORE INTO ${d.table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  log("downloading " + d.source);
  db.exec("BEGIN");
  let rows;
  try { rows = await d.build(ins, log); db.exec("COMMIT"); }
  catch (err) { db.close(); rmSync(tmp, { force: true }); console.error(`${id}: FAILED, the previous file is kept: ${err.message}`); process.exitCode = 1; continue; }
  db.exec("VACUUM");
  db.close();
  const bytes = statSync(tmp).size;
  const others = readdirSync(OUT).filter((n) => n.endsWith(".db") && n !== id + ".db").reduce((s, n) => s + statSync(join(OUT, n)).size, 0);
  if (bytes > d.limit || others + bytes > TOTAL_LIMIT) {
    rmSync(tmp, { force: true });
    console.error(`${id}: ${(bytes / MB).toFixed(1)} MB is over the limit (${d.limit / MB} MB each, ${TOTAL_LIMIT / MB} MB together); the previous file is kept`);
    process.exitCode = 1;
    continue;
  }
  renameSync(tmp, join(OUT, id + ".db"));
  const manifest = { id, name: d.name, version: new Date().toISOString().slice(0, 10), source: d.source, licence: d.licence, rows, bytes, table: d.table, columns: cols };
  writeFileSync(join(OUT, id + ".json"), JSON.stringify(manifest, null, 2) + "\n");
  log(`${rows} rows, ${(bytes / MB).toFixed(1)} MB -> hub/reference-data/${id}.db`);
}

// Builds Chedam's reference datasets (P5 step 7; FR-11.10) into read-only SQLite files that ship with the hub's
// code (hub/pb_hooks/reference/<id>.db + <id>.json manifest), outside the store's database so backups stay small.
// The hub reads them with the sqlite3 command (lib/reference.js); they only ever suggest (FR-11.11).
//   node tools/datasets/build.mjs            all datasets made from tools/datasets/src/*.json
// Datasets downloaded from their publishers (Open Food Facts Canada, CBSA Customs Tariff, Canadian Nutrient File,
// USDA FoodData Central, FoodKeeper, India ITC-HS, Bank of Canada history) get their own builder when Sreya agrees
// to the download; until then the hub asks Open Food Facts and the Bank of Canada online, one product or day at a time.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "hub", "pb_hooks", "reference");
const SRC = join(ROOT, "tools", "datasets", "src");

const SCHEMA = {
  units: { table: "units", cols: ["code", "kind", "base", "factor", "label", "aliases"], ddl: "code TEXT PRIMARY KEY, kind TEXT, base TEXT, factor REAL, label TEXT, aliases TEXT" },
  tax_presets: { table: "presets", cols: ["province", "name", "gst", "hst", "pst", "qst", "pst_name", "note"], ddl: "province TEXT PRIMARY KEY, name TEXT, gst REAL, hst REAL, pst REAL, qst REAL, pst_name TEXT, note TEXT" },
  shelf_life: { table: "shelf", cols: ["keyword", "item", "pantry_days", "fridge_days", "freezer_days", "opened_fridge_days", "note"], ddl: "keyword TEXT, item TEXT, pantry_days INTEGER, fridge_days INTEGER, freezer_days INTEGER, opened_fridge_days INTEGER, note TEXT" },
  suppliers: { table: "suppliers", cols: ["key", "name", "aliases", "order_method", "portal_url", "phone", "email", "hours", "notes"], ddl: "key TEXT PRIMARY KEY, name TEXT, aliases TEXT, order_method TEXT, portal_url TEXT, phone TEXT, email TEXT, hours TEXT, notes TEXT" },
  hs_chapters: { table: "hs", cols: ["code", "description"], ddl: "code TEXT PRIMARY KEY, description TEXT" },
};

mkdirSync(OUT, { recursive: true });
for (const id of Object.keys(SCHEMA)) {
  const src = JSON.parse(readFileSync(join(SRC, id + ".json"), "utf8"));
  const s = SCHEMA[id];
  const file = join(OUT, id + ".db");
  if (existsSync(file)) rmSync(file);
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE ${s.table} (${s.ddl})`);
  const ins = db.prepare(`INSERT INTO ${s.table} (${s.cols.join(",")}) VALUES (${s.cols.map(() => "?").join(",")})`);
  db.exec("BEGIN");
  src.rows.forEach((r) => ins.run(...r));
  db.exec("COMMIT");
  db.exec("VACUUM");
  db.close();
  const manifest = { id, name: src.name, version: src.version, source: src.source, licence: src.licence, rows: src.rows.length, table: s.table, columns: s.cols };
  writeFileSync(join(OUT, id + ".json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${id}: ${src.rows.length} rows -> hub/pb_hooks/reference/${id}.db`);
}

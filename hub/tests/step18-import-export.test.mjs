// P1 step 8: product import and data export. The app's import libraries in Node (file types, encodings,
// header row, profiles, column mapping, transforms) and export (CSV, zip contents); then the hub: the check
// (create / skip / errors / Drafts / warnings / gaps), all-or-nothing import with a job log, categories
// created, packs, weighed goods, tax-included prices, updates, staff without prices.edit, labels on/off,
// the product form unchanged, and the owner-only full export without secrets.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step18-import-export.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { TestHub, HUB } from "./lib/hub.mjs";

const CLIENT = join(HUB, "..", "client");
const t = new TestHub({ port: 8111 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const lib = async (f) => import(pathToFileURL(join(CLIENT, "src", "lib", f)).href);
const creq = createRequire(join(CLIENT, "package.json"));
const XLSX = creq("xlsx");
const { zipSync, unzipSync, strToU8, strFromU8 } = creq("fflate");
const enc = (s) => new TextEncoder().encode(s);

let err = null;
try {
  console.log("Reading files (FR-11.01, 11.02)");
  const R = await lib("import/read.js"), P = await lib("import/profile.js"), M = await lib("import/map.js"), T = await lib("import/transform.js");
  const csv = await R.readBytes("a.csv", enc("\ufeffName,Price,UPC\nCola,1.49,067000004114\n"));
  check("CSV with a BOM: UTF-8, comma, header row 1", csv.kind === "text" && csv.encoding === "UTF-8" && csv.delimiter === "," && csv.tables[0].rows[0][0] === "Name");
  const fr = await R.readBytes("b.csv", new Uint8Array([...enc("Nom;Prix\nCr"), 0xe8, ...enc("me;3,99 $\n")]));
  check("Windows-1252 and ';' (French Excel)", fr.encoding === "Windows-1252" && fr.delimiter === ";" && fr.tables[0].rows[1][0] === "Crème");
  const tsv = await R.readBytes("c.txt", enc("Name\tPrice\nMilk\t6.49\n"));
  check("tab separated", tsv.delimiter === "\t" && tsv.tables[0].rows[1][1] === "6.49");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Store list"], [], ["Description", "Retail", "UPC"], ["Milk", 6.49, 62891520001]]), "Items");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Other"], ["x"]]), "Notes");
  const xl = await R.readBytes("d.xlsx", new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
  check("Excel: every sheet; title row skipped (header on row 3)", xl.kind === "excel" && xl.tables.length === 2 && R.headerRow(xl.tables[0].rows) === 2);
  const js = await R.readBytes("e.json", enc(JSON.stringify({ products: [{ name: "A", price: 1 }, { name: "B", sku: "x" }] })));
  check("JSON: a list inside an object, all keys as columns", js.tables[0].rows[0].join() === "name,price,sku" && js.tables[0].rows.length === 3);
  const zip = await R.readBytes("f.zip", zipSync({ "items.csv": enc("Name,Price\nA,1\n"), "more/b.json": enc('[{"name":"B"}]'), "readme.md": enc("#") }));
  check("zip: the tables inside it", zip.kind === "zip" && zip.tables.length === 2 && zip.tables.map((x) => x.name).sort().join() === "items.csv,more/b.json");

  console.log("Profiles and mapping (FR-11.02, 11.03)");
  const rows = [["Coca-Cola 6x355ml", "$7.99", "067000004114", "Beverages", "4011"], ["Bananas", "1.74", "", "Produce", "4012"]];
  const prof = P.profile(["Item Name", "Price", "GTIN", "Category", "Code"], rows);
  check("types: money, barcode, plu", prof[1].type === "money" && prof[2].type === "barcode" && prof[4].type === "plu", JSON.stringify(prof.map((p) => p.type)));
  const sug = M.suggest(prof);
  check("Square names mapped with high confidence", sug[0].field === "name" && sug[1].field === "price" && sug[2].field === "barcode" && sug[3].field === "category" && sug[0].confidence === "high", JSON.stringify(sug));
  check("an unnamed column of 4-digit codes: PLU from its values", sug[4] && sug[4].field === "plu" && sug[4].confidence !== "high", JSON.stringify(sug[4]));
  const fr2 = M.suggest(P.profile(["Nom du produit", "Prix de vente", "Code-barres", "Catégorie", "Coût"], [["Lait", "3,99", "0628915200013", "Laitier", "2,10"]]));
  check("French headings", Object.values(fr2).map((x) => x.field).join() === "name,price,barcode,category,cost", JSON.stringify(fr2));

  console.log("Transforms (FR-11.04)");
  check("money: $1,234.50, 3,99 $, 7", T.cents("$1,234.50") === 123450 && T.cents("3,99 $") === 399 && T.cents("7") === 700 && Number.isNaN(T.cents("abc")));
  check("barcode: Excel lost the UPC's leading 0 -> put back", T.barcode("36000291452") === "036000291452" && T.barcode("36000291453") === "36000291453" && T.barcode("6.70000041E+11") === "670000041000" && T.barcode("2000000000022") === "2000000000022");
  const pk = T.toRow(["Coca-Cola 6x355ml", "7.99", "067000004114", "Beverages", ""], { 0: "name", 1: "price", 2: "barcode", 3: "category" });
  check("6x355ml in the name: size 2130 mL, noted", pk.size_qty === 2130 && pk.size_unit === "ml" && pk.notes.length === 1);
  const bi = T.toRow(["Milk 2% 4L / Lait 2 % 4 L", "Canada", "kg"], { 0: "name", 1: "origin", 2: "sold_by" }, { split_names: true });
  check("'English / French' split; country to CA; sold by kg", bi.name === "Milk 2% 4L" && bi.name_fr === "Lait 2 % 4 L" && bi.origin_country === "CA" && bi.base_unit === "kg");

  console.log("Exports (FR-11.09)");
  const X = await lib("export.js");
  const c = X.csv([{ key: "a", label: "Name" }, { key: "b" }], [{ a: 'Say "hi", ok', b: 2 }, { a: "line\nbreak", b: null }]);
  check("CSV quoting (commas, quotes, line breaks)", c === 'Name,b\r\n"Say ""hi"", ok",2\r\n"line\nbreak",\r\n', JSON.stringify(c));
  const files = X.exportFiles([{ table: "products", description: "Products", rows: 1, fields: [{ name: "id", type: "text" }, { name: "price_cents", type: "number", note: "money in cents" }] }],
    { products: [{ id: "p1", price_cents: 149 }] }, "2026-10-07");
  check("export zip contents: README, dictionary (CSV + JSON), table CSV + JSON", Object.keys(files).sort().join() === "README.txt,data-dictionary.csv,data-dictionary.json,json/products.json,tables/products.csv"
    && strFromU8(files["tables/products.csv"]).includes("p1,149"));

  console.log("Hub: check");
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => { const dev = await t.pair("Device of " + n); return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token; };
  const owner = await login("Demo Owner"), manager = await login("Mira Manager"), staff = await login("Sam Staff"), cashier = await login("Cal Cashier");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const M_ = as(manager), S = as(staff);
  const cls = Object.fromEntries((await t.list("tax_classes")).items.map((x) => [x.code, x.id]));
  const count = async (col, f = "") => (await t.list(col, f)).totalItems;
  const base = [
    { line: 2, name: "Import Juice 1L", category: "Beverages", tax: "Y", tax_class: cls.standard, price_cents: 349, cost_cents: 200, barcode: "0628915209992", size_qty: 1, size_unit: "l" },
    { line: 3, name: "Import Sparkling 6-pack", category: "Fizzy", tax: "Y", tax_class: cls.standard, price_cents: 199, barcode: "0628915209985", pack_qty: 6, pack_price_cents: 999, pack_barcode: "0628915209978" },
    { line: 4, name: "Import Apples", category: "Produce", tax: "N", tax_class: cls.zero_rated, base_unit: "kg", price_cents: 440, plu: "4131" },
    { line: 5, name: "Import Mystery", category: "", tax: "", price_cents: 500, cost_cents: 900, barcode: "IMP-5" },
    { line: 6, name: "Cola again", category: "Beverages", tax_class: cls.standard, price_cents: 149, barcode: "2000000000022" },
    { line: 7, name: "Import Dup", category: "Beverages", tax_class: cls.standard, price_cents: 100, barcode: "0628915209992" },
    { line: 8, name: "", price_cents: 100, plu: "12" },
  ];
  const opts = { on_existing: "skip", create_categories: true, labels: false, scale_ack: true };
  check("a cashier cannot import", (await as(cashier).post("/api/chedam/imports/check", { rows: base, options: opts })).status === 403);
  const ck = (await M_.post("/api/chedam/imports/check", { rows: base, options: opts })).json;
  const byLine = Object.fromEntries(ck.results.map((x) => [x.line, x]));
  check("complete row: create, no Draft reason", byLine[2].action === "create" && !byLine[2].errors.length && !byLine[2].drafts.length, JSON.stringify(byLine[2]));
  check("new category noted as to be created (not a Draft reason)", byLine[3].warnings.some((d) => /Fizzy.*created/.test(d)) && !byLine[3].drafts.length && ck.gaps.categories.some((g) => g.name === "Fizzy"));
  check("no category / no tax: Draft reasons; cost above price: warning", byLine[5].drafts.length >= 2 && byLine[5].warnings.some((w) => /Costs more/.test(w)));
  check("barcode already in Chedam: skip", byLine[6].action === "skip" && byLine[6].match.via === "barcode");
  check("same barcode twice in the file: error on the second", byLine[7].errors.some((e) => /also on line 2/.test(e)));
  check("no name, bad PLU: errors", byLine[8].errors.length === 2, JSON.stringify(byLine[8].errors));
  check("summary", ck.summary.errors === 2 && ck.summary.skip === 1 && ck.summary.rows === 7, JSON.stringify(ck.summary));

  console.log("Hub: import (FR-11.07)");
  const before = await count("products");
  const fail = (await M_.post("/api/chedam/imports", { file_name: "test.csv", rows: base, options: opts })).json;
  check("rows with errors not excluded: nothing imported, job failed with the line", fail.status === "failed" && /Line 7/.test(fail.error) && (await count("products")) === before, JSON.stringify(fail).slice(0, 300));
  const ok = (await M_.post("/api/chedam/imports", { file_name: "test.csv", rows: base, options: opts, exclude: [7, 8], mapping: { "Item": "name" } })).json;
  check("excluded the bad lines: completed", ok.status === "completed" && ok.created === 4 && ok.skipped === 1 && ok.excluded === 2 && ok.categories_created === 1, JSON.stringify(ok).slice(0, 400));
  const prods = (await t.list("products", "name ~ 'Import '")).items;
  const p = (n) => prods.find((x) => x.name === n);
  check("complete rows active; the incomplete one a Draft with its reasons", p("Import Juice 1L").status === "active" && p("Import Apples").status === "active"
    && p("Import Mystery").status === "draft" && p("Import Mystery").draft_reasons.length >= 2 && ok.drafts === 1);
  const spUnits = (await t.list("selling_units", `product='${p("Import Sparkling 6-pack").id}'`)).items;
  check("pack of 6 made from the single, with its own barcode and price", spUnits.length === 2 && spUnits.some((u) => u.kind === "pack" && u.contains_qty === 6 && u.price_cents === 999 && u.barcodes.includes("0628915209978")));
  check("Fizzy category created", (await count("categories", "name='Fizzy'")) === 1 && p("Import Sparkling 6-pack").category !== "");
  check("weighed apples: kg, PLU, scale confirmed", p("Import Apples").base_unit === "kg" && p("Import Apples").scale_ack === true);
  check("size kept for unit prices", p("Import Juice 1L").size_qty === 1 && p("Import Juice 1L").size_unit === "l");
  check("labels off: nothing added to the label batch", (await count("label_batch_items", "status='pending'")) === 0 || (await t.list("label_batch_items", `product='${p("Import Juice 1L").id}'`)).items.length === 0);
  const jobs = (await M_.get("/api/chedam/imports")).json.jobs;
  check("job log: the failed and the completed job", jobs.length === 2 && jobs[0].status === "completed" && jobs[1].status === "failed");

  const tx = (await M_.post("/api/chedam/imports", { rows: [{ line: 2, name: "Import Taxed", category: "Beverages", tax_class: cls.standard, price_cents: 112, barcode: "IMP-TAX" }],
    options: { ...opts, price_includes_tax: true, labels: true } })).json;
  const taxed = (await t.list("products", "name='Import Taxed'")).items[0];
  const tu = (await t.list("selling_units", `product='${taxed.id}'`)).items[0];
  check("price $1.12 including GST+PST (12%) -> $1.00", tx.status === "completed" && tu.price_cents === 100, JSON.stringify(tu));
  check("labels on: the new product is on the label batch", (await t.list("label_batch_items", `product='${taxed.id}'`)).items.length === 1);
  const up = (await M_.post("/api/chedam/imports", { rows: [{ line: 2, name: "Import Juice 1L", price_cents: 379, barcode: "0628915209992", cost_cents: 220 }], options: { ...opts, on_existing: "update" } })).json;
  const ju = (await t.list("selling_units", `product='${p("Import Juice 1L").id}'`)).items[0];
  check("update existing: new price and cost", up.updated === 1 && ju.price_cents === 379 && (await t.list("products", `id='${p("Import Juice 1L").id}'`)).items[0].cost_cents === 220, JSON.stringify(up).slice(0, 200));
  const st = (await S.post("/api/chedam/imports", { rows: [{ line: 2, name: "Import Staff Item", category: "Beverages", tax_class: cls.standard, price_cents: 250, barcode: "IMP-STAFF" },
    { line: 3, name: "Import Juice 1L", price_cents: 999, barcode: "0628915209992" }], options: { ...opts, on_existing: "update" } })).json;
  check("staff (no prices.edit): new product a Draft; an existing price left alone", st.status === "completed" && (await t.list("products", "name='Import Staff Item'")).items[0].status === "draft"
    && (await t.list("selling_units", `id='${ju.id}'`)).items[0].price_cents === 379, JSON.stringify(st).slice(0, 300));
  const form = await M_.post("/api/chedam/catalogue/products", { product: { name: "Form product", base_unit: "each", category: p("Import Juice 1L").category, tax_class: cls.standard },
    units: [{ name: "Single", kind: "single", barcodes: ["IMP-FORM"], price_cents: 150, sell_at_pos: true, is_default: true }], activate: true });
  check("the product form still saves and activates", form.status === 200 && form.json.product.status === "active", JSON.stringify(form.json).slice(0, 200));
  const big = Array.from({ length: 2001 }, (_, i) => ({ line: i + 2, name: "x" + i }));
  check("over 2000 rows refused", (await M_.post("/api/chedam/imports/check", { rows: big, options: opts })).status === 400);

  console.log("Full export (NFR-22)");
  check("a manager cannot take the full export (owner only)", (await M_.get("/api/chedam/export/dictionary")).status === 403);
  const O = as(owner);
  const dict = (await O.get("/api/chedam/export/dictionary")).json.tables;
  const tbl = (n) => dict.find((x) => x.table === n);
  check("dictionary: the store's tables, with descriptions, row counts and fields", tbl("products") && tbl("sales") && tbl("returns") && tbl("import_jobs") && tbl("products").rows >= 15
    && tbl("products").fields.some((f) => f.name === "category" && f.links_to === "categories") && !dict.some((x) => x.table.startsWith("_")));
  const userFields = tbl("users").fields.map((f) => f.name);
  const secret = (f) => ["password", "tokenKey", "pin", "email_token"].includes(f) || /_hash$/.test(f);
  check("no secrets: no password, PIN, token or hash fields", !userFields.some(secret) && !dict.some((x) => x.fields.some((f) => secret(f.name))), userFields.join());
  const users = (await O.get("/api/chedam/export/table/users?per_page=2&page=1")).json;
  check("tables page by page; rows without secrets", users.rows.length === 2 && users.pages >= 3 && !JSON.stringify(users.rows).match(/\$2a\$|password/i), JSON.stringify(users).slice(0, 300));
  const pj = (await O.get("/api/chedam/export/table/selling_units?per_page=1000")).json.rows;
  check("JSON fields as lists (barcodes), not bytes", pj.some((u) => Array.isArray(u.barcodes) && u.barcodes.includes("0628915209992")));
  check("unknown table refused", (await O.get("/api/chedam/export/table/_superusers")).status === 404);
} catch (e) {
  err = e;
}
await t.finish(err);

// P1 step 7: shelf labels. The app's label libraries in Node (barcodes decoded with ZXing, unit prices,
// layout geometry, exact page sizes of the PDF); then the hub: automatic adds on a price change and a new
// product (BR-25), duplicates merged, add by code / category / list, labels.manage, a printed batch is a
// snapshot, "printed" takes its lines off unless they changed since, the last 10 batches, layouts that do
// not fit refused, module off = no automatic adds.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step17-labels.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { TestHub, HUB } from "./lib/hub.mjs";

const CLIENT = join(HUB, "..", "client");
const t = new TestHub({ port: 8110 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const lib = async (f) => import(pathToFileURL(join(CLIENT, "src", "lib", "labels", f)).href);
const Z = createRequire(join(CLIENT, "package.json"))("@zxing/library");

let err = null;
try {
  console.log("Barcodes (decoded by ZXing)");
  const B = await lib("barcode.js");
  const decode = (m) => {
    const q = "0".repeat(15) + m + "0".repeat(15);
    const row = new Z.BitArray(q.length);
    for (let i = 0; i < q.length; i++) if (q[i] === "1") row.set(i);
    try { return new Z.MultiFormatOneDReader(new Map()).decodeRow(0, row, new Map()).getText(); } catch (_) { return "FAIL"; }
  };
  const cases = [["2000000000022", "EAN-13"], ["036000291452", "UPC-A"], ["96385074", "EAN-8"], ["S-000042", "CODE128"], ["SC-MS72-VDES", "CODE128"]];
  for (const [c, type] of cases) { const e = B.encode(c); check(`${c}: ${type}, decodes back`, e.type === type && decode(e.modules) === c, e.type + " " + decode(e.modules)); }
  check("a 13-digit number with a wrong check digit is not EAN-13", B.encode("2000000000023").type === "CODE128");
  let ok128 = 0;
  for (let i = 32; i < 127; i++) { const s = "a" + String.fromCharCode(i) + "Z"; if (decode(B.encode(s).modules) === s) ok128++; }
  check("CODE128: all 95 printable characters", ok128 === 95);

  console.log("Unit prices (FR-5.14)");
  const U = await lib("unitprice.js");
  check("bananas $1.74/kg: $0.17 / 100 g", JSON.stringify(U.unitPrice({ kind: "weight", price_cents: 174, base_unit: "kg" })) === '{"cents":17,"per":"100 g"}');
  check("by the lb: per kg", JSON.stringify(U.unitPrice({ kind: "weight", price_cents: 199, base_unit: "lb" })) === '{"cents":439,"per":"kg"}');
  check("200 g chips $3.99: $2.00 / 100 g (or $19.95 / kg)", U.unitPrice({ kind: "single", price_cents: 399, base_qty: 1, size_qty: 200, size_unit: "g" }).cents === 200
    && U.unitPrice({ kind: "single", price_cents: 399, base_qty: 1, size_qty: 200, size_unit: "g" }, "kg").cents === 1995);
  check("6 × 355 mL $7.99: $0.38 / 100 mL", JSON.stringify(U.unitPrice({ kind: "pack", price_cents: 799, base_qty: 6, size_qty: 355, size_unit: "ml" })) === '{"cents":38,"per":"100 mL"}');
  check("a dozen eggs: per item; one item: none; no size: none", U.unitPrice({ kind: "single", price_cents: 499, base_qty: 1, size_qty: 12, size_unit: "each" }).per === "item"
    && U.unitPrice({ kind: "single", price_cents: 499, base_qty: 1, size_qty: 1, size_unit: "each" }) === null && U.unitPrice({ kind: "single", price_cents: 499, base_qty: 1 }) === null);
  check("size text: 6 × 355 mL", U.sizeText({ kind: "pack", base_qty: 6, size_qty: 355, size_unit: "ml" }) === "6 × 355 mL");

  console.log("Layout geometry and PDF (FR-5.15, 5.16)");
  const G = await lib("geometry.js");
  const a4 = { page_w_mm: 210, page_h_mm: 297, cols: 3, rows: 8, label_w_mm: 63.5, label_h_mm: 33.9, margin_top_mm: 12.9, margin_left_mm: 7.2, gap_x_mm: 2.5, gap_y_mm: 0 };
  const pages = G.cells(a4, 30, 5);
  check("start at position 5: first label in row 2 column 2; 30 labels -> 2 pages", pages.length === 2 && pages[0].length === 20 && pages[0][0].slot === 5
    && Math.abs(pages[0][0].x - (7.2 + 63.5 + 2.5)) < 1e-9 && Math.abs(pages[0][0].y - (12.9 + 33.9)) < 1e-9 && pages[1][0].slot === 1);
  check("printer offset moves every label", G.cells({ ...a4, offset_x_mm: 1.5, offset_y_mm: -1 }, 1, 1)[0][0].x === 8.7);
  check("a layout too wide is caught", G.fits({ ...a4, cols: 4 }) !== "" && G.fits(a4) === "");
  const P = await lib("pdf.js");
  const item = { qty: 3, name: "Cola 355 mL can", kind: "single", price_cents: 149, base_unit: "each", base_qty: 1, size_qty: 355, size_unit: "ml", barcode: "2000000000022" };
  const doc = await P.labelsPdf({ layout: a4, template: { fields: { name: true, price: true, unit_price: true, barcode: true } }, items: [item], start: 23 });
  check("A4 PDF exactly 210 × 297 mm; 3 labels from position 23 run onto page 2", Math.abs(doc.internal.pageSize.getWidth() - 210) < 0.01
    && Math.abs(doc.internal.pageSize.getHeight() - 297) < 0.01 && doc.getNumberOfPages() === 2);
  const letter = { page_w_mm: 215.9, page_h_mm: 279.4, cols: 3, rows: 10, label_w_mm: 66.68, label_h_mm: 25.4, margin_top_mm: 12.7, margin_left_mm: 4.76, gap_x_mm: 3.18, gap_y_mm: 0 };
  const alignDoc = await P.alignmentPdf(letter);
  const out = alignDoc.output();
  const ops = alignDoc.internal.pages[1].join("\n");
  const box = (out.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/) || []).slice(1).map(Number);
  check("alignment page: Letter (612 × 792 pt), every position numbered", Math.abs(box[0] - 612) < 0.01 && Math.abs(box[1] - 792) < 0.01 && /\(30\) Tj/.test(ops) && /\(1\) Tj/.test(ops), JSON.stringify(box));
  const roll = await P.labelsPdf({ layout: { page_w_mm: 50.8, page_h_mm: 25.4, cols: 1, rows: 1, label_w_mm: 50.8, label_h_mm: 25.4 }, template: { fields: { name: true, price: true } }, items: [{ ...item, qty: 4 }], start: 1 });
  check("thermal roll: one label a page", roll.getNumberOfPages() === 4);

  console.log("Hub: the label batch");
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => { const dev = await t.pair("Device of " + n); return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token; };
  const staff = await login("Sam Staff"), cashier = await login("Cal Cashier"), manager = await login("Mira Manager");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const S = as(staff), M = as(manager);
  check("a cashier cannot use labels", (await as(cashier).get("/api/chedam/labels/batch")).status === 403);
  let batch = (await S.get("/api/chedam/labels/batch")).json;
  check("sample products went on sale: their labels are waiting (new product)", batch.items.length >= 10 && batch.items.every((x) => x.reasons.includes("new_product")), JSON.stringify(batch.items.length));
  // Start clean
  const firstLayout = (await t.list("label_layouts", "", manager)).items.find((l) => l.name.startsWith("A4 3"));
  const tmpl = (await t.list("label_templates", "is_default = true", manager)).items[0];
  const all = await S.post("/api/chedam/labels/batches", { layout: firstLayout.id, template: tmpl.id, start: 1 });
  check("a batch of everything waiting: a snapshot with layout and template", all.status === 200 && all.json.items.length === batch.items.length && all.json.layout.cols === 3 && all.json.template.fields.price === true, JSON.stringify(all.json).slice(0, 300));
  const conf = await S.post(`/api/chedam/labels/batches/${all.json.id}/confirm`, {});
  check("printed: the batch is empty", conf.json.done === batch.items.length && (await S.get("/api/chedam/labels/batch")).json.items.length === 0);

  const look = async (c) => (await S.get("/api/chedam/catalogue/lookup?code=" + c)).json.matches[0];
  const cola = await look("2000000000022");
  await t.su_("PATCH", `/api/collections/selling_units/records/${cola.unit.id}`, { price_cents: 159 });
  batch = (await S.get("/api/chedam/labels/batch")).json;
  check("price change: the cola is added with its new price (BR-25)", batch.items.length === 1 && batch.items[0].reasons.join() === "price_change" && batch.items[0].price_cents === 159, JSON.stringify(batch.items));
  await t.su_("PATCH", `/api/collections/selling_units/records/${cola.unit.id}`, { price_cents: 169 });
  await S.post("/api/chedam/labels/batch", { code: "2000000000022", qty: 3 });
  batch = (await S.get("/api/chedam/labels/batch")).json;
  check("price changed again and scanned: still one line (merged), 3 labels, both reasons", batch.items.length === 1 && batch.items[0].qty === 3 && batch.items[0].reasons.join() === "price_change,manual", JSON.stringify(batch.items));
  const snacks = (await t.list("categories", "name='Snacks'")).items[0];
  const byCat = await S.post("/api/chedam/labels/batch", { category: snacks.id });
  check("add a whole category", byCat.status === 200 && byCat.json.added >= 1 && byCat.json.items.length >= 2, JSON.stringify(byCat.json).slice(0, 200));
  check("unknown code refused", (await S.post("/api/chedam/labels/batch", { code: "9999999999999" })).status === 400);

  const colaLine = batch.items[0];
  const mk = await S.post("/api/chedam/labels/batches", { items: [{ id: colaLine.id, qty: 2 }], layout: firstLayout.id, template: tmpl.id, start: 7 });
  check("a batch of chosen lines, 2 labels from position 7", mk.json.labels === 2 && mk.json.start === 7 && mk.json.items[0].price_cents === 169);
  await t.su_("PATCH", `/api/collections/selling_units/records/${cola.unit.id}`, { price_cents: 179 });
  const c2 = await S.post(`/api/chedam/labels/batches/${mk.json.id}/confirm`, {});
  check("its price changed before 'printed': the line stays to print again", c2.json.done === 0 && c2.json.kept === 1
    && (await S.get("/api/chedam/labels/batch")).json.items.some((x) => x.id === colaLine.id && x.price_cents === 179), JSON.stringify(c2.json).slice(0, 200));
  check("start position beyond the sheet refused", (await S.post("/api/chedam/labels/batches", { layout: firstLayout.id, template: tmpl.id, start: 25 })).status === 400);
  check("quantity 0 takes a line off", (await S.post("/api/chedam/labels/batch/" + colaLine.id, { qty: 0 })).json.items.every((x) => x.id !== colaLine.id));

  const recent = (await S.get("/api/chedam/labels/batches")).json.batches;
  check("printed batches listed for reprint (newest first)", recent.length === 2 && recent[0].number > recent[1].number && recent[0].names.length >= 1, JSON.stringify(recent.map((b) => b.number)));
  for (let i = 0; i < 10; i++) {
    await S.post("/api/chedam/labels/batch", { code: "2000000000060" });
    const b = (await S.post("/api/chedam/labels/batches", { layout: firstLayout.id, template: tmpl.id, start: 1 })).json;
    await S.post(`/api/chedam/labels/batches/${b.id}/confirm`, {});
  }
  check("only the last 10 are offered", (await S.get("/api/chedam/labels/batches")).json.batches.length === 10);

  console.log("Layouts and templates");
  check("a layout that does not fit is refused", (await S.post("/api/chedam/labels/layouts/check", { ...firstLayout, cols: 4 })).status === 400);
  const mine = await t.api("POST", "/api/collections/label_layouts/records", { name: "My sheet 2 × 7", paper: "letter", page_w_mm: 215.9, page_h_mm: 279.4, cols: 2, rows: 7,
    label_w_mm: 99, label_h_mm: 38, margin_top_mm: 6, margin_left_mm: 6, gap_x_mm: 5, gap_y_mm: 0, cut_lines: false, offset_x_mm: 0, offset_y_mm: 0 }, { token: staff });
  check("staff with labels.manage can save a custom layout", mine.status === 200, JSON.stringify(mine.json));
  check("a cashier cannot", (await t.api("POST", "/api/collections/label_layouts/records", { name: "x", paper: "a4" }, { token: cashier })).status >= 400);
  check("6 preset layouts, 2 templates", (await t.list("label_layouts", "preset = true", manager)).items.length === 6 && (await t.list("label_templates", "", manager)).items.length === 2);

  console.log("Module off");
  const mod = (await t.list("modules", "module='labels'")).items[0];
  await t.su_("PATCH", `/api/collections/modules/records/${mod.id}`, { enabled: false });
  const before = (await S.get("/api/chedam/labels/batch")).json.items.length;
  await t.su_("PATCH", `/api/collections/selling_units/records/${cola.unit.id}`, { price_cents: 189 });
  check("Labels module off: a price change adds nothing", (await S.get("/api/chedam/labels/batch")).json.items.length === before);
} catch (e) {
  err = e;
}
await t.finish(err);

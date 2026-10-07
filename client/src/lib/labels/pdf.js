// Shelf labels as an exact-size PDF (FR-5.14-5.16), drawn in the browser with jsPDF (loaded only when
// needed). Page and label sizes are millimetres; print at 100% ("Actual size"), never "Fit to page".
//   labelsPdf(batch, opts)  batch: {layout, template: {fields}, items: [{qty, ...label data}], start}
//                           opts: {logo: dataURL|null}  -> jsPDF document
//   alignmentPdf(layout)    every label outlined and numbered, with a 10 mm ruler, to check a sheet
// Works in Node too (tests check page sizes and positions).
import { cells, perPage } from "./geometry.js";
import { encode } from "./barcode.js";
import { unitPrice, sizeText } from "./unitprice.js";

const COUNTRY = { CA: "Canada", US: "USA", MX: "Mexico", CN: "China", IN: "India", PE: "Peru", CL: "Chile", ES: "Spain", IT: "Italy",
  FR: "France", NZ: "New Zealand", CR: "Costa Rica", GT: "Guatemala", EC: "Ecuador", TH: "Thailand", VN: "Vietnam", PH: "Philippines",
  BR: "Brazil", ZA: "South Africa", AR: "Argentina", NL: "Netherlands", DE: "Germany", JP: "Japan", KR: "Korea", TW: "Taiwan" };
const COUNTRY_FR = { CA: "Canada", US: "États-Unis", MX: "Mexique", CN: "Chine", IN: "Inde", PE: "Pérou", CL: "Chili", ES: "Espagne", IT: "Italie",
  FR: "France", NZ: "Nouvelle-Zélande", CR: "Costa Rica", GT: "Guatemala", EC: "Équateur", TH: "Thaïlande", VN: "Viêt Nam", PH: "Philippines",
  BR: "Brésil", ZA: "Afrique du Sud", AR: "Argentine", NL: "Pays-Bas", DE: "Allemagne", JP: "Japon", KR: "Corée", TW: "Taïwan" };
const PT = 2.8346;                              // points per mm

const money = (c) => "$" + ((Number(c) || 0) / 100).toFixed(2);

async function newDoc(l) {
  const { jsPDF } = await import("jspdf");
  const w = l.page_w_mm, h = l.page_h_mm;
  return new jsPDF({ unit: "mm", format: [w, h], orientation: w > h ? "landscape" : "portrait", compress: true });
}

function priceSuffix(d) {
  if (d.kind === "weight") return "/" + (d.base_unit || "kg");
  if (d.kind !== "single" && d.unit_name) return " " + d.unit_name;
  return "";
}

const QUIET = 6;                                  // modules of white each side
const MIN_MOD = 0.19;                             // mm: narrower bars do not scan reliably

// Width a barcode needs at the smallest bar that still scans.
function barcodeMinW(code) { const e = encode(code); return e ? (e.modules.length + 2 * QUIET) * MIN_MOD : 0; }

// Vector bars; human-readable digits under them. Returns the height used.
function drawBarcode(doc, code, x, y, maxW, h) {
  const e = encode(code);
  if (!e) return 0;
  const quiet = QUIET;
  const mod = Math.min(0.5, maxW / (e.modules.length + 2 * quiet));
  if (mod < MIN_MOD - 1e-9) return 0;             // too small to scan: leave it off
  const textH = Math.max(1.6, Math.min(2.6, h * 0.22));
  const barH = h - textH - 0.3;
  const x0 = x + quiet * mod;
  doc.setFillColor(0, 0, 0);
  let i = 0;
  while (i < e.modules.length) {
    if (e.modules[i] !== "1") { i++; continue; }
    let j = i;
    while (j < e.modules.length && e.modules[j] === "1") j++;
    doc.rect(x0 + i * mod, y, (j - i) * mod, barH, "F");
    i = j;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(textH * PT * 0.95);
  doc.text(e.text, x0 + (e.modules.length * mod) / 2, y + h - 0.2, { align: "center", baseline: "bottom" });
  return h;
}

function drawLabel(doc, cell, d, f, opts) {
  const { x, y, w, h } = cell;
  const s = Math.max(0.55, Math.min(w / 63.5, h / 33.9, 1.8));     // scale against a 63.5 × 33.9 mm label
  const pad = Math.max(1.2, 2 * s);
  const ix = x + pad, iw = w - 2 * pad;
  let top = y + pad;
  // Logo, top right
  let logoW = 0;
  if (f.logo && opts.logo) {
    const lh = Math.min(7 * s, h * 0.22);
    try { doc.addImage(opts.logo, x + w - pad - lh * 1.6, top, lh * 1.6, lh, undefined, "FAST"); logoW = lh * 1.6 + 1; } catch (_) { logoW = 0; }
  }
  // Name (2 lines at most), then the French name and size
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  const nameSize = 9.5 * s;
  doc.setFontSize(nameSize);
  const lines = doc.splitTextToSize(d.name || "", iw - logoW).slice(0, 2);
  doc.text(lines, ix, top, { baseline: "top" });
  top += lines.length * nameSize / PT * 1.15;
  doc.setFont("helvetica", "normal");
  const small = 6.5 * s;
  doc.setFontSize(small);
  const sub = [f.name_fr && d.name_fr ? d.name_fr : "", sizeText(d)].filter(Boolean).join(" · ");
  if (sub) { doc.text(doc.splitTextToSize(sub, iw)[0], ix, top, { baseline: "top" }); top += small / PT * 1.2; }
  if (f.origin && d.origin) {
    const fr = d.origin === "CA" ? "Produit du Canada" : "Origine : " + (COUNTRY_FR[d.origin] || COUNTRY[d.origin] || d.origin);
    const o = "Product of " + (COUNTRY[d.origin] || d.origin) + (f.name_fr ? " / " + fr : "");
    doc.text(doc.splitTextToSize(o, iw)[0], ix, top, { baseline: "top" });
    top += small / PT * 1.2;
  }
  // Price, bottom right; unit price under it
  const bottom = y + h - pad;
  const up = f.unit_price ? unitPrice(d, f.unit_price_basis || "auto") : null;
  let priceBottom = bottom, priceArea = 0;
  if (up) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(small);
    doc.text(money(up.cents) + " / " + up.per, x + w - pad, bottom, { align: "right", baseline: "bottom" });
    priceArea = doc.getTextWidth(money(up.cents) + " / " + up.per) + 1.5;
    priceBottom = bottom - small / PT * 1.25;
  }
  if (f.price) {
    // "$4.39" large, then "/kg" or " 6-pack" smaller after it
    const suffix = priceSuffix(d);
    let bigSize = Math.max(8, Math.min(22 * s, (priceBottom - top) * PT * 0.95));
    const needBar = f.barcode && d.barcode && !(f.plu && d.plu) ? barcodeMinW(d.barcode) + 1.5 : 0;
    const priceW = (size) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(Math.max(6, size * 0.4));
      const sw = suffix ? doc.getTextWidth(suffix) + 0.6 : 0;
      doc.setFont("helvetica", "bold"); doc.setFontSize(size);
      return doc.getTextWidth(money(d.price_cents)) + sw;
    };
    // Smaller price, rather than a barcode that will not scan
    while (needBar && bigSize > 9 && priceW(bigSize) + needBar > iw) bigSize *= 0.92;
    priceArea = Math.max(priceArea, priceW(bigSize) + 1.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(Math.max(6, bigSize * 0.4));
    const sufW = suffix ? doc.getTextWidth(suffix) + 0.6 : 0;
    if (suffix) doc.text(suffix, x + w - pad, priceBottom, { align: "right", baseline: "bottom" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(bigSize);
    doc.text(money(d.price_cents), x + w - pad - sufW, priceBottom, { align: "right", baseline: "bottom" });
  }
  // Barcode bottom left (or the PLU for produce), in the space the price leaves
  const leftW = Math.max(0, iw - priceArea);
  if (f.plu && d.plu) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8 * s);
    doc.text("PLU " + d.plu, ix, bottom, { baseline: "bottom" });
  } else if (f.barcode && d.barcode) {
    const bh = Math.min(10 * s, bottom - top - 0.5);
    if (bh > 4) drawBarcode(doc, d.barcode, ix - 1, bottom - bh, leftW, bh);
  }
}

function cutLines(doc, l, pageCells) {
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.1);
  doc.setLineDashPattern([1, 1], 0);
  pageCells.forEach((c) => doc.rect(c.x, c.y, c.w, c.h, "S"));
  doc.setLineDashPattern([], 0);
}

// One label per copy wanted, in order.
function expand(items) {
  const out = [];
  items.forEach((it) => { for (let i = 0; i < (it.qty || 1); i++) out.push(it); });
  return out;
}

export async function labelsPdf(batch, opts = {}) {
  const l = batch.layout;
  const f = (batch.template && batch.template.fields) || {};
  const list = expand(batch.items);
  const pages = cells(l, list.length, batch.start || 1);
  const doc = await newDoc(l);
  let k = 0;
  pages.forEach((pageCells, p) => {
    if (p > 0) doc.addPage([l.page_w_mm, l.page_h_mm], l.page_w_mm > l.page_h_mm ? "landscape" : "portrait");
    if (l.cut_lines) {
      // Lines around every position on the page, so the sheet is easy to cut.
      const all = cells(l, perPage(l), 1)[0];
      cutLines(doc, l, all);
    }
    pageCells.forEach((c) => drawLabel(doc, c, list[k++], f, opts));
  });
  doc.setProperties({ title: "Chedam labels" + (batch.number ? " batch " + batch.number : ""), creator: "Chedam" });
  return doc;
}

export async function alignmentPdf(l) {
  const doc = await newDoc(l);
  const all = cells(l, perPage(l), 1)[0];
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.setFont("helvetica", "normal");
  all.forEach((c) => {
    doc.rect(c.x, c.y, c.w, c.h, "S");
    doc.setFontSize(Math.min(14, c.h * 0.5 * PT * 0.5));
    doc.text(String(c.slot), c.x + c.w / 2, c.y + c.h / 2, { align: "center", baseline: "middle" });
  });
  // 10 mm ruler from the top-left corner of the page (printer scaling check)
  if (l.page_w_mm > 40 && l.page_h_mm > 40) {
    doc.setLineWidth(0.3);
    doc.line(5, 5, 55, 5); doc.line(5, 5, 5, 35);
    for (let i = 0; i <= 50; i += 10) doc.line(5 + i, 4, 5 + i, 6);
    for (let i = 0; i <= 30; i += 10) doc.line(4, 5 + i, 6, 5 + i);
    doc.setFontSize(6);
    doc.text("50 mm", 56, 5, { baseline: "middle" });
    doc.text("Alignment test: print at 100% (Actual size) on plain paper, hold it over a label sheet against the light.", 8, l.page_h_mm - 4, { maxWidth: l.page_w_mm - 16 });
  }
  return doc;
}

export const _test = { expand, priceSuffix };

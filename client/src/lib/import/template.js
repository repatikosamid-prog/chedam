// The products import template (2026-10-09 feedback): the columns Chedam reads, shown before importing and
// downloadable as Excel or CSV to fill in (Google Sheets: File > Import the template, fill it in, then
// File > Download > .xlsx or .csv and import that). The headings are the names the import recognises at
// once (lib/import/map.js), so a filled-in template maps itself.
//   COLUMNS: [{ heading, field, need: "required" | "to sell" | "optional", what, example: [3 values] }]
//   templateRows(classes) -> rows of cells (headings + 3 examples)
//   downloadTemplate(format, {categories, classes})   format: xlsx | csv

import { csv, download } from "../export.js";

export const COLUMNS = [
  { heading: "Name", field: "name", need: "required", what: "Product name as shown on the till and the receipt.", example: ["Cola 355 mL can", "Bananas", "Vape pods 2-pack"] },
  { heading: "Category", field: "category", need: "to sell", what: "A category of the store; new names can be created during the import.", example: ["Drinks", "Produce", "Tobacco and vape"] },
  { heading: "Price", field: "price", need: "to sell", what: "Selling price in dollars, e.g. 1.49 (per kg or lb for products sold by weight).", example: ["1.49", "1.74", "19.99"] },
  { heading: "Tax", field: "tax", need: "to sell", what: "The store's tax class (its name, see the list).", example: ["", "", ""] },
  { heading: "Barcode", field: "barcode", need: "to sell", what: "UPC/EAN as printed under the bars. A product needs a barcode or a PLU.", example: ["2000000000022", "", "2000000000107"] },
  { heading: "PLU", field: "plu", need: "to sell", what: "Produce code (4 or 5 digits), for products without a barcode.", example: ["", "4011", ""] },
  { heading: "Sold by", field: "sold_by", need: "optional", what: "each, kg or lb. Empty means each.", example: ["each", "kg", "each"] },
  { heading: "Cost", field: "cost", need: "optional", what: "What the store pays per unit, in dollars.", example: ["0.60", "0.95", "9.00"] },
  { heading: "Size", field: "size", need: "optional", what: "Net size, e.g. 355 ml, 1.5 L, 500 g (for unit prices on labels).", example: ["355 ml", "", ""] },
  { heading: "Pack qty", field: "pack_qty", need: "optional", what: "Units in a pack sold as one item (e.g. 12 for a 12-pack).", example: ["12", "", ""] },
  { heading: "Pack price", field: "pack_price", need: "optional", what: "Price of that pack, in dollars.", example: ["8.99", "", ""] },
  { heading: "Pack barcode", field: "pack_barcode", need: "optional", what: "Barcode on the pack.", example: ["2000000000039", "", ""] },
  { heading: "Country of origin", field: "origin", need: "optional", what: "Country name or 2-letter code (CA, US, MX...).", example: ["CA", "EC", "CN"] },
  { heading: "Reorder point", field: "reorder_point", need: "optional", what: "Stock level that means: order more.", example: ["24", "10", "5"] },
  { heading: "Age restricted", field: "age", need: "optional", what: "19+ (or 18+) for tobacco, vape, alcohol, lottery; empty if not.", example: ["", "", "19+"] },
  { heading: "French name", field: "name_fr", need: "optional", what: "Nom en français (labels).", example: ["Cola canette 355 mL", "Bananes", "Capsules de vapotage, paquet de 2"] },
  { heading: "Notes", field: "notes", need: "optional", what: "Longer description, for the store's own use.", example: ["", "Ripen at room temperature", "Behind the counter"] },
];

export const NEED = { required: "Required", "to sell": "Needed to sell (else a Draft)", optional: "Optional" };

export function templateRows(classes = []) {
  const tax = (classes.find((c) => /standard|gst.*pst/i.test(c.name + " " + c.code)) || classes[0] || { name: "" }).name;
  const zero = (classes.find((c) => /zero/i.test(c.name + " " + c.code)) || { name: tax }).name;
  const ex = (c, i) => (c.field === "tax" ? [tax, zero, tax][i] : c.example[i]);
  return [COLUMNS.map((c) => c.heading), ...[0, 1, 2].map((i) => COLUMNS.map((c) => ex(c, i)))];
}

export async function downloadTemplate(format, { categories = [], classes = [] } = {}) {
  const rows = templateRows(classes);
  if (format === "csv") {
    const cols = rows[0].map((h, i) => ({ key: String(i), label: h }));
    const body = rows.slice(1).map((r) => Object.fromEntries(r.map((v, i) => [String(i), v])));
    return download("chedam-products-template.csv", new Blob(["﻿" + csv(cols, body)], { type: "text/csv;charset=utf-8" }));
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = COLUMNS.map((c) => ({ wch: Math.max(12, c.heading.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  const help = [["Column", "Needed", "What to put in it"], ...COLUMNS.map((c) => [c.heading, NEED[c.need], c.what]),
    [], ["Tax classes of this store"], ...classes.map((c) => [c.name]), [], ["Categories of this store"], ...categories.map((c) => [c.name])];
  const hs = XLSX.utils.aoa_to_sheet(help);
  hs["!cols"] = [{ wch: 22 }, { wch: 30 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, hs, "How to fill it in");
  return download("chedam-products-template.xlsx", new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

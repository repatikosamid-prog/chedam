// Exports (P1 step 8; FR-11.09, NFR-22). Any list to CSV, Excel or PDF; the full business export (every
// table as CSV and JSON, plus the data dictionary) as one zip, made in the owner's browser.
// The pure parts (csv, zip contents) run in Node for tests.
import { zipSync, strToU8 } from "fflate";

const cellText = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

// RFC 4180: quotes around values with commas, quotes or line breaks; quotes doubled. CRLF lines.
export function csv(columns, rows) {
  const q = (v) => { const s = cellText(v); return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [columns.map((c) => q(c.label || c.key)).join(","), ...rows.map((r) => columns.map((c) => q(c.value ? c.value(r) : r[c.key])).join(","))].join("\r\n") + "\r\n";
}

export function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Local date and time in file names: 20261007-2159
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()); };

// columns: [{key, label, value?(row)}]; format: csv | xlsx | pdf
export async function exportList(title, columns, rows, format) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + stamp();
  if (format === "csv") return download(base + ".csv", new Blob(["﻿" + csv(columns, rows)], { type: "text/csv;charset=utf-8" }));
  const data = rows.map((r) => columns.map((c) => { const v = c.value ? c.value(r) : r[c.key]; return typeof v === "number" ? v : cellText(v); }));
  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([columns.map((c) => c.label || c.key), ...data]);
    ws["!cols"] = columns.map((c, i) => ({ wch: Math.min(50, Math.max(8, String(c.label || c.key).length + 2, ...data.slice(0, 200).map((r) => String(r[i]).length + 1))) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title.substring(0, 31));
    return download(base + ".xlsx", new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }
  // PDF: a plain table, landscape Letter, repeated header on every page
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "landscape" });
  const W = 279.4, H = 215.9, m = 10, line = 5;
  const widths = columns.map((c, i) => Math.max(String(c.label || c.key).length, ...data.slice(0, 300).map((r) => String(r[i]).length)));
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const colW = widths.map((w) => ((W - 2 * m) * w) / total);
  doc.setFontSize(12); doc.setFont("helvetica", "bold");
  doc.text(title + " (" + new Date().toLocaleString() + ")", m, m);
  let y = m + 8;
  const header = () => {
    doc.setFontSize(8); doc.setFont("helvetica", "bold");
    let x = m;
    columns.forEach((c, i) => { doc.text(doc.splitTextToSize(String(c.label || c.key), colW[i] - 1)[0], x, y); x += colW[i]; });
    doc.setFont("helvetica", "normal"); y += line;
  };
  header();
  data.forEach((r) => {
    if (y > H - m) { doc.addPage([W, H], "landscape"); y = m; header(); }
    let x = m;
    r.forEach((v, i) => { doc.text(doc.splitTextToSize(cellText(v), colW[i] - 1)[0] || "", x, y); x += colW[i]; });
    y += line;
  });
  return download(base + ".pdf", doc.output("blob"));
}

// Files of the full export, from the dictionary and every table's rows (pure).
export function exportFiles(dict, tables, at) {
  const files = {};
  const readme = ["Chedam full business export", "Made: " + at, "",
    "tables/<name>.csv   every table as a spreadsheet (UTF-8, comma separated)",
    "json/<name>.json    the same rows as JSON (lists and objects kept as they are)",
    "data-dictionary.csv / .json   what each table and field is; money is in cents (1234 = $12.34)",
    "", "Not included, on purpose: passwords, PINs, device keys and sign-in tokens.", ""].join("\r\n");
  files["README.txt"] = strToU8(readme);
  files["data-dictionary.json"] = strToU8(JSON.stringify(dict, null, 2));
  const dictRows = [];
  dict.forEach((t) => t.fields.forEach((f) => dictRows.push({ table: t.table, table_description: t.description, rows: t.rows, field: f.name, type: f.type,
    required: f.required, values: (f.values || []).join(" | "), links_to: f.links_to || "", note: f.note || "" })));
  files["data-dictionary.csv"] = strToU8("﻿" + csv(["table", "table_description", "rows", "field", "type", "required", "values", "links_to", "note"].map((k) => ({ key: k })), dictRows));
  dict.forEach((t) => {
    const rows = tables[t.table] || [];
    files["tables/" + t.table + ".csv"] = strToU8("﻿" + csv(t.fields.map((f) => ({ key: f.name })), rows));
    files["json/" + t.table + ".json"] = strToU8(JSON.stringify(rows, null, 1));
  });
  return files;
}

// The full export: fetches every table page by page, then one zip. onProgress(text)
export async function fullExport(api, onProgress = () => {}) {
  const d = await api("GET", "/api/chedam/export/dictionary");
  if (!d.ok) throw new Error(d.message);
  const tables = {};
  let n = 0;
  for (const t of d.json.tables) {
    onProgress("Reading " + t.table + " (" + ++n + " of " + d.json.tables.length + ")");
    tables[t.table] = [];
    for (let page = 1; ; page++) {
      const r = await api("GET", "/api/chedam/export/table/" + t.table + "?per_page=1000&page=" + page, null, { timeout: 60000 });
      if (!r.ok) throw new Error(t.table + ": " + r.message);
      tables[t.table].push(...r.json.rows);
      if (page >= r.json.pages) break;
    }
  }
  onProgress("Making the zip…");
  const zip = zipSync(exportFiles(d.json.tables, tables, d.json.at), { level: 6 });
  download("chedam-export-" + stamp() + ".zip", new Blob([zip], { type: "application/zip" }));
  return { tables: d.json.tables.length, rows: Object.values(tables).reduce((a, r) => a + r.length, 0), bytes: zip.length };
}

// Reading an import file in the browser (P1 step 8; FR-11.01, 11.02). Pure apart from the parsers, so it
// runs in Node for tests. Detects the file type, text encoding, delimiter and header row.
//   readBytes(name, bytes) -> { kind, encoding, delimiter, tables: [{ name, rows: string[][] }] }
//   headerRow(rows) -> index of the row that looks like column names
// CSV/TSV/TXT (Papa Parse), Excel .xlsx/.xls/.ods (SheetJS), JSON, Parquet (hyparquet), zip of these (fflate).
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { unzipSync } from "fflate";
import { parquetReadObjects } from "hyparquet";

const MAX_ROWS = 20000;

export function kindOf(name, bytes) {
  const n = name.toLowerCase();
  const b = bytes.subarray(0, 4);
  if (b[0] === 0x50 && b[1] === 0x4b) return n.endsWith(".xlsx") || n.endsWith(".ods") ? "excel" : "zip";   // PK: zip container
  if (b[0] === 0xd0 && b[1] === 0xcf) return "excel";                                                     // old .xls
  if (b[0] === 0x50 && b[1] === 0x41 && b[2] === 0x52 && b[3] === 0x31) return "parquet";                // PAR1
  if (n.endsWith(".json")) return "json";
  if (n.endsWith(".parquet")) return "parquet";
  return "text";
}

// UTF-8 (with or without BOM, or UTF-16 with BOM); otherwise Windows-1252, what older Windows tills export.
export function decode(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "UTF-16" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "UTF-16" };
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start)), encoding: "UTF-8" }; }
  catch { return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "Windows-1252" }; }
}

const cell = (v) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().substring(0, 10) : typeof v === "object" ? JSON.stringify(v) : String(v).trim());

function fromObjects(list) {
  const cols = [];
  list.forEach((o) => Object.keys(o || {}).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
  return [cols, ...list.map((o) => cols.map((k) => cell(o ? o[k] : "")))];
}

function textTable(name, bytes) {
  const { text, encoding } = decode(bytes);
  const r = Papa.parse(text, { delimiter: "", skipEmptyLines: "greedy" });
  return { encoding, delimiter: r.meta.delimiter, table: { name, rows: r.data.slice(0, MAX_ROWS + 50).map((row) => row.map(cell)) } };
}

async function one(name, bytes) {
  const kind = kindOf(name, bytes);
  if (kind === "excel") {
    const wb = XLSX.read(bytes, { type: "array", cellDates: true });
    return { kind, tables: wb.SheetNames.map((s) => ({ name: s, rows: XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, raw: true, defval: "" }).slice(0, MAX_ROWS + 50).map((r) => r.map(cell)) })) };
  }
  if (kind === "json") {
    const { text, encoding } = decode(bytes);
    let data = JSON.parse(text);
    if (!Array.isArray(data)) data = Object.values(data).find((v) => Array.isArray(v)) || [data];
    return { kind, encoding, tables: [{ name, rows: fromObjects(data.slice(0, MAX_ROWS)) }] };
  }
  if (kind === "parquet") {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const list = await parquetReadObjects({ file: buf, rowEnd: MAX_ROWS });
    return { kind, tables: [{ name, rows: fromObjects(list) }] };
  }
  const t = textTable(name, bytes);
  return { kind: "text", encoding: t.encoding, delimiter: t.delimiter, tables: [t.table] };
}

export async function readBytes(name, bytes) {
  if (kindOf(name, bytes) === "zip") {
    const files = unzipSync(bytes);
    const tables = [];
    for (const [n, b] of Object.entries(files)) {
      if (n.endsWith("/") || n.startsWith("__MACOSX") || !/\.(csv|tsv|txt|xlsx|xls|ods|json|parquet)$/i.test(n)) continue;
      const r = await one(n, b);
      r.tables.forEach((t) => tables.push({ ...t, name: n + (r.tables.length > 1 ? " / " + t.name : "") }));
    }
    return { kind: "zip", tables };
  }
  return one(name, bytes);
}

// The header: among the first 10 rows, the one with the most filled text cells (not numbers), followed by
// rows at least as wide. Title lines and blank lines above the table are skipped.
export function headerRow(rows) {
  let best = 0, score = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = rows[i];
    const filled = r.filter((c) => c !== "").length;
    const texty = r.filter((c) => c !== "" && isNaN(Number(String(c).replace(/[$,]/g, "")))).length;
    const next = rows[i + 1] ? rows[i + 1].filter((c) => c !== "").length : 0;
    if (filled < 2) continue;
    const s = texty * 2 + filled - (next < filled * 0.5 ? 5 : 0);
    if (s > score) { score = s; best = i; }
  }
  return best;
}

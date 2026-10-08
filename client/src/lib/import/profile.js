// Column profiles for an import (FR-11.02): what kind of values each column holds, how many are empty or
// distinct, and examples. Pure; tested in Node.
//   profile(header, rows) -> [{ index, name, type, filled, empty_pct, distinct, examples, max_len }]
// Types: barcode (8, 12, 13 or 14 digits), plu (4-5 digits), money ($ or 2 decimals), integer, decimal,
// percent, date, boolean, text.

const MONEY = /^-?\$?\s?\d{1,3}(,?\d{3})*(\.\d{1,2})?\s?\$?$|^-?\d+,\d{2}\s?\$?$/;

export function typeOf(v) {
  const s = String(v).trim();
  if (s === "") return "";
  if (/^\d{8}$|^\d{11,14}$/.test(s)) return "barcode";
  if (/^\d{4,5}$/.test(s)) return "plu";
  if (/^-?\d+$/.test(s)) return "integer";
  if (/^-?\d+(\.\d+)?%$/.test(s)) return "percent";
  if (/\$/.test(s) && MONEY.test(s)) return "money";
  if (/^-?\d+\.\d{2}$/.test(s) || /^-?\d+,\d{2}$/.test(s)) return "money";
  if (/^-?\d+(\.\d+)?$/.test(s) || /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return "decimal";
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) return "date";
  if (/^(true|false|yes|no|y|n|oui|non)$/i.test(s)) return "boolean";
  return "text";
}

export function profile(header, rows) {
  return header.map((name, index) => {
    const vals = rows.map((r) => (r[index] === undefined ? "" : String(r[index]).trim()));
    const filled = vals.filter((v) => v !== "");
    const counts = {};
    filled.forEach((v) => { const t = typeOf(v); counts[t] = (counts[t] || 0) + 1; });
    let type = "text", best = 0;
    // The type most values share; numbers that are mostly 2-decimal amounts count as money.
    Object.entries(counts).forEach(([t, n]) => { if (n > best) { best = n; type = t; } });
    if (type === "integer" && (counts.money || 0) + (counts.decimal || 0) > filled.length * 0.3) type = counts.money ? "money" : "decimal";
    if (type === "plu" && (counts.integer || 0) > (counts.plu || 0) * 0.5) type = "integer";
    const distinct = new Set(filled).size;
    return { index, name: String(name || "Column " + (index + 1)), type: filled.length ? type : "empty", filled: filled.length,
      empty_pct: vals.length ? Math.round((100 * (vals.length - filled.length)) / vals.length) : 100, distinct,
      examples: [...new Set(filled)].slice(0, 3), max_len: filled.reduce((a, v) => Math.max(a, v.length), 0) };
  });
}

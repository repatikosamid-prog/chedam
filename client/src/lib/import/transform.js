// Turning mapped file rows into Chedam's product fields (FR-11.04): money to cents (also "3,99 $"), units,
// sizes and pack sizes found in names ("6x355ml", "12 pk", "Case of 24"), "Name / Nom" splits into the
// French name, barcodes Excel turned into numbers (lost leading zeros), countries to 2-letter codes.
// Pure; tested in Node. Tax-included prices are converted on the hub (it knows the rates).
//   toRow(fileRow, mapping, opts) -> row for /api/chedam/imports (see hub/pb_hooks/lib/imports.js)
// mapping: { [columnIndex]: field }   opts: { split_names }

export function cents(v) {
  let s = String(v === undefined || v === null ? "" : v).trim().replace(/\s/g, "").replace(/\$|CAD|CA\$/gi, "");
  if (s === "") return null;
  if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");            // 3,99 (French)
  else s = s.replace(/,/g, "");                                      // 1,234.50
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

// Barcodes: digits as scanned. A 12-digit UPC that lost its leading 0 in Excel is 11 digits; an EAN-8 is 7.
function check(body) { let s = 0; for (let i = 0; i < body.length; i++) s += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1); return (10 - (s % 10)) % 10; }
export function barcode(v) {
  let s = String(v === undefined || v === null ? "" : v).trim();
  if (/^\d+(\.0+)?$/.test(s)) s = s.replace(/\.0+$/, "");
  if (/^\d\.\d+e\+\d+$/i.test(s)) s = BigInt(Math.round(Number(s))).toString();         // 6.28915E+11
  if (/^\d{11}$/.test(s) && check(("0" + s).slice(0, 11)) === Number(s[10])) s = "0" + s;
  if (/^\d{7}$/.test(s) && check(("0" + s).slice(0, 7)) === Number(s[6])) s = "0" + s;
  return s;
}

const UNIT = { g: "g", gr: "g", gram: "g", grams: "g", kg: "kg", ml: "ml", l: "l", lt: "l", litre: "l", liter: "l" };

// "355 ml", "1.5L", "500g" -> {qty, unit}
export function size(v) {
  const m = String(v || "").match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grams?|ml|l|lt|litre|liter)\b/i);
  if (!m) return null;
  return { qty: Number(m[1].replace(",", ".")), unit: UNIT[m[2].toLowerCase()] };
}

// "Cola 6x355ml" -> {count 6, size 355 ml}; "Water 24 pk" -> {count 24}; "Case of 12" -> {count 12}
export function packInName(name) {
  const s = String(name || "");
  let m = s.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (m) return { count: Number(m[1]), size: { qty: Number(m[2].replace(",", ".")), unit: UNIT[m[3].toLowerCase()] } };
  m = s.match(/(\d+)\s*-?\s*(?:pk|pack|ct|count)\b/i) || s.match(/case of\s*(\d+)/i);
  if (m && Number(m[1]) >= 2) return { count: Number(m[1]), size: null };
  return null;
}

const COUNTRIES = { canada: "CA", "united states": "US", usa: "US", "u.s.a.": "US", us: "US", mexico: "MX", mexique: "MX", china: "CN", chine: "CN",
  india: "IN", inde: "IN", peru: "PE", chile: "CL", spain: "ES", italy: "IT", france: "FR", "new zealand": "NZ", "costa rica": "CR", guatemala: "GT",
  ecuador: "EC", equateur: "EC", thailand: "TH", vietnam: "VN", philippines: "PH", brazil: "BR", "south africa": "ZA", argentina: "AR",
  netherlands: "NL", germany: "DE", japan: "JP", korea: "KR", "south korea": "KR", taiwan: "TW" };
export function country(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const k = s.toLowerCase().replace(/^(product of|made in|produit (du|de la|de l'|des|de))\s*/i, "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  return COUNTRIES[k] || s;
}

function soldBy(v, priceText) {
  const s = String(v || "").toLowerCase();
  if (/\bkg\b|kilo/.test(s) || /\/\s*kg/i.test(priceText || "")) return "kg";
  if (/\blbs?\b|pound/.test(s) || /\/\s*lb/i.test(priceText || "")) return "lb";
  return "each";
}

const yes = (v) => /^(y|yes|true|1|oui|o|x|18\+|19\+)$/i.test(String(v || "").trim());

export function toRow(fileRow, mapping, opts = {}) {
  const get = (field) => { const k = Object.keys(mapping).find((i) => mapping[i] === field); return k === undefined ? "" : String(fileRow[k] === undefined ? "" : fileRow[k]).trim(); };
  const notes = [];
  let name = get("name"), nameFr = get("name_fr");
  if (opts.split_names && !nameFr && / \/ /.test(name)) { const [a, b] = name.split(" / "); name = a.trim(); nameFr = (b || "").trim(); notes.push("Split into English / French name."); }
  const price = cents(get("price")), cost = cents(get("cost")), packPrice = cents(get("pack_price"));
  const row = { name, name_fr: nameFr, category: get("category"), tax: get("tax"), base_unit: soldBy(get("sold_by"), get("price")),
    price_cents: price, cost_cents: cost, barcode: barcode(get("barcode")), plu: get("plu").replace(/\.0+$/, ""),
    origin_country: country(get("origin")), hs_code: get("hs_code"), reorder_point: get("reorder_point") === "" ? "" : Number(get("reorder_point")) || "",
    description: get("notes"), age_restricted: get("age") ? yes(get("age")) || /\d{2}/.test(get("age")) : false,
    min_age: (get("age").match(/(1[89]|2[01])/) || [])[1] || "", pack_qty: get("pack_qty") === "" ? "" : Number(get("pack_qty")),
    pack_price_cents: packPrice, pack_barcode: barcode(get("pack_barcode")), size_qty: "", size_unit: "" };
  if (Number.isNaN(price)) { row.price_cents = null; notes.push("Price '" + get("price") + "' is not a number."); }
  if (Number.isNaN(cost)) { row.cost_cents = null; notes.push("Cost '" + get("cost") + "' is not a number."); }
  if (Number.isNaN(packPrice)) row.pack_price_cents = null;
  // Size: its own column, else from the name; a pack in the name ("6x355ml") makes the item that pack.
  const sz = size(get("size"));
  const pk = packInName(name);
  if (sz && row.base_unit === "each") { row.size_qty = sz.qty; row.size_unit = sz.unit; }
  else if (pk && pk.size && row.base_unit === "each") { row.size_qty = pk.count * pk.size.qty; row.size_unit = pk.size.unit; notes.push("Pack of " + pk.count + " × " + pk.size.qty + " " + pk.size.unit + " found in the name."); }
  else if (row.base_unit === "each") { const n = size(name); if (n) { row.size_qty = n.qty; row.size_unit = n.unit; } }
  if (row.plu && !/^\d{4,6}$/.test(row.plu)) notes.push("PLU '" + row.plu + "' is not 4 to 6 digits.");
  row.notes = notes;
  return row;
}

// Mapping file columns to product fields (FR-11.03): by synonyms (English, French and the names other POS
// systems export: Square, Shopify, Lightspeed, Clover, Loyverse, QuickBooks), by fuzzy match, and by the
// kind of values in the column. Each mapping has a confidence. Pure; tested in Node.
//   suggest(profiles) -> { [columnIndex]: { field, confidence: "high"|"medium"|"low", score, why } }

export const FIELDS = [
  ["name", "Name", ["name", "item name", "product name", "product", "item", "title", "description", "item description", "product/service name", "nom", "nom du produit", "article", "produit"]],
  ["name_fr", "French name", ["french name", "name fr", "nom fr", "nom français", "nom francais", "french description"]],
  ["category", "Category", ["category", "categories", "department", "dept", "product category", "product type", "type", "group", "catégorie", "categorie", "rayon", "reporting category"]],
  ["price", "Price", ["price", "retail", "retail price", "sell price", "selling price", "sale price", "unit price", "regular price", "variant price", "price per unit", "sales price / rate", "rate", "msrp", "prix", "prix de vente", "default price"]],
  ["cost", "Cost", ["cost", "unit cost", "cost price", "purchase cost", "supplier cost", "cost per item", "default unit cost", "wholesale", "coût", "cout", "prix coûtant"]],
  ["barcode", "Barcode", ["barcode", "upc", "ean", "gtin", "upc/ean", "variant barcode", "bar code", "product code", "code barre", "code-barres", "codes barres", "sku/upc"]],
  ["plu", "PLU", ["plu", "plu code", "produce code"]],
  ["tax", "Tax", ["tax", "taxes", "tax class", "tax code", "tax rate", "taxable", "tax category", "gst/pst", "sales tax", "taxe", "taxes applicables"]],
  ["sold_by", "Sold by (each / kg / lb)", ["sold by", "unit", "uom", "unit of measure", "units", "sell by", "measure", "weight unit", "unité", "unite"]],
  ["size", "Size", ["size", "net weight", "net content", "volume", "weight", "pack size", "taille", "format", "contenance", "poids net"]],
  ["pack_qty", "Pack: how many", ["pack qty", "pack quantity", "units per pack", "case qty", "case quantity", "per case", "inner", "qty per case", "unités par paquet"]],
  ["pack_price", "Pack: price", ["pack price", "case price", "prix paquet", "prix caisse"]],
  ["pack_barcode", "Pack: barcode", ["pack barcode", "case barcode", "case upc", "pack upc", "outer barcode"]],
  ["origin", "Country of origin", ["origin", "country", "country of origin", "made in", "product of", "origine", "pays", "pays d'origine"]],
  ["hs_code", "HS code", ["hs code", "hs", "tariff", "tariff code", "harmonized code", "code sh"]],
  ["reorder_point", "Reorder point", ["reorder point", "reorder level", "min stock", "minimum", "par", "par level", "alert stock", "low stock alert", "point de commande"]],
  ["age", "Age restricted", ["age restricted", "age", "min age", "minimum age", "restricted", "18+", "19+", "âge"]],
  ["notes", "Description / notes", ["notes", "details", "long description", "remarks"]],
];

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9/+]+/g, " ").trim();

// Dice coefficient on letter pairs: 1 = same, 0 = nothing in common.
export function similar(a, b) {
  const pairs = (s) => { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.substring(i, i + 2)); return out; };
  const x = pairs(norm(a)), y = pairs(norm(b));
  if (!x.length || !y.length) return norm(a) === norm(b) ? 1 : 0;
  const ys = [...y];
  let hit = 0;
  x.forEach((p) => { const k = ys.indexOf(p); if (k >= 0) { hit++; ys.splice(k, 1); } });
  return (2 * hit) / (x.length + y.length);
}

function nameScore(col, syns) {
  const c = norm(col);
  let best = 0, why = "";
  syns.forEach((s) => {
    const n = norm(s);
    let v = 0;
    if (c === n) v = 1;
    else if (c.split(" ").includes(n) || (n.includes(" ") && c.includes(n))) v = 0.8;
    else v = similar(c, n) * 0.85;
    if (v > best) { best = v; why = c === n ? "same name" : v >= 0.8 ? "contains '" + s + "'" : "looks like '" + s + "'"; }
  });
  return { score: best, why };
}

// What the values say, whatever the heading.
const BY_TYPE = { barcode: ["barcode", 0.6], plu: ["plu", 0.6], money: ["price", 0.45] };
// Values that a field never holds: 4-5 digit codes are PLUs, not HS codes (6-10 digits) or prices.
const NOT_FOR = { plu: ["hs_code", "reorder_point", "pack_qty"], barcode: ["hs_code", "plu"] };

export function suggest(profiles) {
  const cands = [];
  profiles.forEach((p) => {
    if (p.type === "empty") return;
    FIELDS.forEach(([field, , syns]) => {
      const n = nameScore(p.name, syns);
      let score = n.score, why = n.why;
      const t = BY_TYPE[p.type];
      if (t && t[0] === field) { if (score < t[1]) { score = t[1]; why = "values look like " + (field === "price" ? "money" : field + "s"); } else score = Math.min(1, score + 0.1); }
      // Values that cannot be this field
      if (["price", "cost", "pack_price"].includes(field) && ["text", "date", "boolean"].includes(p.type)) score *= 0.4;
      if (field === "barcode" && ["text", "money", "date"].includes(p.type)) score *= 0.5;
      if (field === "name" && p.type !== "text") score *= 0.5;
      if ((NOT_FOR[p.type] || []).includes(field) && score < 0.9) score *= 0.5;
      if (score >= 0.45) cands.push({ col: p.index, field, score, why });
    });
  });
  cands.sort((a, b) => b.score - a.score);
  const out = {}, used = new Set();
  cands.forEach((c) => {
    if (out[c.col] || used.has(c.field)) return;
    out[c.col] = { field: c.field, score: Math.round(c.score * 100) / 100, why: c.why, confidence: c.score >= 0.9 ? "high" : c.score >= 0.65 ? "medium" : "low" };
    used.add(c.field);
  });
  return out;
}

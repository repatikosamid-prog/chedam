// Unit price for shelf labels (FR-5.14): price per 100 g / 100 mL, per kg / L, or per item, so shoppers
// can compare sizes. Pure; tested in Node. Money in cents.
//   d: {kind, price_cents, base_unit (each|kg|lb), base_qty (base units in this selling unit),
//       size_qty, size_unit (g|kg|ml|l|each: the size of one base unit)}
//   basis: "auto" (100 g / 100 mL), "kg" (kg / L), "100g"
// Returns {cents, per} or null (no size known, or a single item with nothing to compare).

const LB_KG = 0.45359237;

export function unitPrice(d, basis = "auto") {
  const price = Number(d.price_cents) || 0;
  if (!price) return null;
  const big = basis === "kg";
  // Weighed: the price is per kg or per lb.
  if (d.kind === "weight") {
    const perKg = d.base_unit === "lb" ? price / LB_KG : price;
    if (d.base_unit === "lb" || big) return { cents: Math.round(perKg), per: "kg" };
    return { cents: Math.round(perKg / 10), per: "100 g" };
  }
  const n = (Number(d.base_qty) || 1) * (Number(d.size_qty) || 0);
  if (!n) return null;
  const u = d.size_unit;
  if (u === "each") return n > 1 ? { cents: Math.round(price / n), per: "item" } : null;
  if (u === "g" || u === "kg") {
    const g = u === "kg" ? n * 1000 : n;
    return big ? { cents: Math.round((price * 1000) / g), per: "kg" } : { cents: Math.round((price * 100) / g), per: "100 g" };
  }
  if (u === "ml" || u === "l") {
    const ml = u === "l" ? n * 1000 : n;
    return big ? { cents: Math.round((price * 1000) / ml), per: "L" } : { cents: Math.round((price * 100) / ml), per: "100 mL" };
  }
  return null;
}

// "200 g", "1.5 L", "6 × 355 mL"
export function sizeText(d) {
  const s = Number(d.size_qty) || 0;
  if (!s || !d.size_unit || d.size_unit === "each") return "";
  const one = s + " " + ({ g: "g", kg: "kg", ml: "mL", l: "L" }[d.size_unit] || "");
  const b = Number(d.base_qty) || 1;
  return b > 1 && d.kind !== "weight" ? b + " × " + one : one;
}

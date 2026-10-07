// Catalogue helpers for the product screens (P1 step 1). Money is integer cents (BR-01); the hub
// computes base_qty and checks every rule, these only show values while someone types.

const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

export function money(c) { return c == null || isNaN(c) ? "" : fmt.format(c / 100); }

// "4.99", "$4.99", "4" -> 499. "" -> null. Anything else -> NaN.
export function toCents(v) {
  const t = String(v ?? "").replace(/[$,\s]/g, "");
  if (t === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100);
}

export function toDollars(c) { return c == null ? "" : (c / 100).toFixed(2); }

// Margin % of the selling price, markup % of the cost. null when there is no price or cost.
export function margin(priceCents, costCents) {
  if (!priceCents || costCents == null) return null;
  return {
    margin: ((priceCents - costCents) / priceCents) * 100,
    markup: costCents > 0 ? ((priceCents - costCents) / costCents) * 100 : null,
    below: priceCents < costCents,
  };
}

// Ids made on the device (Section 10), so a pack can point at a unit that is not saved yet.
export function newId() {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const b = crypto.getRandomValues(new Uint8Array(15));
  return Array.from(b, (x) => abc[x % 36]).join("");
}

// How many base units a unit holds, following nested packs (DL-64). For display only.
export function baseQty(unit, units, depth = 0) {
  if (unit.kind === "single" || unit.kind === "weight") return 1;
  if (depth > 5) return NaN;
  const inner = unit.contains_unit ? units.find((u) => u.id === unit.contains_unit) : null;
  return Number(unit.contains_qty || 0) * (inner ? baseQty(inner, units, depth + 1) : 1);
}

export const KINDS = { single: "Single", pack: "Pack", case: "Case", weight: "By weight" };
export const BASE_UNITS = { each: "Each (counted)", kg: "By kg", lb: "By lb" };
export const STATUS = { draft: "Draft", active: "Active", archived: "Archived" };

// "0628 1234, 0628-99" -> ["0628", "1234", "0628-99"]
export function splitCodes(text) {
  return String(text || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
}

// "12", "7.25 kg", "1 item": quantities in the product's base unit.
export function qty(n, baseUnit) {
  const v = Math.round(Number(n || 0) * 1000) / 1000;
  return baseUnit === "each" ? String(v) : v + " " + baseUnit;
}

// Id of one stock operation, made on the device so a retry is not applied twice (BR-10).
export function opId() { return "op" + newId(); }

export const MOVES = { receive: "Received", adjust: "Adjusted", damage: "Damaged", loss: "Lost", count: "Counted", pack_break: "Opened packs",
  pack_make: "Made packs", sale: "Sold", return: "Returned", transfer: "Moved" };

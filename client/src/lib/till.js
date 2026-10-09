// Till helpers (P1 step 3). The hub prices every sale (DL-79); the till keeps the cart, shows the hub's
// quote and previews payments with the same rules as the hub (BR-16 cash rounding, DL-82).
import { newId } from "./catalogue.js";

export function newCart(training = false) {
  return { id: "c" + newId(), lines: [], cart_discount: null, exempt: null, training, approval: "", coupons: [] };
}

// What the hub needs for a quote or a sale.
export function toInput(cart) {
  return {
    cart_id: cart.id, training: cart.training,
    lines: cart.lines.map((l) => ({ key: l.key, product: l.product, selling_unit: l.selling_unit, qty: l.qty, weight: l.weight,
      price_cents: l.price_cents, override_reason: l.override_reason, discount: l.discount, age_checked: l.age_checked,
      break_pack: l.break_pack, voided: l.voided })),
    cart_discount: cart.cart_discount, exempt: cart.exempt, approval: cart.approval || undefined, coupons: cart.coupons || [],
  };
}

export const cashRound = (c) => Math.round(c / 5) * 5;

// Same order and rules as the hub (lib/sales.js settlePayments): what is left, rounding, change, and
// each payment as the hub would record it (`applied`, for receipts printed offline).
export function settle(total, payments, s) {
  let remaining = total, rounding = 0, change = 0;
  const rate = Number(s.usd_rate || 1.35);
  const applied = [];
  for (const p of payments) {
    const rec = { method: p.method, status: p.status === "declined" ? "declined" : "approved", amount_cents: 0, tendered_cents: p.amount_cents,
      currency: p.method === "usd_cash" ? "USD" : "CAD", change_cents: 0, last4: p.last4 || "", reference: p.reference || "" };
    applied.push(rec);
    if (rec.status === "declined" || remaining <= 0) continue;
    // Card, store credit and exchange credit are exact (no rounding, no change).
    if (p.method === "card" || p.method === "store_credit" || p.method === "exchange") { rec.amount_cents = Math.min(p.amount_cents, remaining); remaining -= rec.amount_cents; continue; }
    const value = p.method === "usd_cash" ? Math.floor(p.amount_cents * rate + 0.5) : p.amount_cents;
    const due = s.cash_rounding ? cashRound(remaining) : remaining;
    if (value >= due) {
      rounding = due - remaining; rec.amount_cents = due;
      rec.change_cents = s.cash_rounding ? cashRound(value - due) : value - due;
      change += rec.change_cents; remaining = 0;
    } else { rec.amount_cents = value; remaining -= value; }
  }
  return { remaining, rounding, change, applied, cash_due: s.cash_rounding ? cashRound(remaining) : remaining };
}

// Quick cash buttons: exact (rounded) and the next notes up.
export function cashSuggestions(due) {
  const out = [due];
  for (const n of [500, 1000, 2000, 5000, 10000]) {
    const up = Math.ceil(due / n) * n;
    if (up > due && !out.includes(up) && out.length < 5) out.push(up);
  }
  return out;
}

export const METHOD = { cash: "Cash", card: "Card", usd_cash: "US cash", store_credit: "Store credit", platform: "Platform", exchange: "Exchange credit" };

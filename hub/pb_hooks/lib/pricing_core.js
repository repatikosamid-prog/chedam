// Sale arithmetic (P1 step 3): BR-16, 21, 22; FR-4.03, 4.04, 4.06. Pure: no database, so the offline
// till (step 4) can run the same code. All money in integer cents.
//
// compute(lines, opts)
//   lines: [{ key, gross_cents, line_discount_cents, rates: [{code, label, rate}],
//             deposit_cents, deposit_rates: [{code, label, rate}] }]
//   opts:  { mode: "tax_added" | "tax_included", cart_discount_cents }
// 1. The cart discount is spread across lines by their amount after line discounts (BR-21), largest
//    remainder so the shares add up exactly.
// 2. Tax is worked out per tax type and rate for the whole receipt and rounded once (BR-22); each
//    line keeps its share (FR-4.06). Tax-included prices (FR-4.04) have the tax taken out of them.
// 3. Deposits and eco fees are never discounted; their own tax (if any) is added on top.

function roundHalfUp(x) { return Math.floor(x + 0.5 + 1e-9); }

// Splits `total` cents across `weights` in proportion, the shares adding up exactly.
function spread(total, weights) {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (!total || !sum) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map((x) => Math.floor(x + 1e-9));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i: i, f: x - Math.floor(x + 1e-9) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}

const groupKey = (t) => t.code + "@" + t.rate;

function compute(lines, opts) {
  const mode = opts.mode === "tax_included" ? "tax_included" : "tax_added";
  const after = lines.map((l) => Math.max(0, l.gross_cents - (l.line_discount_cents || 0)));
  const subtotal = after.reduce((a, b) => a + b, 0);
  const cartDisc = Math.min(Math.max(0, opts.cart_discount_cents || 0), subtotal);
  const shares = spread(cartDisc, after);
  const nets = after.map((a, i) => a - shares[i]);

  // Exact (unrounded) tax per line per group, from the goods and from deposits.
  const groups = {};
  const exactPerLine = lines.map(() => ({}));
  const touch = (t) => groups[groupKey(t)] || (groups[groupKey(t)] = { code: t.code, label: t.label || t.code, rate: t.rate, base: 0, exact: 0 });
  lines.forEach((l, i) => {
    const rates = l.rates || [];
    const sumRates = rates.reduce((a, t) => a + t.rate, 0);
    rates.forEach((t) => {
      const g = touch(t);
      const base = mode === "tax_included" ? (nets[i] * 100) / (100 + sumRates) : nets[i];
      const ex = (base * t.rate) / 100;
      g.base += base; g.exact += ex;
      exactPerLine[i][groupKey(t)] = (exactPerLine[i][groupKey(t)] || 0) + ex;
    });
    (l.deposit_rates || []).forEach((t) => {
      const g = touch(t);
      const ex = ((l.deposit_cents || 0) * t.rate) / 100;
      g.base += l.deposit_cents || 0; g.exact += ex;
      exactPerLine[i][groupKey(t)] = (exactPerLine[i][groupKey(t)] || 0) + ex;
    });
  });

  // Round once per type and rate; give each line its share.
  const lineTaxes = lines.map(() => []);
  const taxes = Object.keys(groups).sort().map((k) => {
    const g = groups[k];
    const tax = roundHalfUp(g.exact);
    const parts = spread(tax, lines.map((_, i) => exactPerLine[i][k] || 0));
    parts.forEach((p, i) => { if (exactPerLine[i][k] !== undefined) lineTaxes[i].push({ code: g.code, rate: g.rate, tax_cents: p }); });
    return { code: g.code, label: g.label, rate: g.rate, base_cents: roundHalfUp(g.base), tax_cents: tax };
  });

  const taxTotal = taxes.reduce((a, t) => a + t.tax_cents, 0);
  const deposits = lines.reduce((a, l) => a + (l.deposit_cents || 0), 0);
  const netTotal = nets.reduce((a, b) => a + b, 0);
  // Tax-included: the goods' tax is already inside the prices; only deposit tax is added.
  const depositTax = taxes.length && mode === "tax_included"
    ? lines.reduce((a, l) => a + (l.deposit_rates || []).reduce((b, t) => b + ((l.deposit_cents || 0) * t.rate) / 100, 0), 0) : 0;
  const total = mode === "tax_included" ? netTotal + deposits + roundHalfUp(depositTax) : netTotal + taxTotal + deposits;

  return {
    lines: lines.map((l, i) => ({ key: l.key, cart_discount_cents: shares[i], net_cents: nets[i], taxes: lineTaxes[i] })),
    subtotal_cents: subtotal,
    discount_cents: lines.reduce((a, l) => a + (l.line_discount_cents || 0), 0) + cartDisc,
    cart_discount_cents: cartDisc,
    taxes: taxes,
    tax_cents: taxTotal,
    deposit_cents: deposits,
    total_cents: total,
  };
}

// BR-16: cash to the nearest 5 cents (1-2 cents down, 3-4 up). Cards stay exact.
function cashRound(c) { return Math.round(c / 5) * 5; }

// What a discount was, for the sale screen and the receipt: "10% off", "$2.00 off" ("" for none).
function discountLabel(d) {
  if (!d || !Number(d.value)) return "";
  const v = Number(d.value);
  return d.type === "pct" ? String(Math.round(v * 1000) / 1000) + "% off" : "$" + (v / 100).toFixed(2) + " off";
}

// How big a discount is, as a percentage, for the cashier's limit (BR-18): a percentage discount is the
// percentage asked for (10% of $3.99 rounds to $0.40, still 10%); an amount is its share of the price.
function discountPct(d, cents, gross) {
  if (d && d.type === "pct") return Number(d.value) || 0;
  return gross ? (cents / gross) * 100 : 0;
}

module.exports = { compute, spread, cashRound, roundHalfUp, discountLabel, discountPct };

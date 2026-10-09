// Offline pricing (P1 step 4, DL-86): the same cart rules as the hub's lib/sales.js build(), over the
// offline pack, with the hub's own arithmetic (pricing_core.js via `virtual:pricing-core`). The result
// has the hub quote's shape plus `upload_lines`, what the hub needs to check the sale later.
// Offline there is no stock check (BR-12) and no manager PIN (only the hub can check PINs), so
// anything needing approval is refused unless the person signed in may approve.
import core from "virtual:pricing-core";

const r3 = (n) => Math.round(n * 1000) / 1000;

// A 12-digit UPC-A and the same code with a leading 0 (EAN-13) are one barcode (DL-77).
export function codeVariants(c) {
  if (/^\d{12}$/.test(c)) return [c, "0" + c];
  if (/^0\d{12}$/.test(c)) return [c, c.substring(1)];
  return [c];
}

export function indexPack(pack) {
  const products = Object.fromEntries(pack.products.map((p) => [p.id, p]));
  const units = {};
  pack.units.forEach((u) => (units[u.product] ||= []).push(u));
  Object.values(units).forEach((l) => l.sort((a, b) => (a.sort || 0) - (b.sort || 0)));
  return { ...pack, byId: products, unitsOf: units, unitById: Object.fromEntries(pack.units.map((u) => [u.id, u])) };
}

// Same answer shape as GET /api/chedam/catalogue/lookup (sellable only).
export function lookupOffline(ix, code) {
  const forms = codeVariants(code);
  const matches = [];
  ix.units.forEach((u) => {
    const p = ix.byId[u.product];
    if (p && (u.barcodes || []).some((b) => forms.includes(b))) matches.push({ via: "barcode", unit: u, p });
  });
  ix.products.forEach((p) => {
    if (p.plu !== code && p.scale_code !== code) return;
    const u = (ix.unitsOf[p.id] || []).find((x) => x.is_default || x.kind === "weight" || x.kind === "single");
    if (u) matches.push({ via: "plu", unit: u, p });
  });
  return {
    code,
    matches: matches.map((m) => ({ via: m.via, sellable: true, unit: m.unit,
      product: { id: m.p.id, name: m.p.name, status: "active", base_unit: m.p.base_unit, tax_class: m.p.tax_class, age_restricted: m.p.age_restricted, min_age: m.p.min_age } })),
  };
}

// Rates a tax class charges now in the store's province (the hub's lib/tax.js ratesFor).
export function ratesFor(ix, classId, exemptTypes = [], at = new Date()) {
  const cls = ix.tax_classes.find((c) => c.id === classId);
  if (!cls || cls.treatment !== "taxable") return [];
  const now = at.toISOString().replace("T", " ");
  const out = [];
  (cls.tax_types || []).forEach((tid) => {
    const t = ix.tax_types.find((x) => x.id === tid);
    if (!t || exemptTypes.includes(t.code)) return;
    const rows = ix.tax_rates.filter((r) => r.tax_type === tid && (!r.province || r.province === ix.province)
      && r.effective_from <= now && (!r.effective_to || r.effective_to > now))
      .sort((a, b) => (b.province || "").localeCompare(a.province || "") || b.effective_from.localeCompare(a.effective_from));
    if (rows.length) out.push({ code: t.code, label: t.receipt_label || t.code, rate: rows[0].rate });
  });
  return out.sort((a, b) => (a.code < b.code ? -1 : 1));
}

function amountOf(d, gross) {
  if (!d || !d.value) return 0;
  const v = Number(d.value);
  if (d.type === "pct") return core.roundHalfUp((gross * v) / 100);
  return Math.min(v, gross);
}

// perms: { discount, approve, exempt } for the person signed in.
export function quoteOffline(cart, ix, perms) {
  const s = ix.settings;
  const problems = [], lines = [], upload = [];
  const needApproval = (msg, key) => { if (!perms.approve) problems.push({ key, type: "approval_offline", message: msg + ": needs a manager's PIN, which works only when the hub is reachable." }); };
  let exempt = null, exemptTypes = [];
  if (cart.exempt && cart.exempt.reason) {
    const r = (s.exempt_reasons || {})[cart.exempt.reason];
    if (!perms.exempt || !r) problems.push({ type: "exempt", message: "This tax exemption cannot be used here." });
    else if (String(cart.exempt.reference || "").trim().length < 2) problems.push({ type: "exempt", message: "Enter the exemption reference (card or certificate number)." });
    else { exempt = { reason: cart.exempt.reason, label: r.label, reference: String(cart.exempt.reference).trim(), types: r.types || [] }; exemptTypes = exempt.types; }
  }
  for (const ln of cart.lines) {
    const p = ix.byId[ln.product], u = ix.unitById[ln.selling_unit];
    const name = p ? p.name + (u && (u.kind === "single" || u.kind === "weight") ? "" : " (" + (u ? u.name : "") + ")") : ln.name;
    if (ln.voided) { lines.push({ key: ln.key, voided: true, name }); upload.push({ key: ln.key, product: ln.product, selling_unit: ln.selling_unit, name, qty: ln.qty || 1, voided: true }); continue; }
    if (!p || !u) { problems.push({ key: ln.key, type: "not_sellable", message: "'" + (ln.name || "This item") + "' cannot be sold (not on this till's list)." }); continue; }
    let qty, tare = 0;
    if (u.kind === "weight") { tare = Number(p.tare || 0); qty = r3(Number(ln.weight ?? ln.qty) - tare); if (!(qty > 0)) { problems.push({ key: ln.key, type: "weight", message: "The weight is not more than the tare." }); continue; } }
    else qty = Math.max(1, Math.round(Number(ln.qty) || 1));
    const base = r3(qty * (u.base_qty || 1));
    const regular = u.price_cents;
    let price = regular, reason = "";
    if (ln.price_cents !== undefined && ln.price_cents !== null && ln.price_cents !== regular) {
      price = ln.price_cents; reason = String(ln.override_reason || "").trim();
      if (!reason) problems.push({ key: ln.key, type: "override_reason", message: "Give a reason for the new price of '" + p.name + "'." });
      if (price < regular * (1 - s.override_limit_pct / 100) - 1e-9) needApproval("Price of '" + p.name + "' lowered by more than " + s.override_limit_pct + "%", ln.key);
    }
    const gross = core.roundHalfUp(price * qty);
    const ld = amountOf(ln.discount, gross);
    if (ld > 0) {
      if (!perms.discount) problems.push({ key: ln.key, type: "discount", message: "You cannot give discounts." });
      else if (core.discountPct(ln.discount, ld, gross) > s.discount_limit_pct + 1e-9) needApproval("Discount on '" + p.name + "' above " + s.discount_limit_pct + "%", ln.key);
    }
    if (p.age_restricted && !ln.age_checked) problems.push({ key: ln.key, type: "age", message: "Check ID: '" + p.name + "' is " + p.min_age + "+." });
    let deposit = 0, depositRates = [], depositFull = [];
    if ((p.deposits_fees || []).length && ix.modules.regulated_items) {
      ix.deposits_fees.filter((f) => p.deposits_fees.includes(f.id)).forEach((f) => {
        deposit += core.roundHalfUp(f.amount_cents * base);
        depositRates = ratesFor(ix, f.tax_class, exemptTypes);
        depositFull = ratesFor(ix, f.tax_class, []);
      });
    }
    const rates = ratesFor(ix, p.tax_class, exemptTypes);
    lines.push({ key: ln.key, name, product: p.id, selling_unit: u.id, qty, base_qty: base, tare, regular_price_cents: regular, price_cents: price,
      gross_cents: gross, line_discount_cents: ld, discount_label: ld ? core.discountLabel(ln.discount) : "", deposit_cents: deposit, age_restricted: !!p.age_restricted, min_age: p.min_age,
      _rates: rates, _full: ratesFor(ix, p.tax_class, []), _dep: depositRates, _depFull: depositFull });
    upload.push({ key: ln.key, product: p.id, selling_unit: u.id, name, qty, tare, regular_price_cents: regular, price_cents: price, override_reason: reason,
      gross_cents: gross, line_discount_cents: ld, discount_label: ld ? core.discountLabel(ln.discount) : "", rates, deposit_cents: deposit, deposit_rates: depositRates, age_checked: !!ln.age_checked });
  }
  const live = lines.filter((l) => !l.voided);
  const after = live.reduce((a, l) => a + Math.max(0, l.gross_cents - l.line_discount_cents), 0);
  const cartDisc = amountOf(cart.cart_discount, after);
  if (cartDisc > 0) {
    if (!perms.discount) problems.push({ type: "discount", message: "You cannot give discounts." });
    else if (core.discountPct(cart.cart_discount, cartDisc, after) > s.discount_limit_pct + 1e-9) needApproval("Sale discount above " + s.discount_limit_pct + "%");
  }
  const toCore = (full) => live.map((l) => ({ key: l.key, gross_cents: l.gross_cents, line_discount_cents: l.line_discount_cents,
    rates: full ? l._full : l._rates, deposit_cents: l.deposit_cents, deposit_rates: full ? l._depFull : l._dep }));
  const priced = core.compute(toCore(false), { mode: ix.tax_mode, cart_discount_cents: cartDisc });
  const exemptCents = exempt ? core.compute(toCore(true), { mode: ix.tax_mode, cart_discount_cents: cartDisc }).tax_cents - priced.tax_cents : 0;
  const pl = Object.fromEntries(priced.lines.map((l) => [l.key, l]));
  if (!live.length) problems.push({ type: "empty", message: "The cart is empty." });
  return {
    offline: true,
    lines: lines.map((l) => l.voided ? l : { ...l, _rates: undefined, _full: undefined, _dep: undefined, _depFull: undefined,
      cart_discount_cents: pl[l.key].cart_discount_cents, net_cents: pl[l.key].net_cents, taxes: pl[l.key].taxes }),
    tax_mode: ix.tax_mode, subtotal_cents: priced.subtotal_cents, discount_cents: priced.discount_cents, cart_discount_cents: cartDisc,
    cart_discount_label: cartDisc ? core.discountLabel(cart.cart_discount) : "",
    taxes: priced.taxes, tax_cents: priced.tax_cents, deposit_cents: priced.deposit_cents, total_cents: priced.total_cents,
    cash_total_cents: core.cashRound(priced.total_cents), exempt, exempt_cents: exemptCents, problems, needs_approval: [], training: !!cart.training,
    upload_lines: upload,
  };
}

export const cashRound = core.cashRound;

// Selling (P1 step 3): FR-3.02-3.12, 3.15, 3.17, 4.03-4.06; BR-03, 10, 11, 13, 14, 15, 16, 18, 21, 22.
// The till sends the cart; the hub prices it again (pricing_core.js), checks stock, approvals and
// payments, and completes the sale in one transaction. The sale id is made on the till, so a repeat
// returns the first result (BR-10).
//
// Cart input (quote and complete):
//   { id, cart_id, training, lines: [{ key, product, selling_unit, qty, weight, price_cents, override_reason,
//     discount: {type: "pct"|"amount", value}, age_checked, break_pack, voided }],
//     cart_discount: {type, value}, exempt: {reason, reference}, approval, payments, expected_total_cents,
//     note, device_time }

const st = () => require(`${__hooks}/lib/stock.js`);
const core = () => require(`${__hooks}/lib/pricing_core.js`);
const promoCore = () => require(`${__hooks}/lib/promotions_core.js`);

function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function can(app, user, code) { return !!user && require(`${__hooks}/lib/access.js`).can(app, user, code); }
function bad(msg) { throw new BadRequestError(msg); }
const r3 = (n) => Math.round(n * 1000) / 1000;

// ---- Manager approvals (BR-18) --------------------------------------------------------------------
// A manager enters their PIN on the till; the hub keeps a one-time approval for 5 minutes.

const APPROVALS = "chedam.sales.approvals";

// The store keeps a copy of what is set, so every change is written back with saveApprovals().
function approvals(app) {
  const m = app.store().get(APPROVALS) || {};
  const now = Date.now();
  const out = {};
  Object.keys(m).forEach((k) => { if (m[k].expires >= now) out[k] = m[k]; });
  return out;
}
function saveApprovals(app, m) { app.store().set(APPROVALS, m); }

function newApproval(app, e, body) {
  const auth = require(`${__hooks}/lib/auth.js`);
  let user = null;
  try { user = app.findRecordById("users", String(body.user || "")); } catch (_) { user = null; }
  if (!user || !auth.canSignIn(user) || !user.getBool("pin_set")) bad("Wrong name or PIN.");
  const until = auth.lockedUntil(user);
  if (until) throw auth.lockedError(until);
  if (!auth.checkSecret(user, "pin", String(body.pin || ""))) auth.failAndThrow(app, user, e, new BadRequestError("Wrong name or PIN."));
  auth.registerSuccess(app, user, e);
  // "staff": a staff member confirms a staff discount for themselves (FR-5.20); it approves nothing else.
  const perm = body.permission === "sales.void" ? "sales.void" : body.permission === "staff" ? "staff" : "sales.approve";
  if (perm !== "staff" && !can(app, user, perm)) throw new ForbiddenError(user.getString("name") + " cannot approve this.");
  const id = $security.randomString(20);
  const all = approvals(app);
  all[id] = { user: user.id, name: user.getString("name"), perm: perm, expires: Date.now() + 5 * 60000 };
  saveApprovals(app, all);
  return { approval: id, by: user.getString("name"), expires_in: 300 };
}

function approvalFor(app, id, perm) {
  const a = id ? approvals(app)[id] : null;
  if (!a) return null;
  if (perm === "sales.void" && a.perm !== "sales.void") return null;
  if ((perm === "staff") !== (a.perm === "staff")) return null;      // a staff PIN is never a manager's approval
  return a;
}

function useApproval(app, id) { const all = approvals(app); delete all[id]; saveApprovals(app, all); }

// ---- Building a cart -----------------------------------------------------------------------------

function amountOf(d, gross) {
  if (!d || !d.value) return 0;
  const v = Number(d.value);
  if (!(v >= 0)) bad("A discount cannot be negative.");
  if (d.type === "pct") {
    if (v > 100 || Math.abs(r3(v) - v) > 1e-9) bad("A percentage is 0 to 100 with at most 3 decimals (BR-04).");
    return core().roundHalfUp((gross * v) / 100);
  }
  if (v !== Math.floor(v)) bad("Discount amounts are in whole cents.");
  return Math.min(v, gross);
}

// cache: {classId: rates} kept for one sale, so each tax class is looked up once (a line asks up to 4 times).
function ratesOf(app, classId, exemptTypes, cache) {
  if (!classId) return [];
  const all = cache && cache[classId] ? cache[classId] : require(`${__hooks}/lib/tax.js`).ratesFor(app, classId);
  if (cache) cache[classId] = all;
  return all.filter((t) => exemptTypes.indexOf(t.code) < 0).map((t) => ({ code: t.code, label: t.label, rate: t.rate }));
}

function moduleOn(app, code) { return require(`${__hooks}/lib/catalogue.js`).moduleOn(app, code); }

// Prices the cart and lists what stops it: problems (fix on the till) and approvals (manager PIN).
function build(app, input, actor) {
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length > 300) bad("At most 300 lines in one sale.");
  const training = !!input.training;
  const discLimit = Number(setting(app, "sales.discount_limit_pct", 10));
  const ovLimit = Number(setting(app, "sales.override_limit_pct", 10));
  const mayApprove = can(app, actor, "sales.approve");
  const problems = [], needs = [];
  const need = (what, key) => { if (!mayApprove && needs.indexOf(what) < 0) needs.push(what); };

  // Tax exemption (FR-4.05)
  let exempt = null, exemptTypes = [];
  if (input.exempt && input.exempt.reason) {
    if (!can(app, actor, "sales.tax_exempt")) throw new ForbiddenError("You cannot make tax-exempt sales.");
    const reasons = setting(app, "sales.exempt_reasons", {}) || {};
    const r = reasons[input.exempt.reason];
    if (!r) bad("Unknown exemption reason.");
    const ref = String(input.exempt.reference || "").trim();
    if (ref.length < 2) bad("Enter the exemption reference (card or certificate number).");
    exempt = { reason: input.exempt.reason, label: r.label, reference: ref.substring(0, 60), types: r.types || [] };
    exemptTypes = exempt.types;
  }

  // Promotions and scheduled prices (P2), when the Promotions module is on; checked against the hub's
  // clock (BR-30). Coupon codes the cashier entered.
  const promoOn = moduleOn(app, "promotions");
  const now = new Date();
  const deals = promoOn ? { promos: require(`${__hooks}/lib/promotions.js`).current(app), sched: require(`${__hooks}/lib/promotions.js`).currentScheduled(app) } : { promos: [], sched: [] };
  const coupons = (Array.isArray(input.coupons) ? input.coupons : []).map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z0-9-]{3,30}$/.test(c)).slice(0, 10);
  const out = [];
  const taxCache = {};
  const regulated = moduleOn(app, "regulated_items");
  lines.forEach((ln, i) => {
    const key = String(ln.key || "l" + i);
    let p, u;
    try { p = app.findRecordById("products", String(ln.product || "")); } catch (_) { bad("Line " + (i + 1) + ": unknown product."); }
    try { u = app.findRecordById("selling_units", String(ln.selling_unit || "")); } catch (_) { bad("Line " + (i + 1) + ": unknown unit."); }
    if (u.getString("product") !== p.id) bad("Line " + (i + 1) + ": that unit belongs to another product.");
    const name = p.getString("name") + (u.getString("kind") === "single" || u.getString("kind") === "weight" ? "" : " (" + u.getString("name") + ")");
    if (ln.voided) { out.push({ key, voided: true, p, u, name, qty: Number(ln.qty) || 0 }); return; }
    if (p.getString("status") !== "active" || p.getString("deleted_at") || u.getString("deleted_at") || !u.getBool("sell_at_pos")) {
      problems.push({ key, type: "not_sellable", message: "'" + p.getString("name") + "' cannot be sold (not active)." });
    }
    // Quantity (BR-02, BR-03); weighed items: weight minus the product's tare (FR-3.04)
    let qty, tare = 0;
    if (u.getString("kind") === "weight") {
      const w = Number(ln.weight !== undefined ? ln.weight : ln.qty);
      tare = p.getFloat("tare");
      qty = r3(w - tare);
      if (!(w > 0) || Math.abs(r3(w) - w) > 1e-9) bad("Line " + (i + 1) + ": weight is more than 0 with at most 3 decimals.");
      if (!(qty > 0)) bad("Line " + (i + 1) + ": the weight is not more than the tare.");
    } else {
      qty = Number(ln.qty);
      if (!(qty > 0) || qty !== Math.floor(qty)) bad("Line " + (i + 1) + ": quantity is a whole number above 0.");
    }
    const base = r3(qty * (u.getFloat("base_qty") || 1));
    // Price in force (a scheduled price, FR-5.06) and override (FR-3.03, BR-18)
    const regular = u.getInt("price_cents");
    const listed = promoOn ? promoCore().scheduledPrice(u.id, regular, deals.sched, now).price_cents : regular;
    let price = listed, reason = "";
    if (ln.price_cents !== undefined && ln.price_cents !== null && ln.price_cents !== "" && Number(ln.price_cents) !== listed) {
      price = Number(ln.price_cents);
      if (!(price >= 0) || price !== Math.floor(price)) bad("Line " + (i + 1) + ": the price is not valid.");
      reason = String(ln.override_reason || "").trim().substring(0, 200);
      if (!reason) problems.push({ key, type: "override_reason", message: "Give a reason for the new price of '" + p.getString("name") + "'." });
      if (price < regular * (1 - ovLimit / 100) - 1e-9) need("Price of '" + p.getString("name") + "' lowered by more than " + ovLimit + "%", key);
    }
    const gross = core().roundHalfUp(price * qty);
    // Age check (FR-3.06)
    if (p.getBool("age_restricted") && !ln.age_checked) {
      problems.push({ key, type: "age", message: "Check ID: '" + p.getString("name") + "' is " + p.getInt("min_age") + "+." });
    }
    // Deposits and eco fees (FR-3.07), per base unit
    let deposit = 0, depositRates = [], depositFull = [];
    const fees = p.get("deposits_fees") || [];
    if (fees.length && regulated) {
      app.findRecordsByIds("deposits_fees", fees).forEach((f) => {
        if (!f.getBool("active") || f.getString("deleted_at")) return;
        deposit += core().roundHalfUp(f.getInt("amount_cents") * base);
        depositRates = ratesOf(app, f.getString("tax_class"), exemptTypes, taxCache);
        depositFull = ratesOf(app, f.getString("tax_class"), [], taxCache);
      });
    }
    out.push({ key, p, u, name, qty, base, tare, regular, price, reason, gross, disc: ln.discount, ld: 0, dl: "", pc: 0, pl: "", pids: [], sc: 0, deposit,
      rates: ratesOf(app, p.getString("tax_class"), exemptTypes, taxCache), fullRates: ratesOf(app, p.getString("tax_class"), [], taxCache),
      depositRates, depositFull,
      age_checked: !!ln.age_checked, break_pack: !!ln.break_pack, serials: Array.isArray(ln.serials) ? ln.serials.slice(0, 200) : [] });
  });

  const live = out.filter((l) => !l.voided);
  // Promotions (FR-5.07-5.10, BR-20): the best deal per item, then the cashier's own discount on what is
  // left (needs sales.discount; the limit counts against the price after the deal).
  const engineLines = live.map((l) => ({ key: l.key, product: l.p.id, category: l.p.getString("category"), kind: l.u.getString("kind"),
    qty: l.qty, base_qty: l.u.getFloat("base_qty") || 1, price_cents: l.price, no_promo: !!l.reason }));
  // Near-expiry markdowns (FR-5.11): the cart's products' marked-down lots, in selling order
  const segs = promoOn && !training ? require(`${__hooks}/lib/promotions.js`).markdownSegments(app, Object.keys(live.reduce((a, l) => { a[l.p.id] = true; return a; }, {}))) : {};
  const promo = promoOn ? promoCore().evaluate(engineLines, deals.promos, { now: now, coupons: coupons, markdowns: promoCore().markdowns(engineLines, segs) }) : { lines: {}, applied: [] };
  live.forEach((l) => {
    const pr = promo.lines[l.key];
    if (pr && pr.promo_cents) { l.pc = Math.min(pr.promo_cents, l.gross); l.pl = pr.label; l.pids = pr.ids; }
    const md = amountOf(l.disc, l.gross - l.pc);
    if (md > 0) {
      if (!can(app, actor, "sales.discount")) throw new ForbiddenError("You cannot give discounts.");
      if (core().discountPct(l.disc, md, l.gross - l.pc) > discLimit + 1e-9) need("Discount on '" + l.p.getString("name") + "' above " + discLimit + "%", l.key);
      l.dl = core().discountLabel(l.disc);
    }
    l.ld = l.pc + md;
  });
  // Staff discount (FR-5.20): the staff member buying confirmed with their own PIN; % off what is left of
  // each eligible line, up to their monthly limit.
  let staff = null;
  if (input.staff_approval) {
    const cfg = setting(app, "sales.staff_discount", {}) || {};
    const a = approvalFor(app, String(input.staff_approval), "staff");
    if (!cfg.enabled) problems.push({ type: "staff", message: "Staff discounts are switched off." });
    else if (!a) problems.push({ type: "staff", message: "Staff discount: the staff member enters their PIN again." });
    else {
      const pct = Math.max(0, Math.min(100, Number(cfg.pct) || 0));
      const limit = Math.max(0, Number(cfg.monthly_limit_cents) || 0);
      const monthStart = st().today().substring(0, 8) + "01";
      const used = app.findRecordsByFilter("sales", "staff_user = {:u} && status = 'completed' && training = false && completed_at >= {:m}", "", 0, 0,
        { u: a.user, m: require(`${__hooks}/lib/reports.js`).dayStart(monthStart) }).reduce((x, r) => x + r.getInt("staff_discount_cents"), 0);
      let left = limit ? Math.max(0, limit - used) : Infinity;
      const excl = Array.isArray(cfg.exclude_categories) ? cfg.exclude_categories : [];
      let total = 0;
      live.forEach((l) => {
        l.sc = 0;
        if (excl.indexOf(l.p.getString("category")) >= 0 || (l.pc > 0 && !cfg.on_promotions) || left <= 0) return;
        const sc = Math.min(left, core().roundHalfUp(((l.gross - l.ld) * pct) / 100));
        if (sc <= 0) return;
        l.sc = sc; l.ld += sc; left -= sc; total += sc;
      });
      staff = { approval: String(input.staff_approval), user: a.user, name: a.name, pct: pct, cents: total, used_cents: used, limit_cents: limit,
        left_cents: limit ? Math.max(0, limit - used - total) : null };
      if (limit && total === 0 && used >= limit) problems.push({ type: "staff", message: a.name + " has used this month's staff discount (" + (limit / 100).toFixed(2) + ")." });
    }
  }
  const usedCodes = {};
  promo.applied.forEach((a) => { const d = deals.promos.find((x) => x.id === a.id); if (d && d.coupon_code) usedCodes[d.coupon_code] = true; });
  const couponsUnused = coupons.filter((c) => !usedCodes[c]);
  const mode = (() => {
    try { return app.findRecordsByFilter("business", "id != ''", "", 1, 0)[0].getString("tax_display_mode") || "tax_added"; } catch (_) { return "tax_added"; }
  })();
  const after = live.reduce((a, l) => a + Math.max(0, l.gross - l.ld), 0);
  const cartDisc = amountOf(input.cart_discount, after);
  if (cartDisc > 0) {
    if (!can(app, actor, "sales.discount")) throw new ForbiddenError("You cannot give discounts.");
    if (core().discountPct(input.cart_discount, cartDisc, after) > discLimit + 1e-9) need("Sale discount above " + discLimit + "%");
  }
  // Loyalty (P2 step 3, BR-24, FR-7.04): points redeemed come off before tax like a sale discount (BR-21)
  const loyalty = require(`${__hooks}/lib/customers.js`).prepare(app, input, Math.max(0, after - cartDisc), training);
  if (loyalty) loyalty.problems.forEach((x) => problems.push(x));
  const redeemCents = loyalty ? loyalty.redeem.cents : 0;
  const priced = core().compute(live.map((l) => ({ key: l.key, gross_cents: l.gross, line_discount_cents: l.ld, rates: l.rates,
    deposit_cents: l.deposit, deposit_rates: l.depositRates })), { mode: mode, cart_discount_cents: cartDisc + redeemCents });
  let exemptCents = 0;
  if (exempt) {
    const full = core().compute(live.map((l) => ({ key: l.key, gross_cents: l.gross, line_discount_cents: l.ld, rates: l.fullRates,
      deposit_cents: l.deposit, deposit_rates: l.depositFull })), { mode: mode, cart_discount_cents: cartDisc + redeemCents });
    exemptCents = full.tax_cents - priced.tax_cents;
  }
  if (!live.length) problems.push({ type: "empty", message: "The cart is empty." });

  // Bundles take their components (P3 step 8); serial-tracked items need one serial per unit (FR-5.19)
  const V = require(`${__hooks}/lib/variety.js`);
  if (!training) stockCheck(app, live.reduce((a, l) => a.concat(V.stockItems(app, l)), []), input.cart_id, problems, need);
  live.forEach((l) => { l.serialList = V.checkSerials(app, l, problems); });
  // Points earned on what is paid for the items: after every discount and the redemption, before tax
  let loyaltyView = null;
  if (loyalty) {
    const plk = {};
    priced.lines.forEach((x) => { plk[x.key] = x; });
    const earn = loyalty.prog && !training ? require(`${__hooks}/lib/customers.js`).earned(loyalty.prog, live.map((l) => ({ category: l.p.getString("category"),
      promo_cents: l.pc, net_cents: plk[l.key].net_cents, taxes: plk[l.key].taxes })), mode) : 0;
    loyaltyView = { c: loyalty.c, enabled: !!loyalty.prog, earn: earn, redeem: loyalty.redeem,
      balance_after: loyalty.c.getInt("points") - loyalty.redeem.points + earn };
  }
  return { loyalty: loyaltyView, lines: out, live, priced, mode, exempt, exemptCents, problems, needs, training, cartDisc,
    cartDiscLabel: cartDisc ? core().discountLabel(input.cart_discount) : "", promotions: promo.applied, coupons, couponsUnused, staff };
}

// Stock before payment (BR-11): enough on hand (minus other carts' soft holds, BR-13), loose units or
// sealed packs as the line needs (pack-break prompt, FR-3.05), unexpired lots (BR-14).
function stockCheck(app, live, cartId, problems, need) {
  const byProduct = {};
  live.forEach((l) => { (byProduct[l.p.id] || (byProduct[l.p.id] = [])).push(l); });
  const now = new Date().toISOString().replace("T", " ");
  Object.keys(byProduct).forEach((pid) => {
    const ls = byProduct[pid];
    const p = ls[0].p;
    const found = app.findRecordsByFilter("stock_levels", "product = {:p}", "", 1, 0, { p: pid });
    const onHand = found.length ? found[0].getFloat("on_hand") : 0;
    const loose = found.length ? found[0].getFloat("loose_qty") : 0;
    const sealed = found.length ? st().sealedOf(found[0]) : {};
    const held = app.findRecordsByFilter("soft_holds", "product = {:p} && cart_id != {:c} && expires_at > {:n}", "", 0, 0,
      { p: pid, c: String(cartId || "-"), n: now }).reduce((a, h) => a + h.getFloat("qty_base"), 0);
    const want = r3(ls.reduce((a, l) => a + l.base, 0));
    if (want > r3(onHand - held) + 1e-9) {
      problems.push({ key: ls[0].key, type: "stock", available: r3(Math.max(0, onHand - held)),
        message: "Only " + r3(Math.max(0, onHand - held)) + " of '" + p.getString("name") + "' available" + (held ? " (some are in another till's cart)" : "") + "." });
      return;
    }
    // Loose and sealed needs
    const looseWant = r3(ls.filter((l) => st().isLooseUnit(l.u)).reduce((a, l) => a + l.base, 0));
    if (looseWant > loose + 1e-9 && !ls.some((l) => l.break_pack)) {
      problems.push({ key: ls.find((l) => st().isLooseUnit(l.u)).key, type: "pack_break",
        message: "Only " + r3(loose) + " loose '" + p.getString("name") + "'. Open a pack?" });
    }
    ls.filter((l) => !st().isLooseUnit(l.u)).forEach((l) => {
      if ((sealed[l.u.id] || 0) < l.qty && !l.break_pack) {
        problems.push({ key: l.key, type: "pack_break", message: "Only " + (sealed[l.u.id] || 0) + " sealed '" + l.u.getString("name") + "'. Open a larger pack?" });
      }
    });
    // Expired lots (BR-14)
    const lots = st().lotsOf(app, pid);
    if (want > lots.freshQty + 1e-9 && lots.allQty > lots.freshQty + 1e-9) need("Sell expired '" + p.getString("name") + "'");
  });
}

// ---- Payments (FR-3.08, 3.09; BR-16) --------------------------------------------------------------

// relaxed: an offline sale already taken; a method switched off since then is still recorded.
// opts: {relaxed (offline upload: methods switched off since are kept), ctx, exchange_cents (an exchange:
// the returned goods pay this much, lib/returns.js)}. Store credit is the store's own: always taken,
// checked by its code and taken off its balance (FR-3.08).
function settlePayments(app, total, payments, opts) {
  const o = opts || {};
  const relaxed = !!o.relaxed;
  // Store credit, a layaway / special order deposit and a client's house account are the store's own: always taken (P3 step 7)
  const methods = (relaxed ? ["cash", "card", "usd_cash", "store_credit", "platform"] : setting(app, "sales.payment_methods", ["cash", "card"]) || []).concat(["store_credit", "deposit", "house_account"]).concat(o.platform ? ["platform"] : []);
  let exchangeLeft = Number(o.exchange_cents || 0);
  const rounding = setting(app, "sales.cash_rounding", true);
  const rate = Number(setting(app, "sales.usd_rate", 1.35));
  let remaining = total, roundingCents = 0, change = 0;
  const out = [];
  (payments || []).forEach((pm, i) => {
    const method = String(pm.method || "");
    if (method === "exchange") {
      if (!exchangeLeft || Number(pm.amount_cents) !== exchangeLeft) bad("Payment " + (i + 1) + ": an exchange is paid only as part of a return.");
      exchangeLeft = 0;
    } else if (methods.indexOf(method) < 0) bad("Payment " + (i + 1) + ": '" + method + "' is not accepted here.");
    const status = pm.status === "declined" ? "declined" : "approved";
    const rec = { method, status, amount_cents: 0, tendered_cents: 0, currency: method === "usd_cash" ? "USD" : "CAD", fx_rate: method === "usd_cash" ? rate : 1,
      change_cents: 0, reference: String(pm.reference || "").substring(0, 60), last4: String(pm.last4 || "").substring(0, 4), processor: String(pm.processor || "").substring(0, 40) };
    if (rec.last4 && !/^[0-9]{4}$/.test(rec.last4)) bad("Card: the last 4 digits are 4 numbers.");
    const amt = Number(pm.amount_cents);
    if (!(amt > 0) || amt !== Math.floor(amt)) bad("Payment " + (i + 1) + ": the amount is not valid.");
    if (status === "declined") { rec.tendered_cents = amt; out.push(rec); return; }
    if (remaining <= 0) bad("The sale is already paid; remove payment " + (i + 1) + ".");
    if (method === "card" || method === "store_credit" || method === "platform" || method === "exchange" || method === "deposit" || method === "house_account") {
      if (amt > remaining) bad("A card payment cannot be more than what is left to pay (" + remaining + " cents).");
      rec.amount_cents = amt; rec.tendered_cents = amt; remaining -= amt;
      if (method === "store_credit") useCredit(app, rec, amt, relaxed, o.ctx);
      if (method === "deposit") require(`${__hooks}/lib/client_orders.js`).useDeposit(app, rec, amt, relaxed, o);
      if (method === "house_account") require(`${__hooks}/lib/client_orders.js`).chargeAccount(app, rec, amt, relaxed, o);
    } else {
      // Cash (or US cash converted to CAD). Cash that finishes the sale is rounded to 5 cents.
      const value = method === "usd_cash" ? core().roundHalfUp(amt * rate) : amt;
      rec.tendered_cents = amt;
      const due = rounding ? core().cashRound(remaining) : remaining;
      if (value >= due) {
        roundingCents = due - remaining;
        rec.amount_cents = due;
        rec.change_cents = rounding ? core().cashRound(value - due) : value - due;
        change += rec.change_cents;
        remaining = 0;
      } else {
        rec.amount_cents = value;
        remaining -= value;
      }
    }
    out.push(rec);
  });
  return { payments: out, remaining, rounding_cents: roundingCents, change_cents: change,
    paid_cents: out.filter((x) => x.status === "approved").reduce((a, x) => a + x.amount_cents, 0) };
}

// Takes `amt` off a store credit. Offline uploads (relaxed) never fail on it: the customer has paid.
function useCredit(app, rec, amt, relaxed, ctx) {
  const code = rec.reference.trim().toUpperCase();
  rec.reference = code;
  const c = code ? app.findRecordsByFilter("store_credits", "code = {:c}", "", 1, 0, { c: code })[0] : null;
  if (!c) { if (relaxed) return; bad("Store credit: unknown code '" + code + "'."); }
  if (c.getString("status") !== "active" || c.getInt("balance_cents") < amt) {
    if (relaxed) return;
    bad("Store credit " + code + " has " + c.getInt("balance_cents") + " cents left.");
  }
  c.set("balance_cents", c.getInt("balance_cents") - amt);
  if (c.getInt("balance_cents") === 0) c.set("status", "used");
  if (ctx) st().stamp(c, ctx);
  app.save(c);
}

// ---- Views ---------------------------------------------------------------------------------------

function quoteView(b, approval) {
  const pl = {};
  b.priced.lines.forEach((l) => { pl[l.key] = l; });
  return {
    lines: b.lines.map((l) => l.voided ? { key: l.key, voided: true, name: l.name } : {
      key: l.key, name: l.name, product: l.p.id, selling_unit: l.u.id, qty: l.qty, base_qty: l.base, tare: l.tare,
      regular_price_cents: l.regular, price_cents: l.price, gross_cents: l.gross, line_discount_cents: l.ld, discount_label: l.dl,
      promo_cents: l.pc, promo_label: l.pl, promotions: l.pids, staff_cents: l.sc, cart_discount_cents: pl[l.key].cart_discount_cents, net_cents: pl[l.key].net_cents, taxes: pl[l.key].taxes, deposit_cents: l.deposit,
      age_restricted: l.p.getBool("age_restricted"), min_age: l.p.getInt("min_age") }),
    tax_mode: b.mode, subtotal_cents: b.priced.subtotal_cents, discount_cents: b.priced.discount_cents, cart_discount_cents: b.cartDisc,
    cart_discount_label: b.cartDiscLabel, promotions: b.promotions, coupons: b.coupons, coupons_unused: b.couponsUnused,
    staff: b.staff ? { name: b.staff.name, pct: b.staff.pct, cents: b.staff.cents, left_cents: b.staff.left_cents } : null,
    loyalty: b.loyalty ? { customer: { id: b.loyalty.c.id, first_name: b.loyalty.c.getString("first_name"), points: b.loyalty.c.getInt("points"), card: b.loyalty.c.getString("card") },
      enabled: b.loyalty.enabled, earn: b.loyalty.earn, redeem_points: b.loyalty.redeem.points, redeem_cents: b.loyalty.redeem.cents, balance_after: b.loyalty.balance_after } : null,
    taxes: b.priced.taxes, tax_cents: b.priced.tax_cents, deposit_cents: b.priced.deposit_cents, total_cents: b.priced.total_cents,
    cash_total_cents: core().cashRound(b.priced.total_cents), exempt: b.exempt, exempt_cents: b.exemptCents,
    problems: b.problems, needs_approval: approval ? [] : b.needs, training: b.training,
  };
}

function business(app) {
  try {
    const b = app.findRecordsByFilter("business", "id != ''", "", 1, 0)[0];
    let addr = {};
    try { addr = JSON.parse(b.getString("address") || "{}") || {}; } catch (_) { addr = {}; }
    return { name: b.getString("trade_name") || b.getString("legal_name"), legal_name: b.getString("legal_name"), address: addr,
      phone: b.getString("phone"), gst_number: b.getString("gst_number"), pst_number: b.getString("pst_number"),
      header: b.getString("receipt_header"), footer: b.getString("receipt_footer") };
  } catch (_) { return {}; }
}

function saleView(app, id, showCost) {
  const s = app.findRecordById("sales", id);
  const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
  const lines = app.findRecordsByFilter("sale_lines", "sale = {:s}", "line_no", 0, 0, { s: id }).map((l) => {
    const v = { id: l.id, line_no: l.getInt("line_no"), name: l.getString("name"), product: l.getString("product"), selling_unit: l.getString("selling_unit"),
      qty: l.getFloat("qty"), base_qty: l.getFloat("base_qty"), regular_price_cents: l.getInt("regular_price_cents"), price_cents: l.getInt("price_cents"),
      override_reason: l.getString("override_reason"), gross_cents: l.getInt("gross_cents"), line_discount_cents: l.getInt("line_discount_cents"),
      discount_label: l.getString("discount_label"), promo_cents: l.getInt("promo_cents"), promo_label: l.getString("promo_label"), staff_cents: l.getInt("staff_cents"), cart_discount_cents: l.getInt("cart_discount_cents"), net_cents: l.getInt("net_cents"), taxes: j(l, "taxes", []), deposit_cents: l.getInt("deposit_cents"),
      voided: l.getBool("voided"), age_checked: l.getBool("age_checked") };
    if (showCost) v.cost_cents = l.getInt("cost_cents");
    return v;
  });
  const payments = app.findRecordsByFilter("payments", "sale = {:s}", "created_at", 0, 0, { s: id }).map((p) => ({
    method: p.getString("method"), status: p.getString("status"), amount_cents: p.getInt("amount_cents"), tendered_cents: p.getInt("tendered_cents"),
    currency: p.getString("currency"), fx_rate: p.getFloat("fx_rate"), change_cents: p.getInt("change_cents"), last4: p.getString("last4"), reference: p.getString("reference") }));
  let cashier = "";
  try { cashier = app.findRecordById("users", s.getString("cashier")).getString("name"); } catch (_) { cashier = ""; }
  return {
    id: s.id, number: s.getString("number"), status: s.getString("status"), training: s.getBool("training"), tax_mode: s.getString("tax_mode"),
    completed_at: s.getString("completed_at"), cashier: cashier, till: s.getString("till"),
    till_number: (() => { try { return require(`${__hooks}/lib/tills.js`).tillNo(app.findRecordById("tills", s.getString("till"))); } catch (_) { return 0; } })(),
    subtotal_cents: s.getInt("subtotal_cents"), discount_cents: s.getInt("discount_cents"), tax_cents: s.getInt("tax_cents"),
    cart_discount_cents: s.getInt("cart_discount_cents"), cart_discount_label: s.getString("cart_discount_label"),
    promotions: j(s, "promotions", []), coupons: j(s, "coupons", []),
    staff_name: s.getString("staff_name"), staff_discount_cents: s.getInt("staff_discount_cents"),
    customer: s.getString("customer"), customer_name: (() => { if (!s.getString("customer")) return ""; try { return app.findRecordById("customers", s.getString("customer")).getString("first_name"); } catch (_) { return ""; } })(),
    loyalty_earned: s.getInt("loyalty_earned"), loyalty_redeemed: s.getInt("loyalty_redeemed"), loyalty_redeem_cents: s.getInt("loyalty_redeem_cents"),
    loyalty_balance: s.getInt("loyalty_balance"),
    deposit_cents: s.getInt("deposit_cents"), total_cents: s.getInt("total_cents"), rounding_cents: s.getInt("rounding_cents"),
    paid_cents: s.getInt("paid_cents"), change_cents: s.getInt("change_cents"), taxes: j(s, "taxes", []), exempt: j(s, "exempt", null),
    approvals: j(s, "approvals", []), note: s.getString("note"), void_reason: s.getString("void_reason"),
    offline: s.getBool("offline"), offline_ref: s.getString("offline_ref"), sync_note: s.getString("sync_note"),
    reprints: s.getInt("reprints"),
    lines: lines, payments: payments, business: business(app),
    savings_cents: lines.filter((l) => !l.voided).reduce((a, l) => a + Math.max(0, Math.round(l.regular_price_cents * l.qty) - l.gross_cents) + l.line_discount_cents + l.cart_discount_cents, 0),
  };
}

// ---- Completing a sale --------------------------------------------------------------------------

function nextNumber(app, kind, ctx) {
  const r = app.findFirstRecordByData("settings", "key", "sales.next_number");
  let v = {};
  try { v = JSON.parse(r.getString("value") || "{}") || {}; } catch (_) { v = {}; }
  const n = Number(v[kind] || 1);
  v[kind] = n + 1;
  r.set("value", v);
  r.set("updated_by", ctx.actor); r.set("@actor", ctx.actor); r.set("@device", ctx.device || "");
  app.save(r);
  return n;
}

function openTill(app, deviceId) {
  if (!deviceId) return null;
  const t = app.findRecordsByFilter("tills", "device = {:d} && status = 'open'", "-opened_at", 1, 0, { d: deviceId });
  return t.length ? t[0] : null;
}

// Offline sales (BR-12): open what packs there are; a shortfall goes negative instead of failing.
function openPacksForOffline(app, l, ctx) {
  try { openPacksFor(app, l, ctx); } catch (_) { /* not enough: the caller lets stock go negative */ }
}

// Opens packs so a line can be served (FR-3.05): loose units from packs of singles, packs from cases.
function openPacksFor(app, l, ctx) {
  for (let guard = 0; guard < 30; guard++) {
    const lv = st().level(app, l.p.id, ctx);
    const sealed = st().sealedOf(lv);
    const units = require(`${__hooks}/lib/catalogue.js`).unitsOf(app, l.p.id);
    const loose = st().isLooseUnit(l.u);
    if (loose ? lv.getFloat("loose_qty") + 1e-9 >= l.base : (sealed[l.u.id] || 0) >= l.qty) return;
    // What to open: for loose, a sealed pack that opens into loose units, else a case of packs; for a
    // pack, a case that holds it.
    const candidates = units.filter((u) => (sealed[u.id] || 0) > 0 && !st().isLooseUnit(u))
      .map((u) => ({ u, inner: st().sealedInner(app, u) }))
      .filter((x) => loose ? true : x.inner === l.u.id)
      .sort((a, b) => (loose ? (a.inner === "" ? 0 : 1) - (b.inner === "" ? 0 : 1) : 0) || a.u.getFloat("base_qty") - b.u.getFloat("base_qty"));
    if (!candidates.length) bad("Not enough '" + l.name + "' even after opening packs.");
    st().packBreak(app, { product: l.p.id, selling_unit: candidates[0].u.id, count: 1 }, Object.assign({}, ctx, { op: "" }));
  }
}

// internal: {exchange_cents} when lib/returns.js records an exchange (never from the request body).
function complete(app, input, ctx, internal) {
  const id = String(input.id || "");
  if (!/^[a-z0-9]{15}$/.test(id)) bad("The sale needs an id made on the till (15 letters and digits).");
  const existing = app.findRecordsByFilter("sales", "id = {:id}", "", 1, 0, { id: id });
  if (existing.length) return { duplicate: true, sale: saleView(app, id, ctx.showCost) };

  const actor = ctx.user;
  const b = build(app, input, actor);
  const approval = input.approval ? approvalFor(app, input.approval, "sales.approve") : null;
  const quote = quoteView(b, approval);
  if (b.problems.length) return { refused: 409, message: b.problems[0].message, quote };
  if (b.needs.length && !approval) return { refused: 403, message: "A manager's approval is needed: " + b.needs.join("; ") + ".", quote };
  if (input.expected_total_cents !== undefined && Number(input.expected_total_cents) !== b.priced.total_cents) {
    return { refused: 409, message: "The total changed (prices or tax were updated). Check the new total.", quote };
  }
  // Training sales need no till, but are listed on its Z report when one is open (never in its money).
  const till = openTill(app, ctx.device);
  if (!b.training && !till) return { refused: 409, message: "Open the till before selling.", quote };
  const number = (b.training ? "T-" : "S-") + ("000000" + nextNumber(app, b.training ? "training" : "sale", ctx)).slice(-6);
  if (b.training && (input.payments || []).some((p) => p.method === "deposit" || p.method === "house_account")) return { refused: 409, message: "Training sales cannot use a deposit or a house account.", quote };
  const pay = settlePayments(app, b.priced.total_cents, input.payments, { ctx, exchange_cents: internal && internal.exchange_cents, sale_id: id, number: number, platform: !!(internal && internal.delivery) });
  if (pay.remaining > 0) return { refused: 409, message: "Not paid in full: " + pay.remaining + " cents left.", quote };
  const s = new Record(app.findCollectionByNameOrId("sales"));
  s.set("id", id);
  const appr = [];
  if (approval && b.needs.length) b.needs.forEach((w) => appr.push({ what: w, by: "users:" + approval.user, name: approval.name, at: new Date().toISOString() }));
  s.load({ number, till: till ? till.id : "", cashier: actor ? actor.id : "", status: "completed", training: b.training, offline: false,
    tax_mode: b.mode, subtotal_cents: b.priced.subtotal_cents, discount_cents: b.priced.discount_cents, tax_cents: b.priced.tax_cents,
    cart_discount_cents: b.cartDisc, cart_discount_label: b.cartDiscLabel, promotions: b.promotions, coupons: b.coupons.filter((c) => b.couponsUnused.indexOf(c) < 0),
    staff_user: b.staff ? b.staff.user : "", staff_name: b.staff ? b.staff.name : "", staff_discount_cents: b.staff ? b.staff.cents : 0,
    customer: b.loyalty ? b.loyalty.c.id : "", loyalty_earned: b.loyalty ? b.loyalty.earn : 0, loyalty_redeemed: b.loyalty ? b.loyalty.redeem.points : 0,
    loyalty_redeem_cents: b.loyalty ? b.loyalty.redeem.cents : 0,
    deposit_cents: b.priced.deposit_cents, total_cents: b.priced.total_cents, rounding_cents: pay.rounding_cents, paid_cents: pay.paid_cents,
    change_cents: pay.change_cents, taxes: b.priced.taxes, exempt: b.exempt, approvals: appr, note: String(input.note || "").substring(0, 500),
    items: b.live.reduce((a, l) => a + (st().isLooseUnit(l.u) && l.u.getString("kind") === "weight" ? 1 : l.qty), 0),
    completed_at: new DateTime(), device_time: String(input.device_time || "").substring(0, 40) });
  st().stamp(s, ctx);
  app.save(s);

  const pl = {};
  b.priced.lines.forEach((l) => { pl[l.key] = l; });
  let costTotal = 0;
  b.lines.forEach((l, i) => {
    const line = new Record(app.findCollectionByNameOrId("sale_lines"));
    if (l.voided) {
      line.load({ sale: id, line_no: i + 1, product: l.p.id, selling_unit: l.u.id, name: l.name, qty: l.qty, voided: true });
    } else {
      let lots = [], cost = 0;
      if (!b.training) {
        // A bundle's components leave stock instead of the bundle (P3 step 8)
        require(`${__hooks}/lib/variety.js`).stockItems(app, l).forEach((x) => {
          openPacksFor(app, x, ctx);
          const lv = st().level(app, x.p.id, ctx);
          const sealed = st().sealedOf(lv);
          st().removeFromLevel(app, x.p, x.u, st().isLooseUnit(x.u) ? x.base : x.qty, lv, sealed);
          st().saveLevel(app, lv, sealed, ctx);
          // Expired lots only when fresh ones are not enough (the sale was approved for it, BR-14).
          const have = st().lotsOf(app, x.p.id);
          const t = st().takeLots(app, x.p.id, x.base, { lots: have.freshQty + 1e-9 < x.base ? have.all : have.fresh }, ctx);
          lots = lots.concat(t.taken); cost += t.value;
          require(`${__hooks}/lib/delivery.js`).onSold(app, ctx, x.p, x.base, id, "");      // consignment: owed to the vendor (FR-6.14)
          st().movement(app, { product: x.p.id, type: "sale", qty_base: -x.base, selling_unit: x.u.id, unit_qty: x.qty, lots_taken: t.taken,
            cost_cents: x.base ? Math.round((t.value / x.base) * 10000) / 10000 : 0, value_cents: -t.value, ref_collection: "sales", ref_id: id,
            note: number + (x.bundle ? " (" + x.bundle + ")" : "") }, Object.assign({}, ctx, { op: "" }));
        });
      }
      costTotal += cost;
      line.load({ sale: id, line_no: i + 1, product: l.p.id, selling_unit: l.u.id, name: l.name, qty: l.qty, base_qty: l.base, tare: l.tare,
        regular_price_cents: l.regular, price_cents: l.price, override_reason: l.reason, gross_cents: l.gross, line_discount_cents: l.ld,
        discount_label: l.dl, promo_cents: l.pc, promo_label: l.pl, promotions: l.pids, staff_cents: l.sc, cart_discount_cents: pl[l.key].cart_discount_cents, net_cents: pl[l.key].net_cents, tax_class: l.p.getString("tax_class"),
        taxes: pl[l.key].taxes, deposit_cents: l.deposit, lots: lots, cost_cents: cost, age_checked: l.age_checked, serials: l.serialList || [] });
    }
    st().stamp(line, ctx);
    app.save(line);
  });
  s.set("cost_cents", costTotal);
  // Loyalty ledger and the customer's visits and spend (training sales: none)
  if (b.loyalty && !b.training) s.set("loyalty_balance", require(`${__hooks}/lib/customers.js`).settle(app, b.loyalty.c, s, b.loyalty.earn, b.loyalty.redeem, ctx, false));
  st().stamp(s, ctx);
  app.save(s);

  pay.payments.forEach((pm) => {
    const r = new Record(app.findCollectionByNameOrId("payments"));
    r.load(Object.assign({ sale: id }, pm));
    st().stamp(r, ctx);
    app.save(r);
  });
  if (b.exempt) {
    const r = new Record(app.findCollectionByNameOrId("tax_exemptions"));
    r.load({ sale: id, reason: b.exempt.reason, reference: b.exempt.reference, exempt_cents: b.exemptCents });
    st().stamp(r, ctx);
    app.save(r);
  }
  if (input.cart_id) app.findRecordsByFilter("soft_holds", "cart_id = {:c}", "", 0, 0, { c: String(input.cart_id) }).forEach((h) => app.delete(h));
  if (approval) useApproval(app, input.approval);
  if (!b.training && b.promotions.length) require(`${__hooks}/lib/promotions.js`).usage(app, b.promotions.filter((a) => a.id !== "markdown"), ctx);
  if (b.staff) useApproval(app, b.staff.approval);
  return { duplicate: false, sale: saleView(app, id, ctx.showCost) };
}

// ---- Void a completed sale (FR-3.11, BR-18) -------------------------------------------------------
// Only while its till is still open (later: a return). Stock goes back to the lots it came from.

function voidSale(app, id, body, ctx) {
  let s;
  try { s = app.findRecordById("sales", id); } catch (_) { bad("Unknown sale."); }
  if (s.getString("status") !== "completed") bad("This sale is already voided.");
  if (app.findRecordsByFilter("payments", "sale = {:s} && method = 'exchange'", "", 1, 0, { s: id }).length) bad("This sale is part of an exchange. Use a return instead.");
  if (app.findRecordsByFilter("returns", "sale = {:s}", "", 1, 0, { s: id }).length) bad("Items of this sale were returned. Use a return instead.");
  const reason = String(body.reason || "").trim();
  if (!reason) bad("Give a reason for the void.");
  let by = ctx.user;
  if (!can(app, ctx.user, "sales.void")) {
    const a = approvalFor(app, body.approval, "sales.void");
    if (!a) throw new ForbiddenError("A manager's approval is needed to void a sale.");
    by = app.findRecordById("users", a.user);
    useApproval(app, body.approval);
  }
  if (!s.getBool("training")) {
    const till = s.getString("till") ? app.findRecordById("tills", s.getString("till")) : null;
    if (!till || till.getString("status") !== "open") bad("The till of this sale is closed. Use a return instead.");
    app.findRecordsByFilter("sale_lines", "sale = {:s} && voided = false", "line_no", 0, 0, { s: id }).forEach((l) => {
      const p = app.findRecordById("products", l.getString("product"));
      const u = app.findRecordById("selling_units", l.getString("selling_unit"));
      const lv = st().level(app, p.id, ctx);
      const sealed = st().sealedOf(lv);
      st().addToLevel(u, st().isLooseUnit(u) ? l.getFloat("base_qty") : l.getFloat("qty"), lv, sealed);
      st().saveLevel(app, lv, sealed, ctx);
      let lots = [];
      try { lots = JSON.parse(l.getString("lots") || "[]") || []; } catch (_) { lots = []; }
      lots.forEach((t) => {
        try {
          const lot = app.findRecordById("stock_lots", t.lot);
          lot.set("qty", r3(lot.getFloat("qty") + t.qty));
          st().stamp(lot, ctx);
          app.save(lot);
        } catch (_) { /* lot removed */ }
      });
      st().movement(app, { product: p.id, type: "sale", qty_base: l.getFloat("base_qty"), selling_unit: u.id, unit_qty: l.getFloat("qty"),
        lots_taken: lots, value_cents: l.getInt("cost_cents"), ref_collection: "sales", ref_id: id, note: "Void " + s.getString("number"), reason: reason },
        Object.assign({}, ctx, { op: "" }));
    });
  }
  app.findRecordsByFilter("payments", "sale = {:s} && status = 'approved'", "", 0, 0, { s: id }).forEach((p) => {
    // Store credit spent on the sale goes back on the credit.
    if (p.getString("method") === "store_credit") {
      const c = app.findRecordsByFilter("store_credits", "code = {:c}", "", 1, 0, { c: p.getString("reference") })[0];
      if (c) { c.set("balance_cents", c.getInt("balance_cents") + p.getInt("amount_cents")); c.set("status", "active"); st().stamp(c, ctx); app.save(c); }
    }
    p.set("status", "voided"); st().stamp(p, ctx); app.save(p);
  });
  s.set("status", "voided"); s.set("voided_by", "users:" + by.id); s.set("voided_at", new DateTime()); s.set("void_reason", reason.substring(0, 300));
  st().stamp(s, ctx);
  app.save(s);
  return saleView(app, id, ctx.showCost);
}

// ---- Holds (FR-3.10) and soft holds (BR-13) -------------------------------------------------------

function hold(app, body, ctx) {
  const h = new Record(app.findCollectionByNameOrId("holds"));
  const cart = body.cart || {};
  if (!Array.isArray(cart.lines) || !cart.lines.length) bad("Nothing to hold.");
  h.load({ label: String(body.label || "").substring(0, 80), status: "held", cart: cart, total_cents: Number(body.total_cents) || 0,
    items: cart.lines.length, held_by: ctx.user ? ctx.user.id : "" });
  st().stamp(h, ctx);
  app.save(h);
  return h;
}

function recall(app, id, ctx, cancel) {
  let h;
  try { h = app.findRecordById("holds", id); } catch (_) { bad("Unknown held sale."); }
  if (h.getString("status") !== "held") bad("This sale was already recalled or cancelled.");
  h.set("status", cancel ? "cancelled" : "recalled");
  if (!cancel) { h.set("recalled_by", ctx.user ? ctx.user.id : ""); h.set("recalled_at", new DateTime()); }
  st().stamp(h, ctx);
  app.save(h);
  return h;
}

// Replaces this cart's soft holds: items whose stock is at or under the limit are held for N minutes.
function softHold(app, body, ctx) {
  const cfg = setting(app, "sales.soft_hold", { units: 3, minutes: 5 }) || {};
  const cartId = String(body.cart_id || "");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(cartId)) bad("Invalid cart id.");
  const now = new Date();
  app.findRecordsByFilter("soft_holds", "cart_id = {:c} || expires_at < {:n}", "", 0, 0,
    { c: cartId, n: now.toISOString().replace("T", " ") }).forEach((h) => app.delete(h));
  const held = [];
  (Array.isArray(body.items) ? body.items : []).slice(0, 300).forEach((it) => {
    const q = Number(it.qty_base);
    if (!(q > 0)) return;
    const lv = app.findRecordsByFilter("stock_levels", "product = {:p}", "", 1, 0, { p: String(it.product || "") });
    if (!lv.length || lv[0].getFloat("on_hand") > Number(cfg.units || 3)) return;
    const h = new Record(app.findCollectionByNameOrId("soft_holds"));
    h.load({ cart_id: cartId, product: it.product, qty_base: q, expires_at: new Date(now.getTime() + Number(cfg.minutes || 5) * 60000).toISOString().replace("T", " ") });
    st().stamp(h, ctx);
    app.save(h);
    held.push({ product: it.product, qty_base: q });
  });
  return { held };
}

module.exports = { build, quoteView, complete, voidSale, saleView, newApproval, settlePayments, hold, recall, softHold, openTill, nextNumber, business,
  openPacksForOffline, approvalFor, useApproval };

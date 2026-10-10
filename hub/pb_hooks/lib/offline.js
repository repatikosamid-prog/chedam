// Offline selling (P1 step 4): FR-3.16, BR-10, BR-12, Section 8.2; DL-86..89.
// pack():     everything a till needs to price and ring up sales without the hub (no costs).
// complete(): a sale the till made while the hub was unreachable. The customer has paid, so the hub
//             records what the till charged: it checks the arithmetic with the same pricing module but
//             does not price the sale again. Stock may go negative; an urgent task says so (BR-12).

const st = () => require(`${__hooks}/lib/stock.js`);
const core = () => require(`${__hooks}/lib/pricing_core.js`);
const sales = () => require(`${__hooks}/lib/sales.js`);
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function bad(msg) { throw new BadRequestError(msg); }
const r3 = (n) => Math.round(n * 1000) / 1000;

// Plain JSON of the chosen fields. JSON fields come back as raw bytes in the hub's JS engine (even
// through publicExport), so they are parsed from getString().
const JSON_FIELDS = { barcodes: true };

function rows(app, col, filter, fields) {
  return app.findRecordsByFilter(col, filter, "", 0, 0).map((r) => {
    const all = JSON.parse(JSON.stringify(r.publicExport()));
    const o = { id: r.id };
    fields.forEach((f) => {
      if (JSON_FIELDS[f]) { try { o[f] = JSON.parse(r.getString(f) || "null"); } catch (_) { o[f] = null; } }
      else o[f] = all[f];
    });
    return o;
  });
}

// The deals an offline sale used, as the till reported them (counted for max_uses; never re-priced).
function promosOf(input) {
  return (Array.isArray(input.promotions) ? input.promotions : []).slice(0, 50).map((a) => ({ id: String(a.id || ""), name: String(a.name || "").substring(0, 80),
    times: Math.max(1, Math.floor(Number(a.times) || 1)), saving_cents: Math.max(0, Math.floor(Number(a.saving_cents) || 0)) })).filter((a) => a.id);
}

function pack(app) {
  const mods = {};
  app.findRecordsByFilter("modules", "id != ''", "", 0, 0).forEach((m) => { mods[m.getString("module")] = m.getBool("enabled"); });
  let mode = "tax_added";
  try { mode = app.findRecordsByFilter("business", "id != ''", "", 1, 0)[0].getString("tax_display_mode") || "tax_added"; } catch (_) { /* default */ }
  return {
    at: new Date().toISOString(),
    business: sales().business(app),
    tax_mode: mode,
    province: require(`${__hooks}/lib/tax.js`).province(app),
    modules: { weighed_goods: !!mods.weighed_goods, regulated_items: !!mods.regulated_items, promotions: !!mods.promotions, customers: !!mods.customers_loyalty },
    // P2: deals and scheduled prices the till applies itself (its clock decides days and hours, P2-b)
    promotions: mods.promotions ? require(`${__hooks}/lib/promotions.js`).current(app) : [],
    scheduled_prices: mods.promotions ? require(`${__hooks}/lib/promotions.js`).currentScheduled(app) : [],
    markdowns: require(`${__hooks}/lib/promotions.js`).markdownSegments(app, null),   // FR-5.11, refreshed with the pack
    loyalty: (() => { const c = require(`${__hooks}/lib/customers.js`); const prog = c.program(app); return prog ? Object.assign({ program: prog }, c.offlineList(app)) : null; })(),
    settings: {
      payment_methods: setting(app, "sales.payment_methods", ["cash", "card"]), cash_rounding: setting(app, "sales.cash_rounding", true),
      usd_rate: setting(app, "sales.usd_rate", 1.35), discount_limit_pct: setting(app, "sales.discount_limit_pct", 10),
      override_limit_pct: setting(app, "sales.override_limit_pct", 10), exempt_reasons: setting(app, "sales.exempt_reasons", {}),
      float_default_cents: setting(app, "till.float_default_cents", 0), denominations: setting(app, "till.denominations", []),
    },
    categories: rows(app, "categories", "deleted_at = '' && pos_visible = true", ["name", "colour", "sort"]),
    products: rows(app, "products", "deleted_at = '' && status = 'active'",
      ["name", "category", "base_unit", "tax_class", "plu", "scale_code", "tare", "age_restricted", "min_age", "deposits_fees"]),
    units: rows(app, "selling_units", "deleted_at = '' && sell_at_pos = true",
      ["product", "name", "kind", "base_qty", "contains_qty", "barcodes", "price_cents", "is_default", "sort"]),
    tax_types: rows(app, "tax_types", "deleted_at = ''", ["code", "receipt_label"]),
    tax_rates: rows(app, "tax_rates", "deleted_at = ''", ["tax_type", "province", "rate", "effective_from", "effective_to"]),
    tax_classes: rows(app, "tax_classes", "deleted_at = ''", ["code", "name", "treatment", "tax_types"]),
    deposits_fees: rows(app, "deposits_fees", "deleted_at = '' && active = true", ["name", "amount_cents", "tax_class"]),
  };
}

// Takes `l.base` of a line out of stock even when there is not enough (BR-12): opens packs where it
// can, then lets the loose count go negative.
function forceOut(app, l, ctx) {
  try { sales().openPacksForOffline(app, l, ctx); } catch (_) { /* not enough packs: go negative below */ }
  const lv = st().level(app, l.p.id, ctx);
  const sealed = st().sealedOf(lv);
  if (!st().isLooseUnit(l.u) && (sealed[l.u.id] || 0) >= l.qty) sealed[l.u.id] -= l.qty;
  else lv.set("loose_qty", lv.getFloat("loose_qty") - l.base);
  st().saveLevel(app, lv, sealed, ctx);
  return st().takeLots(app, l.p.id, l.base, { allowExpired: true }, ctx);
}

function complete(app, input, ctx) {
  const id = String(input.id || "");
  if (!/^[a-z0-9]{15}$/.test(id)) bad("The sale needs an id made on the till.");
  if (app.findRecordsByFilter("sales", "id = {:id}", "", 1, 0, { id: id }).length) return { duplicate: true, sale: sales().saleView(app, id, ctx.showCost) };
  const ref = String(input.offline_ref || "").substring(0, 40);
  const training = !!input.training;

  // Who sold it: the person signed in on the till at the time (still active and allowed to sell).
  let cashier = ctx.user;
  if (input.cashier) {
    try {
      const u = app.findRecordById("users", String(input.cashier));
      if (require(`${__hooks}/lib/access.js`).isActive(u) && require(`${__hooks}/lib/access.js`).can(app, u, "sales.sell")) cashier = u;
    } catch (_) { /* unknown: the uploader */ }
  }

  // Lines as the till sold them
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length || lines.length > 300) bad("An offline sale has 1 to 300 lines.");
  const out = lines.map((ln, i) => {
    let p, u;
    try { p = app.findRecordById("products", String(ln.product || "")); u = app.findRecordById("selling_units", String(ln.selling_unit || "")); } catch (_) { bad("Line " + (i + 1) + ": unknown product."); }
    if (u.getString("product") !== p.id) bad("Line " + (i + 1) + ": that unit belongs to another product.");
    const qty = Number(ln.qty);
    if (!(qty > 0) || (u.getString("kind") === "weight" ? Math.abs(r3(qty) - qty) > 1e-9 : qty !== Math.floor(qty))) bad("Line " + (i + 1) + ": quantity is not valid.");
    const ints = ["gross_cents", "line_discount_cents", "promo_cents", "deposit_cents", "regular_price_cents", "price_cents"];
    ints.forEach((f) => { const v = Number(ln[f] || 0); if (!(v >= 0) || v !== Math.floor(v)) bad("Line " + (i + 1) + ": " + f + " is not valid."); });
    const okRates = (a) => Array.isArray(a) && a.every((t) => t && typeof t.code === "string" && Number(t.rate) >= 0 && Number(t.rate) <= 100);
    if (!okRates(ln.rates || []) || !okRates(ln.deposit_rates || [])) bad("Line " + (i + 1) + ": tax rates are not valid.");
    return { key: String(ln.key || "l" + i), p, u, voided: !!ln.voided, name: String(ln.name || p.getString("name")).substring(0, 200), qty,
      base: r3(qty * (u.getFloat("base_qty") || 1)), tare: Number(ln.tare || 0), regular: Number(ln.regular_price_cents || 0), price: Number(ln.price_cents || 0),
      reason: String(ln.override_reason || "").substring(0, 200), gross: Number(ln.gross_cents || 0), ld: Math.min(Number(ln.line_discount_cents || 0), Number(ln.gross_cents || 0)),
      dl: String(ln.discount_label || "").substring(0, 40), pc: Math.min(Number(ln.promo_cents || 0), Number(ln.line_discount_cents || 0)),
      pl: String(ln.promo_label || "").substring(0, 200), pids: Array.isArray(ln.promotions) ? ln.promotions.map(String).slice(0, 20) : [],
      deposit: Number(ln.deposit_cents || 0), rates: ln.rates || [], depositRates: ln.deposit_rates || [], age_checked: !!ln.age_checked };
  });
  const live = out.filter((l) => !l.voided);
  const mode = input.tax_mode === "tax_included" ? "tax_included" : "tax_added";
  const priced = core().compute(live.map((l) => ({ key: l.key, gross_cents: l.gross, line_discount_cents: l.ld, rates: l.rates,
    deposit_cents: l.deposit, deposit_rates: l.depositRates })), { mode: mode, cart_discount_cents: Number(input.cart_discount_cents || 0) });
  const totals = input.totals || {};
  if (priced.total_cents !== Number(totals.total_cents) || priced.tax_cents !== Number(totals.tax_cents)) {
    bad("The offline sale's figures do not add up (" + totals.total_cents + " vs " + priced.total_cents + ").");
  }
  const pay = sales().settlePayments(app, priced.total_cents, input.payments, { relaxed: true, ctx });
  if (pay.remaining > 0) bad("The offline sale is not paid in full.");

  // Its till: this device's till, normally still open (the till closes only after uploading).
  let till = null, note = "";
  if (input.till) {
    try { till = app.findRecordById("tills", String(input.till)); } catch (_) { till = null; }
    if (till && till.getString("device") !== ctx.device) till = null;
    if (till && till.getString("status") !== "open") note = "Arrived after till " + require(`${__hooks}/lib/tills.js`).tillNo(till) + " (Z " + till.getInt("number") + ") was closed: not in its Z report.";
  }
  if (!till && !training) note = (note ? note + " " : "") + "No open till recorded for this sale.";

  // Loyalty as the till counted it (FR-7.06): never re-priced; a redemption the balance no longer covers is kept and a task raised
  let loyal = null;
  if (input.customer) {
    try {
      const c = app.findRecordById("customers", String(input.customer));
      if (c.getString("status") === "active") loyal = { c: c, earn: Math.max(0, Math.floor(Number(input.loyalty_earned) || 0)),
        redeem: { points: Math.max(0, Math.floor(Number(input.loyalty_redeemed) || 0)), cents: Math.max(0, Math.floor(Number(input.loyalty_redeem_cents) || 0)) } };
    } catch (_) { loyal = null; }
  }
  const number = (training ? "T-" : "S-") + ("000000" + sales().nextNumber(app, training ? "training" : "sale", ctx)).slice(-6);
  const s = new Record(app.findCollectionByNameOrId("sales"));
  s.set("id", id);
  s.load({ number, till: till ? till.id : "", cashier: cashier ? cashier.id : "", status: "completed", training, offline: true, tax_mode: mode,
    subtotal_cents: priced.subtotal_cents, discount_cents: priced.discount_cents, tax_cents: priced.tax_cents, deposit_cents: priced.deposit_cents,
    cart_discount_cents: priced.cart_discount_cents - (loyal ? loyal.redeem.cents : 0), cart_discount_label: String(input.cart_discount_label || "").substring(0, 40),
    promotions: promosOf(input), coupons: Array.isArray(input.coupons) ? input.coupons.map(String).slice(0, 10) : [],
    customer: loyal ? loyal.c.id : "", loyalty_earned: loyal ? loyal.earn : 0, loyalty_redeemed: loyal ? loyal.redeem.points : 0, loyalty_redeem_cents: loyal ? loyal.redeem.cents : 0,
    total_cents: priced.total_cents, rounding_cents: pay.rounding_cents, paid_cents: pay.paid_cents, change_cents: pay.change_cents, taxes: priced.taxes,
    exempt: input.exempt || null, approvals: [], note: String(input.note || "").substring(0, 500),
    items: live.reduce((a, l) => a + (l.u.getString("kind") === "weight" ? 1 : l.qty), 0),
    completed_at: new DateTime(), device_time: String(input.device_time || "").substring(0, 40), offline_ref: ref, synced_at: new DateTime(), sync_note: note });
  st().stamp(s, ctx);
  app.save(s);

  const pl = {};
  priced.lines.forEach((l) => { pl[l.key] = l; });
  let costTotal = 0;
  const touched = {};
  out.forEach((l, i) => {
    const line = new Record(app.findCollectionByNameOrId("sale_lines"));
    if (l.voided) {
      line.load({ sale: id, line_no: i + 1, product: l.p.id, selling_unit: l.u.id, name: l.name, qty: l.qty, voided: true });
    } else {
      let lots = [], cost = 0;
      if (!training) {
        const t = forceOut(app, l, ctx);
        lots = t.taken; cost = t.value;
        touched[l.p.id] = l.p;
        st().movement(app, { product: l.p.id, type: "sale", qty_base: -l.base, selling_unit: l.u.id, unit_qty: l.qty, lots_taken: lots,
          cost_cents: l.base ? Math.round((cost / l.base) * 10000) / 10000 : 0, value_cents: -cost, ref_collection: "sales", ref_id: id,
          note: number + " (offline " + ref + ")" }, Object.assign({}, ctx, { op: "" }));
      }
      costTotal += cost;
      line.load({ sale: id, line_no: i + 1, product: l.p.id, selling_unit: l.u.id, name: l.name, qty: l.qty, base_qty: l.base, tare: l.tare,
        regular_price_cents: l.regular, price_cents: l.price, override_reason: l.reason, gross_cents: l.gross, line_discount_cents: l.ld,
        discount_label: l.ld ? l.dl : "", promo_cents: l.pc, promo_label: l.pl, promotions: l.pids, cart_discount_cents: pl[l.key].cart_discount_cents, net_cents: pl[l.key].net_cents, tax_class: l.p.getString("tax_class"),
        taxes: pl[l.key].taxes, deposit_cents: l.deposit, lots: lots, cost_cents: cost, age_checked: l.age_checked });
    }
    st().stamp(line, ctx);
    app.save(line);
  });
  s.set("cost_cents", costTotal);
  st().stamp(s, ctx);
  app.save(s);
  pay.payments.forEach((pm) => {
    const r = new Record(app.findCollectionByNameOrId("payments"));
    r.load(Object.assign({ sale: id }, pm));
    st().stamp(r, ctx);
    app.save(r);
  });
  if (input.exempt && input.exempt.reason) {
    const r = new Record(app.findCollectionByNameOrId("tax_exemptions"));
    r.load({ sale: id, reason: String(input.exempt.reason).substring(0, 40), reference: String(input.exempt.reference || "").substring(0, 60),
      exempt_cents: Math.max(0, Number(input.exempt_cents) || 0) });
    st().stamp(r, ctx);
    app.save(r);
  }
  if (!training && promosOf(input).length) require(`${__hooks}/lib/promotions.js`).usage(app, promosOf(input), ctx);
  if (loyal && !training) { s.set("loyalty_balance", require(`${__hooks}/lib/customers.js`).settle(app, loyal.c, s, loyal.earn, loyal.redeem, ctx, true)); st().stamp(s, ctx); app.save(s); }
  // A sale that reached a closed till needs a look from the manager.
  if (note && !training) {
    const t = new Record(app.findCollectionByNameOrId("tasks"));
    t.load({ title: "Offline sale " + number + " (" + ref + "): " + note, kind: "offline_sale", source: "rule", rule_key: "sales:offline:" + id,
      status: "open", priority: "normal", link_collection: "sales", link_id: id });
    st().stamp(t, ctx);
    app.save(t);
  }
  return { duplicate: false, sale: sales().saleView(app, id, ctx.showCost) };
}

module.exports = { pack, complete };

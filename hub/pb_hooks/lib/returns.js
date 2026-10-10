// Returns and exchanges (P1 step 6): FR-4.07-4.11, 4.13, 4.14; BR-17, BR-23; store credit (FR-3.08).
//
// find()     sales a customer brings back: receipt number (S- or OFF-), or date, amount, card last 4.
// returnable(): what of a sale can still come back, each line's share of what was paid, and the policy.
// build()    the return asked for: lines, refund per line, approvals needed. Used by quote and complete.
//            With a receipt (BR-23): the price paid after the line's discount share plus its original tax
//            per type and deposit; never more than sold, the last return of a line takes exactly what is
//            left (no cent drifts). Without a receipt (FR-4.10): the lowest price of the last 30 days at
//            today's tax, as store credit, with a manager's PIN.
// complete() records it in one transaction: stock per item (back to stock, damaged, to vendor,
//            disposed; FR-4.11), refunds (cash rounded to 5 cents, card on the standalone terminal,
//            store credit code), optional exchange sale paid with the returned value (FR-4.13).

const st = () => require(`${__hooks}/lib/stock.js`);
const core = () => require(`${__hooks}/lib/pricing_core.js`);
const sales = () => require(`${__hooks}/lib/sales.js`);
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function can(app, user, code) { return !!user && require(`${__hooks}/lib/access.js`).can(app, user, code); }
function bad(msg) { throw new BadRequestError(msg); }
const r3 = (n) => Math.round(n * 1000) / 1000;
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const DISPOSITIONS = ["restock", "damaged", "vendor", "dispose"];
const DISPO_LABEL = { restock: "Back to stock", damaged: "Damaged", vendor: "Return to vendor", dispose: "Disposed" };

function dayStart(ymdText, plusDays) {
  const a = ymdText.split("-").map(Number);
  return new Date(a[0], a[1] - 1, a[2] + (plusDays || 0)).toISOString().replace("T", " ");
}
const dateOf = (s) => new Date(String(s).replace(" ", "T"));

// ---- Finding the sale (FR-4.08) ------------------------------------------------------------------

function find(app, q) {
  const num = String(q.number || "").trim().toUpperCase();
  let rows;
  if (num) {
    rows = app.findRecordsByFilter("sales", "(number = {:n} || offline_ref = {:n}) && training = false", "-completed_at", 20, 0, { n: num });
  } else {
    const parts = ["training = false", "status = 'completed'"];
    const params = {};
    if (q.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(q.date))) bad("The date is YYYY-MM-DD.");
      parts.push("completed_at >= {:f} && completed_at < {:t}");
      params.f = dayStart(String(q.date)); params.t = dayStart(String(q.date), 1);
    }
    if (q.amount_cents) {
      const a = Number(q.amount_cents);
      if (!(a > 0)) bad("The amount is not valid.");
      parts.push("(total_cents = {:a} || paid_cents = {:a})");
      params.a = a;
    }
    let ids = null;
    if (q.last4) {
      if (!/^[0-9]{4}$/.test(String(q.last4))) bad("The card's last 4 digits are 4 numbers.");
      ids = app.findRecordsByFilter("payments", "last4 = {:l} && method = 'card'", "-created_at", 50, 0, { l: String(q.last4) }).map((p) => p.getString("sale"));
      if (!ids.length) return [];
    }
    if (parts.length === 2 && !ids) bad("Enter the receipt number, or a date, amount or card's last 4 digits.");
    rows = app.findRecordsByFilter("sales", parts.join(" && "), "-completed_at", 50, 0, params);
    if (ids) rows = rows.filter((s) => ids.indexOf(s.id) >= 0);
  }
  return rows.slice(0, 20).map((s) => {
    let cashier = "";
    try { cashier = app.findRecordById("users", s.getString("cashier")).getString("name"); } catch (_) { cashier = ""; }
    return { id: s.id, number: s.getString("number"), offline_ref: s.getString("offline_ref"), status: s.getString("status"),
      completed_at: s.getString("completed_at"), total_cents: s.getInt("total_cents"), rounding_cents: s.getInt("rounding_cents"),
      items: s.getFloat("items"), cashier };
  });
}

// ---- Policy (FR-4.07) ----------------------------------------------------------------------------

function policyOf(app, p) {
  const days = Number(setting(app, "returns.window_days", 30));
  let window = days, blocked = p.getBool("non_returnable");
  if (p.getString("category")) {
    try {
      const c = app.findRecordById("categories", p.getString("category"));
      if (c.getInt("return_window_days") > 0) window = c.getInt("return_window_days");
      if (c.getBool("non_returnable")) blocked = true;
    } catch (_) { /* removed category: store default */ }
  }
  return { window_days: window, non_returnable: blocked };
}

// What was already returned of each sale line: {lineId: {qty, net, deposit, cost, taxes: {code@rate: cents}}}
function returnedOf(app, saleId) {
  const out = {};
  const rets = app.findRecordsByFilter("returns", "sale = {:s}", "", 0, 0, { s: saleId }).map((r) => r.id);
  rets.forEach((rid) => {
    app.findRecordsByFilter("return_lines", "return = {:r}", "", 0, 0, { r: rid }).forEach((l) => {
      const k = l.getString("sale_line");
      const o = out[k] || (out[k] = { qty: 0, net: 0, deposit: 0, cost: 0, taxes: {} });
      o.qty = r3(o.qty + l.getFloat("qty")); o.net += l.getInt("net_cents"); o.deposit += l.getInt("deposit_cents"); o.cost += l.getInt("cost_cents");
      j(l, "taxes", []).forEach((t) => { const g = t.code + "@" + t.rate; o.taxes[g] = (o.taxes[g] || 0) + t.tax_cents; });
    });
  });
  return out;
}

// A sale with, per line, what can still come back and its policy.
function returnable(app, saleId) {
  let s;
  try { s = app.findRecordById("sales", saleId); } catch (_) { bad("Unknown sale."); }
  if (s.getBool("training")) bad("Training sales cannot be returned.");
  const view = sales().saleView(app, saleId, false);
  const back = returnedOf(app, saleId);
  const age = (Date.now() - dateOf(s.getString("completed_at")).getTime()) / 86400000;
  const cardPaid = view.payments.filter((p) => p.method === "card" && p.status === "approved").reduce((a, p) => a + p.amount_cents, 0);
  const cardBack = refundedBy(app, saleId, "card");
  view.lines = view.lines.filter((l) => !l.voided).map((l) => {
    const b = back[l.id] || { qty: 0 };
    let p = null;
    try { p = app.findRecordById("products", l.product); } catch (_) { p = null; }
    const pol = p ? policyOf(app, p) : { window_days: 0, non_returnable: false };
    const perUnit = l.qty ? Math.round((l.net_cents + l.deposit_cents + (view.tax_mode === "tax_included" ? 0 : l.taxes.reduce((a, t) => a + t.tax_cents, 0))) / l.qty) : 0;
    return Object.assign(l, { returned_qty: b.qty, returnable_qty: r3(l.qty - b.qty), unit_refund_cents: perUnit,
      window_days: pol.window_days, outside_window: age > pol.window_days, non_returnable: pol.non_returnable,
      weighed: (() => { try { return app.findRecordById("selling_units", l.selling_unit).getString("kind") === "weight"; } catch (_) { return false; } })() });
  });
  view.status_note = s.getString("status") === "voided" ? "This sale was voided: nothing to return." : "";
  view.card_refundable_cents = Math.max(0, cardPaid - cardBack);
  view.days_ago = Math.floor(age);
  view.returns = app.findRecordsByFilter("returns", "sale = {:s}", "completed_at", 0, 0, { s: saleId }).map((r) => ({ id: r.id, number: r.getString("number"), refund_cents: r.getInt("refund_cents") }));
  return view;
}

function refundedBy(app, saleId, method) {
  let total = 0;
  app.findRecordsByFilter("returns", "sale = {:s}", "", 0, 0, { s: saleId }).forEach((r) => {
    app.findRecordsByFilter("refunds", "return = {:r} && method = {:m}", "", 0, 0, { r: r.id, m: method }).forEach((x) => { total += x.getInt("amount_cents"); });
  });
  return total;
}

// ---- Lowest price for a return without a receipt (FR-4.10) ---------------------------------------

function lowestPrice(app, u) {
  const days = Number(setting(app, "returns.lowest_price_days", 30));
  const since = new Date(Date.now() - days * 86400000).toISOString().replace("T", " ");
  let low = u.getInt("price_cents");
  app.findRecordsByFilter("price_history", "selling_unit = {:u} && field = 'price' && created_at >= {:f}", "", 0, 0, { u: u.id, f: since }).forEach((h) => {
    // A product's first price is recorded as a change from 0: zero is never a price it was sold at.
    [h.getInt("old_cents"), h.getInt("new_cents")].forEach((c) => { if (c > 0 && c < low) low = c; });
  });
  return low;
}

// ---- The return asked for ------------------------------------------------------------------------
// input: {sale, lines: [{sale_line, qty, disposition}] or (no sale) [{product, selling_unit, qty, disposition}],
//         reason, restocking_fee}
function build(app, input, actor) {
  const needs = [];
  const need = (w) => { if (needs.indexOf(w) < 0) needs.push(w); };
  const raw = Array.isArray(input.lines) ? input.lines.filter((l) => Number(l.qty) > 0) : [];
  if (!raw.length) bad("Choose what comes back.");
  if (raw.length > 200) bad("Up to 200 lines in one return.");
  const feePct = input.restocking_fee ? Number(setting(app, "returns.restocking_fee_pct", 0)) || 0 : 0;
  const out = [];
  let saleRec = null, mode = "tax_added", labels = {};

  if (input.sale) {
    try { saleRec = app.findRecordById("sales", String(input.sale)); } catch (_) { bad("Unknown sale."); }
    if (saleRec.getBool("training")) bad("Training sales cannot be returned.");
    if (saleRec.getString("status") !== "completed") bad("This sale was voided: nothing to return.");
    mode = saleRec.getString("tax_mode") || "tax_added";
    j(saleRec, "taxes", []).forEach((t) => { labels[t.code + "@" + t.rate] = t.label; });
    const back = returnedOf(app, saleRec.id);
    const age = (Date.now() - dateOf(saleRec.getString("completed_at")).getTime()) / 86400000;
    const seen = {};
    raw.forEach((ln, i) => {
      let sl;
      try { sl = app.findRecordById("sale_lines", String(ln.sale_line || "")); } catch (_) { bad("Line " + (i + 1) + ": not on this sale."); }
      if (sl.getString("sale") !== saleRec.id || sl.getBool("voided")) bad("Line " + (i + 1) + ": not on this sale.");
      if (seen[sl.id]) bad("'" + sl.getString("name") + "' is listed twice.");
      seen[sl.id] = true;
      const p = app.findRecordById("products", sl.getString("product"));
      let u = null;
      try { u = app.findRecordById("selling_units", sl.getString("selling_unit")); } catch (_) { u = null; }
      const weighed = u && u.getString("kind") === "weight";
      const Q = sl.getFloat("qty");
      const q = Number(ln.qty);
      if (weighed ? Math.abs(r3(q) - q) > 1e-9 : q !== Math.floor(q)) bad("'" + sl.getString("name") + "': the quantity is not valid.");
      const b = back[sl.id] || { qty: 0, net: 0, deposit: 0, cost: 0, taxes: {} };
      const left = r3(Q - b.qty);
      if (q > left + 1e-9) bad("'" + sl.getString("name") + "': only " + left + " can come back (" + Q + " sold, " + b.qty + " returned).");
      const all = Math.abs(q - left) < 1e-9;
      const share = (whole, done) => Math.min(whole - done, all ? whole - done : core().roundHalfUp((whole * q) / Q));
      const net = share(sl.getInt("net_cents"), b.net);
      const deposit = share(sl.getInt("deposit_cents"), b.deposit);
      const cost = share(sl.getInt("cost_cents"), b.cost);
      const taxes = j(sl, "taxes", []).map((t) => ({ code: t.code, rate: t.rate, tax_cents: share(t.tax_cents, b.taxes[t.code + "@" + t.rate] || 0) }));
      const pol = policyOf(app, p);
      if (pol.non_returnable) need("'" + p.getString("name") + "' is marked non-returnable");
      if (age > pol.window_days) need("Sold " + Math.floor(age) + " days ago (returns within " + pol.window_days + " days)");
      const dispo = DISPOSITIONS.indexOf(ln.disposition) >= 0 ? ln.disposition : "restock";
      out.push({ sl, p, u, name: sl.getString("name"), qty: q, base: r3(q * (sl.getFloat("base_qty") / (Q || 1))), price: sl.getInt("price_cents"),
        net, deposit, cost, taxes, dispo, lots: j(sl, "lots", []) });
    });
  } else {
    // No receipt: manager's PIN, store credit only, at the lowest recent price and today's tax.
    need("Return without a receipt");
    raw.forEach((ln, i) => {
      let p, u;
      try { p = app.findRecordById("products", String(ln.product || "")); u = app.findRecordById("selling_units", String(ln.selling_unit || "")); } catch (_) { bad("Line " + (i + 1) + ": unknown product."); }
      if (u.getString("product") !== p.id) bad("Line " + (i + 1) + ": that unit belongs to another product.");
      const weighed = u.getString("kind") === "weight";
      const q = Number(ln.qty);
      if (!(q > 0) || (weighed ? Math.abs(r3(q) - q) > 1e-9 : q !== Math.floor(q))) bad("Line " + (i + 1) + ": the quantity is not valid.");
      if (policyOf(app, p).non_returnable) need("'" + p.getString("name") + "' is marked non-returnable");
      const base = r3(q * (u.getFloat("base_qty") || 1));
      const price = lowestPrice(app, u);
      let deposit = 0, depositRates = [];
      const fees = p.get("deposits_fees") || [];
      if (fees.length && require(`${__hooks}/lib/catalogue.js`).moduleOn(app, "regulated_items")) {
        app.findRecordsByIds("deposits_fees", fees).forEach((f) => {
          if (!f.getBool("active") || f.getString("deleted_at")) return;
          deposit += core().roundHalfUp(f.getInt("amount_cents") * base);
          depositRates = require(`${__hooks}/lib/tax.js`).ratesFor(app, f.getString("tax_class")).map((t) => ({ code: t.code, label: t.label, rate: t.rate }));
        });
      }
      const rates = p.getString("tax_class") ? require(`${__hooks}/lib/tax.js`).ratesFor(app, p.getString("tax_class")).map((t) => ({ code: t.code, label: t.label, rate: t.rate })) : [];
      out.push({ sl: null, p, u, name: p.getString("name") + (u.getString("name") ? " (" + u.getString("name") + ")" : ""), qty: q, base, price,
        gross: core().roundHalfUp(price * q), deposit, rates, depositRates, dispo: DISPOSITIONS.indexOf(ln.disposition) >= 0 ? ln.disposition : "restock",
        cost: core().roundHalfUp(p.getInt("cost_cents") * base), lots: [] });
    });
    try { mode = app.findRecordsByFilter("business", "id != ''", "", 1, 0)[0].getString("tax_display_mode") || "tax_added"; } catch (_) { mode = "tax_added"; }
    const priced = core().compute(out.map((l, i) => ({ key: "r" + i, gross_cents: l.gross, line_discount_cents: 0, rates: l.rates,
      deposit_cents: l.deposit, deposit_rates: l.depositRates })), { mode: mode, cart_discount_cents: 0 });
    priced.taxes.forEach((t) => { labels[t.code + "@" + t.rate] = t.label; });
    out.forEach((l, i) => { l.net = priced.lines[i].net_cents; l.taxes = priced.lines[i].taxes; });
  }

  // Restocking fee: a share of the goods going back to stock (never of tax or deposits).
  out.forEach((l) => { l.fee = feePct > 0 && l.dispo === "restock" ? core().roundHalfUp((l.net * feePct) / 100) : 0; });
  const sum = (f) => out.reduce((a, l) => a + l[f], 0);
  const taxGroups = {};
  out.forEach((l) => l.taxes.forEach((t) => {
    const k = t.code + "@" + t.rate;
    const g = taxGroups[k] || (taxGroups[k] = { code: t.code, label: labels[k] || t.code, rate: t.rate, tax_cents: 0 });
    g.tax_cents += t.tax_cents;
  }));
  const tax = Object.keys(taxGroups).reduce((a, k) => a + taxGroups[k].tax_cents, 0);
  // Tax-included sales: the tax is inside the price paid, so it is not added again.
  const refund = sum("net") + sum("deposit") + (mode === "tax_included" ? 0 : tax) - sum("fee");
  const limit = Number(setting(app, "returns.cashier_limit_cents", 5000));
  if (refund > limit) need("Refund over $" + (limit / 100).toFixed(2));
  return { sale: saleRec, lines: out, mode, needs, net: sum("net"), deposit: sum("deposit"), fee: sum("fee"), tax, cost: sum("cost"),
    taxes: Object.keys(taxGroups).sort().map((k) => taxGroups[k]), refund, receipt: !!saleRec, approver: can(app, actor, "sales.approve") };
}

function quoteView(b, approved) {
  return {
    sale: b.sale ? b.sale.id : "", receipt: b.receipt, tax_mode: b.mode,
    lines: b.lines.map((l) => ({ sale_line: l.sl ? l.sl.id : "", product: l.p.id, selling_unit: l.u ? l.u.id : "", name: l.name, qty: l.qty,
      price_cents: l.price, net_cents: l.net, taxes: l.taxes, deposit_cents: l.deposit, fee_cents: l.fee, disposition: l.dispo })),
    net_cents: b.net, tax_cents: b.tax, taxes: b.taxes, deposit_cents: b.deposit, fee_cents: b.fee, refund_cents: b.refund,
    cash_refund_cents: core().cashRound(b.refund), needs_approval: approved || b.approver ? [] : b.needs, store_credit_only: !b.receipt,
  };
}

// ---- Refund payments ------------------------------------------------------------------------------
// refunds: [{method: cash|card|store_credit, amount_cents, last4, reference}] adding up to `total`.
// Cash that finishes the refund is rounded to 5 cents (BR-16). Card only up to what was paid by card.
function settleRefunds(app, total, refunds, b) {
  let remaining = total, rounding = 0;
  const out = [];
  (refunds || []).forEach((rf, i) => {
    const method = String(rf.method || "");
    if (["cash", "card", "store_credit"].indexOf(method) < 0) bad("Refund " + (i + 1) + ": '" + method + "' is not a refund method.");
    if (!b.receipt && method !== "store_credit") bad("Without a receipt the refund is store credit (FR-4.10).");
    const amt = Number(rf.amount_cents);
    if (!(amt > 0) || amt !== Math.floor(amt)) bad("Refund " + (i + 1) + ": the amount is not valid.");
    if (remaining <= 0) bad("The refund is already complete; remove refund " + (i + 1) + ".");
    const rec = { method, amount_cents: amt, last4: String(rf.last4 || "").substring(0, 4), reference: String(rf.reference || "").substring(0, 60) };
    if (rec.last4 && !/^[0-9]{4}$/.test(rec.last4)) bad("Card: the last 4 digits are 4 numbers.");
    if (method === "cash") {
      const due = core().cashRound(remaining);
      if (amt >= remaining || amt >= due) { rounding = due - remaining; rec.amount_cents = due; remaining = 0; }
      else remaining -= amt;
    } else {
      if (amt > remaining) bad("Refund " + (i + 1) + " is more than what is left to refund.");
      remaining -= amt;
    }
    out.push(rec);
  });
  if (remaining > 0) bad("Refunds add up to " + (total - remaining) + " of " + total + " cents.");
  const card = out.filter((x) => x.method === "card").reduce((a, x) => a + x.amount_cents, 0);
  if (card && b.sale) {
    const paid = app.findRecordsByFilter("payments", "sale = {:s} && method = 'card' && status = 'approved'", "", 0, 0, { s: b.sale.id }).reduce((a, p) => a + p.getInt("amount_cents"), 0);
    const left = paid - refundedBy(app, b.sale.id, "card");
    if (card > left) bad("Only " + left + " cents can go back to the card (what was paid by card).");
  }
  return { refunds: out, rounding_cents: rounding, paid_cents: out.reduce((a, x) => a + x.amount_cents, 0) };
}

// SC-XXXX-XXXX, no look-alike letters.
function newCode(app) {
  for (let i = 0; i < 20; i++) {
    const s = $security.randomStringWithAlphabet(8, "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
    const code = "SC-" + s.substring(0, 4) + "-" + s.substring(4);
    if (!app.findRecordsByFilter("store_credits", "code = {:c}", "", 1, 0, { c: code }).length) return code;
  }
  bad("Could not make a store credit code; try again.");
}

// ---- Stock for each returned item (FR-4.11) -------------------------------------------------------

function putBack(app, l, ret, ctx) {
  require(`${__hooks}/lib/delivery.js`).onSold(app, ctx, l.p, -l.base, "", ret.id);      // consignment: no longer owed
  const note = ret.number + (ret.sale ? " (sale " + ret.sale + ")" : " (no receipt)");
  const perBase = l.base ? l.cost / l.base : 0;
  if (l.dispo === "restock") {
    // A lot of its own at the cost it left with, dated like the earliest lot it came from (FEFO).
    let expiry = "";
    l.lots.forEach((t) => {
      try { const lot = app.findRecordById("stock_lots", t.lot); const e = lot.getString("expiry_date"); if (e && (!expiry || e < expiry)) expiry = e; } catch (_) { /* gone */ }
    });
    const lot = new Record(app.findCollectionByNameOrId("stock_lots"));
    lot.load({ product: l.p.id, lot_code: ret.number, expiry_date: expiry, received_qty: l.base, qty: l.base, cost_cents: Math.round(perBase * 10000) / 10000,
      source: "return", received_at: new DateTime() });
    st().stamp(lot, ctx);
    app.save(lot);
    l.lotId = lot.id;
    const lv = st().level(app, l.p.id, ctx);
    const sealed = st().sealedOf(lv);
    if (l.u && !st().isLooseUnit(l.u)) st().addToLevel(l.u, l.qty, lv, sealed);   // a pack comes back sealed
    else lv.set("loose_qty", r3(lv.getFloat("loose_qty") + l.base));
    st().saveLevel(app, lv, sealed, ctx);
    st().movement(app, { product: l.p.id, type: "return", qty_base: l.base, selling_unit: l.u ? l.u.id : "", unit_qty: l.qty, lot: lot.id,
      cost_cents: Math.round(perBase * 10000) / 10000, value_cents: l.cost, ref_collection: "returns", ref_id: ret.id, note: note, reason: "Customer return" },
      Object.assign({}, ctx, { op: "" }));
    return;
  }
  // Not back on the shelf: in and straight out again, so the history and the shrink report show it.
  const outType = { damaged: "damage", dispose: "loss", vendor: "return" }[l.dispo];
  const reason = { damaged: "Customer return: damaged", dispose: "Customer return: disposed", vendor: "Customer return: to vendor" }[l.dispo];
  st().movement(app, { product: l.p.id, type: "return", qty_base: l.base, selling_unit: l.u ? l.u.id : "", unit_qty: l.qty,
    cost_cents: Math.round(perBase * 10000) / 10000, value_cents: l.cost, ref_collection: "returns", ref_id: ret.id, note: note, reason: "Customer return" },
    Object.assign({}, ctx, { op: "" }));
  st().movement(app, { product: l.p.id, type: outType, qty_base: -l.base, selling_unit: l.u ? l.u.id : "", unit_qty: l.qty,
    cost_cents: Math.round(perBase * 10000) / 10000, value_cents: -l.cost, ref_collection: "returns", ref_id: ret.id, note: note, reason: reason },
    Object.assign({}, ctx, { op: "" }));
  if (l.dispo === "vendor") {
    const t = new Record(app.findCollectionByNameOrId("tasks"));
    t.load({ title: "Send back to the vendor: " + l.name + " × " + l.qty + " (" + ret.number + ")", kind: "vendor_return", source: "rule",
      rule_key: "returns:vendor:" + ret.id + ":" + l.p.id, status: "open", priority: "normal", link_collection: "returns", link_id: ret.id });
    st().stamp(t, ctx);
    app.save(t);
  }
}

// ---- Complete -------------------------------------------------------------------------------------
// input: build() input + {id, refunds, approval, device_time, exchange: sale input (id, lines, payments, ...)}
// internal: {} (reserved)
function complete(app, input, ctx) {
  const id = String(input.id || "");
  if (!/^[a-z0-9]{15}$/.test(id)) bad("The return needs an id made on the till (15 letters and digits).");
  if (app.findRecordsByFilter("returns", "id = {:id}", "", 1, 0, { id: id }).length) return { duplicate: true, return: view(app, id, ctx.showCost) };

  const b = build(app, input, ctx.user);
  const approval = input.approval ? sales().approvalFor(app, input.approval, "sales.approve") : null;
  const quote = quoteView(b, !!approval);
  if (b.needs.length && !b.approver && !approval) return { refused: 403, message: "A manager's approval is needed: " + b.needs.join("; ") + ".", quote };
  if (input.expected_refund_cents !== undefined && Number(input.expected_refund_cents) !== b.refund) {
    return { refused: 409, message: "The refund changed. Check the new amount.", quote };
  }
  const till = sales().openTill(app, ctx.device);
  if (!till) return { refused: 409, message: "Open the till before taking a return.", quote };

  // Exchange: the new sale is paid first with the returned value; what is left is refunded.
  let exchangeSale = null, applied = 0;
  if (input.exchange) {
    const ex = Object.assign({}, input.exchange);
    const saleBuild = sales().build(app, ex, ctx.user);
    applied = Math.min(b.refund, saleBuild.priced.total_cents);
    ex.payments = (applied > 0 ? [{ method: "exchange", amount_cents: applied, reference: "" }] : []).concat(ex.payments || []);
    const r = sales().complete(app, ex, ctx, { exchange_cents: applied });
    if (r.refused) return { refused: r.refused, message: "New items: " + r.message, quote, sale_quote: r.quote };
    if (r.duplicate) bad("That exchange sale was already recorded.");
    exchangeSale = r.sale;
  }
  const toRefund = b.refund - applied;
  const pay = toRefund > 0 ? settleRefunds(app, toRefund, input.refunds, b) : { refunds: [], rounding_cents: 0, paid_cents: 0 };
  if (toRefund <= 0 && (input.refunds || []).length) bad("Nothing is left to refund: the new items take the whole return.");

  const number = "R-" + ("000000" + sales().nextNumber(app, "return", ctx)).slice(-6);
  const ret = new Record(app.findCollectionByNameOrId("returns"));
  ret.set("id", id);
  const appr = [];
  if (b.needs.length) {
    const by = approval ? { user: approval.user, name: approval.name } : { user: ctx.user ? ctx.user.id : "", name: ctx.user ? ctx.user.getString("name") : "" };
    b.needs.forEach((w) => appr.push({ what: w, by: "users:" + by.user, name: by.name, at: new Date().toISOString() }));
  }
  ret.load({ number, sale: b.sale ? b.sale.id : "", till: till.id, cashier: ctx.user ? ctx.user.id : "", status: "completed", receipt: b.receipt,
    reason: String(input.reason || "").trim().substring(0, 300), tax_mode: b.mode, net_cents: b.net, tax_cents: b.tax, deposit_cents: b.deposit,
    fee_cents: b.fee, refund_cents: b.refund, rounding_cents: pay.rounding_cents, paid_cents: pay.paid_cents + applied, taxes: b.taxes, approvals: appr,
    exchange_sale: exchangeSale ? exchangeSale.id : "", cost_cents: b.cost, completed_at: new DateTime(), device_time: String(input.device_time || "").substring(0, 40) });
  st().stamp(ret, ctx);
  app.save(ret);
  const meta = { id, number, sale: b.sale ? b.sale.getString("number") : "" };

  b.lines.forEach((l, i) => {
    // A bundle comes back as its components, each with its share of the cost (P3 step 8)
    const comps = require(`${__hooks}/lib/variety.js`).componentsOf(l.p);
    if (comps.length && l.qty) {
      const items = require(`${__hooks}/lib/variety.js`).stockItems(app, l);
      const share = l.cost / items.length;
      items.forEach((x) => putBack(app, { p: x.p, u: x.u, qty: x.qty, base: x.base, cost: Math.round(share), lots: [], dispo: l.dispo }, meta, ctx));
    } else putBack(app, l, meta, ctx);
    const r = new Record(app.findCollectionByNameOrId("return_lines"));
    r.load({ return: id, line_no: i + 1, sale_line: l.sl ? l.sl.id : "", product: l.p.id, selling_unit: l.u ? l.u.id : "", name: l.name, qty: l.qty,
      base_qty: l.base, price_cents: l.price, net_cents: l.net, taxes: l.taxes, tax_cents: l.taxes.reduce((a, t) => a + t.tax_cents, 0),
      deposit_cents: l.deposit, fee_cents: l.fee, disposition: l.dispo, cost_cents: l.cost, lot: l.lotId || "" });
    st().stamp(r, ctx);
    app.save(r);
  });

  // Loyalty points of the returned items (FR-4.12)
  if (b.sale) require(`${__hooks}/lib/customers.js`).onReturn(app, b.sale, ret, b.net, ctx);
  const credits = [];
  const saveRefund = (data) => { const r = new Record(app.findCollectionByNameOrId("refunds")); r.load(Object.assign({ return: id }, data)); st().stamp(r, ctx); app.save(r); };
  if (applied) saveRefund({ method: "exchange", amount_cents: applied, reference: exchangeSale.number });
  pay.refunds.forEach((rf) => {
    let credit = "";
    if (rf.method === "store_credit") {
      const c = new Record(app.findCollectionByNameOrId("store_credits"));
      c.load({ code: newCode(app), issued_cents: rf.amount_cents, balance_cents: rf.amount_cents, status: "active", source_return: id, note: number });
      st().stamp(c, ctx);
      app.save(c);
      credit = c.id;
      credits.push(c.getString("code"));
      rf.reference = c.getString("code");
    }
    saveRefund({ method: rf.method, amount_cents: rf.amount_cents, reference: rf.reference, last4: rf.last4, credit });
  });
  if (approval) sales().useApproval(app, input.approval);
  return { duplicate: false, return: view(app, id, ctx.showCost), sale: exchangeSale };
}

// ---- View -----------------------------------------------------------------------------------------

function view(app, id, showCost) {
  const r = app.findRecordById("returns", id);
  const lines = app.findRecordsByFilter("return_lines", "return = {:r}", "line_no", 0, 0, { r: id }).map((l) => {
    const v = { id: l.id, line_no: l.getInt("line_no"), sale_line: l.getString("sale_line"), product: l.getString("product"), name: l.getString("name"),
      qty: l.getFloat("qty"), price_cents: l.getInt("price_cents"), net_cents: l.getInt("net_cents"), taxes: j(l, "taxes", []), tax_cents: l.getInt("tax_cents"),
      deposit_cents: l.getInt("deposit_cents"), fee_cents: l.getInt("fee_cents"), disposition: l.getString("disposition"), disposition_label: DISPO_LABEL[l.getString("disposition")] };
    if (showCost) v.cost_cents = l.getInt("cost_cents");
    return v;
  });
  const refunds = app.findRecordsByFilter("refunds", "return = {:r}", "created_at", 0, 0, { r: id }).map((x) => ({
    method: x.getString("method"), amount_cents: x.getInt("amount_cents"), reference: x.getString("reference"), last4: x.getString("last4") }));
  let cashier = "", saleNumber = "", exNumber = "";
  try { cashier = app.findRecordById("users", r.getString("cashier")).getString("name"); } catch (_) { cashier = ""; }
  try { saleNumber = app.findRecordById("sales", r.getString("sale")).getString("number"); } catch (_) { saleNumber = ""; }
  try { exNumber = app.findRecordById("sales", r.getString("exchange_sale")).getString("number"); } catch (_) { exNumber = ""; }
  const v = { id: r.id, number: r.getString("number"), sale: r.getString("sale"), sale_number: saleNumber, receipt: r.getBool("receipt"),
    till: r.getString("till"), till_number: (() => { try { return require(`${__hooks}/lib/tills.js`).tillNo(app.findRecordById("tills", r.getString("till"))); } catch (_) { return 0; } })(),
    cashier, reason: r.getString("reason"), tax_mode: r.getString("tax_mode"), completed_at: r.getString("completed_at"),
    net_cents: r.getInt("net_cents"), tax_cents: r.getInt("tax_cents"), deposit_cents: r.getInt("deposit_cents"), fee_cents: r.getInt("fee_cents"),
    refund_cents: r.getInt("refund_cents"), rounding_cents: r.getInt("rounding_cents"), paid_cents: r.getInt("paid_cents"), taxes: j(r, "taxes", []),
    approvals: j(r, "approvals", []), exchange_sale: r.getString("exchange_sale"), exchange_number: exNumber, reprints: r.getInt("reprints"), loyalty_reversed: r.getInt("loyalty_reversed"), loyalty_returned: r.getInt("loyalty_returned"),
    lines, refunds, business: sales().business(app) };
  if (showCost) v.cost_cents = r.getInt("cost_cents");
  return v;
}

// Store credit balance (the till checks a code before taking it as payment).
function credit(app, code) {
  const c = app.findRecordsByFilter("store_credits", "code = {:c}", "", 1, 0, { c: String(code || "").trim().toUpperCase() });
  if (!c.length) bad("Unknown store credit code.");
  return { code: c[0].getString("code"), balance_cents: c[0].getInt("balance_cents"), status: c[0].getString("status") };
}

module.exports = { find, returnable, build, quoteView, complete, view, credit, lowestPrice, DISPO_LABEL };

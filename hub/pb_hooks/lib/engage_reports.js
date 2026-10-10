// Promotion and loyalty reports (P2 step 4).
// promotions(): each deal of a period: times used, sales, units, savings given, margin (with costs.view),
//               and the same for the period before (as long, just before it). For the products a deal was
//               used on, all their units and sales now and before show the lift (FR-5.12). Coupons by code.
// loyalty():    members (all, new, who bought), members' share of sales, points earned / used / taken back
//               in the period, the points customers hold now and what they are worth in $ (the liability,
//               at the owner's points-for-$1), and the top customers by spend (customers.manage) (FR-7.07).
// Completed, non-training sales only; returns are not taken off (the Returns report has them).

function R() { return require(`${__hooks}/lib/reports.js`); }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };

// The period of the same length just before {from, to} (YYYY-MM-DD).
function before(r) {
  const p = (s) => s.split("-").map(Number);
  const a = p(r.from), b = p(r.to);
  const days = Math.round((new Date(b[0], b[1] - 1, b[2]) - new Date(a[0], a[1] - 1, a[2])) / 86400000) + 1;
  const ymd = (d) => d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  const from = ymd(new Date(a[0], a[1] - 1, a[2] - days)), to = ymd(new Date(a[0], a[1] - 1, a[2] - 1));
  return { from: from, to: to, days: days, f: R().dayStart(from), t: R().dayStart(to, 1) };
}

const SALES = "status = 'completed' && training = false && completed_at >= {:f} && completed_at < {:t}";

// The sales of a period and their lines: sales value before tax (after every discount), cost, deal savings.
function period(app, r) {
  const sales = app.findRecordsByFilter("sales", SALES, "completed_at", 0, 0, { f: r.f, t: r.t });
  const lines = [];
  sales.forEach((s) => {
    const incl = s.getString("tax_mode") === "tax_included";
    app.findRecordsByFilter("sale_lines", "sale = {:s} && voided = false", "line_no", 0, 0, { s: s.id }).forEach((l) => {
      const tax = incl ? j(l, "taxes", []).reduce((a, x) => a + (Number(x.tax_cents) || 0), 0) : 0;
      lines.push({ sale: s.id, product: l.getString("product"), name: l.getString("name"), qty: l.getFloat("qty"), sales_cents: l.getInt("net_cents") - tax,
        cost_cents: l.getInt("cost_cents"), promo_cents: l.getInt("promo_cents"), promos: j(l, "promotions", []) });
    });
  });
  return { sales: sales, lines: lines };
}

function blank() { return { times: 0, sales: 0, units: 0, sales_cents: 0, savings_cents: 0, cost_cents: 0 }; }
const round2 = (x) => Math.round(x * 100) / 100;

// Per deal: from the sales (times, savings: exact) and their lines (units, sales value, cost). A line with
// two deals (a stackable one on top) counts for both.
function byDeal(p) {
  const out = {};
  const get = (id) => out[id] || (out[id] = Object.assign(blank(), { products: {}, _sales: {} }));
  p.sales.forEach((s) => j(s, "promotions", []).forEach((a) => {
    const d = get(a.id);
    d.times += Number(a.times) || 0; d.savings_cents += Number(a.saving_cents) || 0; d.name = d.name || a.name;
    if (!d._sales[s.id]) { d._sales[s.id] = true; d.sales++; }
  }));
  p.lines.forEach((l) => l.promos.forEach((id) => {
    const d = get(id);
    d.units += l.qty; d.sales_cents += l.sales_cents; d.cost_cents += l.cost_cents;
    if (l.product) d.products[l.product] = l.name;
  }));
  Object.keys(out).forEach((k) => { delete out[k]._sales; });
  return out;
}

// All units and sales of some products in a period (with or without a deal): the lift.
function ofProducts(p, ids) {
  const o = { units: 0, sales_cents: 0 };
  p.lines.forEach((l) => { if (ids[l.product]) { o.units += l.qty; o.sales_cents += l.sales_cents; } });
  o.units = round2(o.units);
  return o;
}

function promotions(app, q, showCost) {
  const r = R().range(q), b = before(r);
  const now = period(app, r), then = period(app, b);
  const cur = byDeal(now), prev = byDeal(then);
  const names = {};
  Object.keys(cur).concat(Object.keys(prev)).forEach((id) => {
    if (names[id] !== undefined) return;
    if (id === "markdown") { names[id] = { name: "Near-expiry markdowns", type: "markdown", status: "" }; return; }
    try { const x = app.findRecordById("promotions", id); names[id] = { name: x.getString("name"), type: x.getString("type"), status: x.getString("status"), coupon: x.getString("coupon_code") }; }
    catch (_) { names[id] = { name: (cur[id] || prev[id]).name || "(deleted)", type: "", status: "" }; }
  });
  const pub = (d) => {
    if (!d) return null;
    const o = { times: d.times, sales: d.sales, units: round2(d.units), sales_cents: d.sales_cents, savings_cents: d.savings_cents };
    if (showCost) { o.cost_cents = d.cost_cents; o.margin_cents = d.sales_cents - d.cost_cents; o.margin_pct = d.sales_cents ? round2(100 * (d.sales_cents - d.cost_cents) / d.sales_cents) : 0; }
    return o;
  };
  const rows = Object.keys(cur).map((id) => {
    const d = cur[id];
    return Object.assign({ id: id }, names[id], { now: pub(d), before: pub(prev[id]),
      products: Object.keys(d.products).map((k) => ({ id: k, name: d.products[k] })),
      lift: { now: ofProducts(now, d.products), before: ofProducts(then, d.products) } });
  });
  // Deals used before but not now (ended, paused): shown so the comparison is complete.
  Object.keys(prev).filter((id) => !cur[id]).forEach((id) => rows.push(Object.assign({ id: id }, names[id], { now: pub(blank()), before: pub(prev[id]), products: [], lift: null })));
  rows.sort((x, y) => y.now.savings_cents - x.now.savings_cents || y.before.savings_cents - x.before.savings_cents);
  const coupons = {};
  now.sales.forEach((s) => j(s, "coupons", []).forEach((c) => { coupons[c] = (coupons[c] || 0) + 1; }));
  const total = (p, list) => {
    const o = { sales: p.sales.length, sales_cents: p.lines.reduce((a, l) => a + l.sales_cents, 0), with_deal: 0, deal_sales_cents: 0, savings_cents: 0 };
    p.sales.forEach((s) => { const a = j(s, "promotions", []); if (a.length) { o.with_deal++; o.savings_cents += a.reduce((x, y) => x + (Number(y.saving_cents) || 0), 0); } });
    o.deal_sales_cents = p.lines.filter((l) => l.promos.length).reduce((a, l) => a + l.sales_cents, 0);
    return o;
  };
  return { from: r.from, to: r.to, before: { from: b.from, to: b.to }, show_cost: !!showCost, promotions: rows,
    coupons: Object.keys(coupons).map((c) => ({ code: c, sales: coupons[c] })).sort((x, y) => y.sales - x.sales),
    totals: { now: total(now), before: total(then) } };
}

// ---- Loyalty (FR-7.07) ------------------------------------------------------------------------------

const LEDGER = ["earn", "redeem", "reverse_earn", "return_redeem", "adjust", "move_in", "move_out", "expire"];

function loyalty(app, q, canManage) {
  const r = R().range(q);
  const prog = setting(app, "loyalty.program", {}) || {};
  const perDollar = Number(prog.points_per_dollar_off) || 0;
  const members = app.findRecordsByFilter("customers", "status = 'active' && deleted_at = ''", "", 0, 0);
  const held = members.reduce((a, c) => a + Math.max(0, c.getInt("points")), 0);
  const isNew = members.filter((c) => { const t = c.getString("created_at"); return t >= r.f && t < r.t; }).length;
  const ledger = {};
  LEDGER.forEach((k) => { ledger[k] = 0; });
  app.findRecordsByFilter("loyalty_ledger", "created_at >= {:f} && created_at < {:t}", "", 0, 0, { f: r.f, t: r.t })
    .forEach((x) => { ledger[x.getString("type")] = (ledger[x.getString("type")] || 0) + x.getInt("points"); });
  const sales = app.findRecordsByFilter("sales", SALES, "", 0, 0, { f: r.f, t: r.t });
  const who = {};
  let memberSales = 0, memberCents = 0, allCents = 0, redeemCents = 0;
  sales.forEach((s) => {
    const cents = s.getInt("total_cents") + s.getInt("rounding_cents");
    allCents += cents;
    const c = s.getString("customer");
    if (!c) return;
    memberSales++; memberCents += cents; redeemCents += s.getInt("loyalty_redeem_cents");
    const w = who[c] || (who[c] = { visits: 0, spent_cents: 0, earned: 0, redeemed: 0 });
    w.visits++; w.spent_cents += cents; w.earned += s.getInt("loyalty_earned"); w.redeemed += s.getInt("loyalty_redeemed");
  });
  const out = {
    from: r.from, to: r.to,
    program: { enabled: !!prog.enabled, points_per_dollar: Number(prog.points_per_dollar) || 0, points_per_dollar_off: perDollar, set_by_owner: !!prog.set_by_owner },
    members: { total: members.length, new: isNew, bought: Object.keys(who).length },
    sales: { all: sales.length, members: memberSales, all_cents: allCents, member_cents: memberCents, member_pct: allCents ? round2(100 * memberCents / allCents) : 0,
      avg_member_cents: memberSales ? Math.round(memberCents / memberSales) : 0, avg_other_cents: sales.length > memberSales ? Math.round((allCents - memberCents) / (sales.length - memberSales)) : 0 },
    points: { earned: ledger.earn, taken_back: -ledger.reverse_earn, used: -ledger.redeem, given_back: ledger.return_redeem,
      adjusted: ledger.adjust, expired: -ledger.expire, redeem_cents: redeemCents },
    // What the points customers hold are worth: what the store owes in discounts if all were used.
    liability: { points: held, cents: perDollar > 0 ? Math.floor((held * 100) / perDollar) : 0 },
  };
  if (canManage) {
    out.top = Object.keys(who).map((id) => {
      let c = null;
      try { c = app.findRecordById("customers", id); } catch (_) { c = null; }
      const card = c ? c.getString("card") : "";
      return Object.assign({ id: id, first_name: c && c.getString("status") === "active" ? c.getString("first_name") : "(deleted)",
        card: card ? "…" + card.slice(-4) : "", phone: c && c.getString("phone") ? "…" + c.getString("phone").slice(-4) : "", points: c ? c.getInt("points") : 0 }, who[id]);
    }).sort((x, y) => y.spent_cents - x.spent_cents || y.visits - x.visits).slice(0, Math.min(100, Math.max(1, Number(q.top) || 20)));
  }
  return out;
}

module.exports = { promotions, loyalty, before };

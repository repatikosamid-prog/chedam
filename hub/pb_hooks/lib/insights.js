// Dashboard and sales insights (P2 step 6, FR-2.01, FR-10.10).
// dashboard(): what this person needs, by permission: the attention list first (open tasks, approvals,
//              tills to reconcile, low / out of stock, lots near or past expiry), then today and month to
//              date against last week / last month (sales.view), the P&L month to date as far as Chedam's
//              own data goes (costs.view), sales per day for 30 days with last year's, margin (or sales) by
//              category, inventory health and wastage.
// insights():  sales by weekday and hour (heatmap), best and worst sellers, sell-through, year over year,
//              margin by category, for any dates (Reports → Insights).
// Money "sales" is before tax, after every discount (what the store earned); completed, non-training sales.

function R() { return require(`${__hooks}/lib/reports.js`); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const round2 = (x) => Math.round(x * 100) / 100;
const pct = (a, b) => (b ? round2((100 * a) / b) : 0);
const p2 = (n) => ("0" + n).slice(-2);
const ymd = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
const local = (s) => new Date(String(s).replace(" ", "T"));
function shift(ymdText, days, years) {
  const a = ymdText.split("-").map(Number);
  return ymd(new Date(a[0] + (years || 0), a[1] - 1, a[2] + (days || 0)));
}
function span(from, to) { return { from: from, to: to, f: R().dayStart(from), t: R().dayStart(to, 1) }; }

// One pass over a period: sales (header) and their lines, with the product's category.
function load(app, r, cat) {
  const sales = app.findRecordsByFilter("sales", "status = 'completed' && training = false && completed_at >= {:f} && completed_at < {:t}", "completed_at", 0, 0, { f: r.f, t: r.t });
  const byId = {};
  sales.forEach((s) => { byId[s.id] = { at: s.getString("completed_at"), incl: s.getString("tax_mode") === "tax_included", sales: 0, cost: 0, items: 0 }; });
  const lines = [];
  if (sales.length) {
    app.findRecordsByFilter("sale_lines", "voided = false && sale.status = 'completed' && sale.training = false && sale.completed_at >= {:f} && sale.completed_at < {:t}", "", 0, 0, { f: r.f, t: r.t })
      .forEach((l) => {
        const s = byId[l.getString("sale")];
        if (!s) return;
        const tax = s.incl ? j(l, "taxes", []).reduce((a, x) => a + (Number(x.tax_cents) || 0), 0) : 0;
        const o = { sale: l.getString("sale"), product: l.getString("product"), name: l.getString("name"), qty: l.getFloat("qty"), base: l.getFloat("base_qty") || l.getFloat("qty"),   // base_qty: the line's total in base units
          sales: l.getInt("net_cents") - tax, cost: l.getInt("cost_cents"), discount: l.getInt("line_discount_cents") + l.getInt("cart_discount_cents") };
        o.category = cat ? cat.of(o.product) : "";
        s.sales += o.sales; s.cost += o.cost; s.items += o.qty;
        lines.push(o);
      });
  }
  return { sales: sales, byId: byId, lines: lines };
}

function totals(p) {
  const n = p.sales.length;
  const sales = p.lines.reduce((a, l) => a + l.sales, 0), cost = p.lines.reduce((a, l) => a + l.cost, 0);
  return { transactions: n, sales_cents: sales, cost_cents: cost, margin_cents: sales - cost, margin_pct: pct(sales - cost, sales),
    avg_basket_cents: n ? Math.round(sales / n) : 0, items: round2(p.lines.reduce((a, l) => a + l.qty, 0)), discount_cents: p.lines.reduce((a, l) => a + l.discount, 0) };
}
function hideCost(t, showCost) { if (!showCost) { delete t.cost_cents; delete t.margin_cents; delete t.margin_pct; } return t; }

// Products → category, names (once per request)
function catalogue(app) {
  const cats = {};
  app.findRecordsByFilter("categories", "id != ''", "", 0, 0).forEach((c) => { cats[c.id] = c.getString("name"); });
  const prod = {};
  app.findRecordsByFilter("products", "deleted_at = ''", "", 0, 0).forEach((p) => {
    prod[p.id] = { name: p.getString("name"), category: p.getString("category"), status: p.getString("status"), reorder: p.getFloat("reorder_point"), perishable: p.getBool("perishable"),
      consignment: !!p.getString("consignment_vendor") };
  });
  return { cats: cats, prod: prod, of: (id) => (prod[id] ? prod[id].category : ""), catName: (id) => cats[id] || "(no category)" };
}

function byCategory(p, cat, showCost) {
  const g = {};
  p.lines.forEach((l) => {
    const k = l.category || "";
    const x = g[k] || (g[k] = { category: k, name: cat.catName(k), sales_cents: 0, cost_cents: 0, items: 0 });
    x.sales_cents += l.sales; x.cost_cents += l.cost; x.items += l.qty;
  });
  return Object.values(g).map((x) => {
    x.items = round2(x.items);
    x.margin_cents = x.sales_cents - x.cost_cents; x.margin_pct = pct(x.margin_cents, x.sales_cents);
    return hideCost(x, showCost);
  }).sort((a, b) => b.sales_cents - a.sales_cents);
}

function perDay(p, from, to) {
  const days = {};
  for (let d = from; d <= to; d = shift(d, 1)) days[d] = { day: d, sales_cents: 0, transactions: 0 };
  p.sales.forEach((s) => {
    const k = ymd(local(s.getString("completed_at")));
    if (!days[k]) return;
    days[k].transactions++; days[k].sales_cents += p.byId[s.id].sales;
  });
  return Object.values(days);
}

// ---- Stock -------------------------------------------------------------------------------------------

function inventory(app, cat, showCost, soldSince) {
  const levels = {};
  app.findRecordsByFilter("stock_levels", "deleted_at = ''", "", 0, 0).forEach((s) => { levels[s.getString("product")] = s.getFloat("on_hand"); });
  const today = R().dayStart(require(`${__hooks}/lib/stock.js`).today());
  const soon = R().dayStart(require(`${__hooks}/lib/stock.js`).today(3));
  let value = 0, nearExpiry = 0, expired = 0, expiredValue = 0;
  app.findRecordsByFilter("stock_lots", "qty > 0 && deleted_at = ''", "", 0, 0).forEach((l) => {
    const pr = cat.prod[l.getString("product")];
    // Consignment stock belongs to the vendor: not in the store's stock value (FR-6.14)
    const v = pr && pr.consignment ? 0 : Math.round(l.getFloat("qty") * l.getFloat("cost_cents"));
    value += v;
    const e = l.getString("expiry_date");
    if (!e) return;
    if (e < today) { expired++; expiredValue += v; } else if (e < soon) nearExpiry++;
  });
  const out = [], low = [], dead = [];
  Object.keys(cat.prod).forEach((id) => {
    const p = cat.prod[id];
    if (p.status !== "active" || levels[id] === undefined) return;
    const on = levels[id];
    if (on <= 0) out.push({ id: id, name: p.name });
    else if (p.reorder > 0 && on <= p.reorder) low.push({ id: id, name: p.name, on_hand: round2(on), reorder_point: p.reorder });
    if (on > 0 && soldSince && !soldSince[id]) dead.push({ id: id, name: p.name, on_hand: round2(on) });
  });
  const o = { products: Object.keys(levels).length, out_of_stock: out.length, low_stock: low.length, near_expiry_lots: nearExpiry, expired_lots: expired,
    no_sales_60_days: dead.length, out: out.slice(0, 20), low: low.slice(0, 20), dead: dead.slice(0, 20) };
  if (showCost) { o.stock_value_cents = value; o.expired_value_cents = expiredValue; }
  return o;
}

// Wastage and shrink at cost in a period: damage and loss (written off), and count differences.
function wastage(app, r) {
  const o = { damage_cents: 0, loss_cents: 0, count_cents: 0 };
  app.findRecordsByFilter("stock_movements", "status = 'posted' && (type = 'damage' || type = 'loss' || type = 'count') && created_at >= {:f} && created_at < {:t}", "", 0, 0, { f: r.f, t: r.t })
    .forEach((m) => { o[m.getString("type") + "_cents"] += -m.getInt("value_cents"); });
  return o;
}

// ---- Dashboard (FR-2.01) -----------------------------------------------------------------------------

function dashboard(app, c) {
  const st = require(`${__hooks}/lib/stock.js`);
  const can = c.can, showCost = c.showCost;
  const today = st.today();
  const out = { today: today, attention: [], sections: [] };
  const add = (kind, text, count, go) => { if (count) out.attention.push({ kind: kind, text: text, count: count, go: go || "" }); };

  if (can("tasks.view")) {
    const tasks = app.findRecordsByFilter("tasks", "status = 'open' && deleted_at = ''", "-created_at", 8, 0);
    out.tasks = tasks.map((t) => ({ id: t.id, title: t.getString("title"), created_at: t.getString("created_at") }));
    add("tasks", "Open tasks", app.countRecords("tasks", $dbx.exp("status = 'open' AND deleted_at = ''")), "home");
  }
  if (can("tasks.view") && c.user) {
    // Handover notes of the last 2 days this person has not read (FR-2.12), today's checklists not finished
    const since = new Date(Date.now() - 2 * 86400000).toISOString().replace("T", " ");
    const unread = app.findRecordsByFilter("handover_notes", "created_at >= {:s} && deleted_at = '' && author != {:a}", "", 0, 0, { s: since, a: c.actor })
      .filter((n) => { try { return JSON.parse(n.getString("read_by") || "[]").indexOf(c.user.id) < 0; } catch (_) { return true; } }).length;
    add("handover", "Handover notes you have not read", unread, "team");
    const lists = app.findRecordsByFilter("checklists", "active = true && deleted_at = ''", "", 0, 0);
    const doneToday = app.findRecordsByFilter("checklist_runs", "day = {:d} && status = 'done'", "", 0, 0, { d: today }).map((r) => r.getString("checklist"));
    add("checklists", "Checklists not finished today", lists.filter((k) => doneToday.indexOf(k.id) < 0).length, "team");
  }
  if (c.user) {
    const M = require(`${__hooks}/lib/messages.js`);
    add("announcements", "Announcements to read and confirm", M.toAck(app, c), "messages");
    add("messages", "Unread messages", M.unread(app, c).unread, "messages");
    add("inbox", "Unread in your inbox (end-of-day report, alerts)", app.countRecords("inbox_items", $dbx.exp("user = {:u} AND read_at = '' AND deleted_at = ''", { u: c.user.id })), "inbox");
  }
  if (can("stock.approve")) add("approvals", "Stock changes waiting for approval", app.countRecords("stock_movements", $dbx.exp("status = 'pending'")), "approvals");
  if (can("till.manage")) add("tills", "Closed tills not reconciled", app.countRecords("tills", $dbx.exp("status = 'closed' AND reconciled_at = ''")), "reports");

  const cat = catalogue(app);
  const sold60 = {};
  const r60 = span(st.today(-59), today);
  app.findRecordsByFilter("sale_lines", "voided = false && sale.status = 'completed' && sale.completed_at >= {:f}", "", 0, 0, { f: r60.f }).forEach((l) => { sold60[l.getString("product")] = true; });
  const inv = inventory(app, cat, showCost, sold60);
  add("out", "Products out of stock", inv.out_of_stock, "stock");
  add("low", "Products at or below their reorder point", inv.low_stock, "stock");
  add("expired", "Lots past their expiry date still in stock", inv.expired_lots, "stock");
  add("expiry", "Lots expiring in the next 3 days", inv.near_expiry_lots, "stock");
  out.inventory = inv;

  if (can("sales.view")) {
    const d = (n) => st.today(n);
    const tNow = load(app, span(today, today)), tLast = load(app, span(d(-7), d(-7)));
    const month = today.substring(0, 8) + "01";
    const dayOfMonth = Number(today.substring(8));
    const prevMonth = shift(month, -1).substring(0, 8) + "01";
    const prevTo = shift(prevMonth, dayOfMonth - 1) > shift(month, -1) ? shift(month, -1) : shift(prevMonth, dayOfMonth - 1);   // the same days, within that month
    const mtd = load(app, span(month, today), cat), pm = load(app, span(prevMonth, prevTo));
    out.kpis = {
      today: hideCost(totals(tNow), showCost), same_day_last_week: hideCost(totals(tLast), showCost),
      month: hideCost(totals(mtd), showCost), last_month_same_days: hideCost(totals(pm), showCost),
      month_from: month, last_month: { from: prevMonth, to: prevTo },
    };
    const from30 = d(-29);
    const now30 = load(app, span(from30, today)), ly30 = load(app, span(shift(from30, 0, -1), shift(today, 0, -1)));
    const lyDays = perDay(ly30, shift(from30, 0, -1), shift(today, 0, -1));
    out.daily = perDay(now30, from30, today).map((x, i) => Object.assign(x, { last_year_cents: lyDays[i] ? lyDays[i].sales_cents : 0 }));
    out.categories = byCategory(mtd, cat, showCost);
    const ret = app.findRecordsByFilter("returns", "completed_at >= {:f} && completed_at < {:t}", "", 0, 0, { f: R().dayStart(month), t: R().dayStart(today, 1) });
    out.kpis.month.returns_cents = ret.reduce((a, x) => a + x.getInt("refund_cents"), 0);
    if (showCost) {
      // P&L month to date, as far as Chedam's own records go (no rent, wages or bills yet)
      const w = wastage(app, span(month, today));
      const payouts = app.findRecordsByFilter("cash_movements", "type = 'payout' && created_at >= {:f} && created_at < {:t}", "", 0, 0, { f: R().dayStart(month), t: R().dayStart(today, 1) })
        .reduce((a, m) => a + m.getInt("amount_cents"), 0);
      const t = totals(mtd);
      out.pnl = { sales_cents: t.sales_cents, discount_cents: t.discount_cents, cost_cents: t.cost_cents, gross_cents: t.sales_cents - t.cost_cents, gross_pct: t.margin_pct,
        damage_cents: w.damage_cents, loss_cents: w.loss_cents, count_cents: w.count_cents, payouts_cents: payouts,
        result_cents: t.sales_cents - t.cost_cents - w.damage_cents - w.loss_cents - w.count_cents - payouts };
      out.wastage = w;
    }
  }
  return out;
}

// ---- Insights (FR-10.10) -----------------------------------------------------------------------------

function insights(app, q, showCost) {
  const r = R().range(q);
  const cat = catalogue(app);
  const now = load(app, r, cat);
  const ly = load(app, span(shift(r.from, 0, -1), shift(r.to, 0, -1)), cat);
  // Weekday × hour (store time)
  const heat = [];
  for (let d = 0; d < 7; d++) { heat.push([]); for (let h = 0; h < 24; h++) heat[d].push({ sales_cents: 0, transactions: 0 }); }
  now.sales.forEach((s) => { const t = local(s.getString("completed_at")); const c = heat[t.getDay()][t.getHours()]; c.transactions++; c.sales_cents += now.byId[s.id].sales; });
  // Per product
  const levels = {};
  app.findRecordsByFilter("stock_levels", "deleted_at = ''", "", 0, 0).forEach((s) => { levels[s.getString("product")] = s.getFloat("on_hand"); });
  const g = {};
  now.lines.forEach((l) => {
    if (!l.product) return;
    const x = g[l.product] || (g[l.product] = { id: l.product, name: (cat.prod[l.product] || {}).name || l.name, category: cat.catName(l.category), units: 0, base: 0, sales_cents: 0, cost_cents: 0, sales: {} });
    x.units += l.qty; x.base += l.base; x.sales_cents += l.sales; x.cost_cents += l.cost; x.sales[l.sale] = true;
  });
  const rows = Object.values(g).map((x) => {
    const on = levels[x.id];
    const o = { id: x.id, name: x.name, category: x.category, units: round2(x.units), transactions: Object.keys(x.sales).length, sales_cents: x.sales_cents,
      on_hand: on === undefined ? null : round2(on), sell_through_pct: on === undefined ? null : pct(x.base, x.base + Math.max(0, on)) };
    if (showCost) { o.margin_cents = x.sales_cents - x.cost_cents; o.margin_pct = pct(o.margin_cents, x.sales_cents); }
    return o;
  });
  const best = rows.slice().sort((a, b) => b.sales_cents - a.sales_cents).slice(0, 20);
  // Worst: active products with stock on hand that sold least (nothing at all first)
  const worst = Object.keys(cat.prod).filter((id) => cat.prod[id].status === "active" && levels[id] > 0)
    .map((id) => g[id] ? rows.find((x) => x.id === id) : { id: id, name: cat.prod[id].name, category: cat.catName(cat.prod[id].category), units: 0, transactions: 0, sales_cents: 0, on_hand: round2(levels[id]), sell_through_pct: 0 })
    .sort((a, b) => a.units - b.units || a.sales_cents - b.sales_cents).slice(0, 20);
  const tn = hideCost(totals(now), showCost), tl = hideCost(totals(ly), showCost);
  const lyCats = {};
  byCategory(ly, cat, showCost).forEach((x) => { lyCats[x.category] = x.sales_cents; });
  return { from: r.from, to: r.to, last_year: { from: shift(r.from, 0, -1), to: shift(r.to, 0, -1) }, show_cost: !!showCost,
    totals: tn, last_year_totals: tl, heatmap: heat, best: best, worst: worst, products: rows.length,
    categories: byCategory(now, cat, showCost).map((x) => Object.assign(x, { last_year_cents: lyCats[x.category] || 0 })) };
}

module.exports = { dashboard, insights, shift, load, totals, catalogue, span, inventory, perDay };

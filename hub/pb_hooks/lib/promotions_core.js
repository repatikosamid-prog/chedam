// Promotions and scheduled prices (P2 step 1): FR-5.06-5.10, BR-20, 21. Pure: no database, so the hub and
// the offline till (`virtual:promotions-core`) price a cart the same way (P2-a, P2-b). Money in cents.
//
// Promotion (as stored, plain object):
//   { id, name, type, status, pct, amount_cents, price_cents, buy_qty, get_qty, reward ("pct"|"amount"|"free"),
//     threshold_cents, products: [ids], categories: [ids], exclude: [product ids], starts_at, ends_at (ISO),
//     days: [0-6, Sunday 0], hours_from, hours_to ("HH:MM"), coupon_code, stackable, per_transaction, max_uses, uses }
// Types:
//   pct_off       pct off each item                     amount_off   amount_cents off each item (per kg/lb when weighed)
//   fixed_price   each item at price_cents              buy_get      buy `buy_qty`, the next `get_qty` cheapest get the reward:
//                                                                     pct off, amount_cents off each, or free
//   multi_price   `buy_qty` items for price_cents (Y for $X), one product
//   mix_match     `buy_qty` items from the products/categories for price_cents (several products)
//   spend         spend threshold_cents on the items in scope (whole cart when no scope), get pct or amount_cents off
// Days and hours make any type time-based; a coupon_code makes it a coupon (only with that code entered).
//
// evaluate(lines, promos, opts) -> { lines: {key: {promo_cents, label, ids: [ids]}}, applied: [{id, name, times, saving_cents}] }
//   lines: [{ key, product, category, kind ("weight" or other), qty (units, or weight), price_cents (each, or per kg/lb),
//             no_promo (a price changed by hand: no promotion) }]
//   opts:  { now: Date (store-local clock), coupons: [codes] }
// BR-20: one promotion per item unless the promotion is stackable; the customer gets the best price: the deal
// that saves most is applied first; ties go to item > category > cart. Bundle items ("buy" items of a
// buy-get, every item of a Y-for-$X) are used up by their deal.
//
// scheduledPrice(unitId, regular_cents, scheduled, now) -> {price_cents, id} the price in force (FR-5.06).
//
// Near-expiry markdowns (FR-5.11, P2 step 2): markdownPct(days left, steps) is a lot's % off; segments are
// a product's marked-down stock in the order it sells (FEFO): {product: [{qty (base units), pct}]}.
// markdowns(lines, segments) gives each line's items their % off (`md`), and evaluate() treats the markdown
// as one more deal, so an item gets the markdown or another deal, whichever saves more (BR-20).
//   lines also carry base_qty (base units in one item) for markdowns.

function roundHalfUp(x) { return Math.floor(x + 0.5 + 1e-9); }

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

const TYPES = ["pct_off", "amount_off", "fixed_price", "buy_get", "multi_price", "mix_match", "spend"];
const PER_ITEM = { pct_off: 1, amount_off: 1, fixed_price: 1 };

function iso(d) { return d.toISOString().replace("T", " "); }
function minutes(hhmm) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }

// In force at `now`: active, within its dates, on one of its days, within its hours (hours may pass
// midnight: 22:00-02:00), and still has uses left.
function inForce(p, now) {
  if (!p || p.status !== "active" || p.deleted_at) return false;
  const t = iso(now);
  if (p.starts_at && String(p.starts_at) > t) return false;
  if (p.ends_at && String(p.ends_at) <= t) return false;
  if (Array.isArray(p.days) && p.days.length && p.days.indexOf(now.getDay()) < 0) return false;
  const from = minutes(p.hours_from), to = minutes(p.hours_to);
  if (from !== null && to !== null && from !== to) {
    const m = now.getHours() * 60 + now.getMinutes();
    if (from < to ? (m < from || m >= to) : (m < from && m >= to)) return false;
  }
  if (Number(p.max_uses) > 0 && Number(p.uses || 0) >= Number(p.max_uses)) return false;
  return true;
}

function inScope(p, line) {
  if ((p.exclude || []).indexOf(line.product) >= 0) return false;
  const prods = p.products || [], cats = p.categories || [];
  if (!prods.length && !cats.length) return p.type === "spend";      // only a spend threshold may mean "everything"
  return prods.indexOf(line.product) >= 0 || cats.indexOf(line.category) >= 0;
}

// Priority for ties (BR-20): item 3 > category 2 > cart 1.
function rank(p) { return (p.products || []).length ? 3 : (p.categories || []).length ? 2 : 1; }

const money = (c) => "$" + (Number(c || 0) / 100).toFixed(2);

// What the deal is, for the till, the receipt and labels (the promotion's own name is shown when it has one).
function describe(p) {
  switch (p.type) {
    case "pct_off": return String(p.pct) + "% off";
    case "amount_off": return money(p.amount_cents) + " off";
    case "fixed_price": return "Now " + money(p.price_cents);
    case "buy_get": return "Buy " + p.buy_qty + ", get " + (p.get_qty || 1) + " " + (p.reward === "free" ? "free" : p.reward === "amount" ? money(p.amount_cents) + " off" : p.pct + "% off");
    case "multi_price": case "mix_match": return p.buy_qty + " for " + money(p.price_cents);
    case "spend": return "Spend " + money(p.threshold_cents) + ", get " + (p.reward === "amount" ? money(p.amount_cents) : p.pct + "%") + " off";
    default: return p.name || "Promotion";
  }
}

// The saving of one promotion on the free units. Returns {saving (exact), per: [{u, s}], used: [unit indexes], times}.
function tryPromo(p, units, free) {
  const cand = p.type === "markdown" ? free.filter((i) => units[i].md > 0) : free.filter((i) => inScope(p, units[i]));
  const limit = Number(p.per_transaction) > 0 ? Number(p.per_transaction) : Infinity;
  const per = [], used = [];
  let times = 0;
  if (p.type === "markdown") {
    cand.forEach((i) => { const s = (units[i].net * units[i].md) / 100; if (s > 0) { per.push({ u: i, s: s }); used.push(i); times++; } });
  } else if (PER_ITEM[p.type]) {
    cand.forEach((i) => {
      if (times >= limit) return;
      const u = units[i];
      const w = u.weight || 1;                       // a weighed line is one unit of `weight` kg/lb
      let s = 0;
      if (p.type === "pct_off") s = (u.net * Number(p.pct || 0)) / 100;
      else if (p.type === "amount_off") s = Math.min(u.net, Number(p.amount_cents || 0) * w);
      else s = Math.max(0, u.net - Number(p.price_cents || 0) * w);
      if (s > 0) { per.push({ u: i, s: s }); used.push(i); times++; }
    });
  } else if (p.type === "buy_get" || p.type === "multi_price" || p.type === "mix_match") {
    // Whole items only, most expensive first: the customer's best (the reward goes to the cheapest of each group).
    const items = cand.filter((i) => !units[i].weight).sort((a, b) => units[b].net - units[a].net || a - b);
    const buy = Math.max(1, Number(p.buy_qty || 0)), get = p.type === "buy_get" ? Math.max(1, Number(p.get_qty || 1)) : 0;
    const size = buy + get;
    for (let g = 0; g + size <= items.length && times < limit; g += size) {
      const grp = items.slice(g, g + size);
      if (p.type === "buy_get") {
        let s = 0;
        const rewarded = grp.slice(buy);
        const ps = rewarded.map((i) => {
          const n = units[i].net;
          return p.reward === "free" ? n : p.reward === "amount" ? Math.min(n, Number(p.amount_cents || 0)) : (n * Number(p.pct || 0)) / 100;
        });
        s = ps.reduce((a, b) => a + b, 0);
        if (s <= 0) break;
        rewarded.forEach((i, k) => per.push({ u: i, s: ps[k] }));
      } else {
        const total = grp.reduce((a, i) => a + units[i].net, 0);
        const s = total - Number(p.price_cents || 0);
        if (s <= 0) break;                           // groups only get cheaper from here
        grp.forEach((i) => per.push({ u: i, s: (s * units[i].net) / total }));
      }
      grp.forEach((i) => used.push(i));
      times++;
    }
  }
  return { saving: per.reduce((a, x) => a + x.s, 0), per: per, used: used, times: times };
}

function markdownPct(daysLeft, steps) {
  if (!(daysLeft >= 0)) return 0;
  let pct = 0;
  (steps || []).forEach((st) => { if (daysLeft <= Number(st.days) && Number(st.pct) > pct) pct = Number(st.pct); });
  return Math.min(100, pct);
}

// {key: [pct of each item]} (a weighed line is one item). Lines of one product share its marked-down stock in order.
function markdowns(lines, segments) {
  const left = {};
  Object.keys(segments || {}).forEach((pid) => { left[pid] = (segments[pid] || []).map((x) => ({ qty: Number(x.qty), pct: Number(x.pct) })); });
  const out = {};
  const take = (pid, want) => {
    // Weighted % over the base units taken (unmarked stock counts as 0%).
    let need = want, sum = 0;
    const segs = left[pid] || [];
    while (need > 1e-9 && segs.length) {
      const t = Math.min(need, segs[0].qty);
      sum += t * segs[0].pct; need -= t; segs[0].qty -= t;
      if (segs[0].qty <= 1e-9) segs.shift();
    }
    return want > 0 ? sum / want : 0;
  };
  lines.forEach((l) => {
    if (!left[l.product] || !left[l.product].length || l.no_promo) return;
    if (l.kind === "weight") { out[l.key] = [take(l.product, Number(l.qty))]; return; }
    const per = Number(l.base_qty) > 0 ? Number(l.base_qty) : 1;
    const md = [];
    for (let i = 0; i < Math.round(Number(l.qty) || 0) && i < 1000; i++) md.push(take(l.product, per));
    out[l.key] = md;
  });
  return out;
}

function evaluate(lines, promos, opts) {
  const o = opts || {};
  const now = o.now || new Date();
  const codes = (o.coupons || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  const out = {};
  lines.forEach((l) => { out[l.key] = { promo_cents: 0, label: "", ids: [] }; });
  const live = (promos || []).filter((p) => TYPES.indexOf(p.type) >= 0 && inForce(p, now)
    && (!p.coupon_code || codes.indexOf(String(p.coupon_code).trim().toUpperCase()) >= 0));
  if (!live.length && !Object.keys(o.markdowns || {}).length) return { lines: out, applied: [] };

  // Units: one per item (whole quantities), one per weighed line.
  const units = [];
  lines.forEach((l) => {
    if (l.no_promo || !(Number(l.price_cents) > 0)) return;
    const md = (o.markdowns && o.markdowns[l.key]) || [];
    if (l.kind === "weight") units.push({ key: l.key, product: l.product, category: l.category, weight: Number(l.qty), net: Number(l.price_cents) * Number(l.qty), md: md[0] || 0 });
    else for (let i = 0; i < Math.round(Number(l.qty) || 0) && i < 1000; i++) units.push({ key: l.key, product: l.product, category: l.category, net: Number(l.price_cents), md: md[i] || 0 });
  });
  // The markdown competes with the other deals as one more deal (BR-20).
  const mdPcts = {};
  units.forEach((u) => { if (u.md > 0) mdPcts[Math.round(u.md * 10) / 10] = true; });
  const mdList = Object.keys(mdPcts);
  if (mdList.length) live.push({ id: "markdown", type: "markdown", status: "active", products: [], categories: [], exclude: [],
    name: mdList.length === 1 ? "Near expiry " + mdList[0] + "% off" : "Near expiry markdown" });
  const claimed = units.map(() => false);
  const applied = [];

  // Exact savings of one application go to the lines in whole cents (largest remainder), so the total
  // is exactly the deal's saving (3 for $5.00 costs $5.00, not $5.01).
  const record = (p, r) => {
    const byLine = {};
    r.per.forEach((x) => { const k = units[x.u].key; byLine[k] = (byLine[k] || 0) + x.s; units[x.u].net -= x.s; });
    const keys = Object.keys(byLine);
    const total = roundHalfUp(r.saving);
    const cents = spread(total, keys.map((k) => byLine[k]));
    const label = p.name || describe(p);
    keys.forEach((k, i) => {
      if (!cents[i]) return;
      out[k].promo_cents += cents[i];
      out[k].ids.push(p.id);
      out[k].label = out[k].label ? out[k].label + "; " + label : label;
    });
    if (total > 0) applied.push({ id: p.id, name: label, times: r.times, saving_cents: total });
  };

  // 1. Deals that do not stack (BR-20: the customer's best price).
  //    a. Bundles (buy-get, X for $Y, mix and match): the one that gains most over the best per-item deals
  //       on the same items goes first, until no bundle gains anything.
  //    b. Per-item deals (% off, $ off, sale price, near-expiry markdown): each remaining item gets the deal
  //       that saves most on it; ties go to item > category > cart.
  const noStack = live.filter((p) => !p.stackable && p.type !== "spend");
  const perItem = noStack.filter((p) => PER_ITEM[p.type] || p.type === "markdown");
  const itemSaving = (p, i) => {
    const u = units[i];
    if (p.type === "markdown") return u.md > 0 ? (u.net * u.md) / 100 : 0;
    if (!inScope(p, u)) return 0;
    const w = u.weight || 1;
    if (p.type === "pct_off") return (u.net * Number(p.pct || 0)) / 100;
    if (p.type === "amount_off") return Math.min(u.net, Number(p.amount_cents || 0) * w);
    return Math.max(0, u.net - Number(p.price_cents || 0) * w);
  };
  const bestItem = (i) => perItem.reduce((a, p) => Math.max(a, itemSaving(p, i)), 0);
  let bundles = noStack.filter((p) => !PER_ITEM[p.type] && p.type !== "markdown");
  for (let guard = 0; bundles.length && guard < 200; guard++) {
    const free = units.map((u, i) => i).filter((i) => !claimed[i]);
    let best = null, bestP = null, bestGain = 0;
    bundles.forEach((p) => {
      const r = tryPromo(p, units, free);
      const gain = r.saving - r.used.reduce((a, i) => a + bestItem(i), 0);
      if (gain > bestGain + 1e-9 || (best && Math.abs(gain - bestGain) <= 1e-9 && gain > 1e-9 && rank(p) > rank(bestP))) { best = r; bestP = p; bestGain = gain; }
    });
    if (!best) break;
    record(bestP, best);
    best.used.forEach((i) => { claimed[i] = true; });
    bundles = bundles.filter((p) => p !== bestP);
  }
  if (perItem.length) {
    const byPromo = new Map();
    const count = new Map();
    units.forEach((u, i) => {
      if (claimed[i]) return;
      let bp = null, bs = 0;
      perItem.forEach((p) => {
        const limit = Number(p.per_transaction) > 0 ? Number(p.per_transaction) : Infinity;
        if ((count.get(p) || 0) >= limit) return;
        const sv = itemSaving(p, i);
        if (sv > bs + 1e-9 || (bp && Math.abs(sv - bs) <= 1e-9 && sv > 0 && rank(p) > rank(bp))) { bp = p; bs = sv; }
      });
      if (!bp || bs <= 0.0001) return;
      count.set(bp, (count.get(bp) || 0) + 1);
      if (!byPromo.has(bp)) byPromo.set(bp, { saving: 0, per: [], used: [], times: 0 });
      const r = byPromo.get(bp);
      r.saving += bs; r.per.push({ u: i, s: bs }); r.used.push(i); r.times++;
      claimed[i] = true;
    });
    perItem.filter((p) => byPromo.has(p)).forEach((p) => record(p, byPromo.get(p)));
  }
  // 2. Stackable item deals, on top (on what is left of each price).
  live.filter((p) => p.stackable && p.type !== "spend").forEach((p) => {
    const r = tryPromo(p, units, units.map((u, i) => i));
    if (r.saving > 0.0001) record(p, r);
  });
  // 3. Spend thresholds (cart level): the spend counts every item in scope after its deals; the discount
  //    goes to items without another deal (all items in scope when the promotion stacks). Best one only,
  //    unless stackable.
  const spends = live.filter((p) => p.type === "spend").map((p) => {
    const scope = units.map((u, i) => i).filter((i) => inScope(p, units[i]));
    const spent = scope.reduce((a, i) => a + units[i].net, 0);
    if (spent + 1e-9 < Number(p.threshold_cents || 0)) return null;
    const on = scope.filter((i) => p.stackable || !claimed[i]);
    const base = on.reduce((a, i) => a + units[i].net, 0);
    if (!base) return null;
    const saving = p.reward === "amount" ? Math.min(base, Number(p.amount_cents || 0)) : (base * Number(p.pct || 0)) / 100;
    return { p: p, r: { saving: saving, per: on.map((i) => ({ u: i, s: (saving * units[i].net) / base })), used: on, times: 1 } };
  }).filter((x) => x && x.r.saving > 0.0001);
  const single = spends.filter((x) => !x.p.stackable).sort((a, b) => b.r.saving - a.r.saving)[0];
  if (single) record(single.p, single.r);
  spends.filter((x) => x.p.stackable).forEach((x) => record(x.p, x.r));
  return { lines: out, applied: applied };
}

// FR-5.06: the scheduled price in force for a selling unit (the one that started last), else the regular price.
function scheduledPrice(unitId, regular, scheduled, now) {
  const t = iso(now || new Date());
  let best = null;
  (scheduled || []).forEach((s) => {
    if (s.selling_unit !== unitId || s.deleted_at) return;
    if (s.starts_at && String(s.starts_at) > t) return;
    if (s.ends_at && String(s.ends_at) <= t) return;
    if (!best || String(s.starts_at || "") > String(best.starts_at || "")) best = s;
  });
  return best ? { price_cents: Number(best.price_cents), id: best.id } : { price_cents: Number(regular), id: "" };
}

// What one item costs with a simple deal (for the preview and shelf labels): per-item types and Y-for-$X.
// Returns {price_cents (each), text} or null when the deal has no single item price (buy-get, spend).
function itemPrice(p, regular) {
  const r = Number(regular);
  if (p.type === "pct_off") return { price_cents: r - roundHalfUp((r * Number(p.pct || 0)) / 100), text: describe(p) };
  if (p.type === "amount_off") return { price_cents: Math.max(0, r - Number(p.amount_cents || 0)), text: describe(p) };
  if (p.type === "fixed_price") return { price_cents: Math.min(r, Number(p.price_cents || 0)), text: describe(p) };
  if (p.type === "multi_price" || p.type === "mix_match") return { price_cents: roundHalfUp(Number(p.price_cents || 0) / Math.max(1, Number(p.buy_qty || 1))), text: describe(p) };
  return null;
}

module.exports = { evaluate, inForce, inScope, describe, scheduledPrice, itemPrice, markdownPct, markdowns, TYPES };

// Promotions and scheduled prices on the hub (P2 step 1): FR-5.06-5.10, BR-20, 25. The arithmetic is in
// promotions_core.js (shared with the offline till).
// list()/plain():   promotions and scheduled prices as plain objects (the till's offline pack has the same).
// save():           checks a promotion (type fields, scope, dates, hours, coupon) and saves it.
// saveScheduled():  a price for a selling unit from a date (to a date).
// preview():        FR-5.09: per product in scope: regular and promo price, cost, new margin; below cost warned.
// labelsJob():      every minute: products whose promotion or scheduled price started or ended get labels (BR-25).
// usage():          a completed sale counts towards each promotion's max_uses.

const core = () => require(`${__hooks}/lib/promotions_core.js`);
const st = () => require(`${__hooks}/lib/stock.js`);
function bad(msg) { throw new BadRequestError(msg); }

const ids = (r, f) => { try { return r.getStringSlice(f) || []; } catch (_) { return []; } };
const json = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const dt = (r, f) => r.getString(f) || "";

function plain(r) {
  return { id: r.id, name: r.getString("name"), type: r.getString("type"), status: r.getString("status"), pct: r.getFloat("pct"),
    amount_cents: r.getInt("amount_cents"), price_cents: r.getInt("price_cents"), buy_qty: r.getInt("buy_qty"), get_qty: r.getInt("get_qty"),
    reward: r.getString("reward"), threshold_cents: r.getInt("threshold_cents"), products: ids(r, "products"), categories: ids(r, "categories"),
    exclude: ids(r, "exclude"), starts_at: dt(r, "starts_at"), ends_at: dt(r, "ends_at"), days: json(r, "days", []),
    hours_from: r.getString("hours_from"), hours_to: r.getString("hours_to"), coupon_code: r.getString("coupon_code"),
    stackable: r.getBool("stackable"), per_transaction: r.getInt("per_transaction"), per_customer: r.getInt("per_customer"),
    max_uses: r.getInt("max_uses"), uses: r.getInt("uses"), labels: r.getBool("labels"), note: r.getString("note"),
    deleted_at: r.getString("deleted_at") };
}

function plainScheduled(r) {
  return { id: r.id, product: r.getString("product"), selling_unit: r.getString("selling_unit"), price_cents: r.getInt("price_cents"),
    starts_at: dt(r, "starts_at"), ends_at: dt(r, "ends_at"), note: r.getString("note"), deleted_at: r.getString("deleted_at") };
}

const nowText = () => new Date().toISOString().replace("T", " ");

// Promotions a sale or the till could use: active and not over (the till checks days and hours itself).
function current(app) {
  return app.findRecordsByFilter("promotions", "status = 'active' && deleted_at = '' && (ends_at = '' || ends_at > {:n})", "", 0, 0, { n: nowText() }).map(plain);
}
function currentScheduled(app) {
  return app.findRecordsByFilter("scheduled_prices", "deleted_at = '' && (ends_at = '' || ends_at > {:n})", "starts_at", 0, 0, { n: nowText() }).map(plainScheduled);
}

function list(app) {
  return {
    promotions: app.findRecordsByFilter("promotions", "deleted_at = ''", "-created_at", 500, 0).map((r) => {
      const p = plain(r);
      p.in_force = core().inForce(p, new Date());
      p.text = core().describe(p);
      return p;
    }),
    scheduled: app.findRecordsByFilter("scheduled_prices", "deleted_at = ''", "-starts_at", 500, 0).map((r) => {
      const s = plainScheduled(r);
      try { s.product_name = app.findRecordById("products", s.product).getString("name"); s.unit_name = app.findRecordById("selling_units", s.selling_unit).getString("name"); } catch (_) { /* removed */ }
      return s;
    }),
  };
}

const int = (v, name, lo) => { const n = Number(v || 0); if (!(n >= (lo || 0)) || n !== Math.floor(n)) bad(name + " is a whole number" + (lo ? " of at least " + lo : "") + "."); return n; };
const date = (v, name) => {
  if (v === undefined || v === null || v === "") return "";
  const t = Date.parse(String(v).replace(" ", "T"));
  if (!t) bad(name + " is not a date.");
  return new Date(t).toISOString().replace("T", " ");
};

// body: {id?, name, type, status ("draft"|"active"), pct, amount_cents, price_cents, buy_qty, get_qty, reward, threshold_cents,
//        products, categories, exclude, starts_at, ends_at, days, hours_from, hours_to, coupon_code, stackable,
//        per_transaction, per_customer, max_uses, labels, note}
function save(app, body, ctx) {
  const T = core().TYPES;
  const type = String(body.type || "");
  if (T.indexOf(type) < 0) bad("Choose the kind of promotion.");
  const name = String(body.name || "").trim().substring(0, 80);
  if (!name) bad("Give the promotion a name (customers see it on the receipt).");
  let r;
  if (body.id) {
    try { r = app.findRecordById("promotions", String(body.id)); } catch (_) { bad("Unknown promotion."); }
    if (r.getString("status") === "ended") bad("This promotion has ended. Copy it into a new one instead.");
  } else r = new Record(app.findCollectionByNameOrId("promotions"));
  const v = { name: name, type: type, status: body.status === "active" ? "active" : "draft", pct: 0, amount_cents: 0, price_cents: 0, buy_qty: 0, get_qty: 0,
    reward: "", threshold_cents: 0 };
  // Fields each kind needs
  const pct = () => { const n = Number(body.pct); if (!(n > 0 && n <= 100) || Math.abs(Math.round(n * 1000) / 1000 - n) > 1e-9) bad("The percentage is more than 0 and at most 100."); v.pct = n; };
  const amount = () => { v.amount_cents = int(body.amount_cents, "The amount (cents)", 1); };
  const price = () => { v.price_cents = int(body.price_cents, "The price (cents)", 1); };
  if (type === "pct_off") pct();
  else if (type === "amount_off") amount();
  else if (type === "fixed_price") price();
  else if (type === "buy_get") {
    v.buy_qty = int(body.buy_qty, "Buy", 1); v.get_qty = int(body.get_qty || 1, "Get", 1);
    v.reward = ["pct", "amount", "free"].indexOf(body.reward) >= 0 ? body.reward : bad("Choose what the customer gets: % off, $ off or free.");
    if (v.reward === "pct") pct(); else if (v.reward === "amount") amount();
  } else if (type === "multi_price" || type === "mix_match") {
    v.buy_qty = int(body.buy_qty, "How many items", 2); price();
  } else if (type === "spend") {
    v.threshold_cents = int(body.threshold_cents, "The amount to spend (cents)", 1);
    v.reward = body.reward === "amount" ? "amount" : "pct";
    if (v.reward === "pct") pct(); else amount();
  }
  // Scope (FR-5.08)
  const prods = Array.isArray(body.products) ? body.products.map(String) : [];
  const cats = Array.isArray(body.categories) ? body.categories.map(String) : [];
  const excl = Array.isArray(body.exclude) ? body.exclude.map(String) : [];
  if (type !== "spend" && !prods.length && !cats.length) bad("Choose the products or categories it is for.");
  if (type === "multi_price" && prods.length !== 1) bad("'Y for $X' is for one product; for several, use mix and match.");
  if (type === "mix_match" && prods.length + cats.length < 1) bad("Choose the products or categories that mix and match.");
  if (prods.length && app.findRecordsByIds("products", prods).length !== prods.length) bad("A chosen product does not exist.");
  if (cats.length && app.findRecordsByIds("categories", cats).length !== cats.length) bad("A chosen category does not exist.");
  // When (FR-5.08)
  const starts = date(body.starts_at, "The start"), ends = date(body.ends_at, "The end");
  if (starts && ends && ends <= starts) bad("The end is before the start.");
  const days = Array.isArray(body.days) ? body.days.map(Number).filter((d) => d >= 0 && d <= 6 && d === Math.floor(d)) : [];
  const hm = (x, n) => { const s = String(x || "").trim(); if (s && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(s)) bad(n + " is a time like 16:00."); return s; };
  const hf = hm(body.hours_from, "From"), ht = hm(body.hours_to, "To");
  if ((hf && !ht) || (!hf && ht)) bad("Give both times, or neither.");
  const code = String(body.coupon_code || "").trim().toUpperCase();
  if (code && !/^[A-Z0-9-]{3,30}$/.test(code)) bad("A coupon code is 3 to 30 letters, digits or dashes.");
  if (code && app.findRecordsByFilter("promotions", "coupon_code = {:c} && deleted_at = '' && id != {:id}", "", 1, 0, { c: code, id: r.id || "" }).length) bad("Another promotion uses coupon " + code + ".");
  r.load(Object.assign(v, { products: prods, categories: cats, exclude: excl, starts_at: starts, ends_at: ends, days: days, hours_from: hf, hours_to: ht,
    coupon_code: code, stackable: !!body.stackable, per_transaction: int(body.per_transaction, "Per sale"), per_customer: int(body.per_customer, "Per customer"),
    max_uses: int(body.max_uses, "Total uses"), labels: body.labels !== false, note: String(body.note || "").substring(0, 500) }));
  if (!r.id || r.isNew()) r.set("uses", 0);
  // Labels again when the deal or its dates change: now when it is already running, else the minute job.
  r.set("labels_started", false); r.set("labels_ended", false);
  st().stamp(r, ctx);
  app.save(r);
  if (r.getBool("labels") && v.status === "active" && (!starts || starts <= nowText()) && labelsOn(app)) {
    queueProducts(app, productsOf(app, plain(r)), "promotion", ctx);
    r.set("labels_started", true);
    app.save(r);
  }
  return r;
}

function labelsOn(app) { return require(`${__hooks}/lib/catalogue.js`).moduleOn(app, "labels"); }

// The products a promotion covers (its products, the active products of its categories, less exclusions).
function productsOf(app, p) {
  const out = {};
  p.products.forEach((id) => { out[id] = true; });
  if (p.categories.length) app.findRecordsByFilter("products", "deleted_at = '' && status = 'active'", "", 0, 0)
    .filter((x) => p.categories.indexOf(x.getString("category")) >= 0).forEach((x) => { out[x.id] = true; });
  p.exclude.forEach((id) => { delete out[id]; });
  return Object.keys(out);
}

function queueProducts(app, productIds, reason, ctx) {
  const labels = require(`${__hooks}/lib/labels.js`);
  productIds.forEach((pid) => {
    app.findRecordsByFilter("selling_units", "product = {:p} && deleted_at = '' && sell_at_pos = true", "sort", 0, 0, { p: pid })
      .forEach((u) => labels.queue(app, pid, u.id, reason, ctx));
  });
}

// Ends a promotion now (its end labels follow).
function end(app, id, ctx) {
  let r;
  try { r = app.findRecordById("promotions", id); } catch (_) { bad("Unknown promotion."); }
  r.set("status", "ended");
  if (!r.getString("ends_at") || r.getString("ends_at") > nowText()) r.set("ends_at", nowText());
  // Its shelf labels go back to the regular price now (BR-25).
  if (r.getBool("labels") && r.getBool("labels_started") && !r.getBool("labels_ended") && labelsOn(app)) {
    queueProducts(app, productsOf(app, plain(r)), "promotion", ctx);
    r.set("labels_ended", true);
  }
  st().stamp(r, ctx);
  app.save(r);
  return r;
}

// body: {id?, selling_unit, price_cents, starts_at, ends_at, note, remove}
function saveScheduled(app, body, ctx) {
  let r;
  if (body.id) { try { r = app.findRecordById("scheduled_prices", String(body.id)); } catch (_) { bad("Unknown scheduled price."); } }
  else r = new Record(app.findCollectionByNameOrId("scheduled_prices"));
  if (body.remove) { r.set("deleted_at", nowText()); r.set("labels_ended", false); st().stamp(r, ctx); app.save(r); return r; }
  let u;
  try { u = app.findRecordById("selling_units", String(body.selling_unit || "")); } catch (_) { bad("Choose the product and unit."); }
  const starts = date(body.starts_at, "The start"), ends = date(body.ends_at, "The end");
  if (!starts) bad("Give the date the price starts.");
  if (ends && ends <= starts) bad("The end is before the start.");
  r.load({ product: u.getString("product"), selling_unit: u.id, price_cents: int(body.price_cents, "The price (cents)", 1), starts_at: starts, ends_at: ends,
    note: String(body.note || "").substring(0, 200), labels_started: false, labels_ended: false });
  // Already in force: its label now (BR-25); later starts and ends: the minute job.
  if (starts <= nowText() && labelsOn(app)) {
    require(`${__hooks}/lib/labels.js`).queue(app, u.getString("product"), u.id, "price_change", ctx);
    r.set("labels_started", true);
  }
  st().stamp(r, ctx);
  app.save(r);
  return r;
}

// FR-5.09: what each product in scope sells for with the deal. Costs only with costs.view.
function preview(app, body, showCost) {
  const p = Object.assign({ status: "active" }, body || {});
  const prods = {};
  (Array.isArray(p.products) ? p.products : []).forEach((id) => { prods[id] = true; });
  if (Array.isArray(p.categories) && p.categories.length) {
    app.findRecordsByFilter("products", "deleted_at = '' && status = 'active'", "name", 0, 0)
      .filter((x) => p.categories.indexOf(x.getString("category")) >= 0).forEach((x) => { prods[x.id] = true; });
  }
  (Array.isArray(p.exclude) ? p.exclude : []).forEach((id) => { delete prods[id]; });
  const rows = [];
  Object.keys(prods).slice(0, 300).forEach((pid) => {
    let pr;
    try { pr = app.findRecordById("products", pid); } catch (_) { return; }
    app.findRecordsByFilter("selling_units", "product = {:p} && deleted_at = '' && sell_at_pos = true", "sort", 0, 0, { p: pid }).forEach((u) => {
      const regular = u.getInt("price_cents");
      const ip = core().itemPrice(Object.assign({}, p, { pct: Number(p.pct), amount_cents: Number(p.amount_cents), price_cents: Number(p.price_cents), buy_qty: Number(p.buy_qty) }), regular);
      const row = { product: pid, name: pr.getString("name"), unit: u.getString("name"), regular_cents: regular, promo_cents: ip ? ip.price_cents : null };
      if (showCost) {
        const cost = Math.round(pr.getFloat("cost_cents") * (u.getFloat("base_qty") || 1));
        row.cost_cents = cost;
        row.margin_pct = ip && ip.price_cents ? Math.round(((ip.price_cents - cost) / ip.price_cents) * 1000) / 10 : null;
        row.below_cost = !!(ip && cost && ip.price_cents < cost);
      }
      rows.push(row);
    });
  });
  return { text: core().describe(p), rows: rows, below_cost: rows.filter((x) => x.below_cost).length };
}

// The simple deal in force on a selling unit now, for its shelf label: {price_cents, regular_cents, text, until} or null.
function labelPromo(app, product, unit, cache) {
  const now = new Date();
  const promos = cache && cache.promos ? cache.promos : current(app);
  const sched = cache && cache.sched ? cache.sched : currentScheduled(app);
  if (cache) { cache.promos = promos; cache.sched = sched; }
  const regular = unit.getInt("price_cents");
  const sp = core().scheduledPrice(unit.id, regular, sched, now);
  let best = null;
  promos.filter((p) => core().inForce(p, now) && !p.coupon_code && core().inScope(p, { product: product.id, category: product.getString("category") })).forEach((p) => {
    const ip = core().itemPrice(p, sp.price_cents);
    if (ip && ip.price_cents < sp.price_cents && (!best || ip.price_cents < best.price_cents)) best = { price_cents: ip.price_cents, text: ip.text, until: p.ends_at };
  });
  return { price_cents: sp.price_cents, promo: best ? Object.assign(best, { regular_cents: sp.price_cents }) : null };
}

// Every minute: shelf labels for products whose promotion or scheduled price started or ended (BR-25).
function labelsJob(app) {
  if (!labelsOn(app)) return;
  const labels = require(`${__hooks}/lib/labels.js`);
  const ctx = { actor: "system:promotions", device: "" };
  const n = nowText();
  const mark = (tx, r, f) => { r.set(f, true); r.set("updated_by", ctx.actor); tx.save(r); };
  app.findRecordsByFilter("promotions", "labels = true && deleted_at = '' && labels_started = false && status = 'active' && (starts_at = '' || starts_at <= {:n})", "", 50, 0, { n: n })
    .forEach((r) => app.runInTransaction((tx) => { queueProducts(tx, productsOf(tx, plain(r)), "promotion", ctx); mark(tx, r, "labels_started"); }));
  app.findRecordsByFilter("promotions", "labels = true && labels_started = true && labels_ended = false && (status = 'ended' || deleted_at != '' || (ends_at != '' && ends_at <= {:n}))", "", 50, 0, { n: n })
    .forEach((r) => app.runInTransaction((tx) => { queueProducts(tx, productsOf(tx, plain(r)), "promotion", ctx); mark(tx, r, "labels_ended"); }));
  app.findRecordsByFilter("scheduled_prices", "labels_started = false && deleted_at = '' && starts_at <= {:n}", "", 50, 0, { n: n })
    .forEach((r) => app.runInTransaction((tx) => { labels.queue(tx, r.getString("product"), r.getString("selling_unit"), "price_change", ctx); mark(tx, r, "labels_started"); }));
  app.findRecordsByFilter("scheduled_prices", "labels_started = true && labels_ended = false && (deleted_at != '' || (ends_at != '' && ends_at <= {:n}))", "", 50, 0, { n: n })
    .forEach((r) => app.runInTransaction((tx) => { labels.queue(tx, r.getString("product"), r.getString("selling_unit"), "price_change", ctx); mark(tx, r, "labels_ended"); }));
}

// A completed sale used these promotions ([{id, times}]): counted for max_uses (offline sales too; they
// may go over the limit, the customer has paid).
function usage(app, applied, ctx) {
  (applied || []).forEach((a) => {
    try {
      const r = app.findRecordById("promotions", a.id);
      r.set("uses", r.getInt("uses") + (Number(a.times) || 1));
      st().stamp(r, ctx);
      app.save(r);
    } catch (_) { /* removed since */ }
  });
}

module.exports = { productsOf, plain, plainScheduled, current, currentScheduled, list, save, end, saveScheduled, preview, labelPromo, labelsJob, usage };

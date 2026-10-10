// Inbox, end-of-day report, email fallback (P2 step 10; FR-2.08-2.10, 12.07, BR-40, 41).
// Inbox: per person, in the app first (Section 8.4). Kinds: eod_report (the day's report, to the owner and the
// people chosen in reports.eod), alert (an urgent problem Chedam found: to people who manage tasks), report.
// Each person chooses per kind: in the app (off = not delivered) and email (inbox_subs).
// Deadlines (inbox.deadlines, BR-40): an item still unread at its deadline is emailed once, only when the hub
// is online and the owner connected Gmail/Outlook (email.connection); until the client IDs exist (P2-f) it is
// marked "not connected" instead. Never more than one email per item (BR-41). Pings are never emailed.

function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
const st = () => require(`${__hooks}/lib/stock.js`);
const I = () => require(`${__hooks}/lib/insights.js`);
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const money = (c) => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toFixed(2);
const KINDS = { eod_report: "End-of-day report", alert: "Urgent alerts", report: "Reports" };

function sub(app, uid, kind) {
  const s = app.findRecordsByFilter("inbox_subs", "user = {:u} && kind = {:k}", "", 1, 0, { u: uid, k: kind })[0];
  return { in_app: s ? s.getBool("in_app") : true, email: s ? s.getBool("email") : kind !== "report" };
}

// When an item arrived now becomes due for email
function deadline(app, kind) {
  const d = (setting(app, "inbox.deadlines", {}) || {})[kind];
  if (d === undefined || d === null || d === "") return "";
  const m = String(d).match(/^next (\d{2}):(\d{2})$/);
  let t;
  if (m) { t = new Date(); t.setDate(t.getDate() + 1); t.setHours(Number(m[1]), Number(m[2]), 0, 0); }
  else t = new Date(Date.now() + Number(d) * 60000);
  return isNaN(t.getTime()) ? "" : t.toISOString().replace("T", " ");
}

// Puts an item in a person's inbox (once per user, kind and ref). Returns the record or null.
function deliver(app, uid, kind, ref, title, body, data, link) {
  const s = sub(app, uid, kind);
  if (!s.in_app) return null;                     // switched off by this person (email goes with the in-app item)
  if (ref && app.findRecordsByFilter("inbox_items", "user = {:u} && kind = {:k} && ref = {:r}", "", 1, 0, { u: uid, k: kind, r: ref }).length) return null;
  const r = new Record(app.findCollectionByNameOrId("inbox_items"));
  r.load({ user: uid, kind: kind, ref: ref || "", title: String(title).substring(0, 200), body: String(body || "").substring(0, 20000), data: data || {}, link: link || "",
    deadline_at: s.email ? deadline(app, kind) : "", email_status: s.email ? "waiting" : "off" });
  r.set("created_by", "system:inbox"); r.set("updated_by", "system:inbox"); r.set("@actor", "system:inbox");
  app.save(r);
  return r;
}

function activeUsers(app) { return app.findRecordsByFilter("users", "status = 'active' && deleted_at = ''", "", 0, 0); }

// An urgent rule task opened: an alert for the people who manage tasks (FR-2.08)
function alert(app, title, link, ref) {
  const access = require(`${__hooks}/lib/access.js`);
  activeUsers(app).filter((u) => access.isOwner(app, u) || access.can(app, u, "tasks.manage"))
    .forEach((u) => deliver(app, u.id, "alert", ref || "", title, "Chedam opened an urgent task: " + title, {}, link || "team"));
}

// ---- End-of-day report (FR-2.09) ----------------------------------------------------------------------------

function eodData(app, day) {
  const r = I().span(day, day);
  const cat = I().catalogue(app);
  const p = I().load(app, r, cat);
  const t = I().totals(p);
  const all = app.findRecordsByFilter("sales", "training = false && completed_at >= {:f} && completed_at < {:t}", "", 0, 0, { f: r.f, t: r.t });
  const done = all.filter((s) => s.getString("status") === "completed");
  const pay = {};
  done.forEach((s) => app.findRecordsByFilter("payments", "sale = {:s} && status = 'approved'", "", 0, 0, { s: s.id }).forEach((x) => {
    const m = x.getString("method"); const g = pay[m] || (pay[m] = { method: m, count: 0, amount_cents: 0 }); g.count++; g.amount_cents += x.getInt("amount_cents");
  }));
  const rets = app.findRecordsByFilter("returns", "completed_at >= {:f} && completed_at < {:t}", "", 0, 0, { f: r.f, t: r.t });
  const tills = app.findRecordsByFilter("tills", "(closed_at >= {:f} && closed_at < {:t}) || status = 'open'", "", 0, 0, { f: r.f, t: r.t }).map((x) => ({
    number: require(`${__hooks}/lib/tills.js`).tillNo(x), status: x.getString("status"), variance_cents: x.getString("status") === "closed" ? x.getInt("variance_cents") : null }));
  const best = {};
  p.lines.forEach((l) => { const k = l.product || l.name; const b = best[k] || (best[k] = { name: (cat.prod[l.product] || {}).name || l.name, units: 0, sales_cents: 0 }); b.units += l.qty; b.sales_cents += l.sales; });
  const inv = I().inventory(app, cat, false, null);
  return {
    day: day, transactions: t.transactions, sales_cents: t.sales_cents, margin_pct: t.margin_pct, margin_cents: t.margin_cents, avg_basket_cents: t.avg_basket_cents, items: t.items,
    total_cents: done.reduce((a, s) => a + s.getInt("total_cents") + s.getInt("rounding_cents"), 0), tax_cents: done.reduce((a, s) => a + s.getInt("tax_cents"), 0),
    discount_cents: t.discount_cents, promo_savings_cents: done.reduce((a, s) => a + j(s, "promotions", []).reduce((x, y) => x + (Number(y.saving_cents) || 0), 0), 0),
    voided: all.length - done.length, payments: Object.values(pay).sort((a, b) => b.amount_cents - a.amount_cents),
    returns: rets.length, refunds_cents: rets.reduce((a, x) => a + x.getInt("refund_cents"), 0),
    loyalty_earned: done.reduce((a, s) => a + s.getInt("loyalty_earned"), 0), loyalty_redeemed: done.reduce((a, s) => a + s.getInt("loyalty_redeemed"), 0),
    members: done.filter((s) => s.getString("customer")).length,
    tills: tills, open_tills: tills.filter((x) => x.status === "open").length, cash_variance_cents: tills.reduce((a, x) => a + (x.variance_cents || 0), 0),
    top: Object.values(best).sort((a, b) => b.sales_cents - a.sales_cents).slice(0, 5).map((x) => ({ name: x.name, units: Math.round(x.units * 100) / 100, sales_cents: x.sales_cents })),
    open_tasks: app.countRecords("tasks", $dbx.exp("status = 'open' AND deleted_at = ''")), out_of_stock: inv.out_of_stock, low_stock: inv.low_stock, expiring_lots: inv.near_expiry_lots,
  };
}

function eodText(d, showCost) {
  const lines = [
    "Sales " + money(d.sales_cents) + " before tax (" + money(d.total_cents) + " with tax) · " + d.transactions + " sales · average " + money(d.avg_basket_cents),
    showCost ? "Margin " + money(d.margin_cents) + " (" + d.margin_pct + "%)" : "",
    "Payments: " + (d.payments.map((p) => p.method.replace("_", " ") + " " + money(p.amount_cents)).join(", ") || "none"),
    "Discounts " + money(d.discount_cents) + " (deals " + money(d.promo_savings_cents) + ") · returns " + d.returns + " (" + money(d.refunds_cents) + ") · voided " + d.voided,
    "Tills: " + (d.tills.map((x) => x.number + (x.status === "open" ? " still open" : x.variance_cents ? " " + (x.variance_cents < 0 ? "short " : "over ") + money(Math.abs(x.variance_cents)) : " balanced")).join(", ") || "none"),
    d.members ? "Loyalty: " + d.members + " member sales, " + d.loyalty_earned + " points earned, " + d.loyalty_redeemed + " used" : "",
    d.top.length ? "Best sellers: " + d.top.map((x) => x.name + " (" + money(x.sales_cents) + ")").join(", ") : "",
    "To look at: " + d.open_tasks + " open tasks, " + d.out_of_stock + " out of stock, " + d.low_stock + " low, " + d.expiring_lots + " lots expiring",
  ];
  return lines.filter(Boolean).join("\n");
}

// Made once a day for the owner and the people in reports.eod (FR-2.09). force: make it now (any time).
function eod(app, day, force) {
  const cfg = Object.assign({ enabled: true, time: "23:30", recipients: [] }, setting(app, "reports.eod", {}) || {});
  if (!cfg.enabled && !force) return { made: 0 };
  const access = require(`${__hooks}/lib/access.js`);
  const want = activeUsers(app).filter((u) => access.isOwner(app, u) || (cfg.recipients || []).indexOf(u.id) >= 0);
  const d = eodData(app, day);
  let made = 0;
  want.forEach((u) => {
    const show = access.isOwner(app, u) || access.can(app, u, "costs.view");
    const data = Object.assign({}, d);
    if (!show) { delete data.margin_cents; delete data.margin_pct; }
    if (deliver(app, u.id, "eod_report", day, "End of day " + day + ": " + money(d.sales_cents) + ", " + d.transactions + " sales", eodText(d, show), data, "dashboard")) made++;
  });
  return { made: made, day: day };
}

// ---- Jobs ------------------------------------------------------------------------------------------------------

// Every 10 minutes: the end-of-day report after its time; unread items past their deadline (email fallback).
function jobs(app) {
  const cfg = Object.assign({ enabled: true, time: "23:30" }, setting(app, "reports.eod", {}) || {});
  const now = new Date(), hm = ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
  let made = 0;
  if (cfg.enabled && hm >= cfg.time) made = eod(app, st().today(), false).made;
  const due = app.findRecordsByFilter("inbox_items", "email_status = 'waiting' && deadline_at != '' && deadline_at <= {:n}", "", 100, 0, { n: now.toISOString().replace("T", " ") });
  const online = require(`${__hooks}/lib/net.js`).online(app);
  let marked = 0;
  due.forEach((r) => {
    if (r.getString("read_at")) { r.set("email_status", "none"); }
    else if (!online) return;                                     // try again when the hub is online (BR-41)
    else r.set("email_status", "not_connected");                  // sending arrives with the owner's Google/Microsoft connection (P2-f)
    r.set("updated_by", "system:inbox"); r.set("@actor", "system:inbox");
    app.save(r); marked++;
  });
  return { made: made, email_checked: marked };
}

// ---- Endpoints -------------------------------------------------------------------------------------------------

function view(r) {
  return { id: r.id, kind: r.getString("kind"), kind_label: KINDS[r.getString("kind")] || r.getString("kind"), title: r.getString("title"), body: r.getString("body"), data: j(r, "data", {}),
    link: r.getString("link"), created_at: r.getString("created_at"), read: !!r.getString("read_at"), deadline_at: r.getString("deadline_at"), email_status: r.getString("email_status") };
}

function list(app, c, q) {
  const uid = c.user ? c.user.id : "";
  const items = app.findRecordsByFilter("inbox_items", "user = {:u} && deleted_at = ''" + (q.unread ? " && read_at = ''" : ""), "-created_at", 100, 0, { u: uid }).map(view);
  return { items: items, unread: app.countRecords("inbox_items", $dbx.exp("user = {:u} AND read_at = '' AND deleted_at = ''", { u: uid })),
    email_connected: !!(setting(app, "email.connection", {}) || {}).connected };
}

function read(app, c, id) {
  const r = app.findRecordById("inbox_items", id);
  if (!c.user || r.getString("user") !== c.user.id) throw new NotFoundError("Not in your inbox.");
  if (!r.getString("read_at")) {
    r.set("read_at", new DateTime());
    if (r.getString("email_status") === "waiting") r.set("email_status", "none");
    r.set("updated_by", c.actor); r.set("@actor", c.actor); app.save(r);
  }
  return view(r);
}

function readAll(app, c) {
  const uid = c.user ? c.user.id : "";
  let n = 0;
  app.findRecordsByFilter("inbox_items", "user = {:u} && read_at = ''", "", 0, 0, { u: uid }).forEach((r) => { read(app, c, r.id); n++; });
  return { read: n };
}

function settings(app, c) {
  const uid = c.user ? c.user.id : "";
  return { mine: Object.keys(KINDS).map((k) => Object.assign({ kind: k, label: KINDS[k] }, sub(app, uid, k))),
    eod: c.can("settings.manage") ? setting(app, "reports.eod", {}) : null, deadlines: c.can("settings.manage") ? setting(app, "inbox.deadlines", {}) : null,
    email: setting(app, "email.connection", {}) };
}

function saveSettings(app, c, b) {
  const uid = c.user ? c.user.id : "";
  (Array.isArray(b.mine) ? b.mine : []).forEach((x) => {
    if (!KINDS[x.kind]) return;
    let s = app.findRecordsByFilter("inbox_subs", "user = {:u} && kind = {:k}", "", 1, 0, { u: uid, k: x.kind })[0];
    if (!s) { s = new Record(app.findCollectionByNameOrId("inbox_subs")); s.load({ user: uid, kind: x.kind }); }
    s.set("in_app", !!x.in_app); s.set("email", !!x.email);
    s.set("updated_by", c.actor); s.set("@actor", c.actor); app.save(s);
  });
  if (b.eod && c.can("settings.manage")) {
    const e = b.eod;
    if (e.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)) throw new BadRequestError("Report time as HH:MM.");
    if (e.email_by && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.email_by)) throw new BadRequestError("Email time as HH:MM.");
    const rec = app.findFirstRecordByData("settings", "key", "reports.eod");
    rec.set("value", { enabled: e.enabled !== false, time: e.time || "23:30", recipients: Array.isArray(e.recipients) ? e.recipients.map(String) : [], email_by: e.email_by || "08:00" });
    rec.set("updated_by", c.actor); rec.set("@actor", c.actor); app.save(rec);
    const dl = app.findFirstRecordByData("settings", "key", "inbox.deadlines");
    dl.set("value", Object.assign({}, setting(app, "inbox.deadlines", {}) || {}, { eod_report: "next " + (e.email_by || "08:00") }));
    dl.set("updated_by", c.actor); dl.set("@actor", c.actor); app.save(dl);
  }
  return settings(app, c);
}

module.exports = { deliver, alert, eod, eodData, jobs, list, read, readAll, settings, saveSettings, KINDS };

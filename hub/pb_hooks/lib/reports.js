// Money reports (P1 step 9).
// tillRecon():      every till of a period: cash expected vs counted (from its Z report), card total vs the
//                   card terminal's settlement (entered by a manager), sales that reached the till after it
//                   was closed (offline uploads), and whether it is reconciled (FR-10.01).
// reconcile():      records the terminal settlement for a closed till; a note is needed when cash or card
//                   do not balance.
// lossPrevention(): per cashier: voids, removed lines, discounts, price overrides, no-sales, refunds (no
//                   receipt; on their own sales), tills closed short; a rate far above the store's is flagged
//                   (FR-10.11). details() lists the events behind one cashier's figures.

const st = () => require(`${__hooks}/lib/stock.js`);
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function bad(msg) { throw new BadRequestError(msg); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };

function dayStart(ymdText, plusDays) {
  const a = String(ymdText).split("-").map(Number);
  return new Date(a[0], a[1] - 1, a[2] + (plusDays || 0)).toISOString().replace("T", " ");
}
function range(q) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const to = ok(q.to) ? q.to : st().today();
  const from = ok(q.from) ? q.from : st().today(-6);
  if (from > to) bad("The start date is after the end date.");
  return { from, to, f: dayStart(from), t: dayStart(to, 1) };
}

// Names looked up once per report (cleared at the start of each one)
const names = {};
function fresh() { Object.keys(names).forEach((k) => { delete names[k]; }); }
function nameOf(app, id) {
  if (!id) return "";
  const k = String(id).replace(/^users:/, "");
  if (names[k] === undefined) { try { names[k] = app.findRecordById("users", k).getString("name"); } catch (_) { names[k] = ""; } }
  return names[k];
}
function deviceName(app, id) { try { return app.findRecordById("devices", id).getString("name"); } catch (_) { return ""; } }

// ---- Till reconciliation (FR-10.01) ---------------------------------------------------------------

function tillRow(app, t, limit) {
  const tills = require(`${__hooks}/lib/tills.js`);
  const open = t.getString("status") === "open";
  const now = tills.summary(app, t);
  const z = open ? now : (j(t, "z_report", null) || now);
  const card = (z.payments || []).filter((p) => p.method === "card").reduce((a, p) => a + p.amount_cents, 0);
  const cardNow = (now.payments || []).filter((p) => p.method === "card").reduce((a, p) => a + p.amount_cents, 0);
  const settled = t.getString("settlement_ref") || t.getString("reconciled_at") || t.get("@settled") ? t.getInt("card_settlement_cents") : null;
  // Sales that reached the till after its Z report (offline uploads, DL-88)
  const late = open ? 0 : now.sales_count - (z.sales_count || 0);
  const lateCents = open ? 0 : (now.total_cents + now.rounding_cents) - ((z.total_cents || 0) + (z.rounding_cents || 0));
  const cashVar = open ? null : t.getInt("variance_cents");
  const cardVar = settled === null ? null : settled - cardNow;
  const flags = [];
  if (open) flags.push("Still open");
  if (cashVar !== null && Math.abs(cashVar) > limit) flags.push("Cash " + (cashVar < 0 ? "short" : "over") + " by $" + (Math.abs(cashVar) / 100).toFixed(2));
  if (!open && cardNow > 0 && settled === null) flags.push("Card settlement not entered");
  if (cardVar) flags.push("Card terminal " + (cardVar < 0 ? "below" : "above") + " the till by $" + (Math.abs(cardVar) / 100).toFixed(2));
  if (late > 0) flags.push(late + " sale(s) arrived after closing ($" + (lateCents / 100).toFixed(2) + ")");
  return {
    id: t.id, number: require(`${__hooks}/lib/tills.js`).tillNo(t), shift: t.getInt("number"), device: deviceName(app, t.getString("device")), status: t.getString("status"),
    opened_at: t.getString("opened_at"), closed_at: t.getString("closed_at"), opened_by: nameOf(app, t.getString("opened_by")), closed_by: nameOf(app, t.getString("closed_by")),
    sales: now.sales_count, total_cents: now.total_cents + now.rounding_cents, cash_in_cents: now.cash_in_cents,
    expected_cash_cents: open ? now.expected_cash_cents : t.getInt("expected_cents"), counted_cents: open ? null : t.getInt("counted_cents"), cash_variance_cents: cashVar,
    card_cents: cardNow, card_at_close_cents: card, card_settlement_cents: settled, settlement_ref: t.getString("settlement_ref"), batch_no: t.getString("batch_no"), card_variance_cents: cardVar,
    late_sales: late, late_cents: lateCents, returns_cents: now.returns_cents || 0, cash_refunds_cents: now.cash_refunds_cents || 0,
    reconciled_at: t.getString("reconciled_at"), reconciled_by: nameOf(app, t.getString("reconciled_by")), note: t.getString("reconcile_note"),
    flags: flags, balanced: !open && !flags.length,
  };
}

function tillRecon(app, q) {
  fresh();
  const r = range(q);
  const limit = Number(setting(app, "till.variance_task_cents", 500));
  const list = app.findRecordsByFilter("tills", "(opened_at >= {:f} && opened_at < {:t}) || (status = 'open')", "-opened_at", 500, 0, { f: r.f, t: r.t })
    .map((t) => tillRow(app, t, limit));
  const sum = (f) => list.reduce((a, x) => a + (x[f] || 0), 0);
  return { from: r.from, to: r.to, variance_limit_cents: limit, tills: list,
    totals: { tills: list.length, sales: sum("sales"), total_cents: sum("total_cents"), cash_variance_cents: sum("cash_variance_cents"), card_cents: sum("card_cents"),
      card_settlement_cents: list.reduce((a, x) => a + (x.card_settlement_cents || 0), 0), unreconciled: list.filter((x) => x.status === "closed" && !x.reconciled_at).length,
      flagged: list.filter((x) => x.flags.length).length } };
}

function reconcile(app, id, body, ctx) {
  const tills = require(`${__hooks}/lib/tills.js`);
  const t = tills.till(app, id);
  if (t.getString("status") !== "closed") bad("Close the till first.");
  const c = Number(body.card_settlement_cents);
  if (!(c >= 0) || c !== Math.floor(c)) bad("Enter the card terminal's total for this till (0 if no cards).");
  t.set("card_settlement_cents", c);
  t.set("settlement_ref", String(body.settlement_ref || "").trim().substring(0, 60));
  // The batch number is the hub's: B-000001, B-000002... in order, given once per till (a change keeps it).
  if (!t.getString("batch_no")) t.set("batch_no", "B-" + ("000000" + require(`${__hooks}/lib/sales.js`).nextNumber(app, "batch", ctx)).slice(-6));
  t.set("@settled", true);
  const row = tillRow(app, t, Number(setting(app, "till.variance_task_cents", 500)));
  const note = String(body.note || "").trim();
  const off = row.cash_variance_cents || row.card_variance_cents || row.late_sales;
  if (off && !note) bad("Cash or card do not balance: add a note saying why.");
  t.set("reconcile_note", note.substring(0, 500));
  t.set("reconciled_at", new DateTime());
  t.set("reconciled_by", ctx.user ? ctx.user.id : ctx.actor);
  st().stamp(t, ctx);
  app.save(t);
  return tillRow(app, t, Number(setting(app, "till.variance_task_cents", 500)));
}

// ---- Loss prevention (FR-10.11) -------------------------------------------------------------------

const METRICS = [
  // [key, label, numerator, denominator]
  ["voids", "Voided sales per 100 sales", "voided_sales", "sales"],
  ["removed", "Removed lines per 100 sales", "removed_lines", "sales"],
  ["discount", "Discounts, % of sales", "discount_cents", "gross_cents"],
  ["overrides", "Price overrides per 100 sales", "overrides", "sales"],
  ["no_sales", "No-sales per 100 sales", "no_sales", "sales"],
  ["refunds", "Refunds, % of sales", "refund_cents", "total_cents"],
];

function blank(id, name) {
  return { cashier: id, name: name, sales: 0, total_cents: 0, gross_cents: 0, voided_sales: 0, voided_cents: 0, removed_lines: 0, removed_cents: 0,
    discount_cents: 0, discounted_sales: 0, overrides: 0, override_cents: 0, no_sales: 0, refunds: 0, refund_cents: 0, no_receipt_refunds: 0,
    own_sale_refunds: 0, cash_refund_cents: 0, tills_closed: 0, short_tills: 0, cash_variance_cents: 0, rates: {}, flags: [] };
}

function collect(app, r) {
  const by = {};
  const get = (id) => by[id] || (by[id] = blank(id, nameOf(app, id) || (id ? "(unknown)" : "(no one)")));
  const sales = app.findRecordsByFilter("sales", "training = false && completed_at >= {:f} && completed_at < {:t}", "completed_at", 0, 0, { f: r.f, t: r.t });
  sales.forEach((s) => {
    const c = get(s.getString("cashier"));
    if (s.getString("status") === "voided") { c.voided_sales++; c.voided_cents += s.getInt("total_cents"); return; }
    c.sales++; c.total_cents += s.getInt("total_cents") + s.getInt("rounding_cents"); c.gross_cents += s.getInt("subtotal_cents");
    if (s.getInt("discount_cents") > 0) { c.discount_cents += s.getInt("discount_cents"); c.discounted_sales++; }
    app.findRecordsByFilter("sale_lines", "sale = {:s}", "", 0, 0, { s: s.id }).forEach((l) => {
      if (l.getBool("voided")) { c.removed_lines++; return; }
      if (l.getString("override_reason")) {
        c.overrides++;
        c.override_cents += Math.max(0, Math.round((l.getInt("regular_price_cents") - l.getInt("price_cents")) * l.getFloat("qty")));
      }
    });
  });
  app.findRecordsByFilter("cash_movements", "type = 'no_sale' && created_at >= {:f} && created_at < {:t}", "", 0, 0, { f: r.f, t: r.t })
    .forEach((m) => { get(m.getString("by")).no_sales++; });
  app.findRecordsByFilter("returns", "completed_at >= {:f} && completed_at < {:t}", "", 0, 0, { f: r.f, t: r.t }).forEach((x) => {
    const c = get(x.getString("cashier"));
    c.refunds++; c.refund_cents += x.getInt("refund_cents");
    if (!x.getBool("receipt")) c.no_receipt_refunds++;
    if (x.getString("sale")) { try { if (app.findRecordById("sales", x.getString("sale")).getString("cashier") === x.getString("cashier")) c.own_sale_refunds++; } catch (_) { /* gone */ } }
    app.findRecordsByFilter("refunds", "return = {:r} && method = 'cash'", "", 0, 0, { r: x.id }).forEach((f) => { c.cash_refund_cents += f.getInt("amount_cents"); });
  });
  app.findRecordsByFilter("tills", "status = 'closed' && closed_at >= {:f} && closed_at < {:t}", "", 0, 0, { f: r.f, t: r.t }).forEach((t) => {
    const c = get(t.getString("closed_by"));
    c.tills_closed++; c.cash_variance_cents += t.getInt("variance_cents");
    if (t.getInt("variance_cents") < 0) c.short_tills++;
  });
  return by;
}

function rate(num, den, money) { return den ? Math.round((money ? 10000 : 10000) * num / den) / 100 : 0; }   // per 100 / percent

function lossPrevention(app, q) {
  fresh();
  const r = range(q);
  const cfg = Object.assign({ multiple: 2, min_count: 3 }, setting(app, "reports.flags", {}) || {});
  const by = collect(app, r);
  const people = Object.values(by).filter((c) => c.cashier);
  const store = blank("", "Whole store");
  people.forEach((c) => Object.keys(store).forEach((k) => { if (typeof store[k] === "number") store[k] += c[k]; }));
  const countOf = { voids: "voided_sales", removed: "removed_lines", discount: "discounted_sales", overrides: "overrides", no_sales: "no_sales", refunds: "refunds" };
  [store].concat(people).forEach((c) => METRICS.forEach(([k, , n, d]) => { c.rates[k] = rate(c[n], c[d]); }));
  people.forEach((c) => {
    METRICS.forEach(([k, label]) => {
      const mine = c.rates[k], all = store.rates[k];
      if (c[countOf[k]] >= cfg.min_count && mine > 0 && (all === 0 || mine >= cfg.multiple * all) && people.length > 1) {
        c.flags.push(label + ": " + mine + " (store " + all + ")");
      }
    });
    if (c.no_receipt_refunds >= 2) c.flags.push(c.no_receipt_refunds + " refunds without a receipt");
    if (c.own_sale_refunds >= 2) c.flags.push(c.own_sale_refunds + " refunds on sales they rang up themselves");
    if (c.short_tills >= 2) c.flags.push(c.short_tills + " tills closed short ($" + (Math.abs(Math.min(0, c.cash_variance_cents)) / 100).toFixed(2) + ")");
  });
  people.sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name));
  return { from: r.from, to: r.to, settings: cfg, metrics: METRICS.map(([k, label]) => ({ key: k, label: label })), cashiers: people, store: store };
}

// The events behind one cashier's figures.
function details(app, q) {
  fresh();
  const r = range(q);
  const id = String(q.cashier || "");
  if (!id) bad("Choose a cashier.");
  const out = [];
  const money = (c) => "$" + (c / 100).toFixed(2);
  app.findRecordsByFilter("sales", "cashier = {:c} && training = false && completed_at >= {:f} && completed_at < {:t}", "completed_at", 0, 0, { c: id, f: r.f, t: r.t }).forEach((s) => {
    if (s.getString("status") === "voided") out.push({ at: s.getString("voided_at") || s.getString("completed_at"), kind: "Voided sale", ref: s.getString("number"), amount_cents: s.getInt("total_cents"), note: s.getString("void_reason") + (s.getString("voided_by") ? " · approved by " + nameOf(app, s.getString("voided_by")) : "") });
    if (s.getInt("discount_cents") > 0 && s.getString("status") !== "voided") out.push({ at: s.getString("completed_at"), kind: "Discount", ref: s.getString("number"), amount_cents: s.getInt("discount_cents"), note: Math.round(100 * s.getInt("discount_cents") / Math.max(1, s.getInt("subtotal_cents"))) + "% of " + money(s.getInt("subtotal_cents")) });
    app.findRecordsByFilter("sale_lines", "sale = {:s} && (voided = true || override_reason != '')", "line_no", 0, 0, { s: s.id }).forEach((l) => {
      if (l.getBool("voided")) out.push({ at: s.getString("completed_at"), kind: "Removed line", ref: s.getString("number"), amount_cents: 0, note: l.getString("name") });
      else out.push({ at: s.getString("completed_at"), kind: "Price override", ref: s.getString("number"), amount_cents: Math.round((l.getInt("regular_price_cents") - l.getInt("price_cents")) * l.getFloat("qty")),
        note: l.getString("name") + ": " + money(l.getInt("regular_price_cents")) + " → " + money(l.getInt("price_cents")) + " (" + l.getString("override_reason") + ")" });
    });
  });
  app.findRecordsByFilter("cash_movements", "type = 'no_sale' && by = {:c} && created_at >= {:f} && created_at < {:t}", "created_at", 0, 0, { c: id, f: r.f, t: r.t })
    .forEach((m) => out.push({ at: m.getString("created_at"), kind: "No sale", ref: "", amount_cents: 0, note: m.getString("reason") }));
  app.findRecordsByFilter("returns", "cashier = {:c} && completed_at >= {:f} && completed_at < {:t}", "completed_at", 0, 0, { c: id, f: r.f, t: r.t }).forEach((x) => {
    let own = false;
    if (x.getString("sale")) { try { own = app.findRecordById("sales", x.getString("sale")).getString("cashier") === id; } catch (_) { own = false; } }
    out.push({ at: x.getString("completed_at"), kind: x.getBool("receipt") ? "Refund" : "Refund, no receipt", ref: x.getString("number"), amount_cents: x.getInt("refund_cents"),
      note: (x.getString("reason") || "") + (own ? " · on their own sale" : "") });
  });
  out.sort((a, b) => (a.at < b.at ? -1 : 1));
  return { cashier: id, name: nameOf(app, id), from: r.from, to: r.to, events: out };
}

module.exports = { tillRecon, reconcile, lossPrevention, details, range, nameOf };

// Tills (P1 step 3): FR-3.01, 3.11 (no-sale), FR-1.12 (float default). One open till per device.
// Expected cash = float + cash taken (after change) - change given for US cash - drops - pay-outs
// + float added. US cash stays in its own count. Closing writes the Z report.

const st = () => require(`${__hooks}/lib/stock.js`);
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function bad(msg) { throw new BadRequestError(msg); }

// {denomination_cents: count} -> total cents (only the store's denominations)
function countTotal(app, detail) {
  const allowed = setting(app, "till.denominations", []) || [];
  let total = 0;
  const clean = {};
  Object.keys(detail || {}).forEach((k) => {
    const d = Number(k), n = Number(detail[k]);
    if (!n) return;
    if (allowed.indexOf(d) < 0) bad("Unknown denomination " + k + ".");
    if (!(n > 0) || n !== Math.floor(n)) bad("Counts are whole numbers.");
    clean[d] = n;
    total += d * n;
  });
  return { total, clean };
}

function open(app, body, ctx) {
  if (!ctx.device) bad("Tills open on a paired device.");
  if (require(`${__hooks}/lib/sales.js`).openTill(app, ctx.device)) bad("This till is already open.");
  let float;
  if (body.float_detail) float = countTotal(app, body.float_detail);
  else {
    const c = Number(body.float_cents !== undefined ? body.float_cents : setting(app, "till.float_default_cents", 0));
    if (!(c >= 0) || c !== Math.floor(c)) bad("The float is not a valid amount.");
    float = { total: c, clean: {} };
  }
  const t = new Record(app.findCollectionByNameOrId("tills"));
  t.load({ number: require(`${__hooks}/lib/sales.js`).nextNumber(app, "till", ctx), device: ctx.device, status: "open",
    opened_by: ctx.user ? ctx.user.id : "", opened_at: new DateTime(), float_cents: float.total, float_detail: float.clean });
  st().stamp(t, ctx);
  app.save(t);
  return t;
}

function till(app, id) {
  let t;
  try { t = app.findRecordById("tills", id); } catch (_) { bad("Unknown till."); }
  return t;
}

// Who may act on a till: its own device, or someone with till.manage.
function mayUse(app, t, ctx) {
  if (t.getString("device") === ctx.device) return;
  if (!ctx.can("till.manage")) throw new ForbiddenError("This is another device's till.");
}

function cash(app, id, body, ctx) {
  const t = till(app, id);
  mayUse(app, t, ctx);
  if (t.getString("status") !== "open") bad("This till is closed.");
  const type = String(body.type || "");
  if (["drop", "payout", "float_add", "no_sale"].indexOf(type) < 0) bad("Choose drop, pay-out, float added or no sale.");
  const amount = type === "no_sale" ? 0 : Number(body.amount_cents);
  if (type !== "no_sale" && (!(amount > 0) || amount !== Math.floor(amount))) bad("Enter an amount.");
  const reason = String(body.reason || "").trim();
  if ((type === "payout" || type === "no_sale") && !reason) bad("Give a reason.");
  if (type === "payout" && !ctx.can("till.manage")) throw new ForbiddenError("A manager records pay-outs.");
  const m = new Record(app.findCollectionByNameOrId("cash_movements"));
  m.load({ till: t.id, type, amount_cents: amount, reason: reason.substring(0, 200), by: ctx.user ? ctx.user.id : "" });
  st().stamp(m, ctx);
  app.save(m);
  return m;
}

// Everything the Z report and the close need, from the till's records.
function summary(app, t) {
  const sales = app.findRecordsByFilter("sales", "till = {:t}", "completed_at", 0, 0, { t: t.id });
  const done = sales.filter((s) => s.getString("status") === "completed" && !s.getBool("training"));
  const voided = sales.filter((s) => s.getString("status") === "voided");
  const sum = (list, f) => list.reduce((a, s) => a + s.getInt(f), 0);
  const taxes = {};
  done.forEach((s) => {
    let ts = [];
    try { ts = JSON.parse(s.getString("taxes") || "[]") || []; } catch (_) { ts = []; }
    ts.forEach((x) => {
      const k = x.code + "@" + x.rate;
      const g = taxes[k] || (taxes[k] = { code: x.code, label: x.label, rate: x.rate, base_cents: 0, tax_cents: 0 });
      g.base_cents += x.base_cents; g.tax_cents += x.tax_cents;
    });
  });
  const methods = {};
  let cashIn = 0, usdChange = 0, usdTendered = 0, declined = 0;
  done.forEach((s) => {
    app.findRecordsByFilter("payments", "sale = {:s}", "", 0, 0, { s: s.id }).forEach((p) => {
      if (p.getString("status") === "declined") { declined++; return; }
      if (p.getString("status") !== "approved") return;
      const m = p.getString("method");
      const g = methods[m] || (methods[m] = { method: m, count: 0, amount_cents: 0 });
      g.count++; g.amount_cents += p.getInt("amount_cents");
      if (m === "cash") cashIn += p.getInt("amount_cents");
      if (m === "usd_cash") { usdChange += p.getInt("change_cents"); usdTendered += p.getInt("tendered_cents"); }
    });
  });
  const moves = app.findRecordsByFilter("cash_movements", "till = {:t}", "created_at", 0, 0, { t: t.id });
  const mv = (type) => moves.filter((m) => m.getString("type") === type);
  const msum = (type) => mv(type).reduce((a, m) => a + m.getInt("amount_cents"), 0);
  let voidLineCount = 0;
  sales.forEach((s) => app.findRecordsByFilter("sale_lines", "sale = {:s} && voided = true", "", 0, 0, { s: s.id }).forEach(() => { voidLineCount++; }));
  const expected = t.getInt("float_cents") + cashIn - usdChange - msum("drop") - msum("payout") + msum("float_add");
  return {
    till: t.getInt("number"), opened_at: t.getString("opened_at"), float_cents: t.getInt("float_cents"),
    sales_count: done.length, items: done.reduce((a, s) => a + s.getFloat("items"), 0),
    gross_cents: sum(done, "subtotal_cents"), discount_cents: sum(done, "discount_cents"), tax_cents: sum(done, "tax_cents"),
    deposit_cents: sum(done, "deposit_cents"), total_cents: sum(done, "total_cents"), rounding_cents: sum(done, "rounding_cents"),
    taxes: Object.values(taxes), payments: Object.values(methods), declined_cards: declined,
    voided_sales: voided.length, voided_sales_cents: sum(voided, "total_cents"), voided_lines: voidLineCount,
    exempt_sales: done.filter((s) => s.getString("exempt") && s.getString("exempt") !== "null").length,
    training_sales: sales.filter((s) => s.getBool("training")).length,
    drops_cents: msum("drop"), payouts_cents: msum("payout"), float_added_cents: msum("float_add"), no_sales: mv("no_sale").length,
    cash_in_cents: cashIn, usd_change_cents: usdChange, usd_tendered_cents: usdTendered, expected_cash_cents: expected,
  };
}

function close(app, id, body, ctx) {
  const t = till(app, id);
  mayUse(app, t, ctx);
  if (t.getString("status") !== "open") bad("This till is already closed.");
  const counted = body.counted_detail ? countTotal(app, body.counted_detail) : { total: Number(body.counted_cents), clean: {} };
  if (!(counted.total >= 0)) bad("Count the cash in the drawer.");
  const z = summary(app, t);
  z.counted_cents = counted.total;
  z.variance_cents = counted.total - z.expected_cash_cents;
  if (body.counted_usd_cents !== undefined) {
    z.counted_usd_cents = Number(body.counted_usd_cents) || 0;
    z.usd_variance_cents = z.counted_usd_cents - z.usd_tendered_cents;
  }
  z.closed_at = new Date().toISOString();
  t.load({ status: "closed", closed_by: ctx.user ? ctx.user.id : "", closed_at: new DateTime(), counted_cents: counted.total,
    counted_detail: counted.clean, expected_cents: z.expected_cash_cents, variance_cents: z.variance_cents, z_report: z });
  st().stamp(t, ctx);
  app.save(t);
  // A till far over or short raises a task for the manager.
  const limit = Number(setting(app, "till.variance_task_cents", 500));
  if (Math.abs(z.variance_cents) > limit) {
    const task = new Record(app.findCollectionByNameOrId("tasks"));
    task.load({ title: "Till " + z.till + " closed " + (z.variance_cents < 0 ? "short" : "over") + " by $" + (Math.abs(z.variance_cents) / 100).toFixed(2),
      kind: "till_variance", source: "rule", rule_key: "till:variance:" + t.id, status: "open", priority: "normal", link_collection: "tills", link_id: t.id });
    st().stamp(task, ctx);
    app.save(task);
  }
  return t;
}

function view(app, t) {
  const v = { id: t.id, number: t.getInt("number"), status: t.getString("status"), device: t.getString("device"),
    opened_at: t.getString("opened_at"), float_cents: t.getInt("float_cents"), closed_at: t.getString("closed_at") };
  if (t.getString("status") === "open") v.summary = summary(app, t);
  else { try { v.z_report = JSON.parse(t.getString("z_report") || "null"); } catch (_) { v.z_report = null; } }
  return v;
}

module.exports = { open, cash, close, summary, view, till, mayUse };

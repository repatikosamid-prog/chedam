// Linked card payments at the till (P5 step 2; FR-3.21, P5-b, P5-d). The till asks the hub to send an amount to
// its terminal; the hub creates the processor's checkout (outbound), the till asks for the result every few
// seconds and the hub asks the processor. When it is approved the hub keeps the card type, last 4 and the
// processor's payment id; the sale then names the checkout and the hub fills the card payment from it, so a
// linked payment can't be typed in or used twice. A checkout that was paid but whose sale never completed
// stays "paid, not used": the till picks it up again for the same sale, and managers see it (step 3 refunds it).
//   start()   POST /api/chedam/terminal/checkouts     {sale_id, amount_cents}
//   poll()    GET  /api/chedam/terminal/checkouts/{id}
//   cancel()  POST /api/chedam/terminal/checkouts/{id}/cancel
//   claim()   from settlePayments (lib/sales.js), inside the sale's transaction

const pp = () => require(`${__hooks}/lib/payproc.js`);
function bad(msg) { throw new BadRequestError(msg); }
const FINAL = ["completed", "cancelled", "failed"];
const SYS = { actor: "system:terminal", device: "" };

function view(t) {
  return { id: t.id, sale_id: t.getString("sale_id"), amount_cents: t.getInt("amount_cents"), status: t.getString("status"), terminal: t.getString("terminal_name"),
    card_type: t.getString("card_type"), last4: t.getString("last4"), cancel_reason: t.getString("cancel_reason"), used_sale: t.getString("used_sale"),
    created_at: t.getString("created_at"), completed_at: t.getString("completed_at") };
}

function save(app, id, fields, c) {
  app.runInTransaction((tx) => {
    const r = tx.findRecordById("terminal_checkouts", id);
    Object.keys(fields).forEach((k) => r.set(k, fields[k]));
    pp().stamp(r, c || SYS); tx.save(r);
  });
  return app.findRecordById("terminal_checkouts", id);
}

function start(app, c, b) {
  const saleId = String(b.sale_id || "");
  if (!/^[a-z0-9]{15}$/.test(saleId)) bad("The sale id is not valid.");
  const amt = Number(b.amount_cents);
  if (!(amt > 0) || amt !== Math.floor(amt)) bad("The amount is not valid.");
  if (amt > 9999999) bad("The amount is too large for one card payment.");
  try { app.findRecordById("sales", saleId); bad("This sale is already saved."); } catch (err) { if (err instanceof BadRequestError) throw err; }
  const l = pp().forDevice(app, c.device) || bad("Card is not linked on this till: key the amount into the terminal.");
  const termId = l.terminal.id;
  // One checkout at a time on a terminal. The same sale and amount again (a till that lost the answer) gets
  // the same checkout back.
  const busy = app.findRecordsByFilter("terminal_checkouts", "terminal = {:t} && (status = 'pending' || status = 'in_progress' || status = 'cancel_requested')", "-created_at", 5, 0, { t: termId });
  const same = busy.find((x) => x.getString("sale_id") === saleId && x.getInt("amount_cents") === amt);
  if (same) return view(same);
  if (busy.length) bad("The terminal is busy with another payment: cancel it there or on the till first.");
  const key = $security.randomString(30);
  const co = pp().call(app, l.processor, (cn, ad) => ad.checkout(cn, { terminal_id: l.terminal.getString("terminal_id"), amount_cents: amt, reference: saleId, note: "Chedam sale", key: key }));
  let id = "";
  app.runInTransaction((tx) => {
    const r = new Record(tx.findCollectionByNameOrId("terminal_checkouts"));
    r.load({ processor: l.processor.id, terminal: termId, terminal_name: l.terminal.getString("name"), till_device: c.device, sale_id: saleId, amount_cents: amt,
      checkout_id: co.id, status: co.status === "completed" ? "pending" : co.status, started_by: c.user ? c.user.getString("name") : "" });
    pp().stamp(r, c); tx.save(r);
    id = r.id;
  });
  return view(app.findRecordById("terminal_checkouts", id));
}

function record(app, id) {
  let t;
  try { t = app.findRecordById("terminal_checkouts", id); } catch (_) { bad("Checkout not found."); }
  return t;
}

// Asks the processor for news (unless the checkout is final). Too long waiting: cancelled on the terminal.
function poll(app, c, id) {
  let t = record(app, id);
  if (FINAL.indexOf(t.getString("status")) >= 0) return view(t);
  const p = app.findRecordById("payment_processors", t.getString("processor"));
  const set = require(`${__hooks}/lib/auth.js`).setting(app, "payments.linked", {}) || {};
  const waited = (Date.now() - new Date(t.getString("created_at").replace(" ", "T")).getTime()) / 1000;
  let s = pp().call(app, p, (cn, ad) => ad.checkoutStatus(cn, t.getString("checkout_id")));
  if ((s.status === "pending" || s.status === "in_progress") && waited > (set.wait_seconds === undefined || set.wait_seconds === null ? 300 : Number(set.wait_seconds))) {
    try { s = pp().call(app, p, (cn, ad) => ad.cancel(cn, t.getString("checkout_id"))); s.cancel_reason = "timed_out"; } catch (_) { /* answered next time */ }
  }
  if (s.status === "completed") {
    const pay = pp().call(app, p, (cn, ad) => ad.payment(cn, s.payment_ids[0]));
    t = save(app, t.id, { status: "completed", payment_id: pay.id, card_type: pay.card_type, last4: pay.last4, fee_cents: pay.fee_known ? pay.fee_cents : 0,
      fee_known: pay.fee_known, completed_at: new Date().toISOString() });
  } else if (s.status !== t.getString("status") || (s.status === "cancelled" && !t.getString("completed_at"))) {
    const f = { status: s.status };
    if (s.status === "cancelled") { f.cancel_reason = s.cancel_reason || "cancelled"; f.completed_at = new Date().toISOString(); }
    t = save(app, t.id, f);
  }
  return view(t);
}

function cancel(app, c, id) {
  const t = record(app, id);
  if (FINAL.indexOf(t.getString("status")) >= 0) return view(t);
  const p = app.findRecordById("payment_processors", t.getString("processor"));
  try { pp().call(app, p, (cn, ad) => ad.cancel(cn, t.getString("checkout_id"))); } catch (err) {
    // Already paid on the terminal a moment ago: the next poll says so
    return poll(app, c, id);
  }
  save(app, t.id, { status: "cancel_requested" }, c);
  return poll(app, c, id);
}

// Paid checkouts of a sale that are not yet in a saved sale (the till lost them: reload, a refused sale)
function unused(app, saleId) {
  return app.findRecordsByFilter("terminal_checkouts", "sale_id = {:s} && status = 'completed' && used_sale = ''", "created_at", 0, 0, { s: String(saleId || "") }).map(view);
}

// Managers: paid checkouts never used by a sale (refund them or finish the sale)
function orphans(app) {
  return app.findRecordsByFilter("terminal_checkouts", "status = 'completed' && used_sale = '' && completed_at < {:t}", "-created_at", 100, 0,
    { t: new Date(Date.now() - 15 * 60000).toISOString().replace("T", " ") }).map(view);
}

// Inside the sale's transaction (settlePayments): a card payment naming a checkout is filled from it.
// relaxed (an offline upload of a sale paid while the hub was briefly unreachable): never refused.
function claim(app, rec, pm, amt, opts) {
  const o = opts || {};
  let t = null;
  try { t = app.findRecordById("terminal_checkouts", String(pm.checkout)); } catch (_) { t = null; }
  if (!t) { if (o.relaxed) return; bad("The linked card payment was not found."); }
  if (t.getString("status") !== "completed") { if (o.relaxed) return; bad("The card payment on the terminal is not approved."); }
  if (t.getInt("amount_cents") !== amt) bad("The card payment was " + t.getInt("amount_cents") + " cents, not " + amt + ".");
  const used = t.getString("used_sale");
  if (used && used !== o.sale_id) bad("This card payment is already used by another sale.");
  if (!o.relaxed && t.getString("sale_id") !== o.sale_id) bad("This card payment was taken for another sale.");
  const p = app.findRecordById("payment_processors", t.getString("processor"));
  rec.checkout = t.id; rec.processor = p.getString("kind"); rec.processor_payment = t.getString("payment_id");
  rec.last4 = t.getString("last4"); rec.card_type = t.getString("card_type"); rec.reference = t.getString("payment_id").substring(0, 60);
  t.set("used_sale", o.sale_id || "");
  if (o.ctx) pp().stamp(t, o.ctx);
  app.save(t);
}

module.exports = { start, poll, cancel, unused, orphans, claim, view };

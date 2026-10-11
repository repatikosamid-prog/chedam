// Card refunds through the linked processor (P5 step 3; FR-4.14 stage 2), its fees and payouts (FR-10.05).
// A card payment taken on a linked terminal goes back to the same card through the processor: Interac (debit)
// needs the card on a terminal (the till's own, else the one it was paid on); other cards go back without it.
// The refund is made first (outside a transaction), then the return or void names it, and the hub checks it
// is accepted, for that sale, for that amount and not used before (like linked payments, lib/terminal.js).
// A refund the processor has accepted but whose return was refused stays "not used": the till picks it up
// again for the same return. Paid checkouts that no sale took (step 2) are refunded by a manager.
//   start()       POST /api/chedam/terminal/refunds        {sale, ref, purpose: return|void, amount_cents}
//   poll()        GET  /api/chedam/terminal/refunds/{id}
//   unused()      GET  /api/chedam/terminal/refunds?ref=   accepted refunds not yet in a return or void
//   refundUnused() POST /api/chedam/terminal/checkouts/{id}/refund
//   claim()       from settleRefunds (lib/returns.js) and voidSale (lib/sales.js), inside their transaction
//   syncFees()    hourly: the processor's fee per linked payment; its payouts

const pp = () => require(`${__hooks}/lib/payproc.js`);
function bad(msg) { throw new BadRequestError(msg); }
const SYS = { actor: "system:payproc", device: "" };
const ACCEPTED = (r) => r.getString("status") === "completed" || (r.getString("status") === "pending" && !r.getBool("on_terminal"));

function view(r) {
  return { id: r.id, sale: r.getString("sale"), ref: r.getString("ref"), purpose: r.getString("purpose"), amount_cents: r.getInt("amount_cents"), status: r.getString("status"),
    accepted: ACCEPTED(r), on_terminal: r.getBool("on_terminal"), terminal: r.getString("terminal_name"), card_type: r.getString("card_type"), last4: r.getString("last4"),
    used_by: r.getString("used_by"), created_at: r.getString("created_at") };
}

// What can still go back to each linked card payment of a sale
function linkedLeft(app, saleId) {
  return app.findRecordsByFilter("payments", "sale = {:s} && method = 'card' && status = 'approved' && checkout != ''", "created_at", 0, 0, { s: saleId }).map((p) => {
    const back = app.findRecordsByFilter("processor_refunds", "payment = {:p} && (status = 'pending' || status = 'completed')", "", 0, 0, { p: p.id }).reduce((a, x) => a + x.getInt("amount_cents"), 0);
    return { p: p, left: Math.max(0, p.getInt("amount_cents") - back) };
  });
}
function linkedRefundable(app, saleId) { return linkedLeft(app, saleId).reduce((a, x) => a + x.left, 0); }

// The terminal for a card-present refund: this till's, else the one the payment was taken on (if still paired)
function terminalFor(app, deviceId, checkoutId) {
  const mine = pp().forDevice(app, deviceId);
  if (mine) return mine.terminal;
  try {
    const t = app.findRecordById("card_terminals", app.findRecordById("terminal_checkouts", checkoutId).getString("terminal"));
    if (t.getString("status") === "paired") return t;
  } catch (_) { /* gone */ }
  return null;
}

function create(app, c, f) {
  let id = "";
  app.runInTransaction((tx) => {
    const r = new Record(tx.findCollectionByNameOrId("processor_refunds"));
    r.load(f);
    r.set("by_name", c.user ? c.user.getString("name") : "");
    pp().stamp(r, c); tx.save(r);
    id = r.id;
  });
  return app.findRecordById("processor_refunds", id);
}

// One processor refund against one payment (or a paid checkout)
function send(app, c, o) {
  const p = pp().processor(app) || bad("The card processor is not connected: refund on the terminal by hand.");
  const interac = o.card_type === "interac";
  let term = null;
  if (interac) {
    term = terminalFor(app, c.device, o.checkout) || bad("Interac refunds need the customer's card on a linked terminal, and none is linked here.");
  }
  const key = $security.randomString(30);
  const res = pp().call(app, p, (cn, ad) => ad.refund(cn, { payment_id: o.processor_payment, amount_cents: o.amount_cents, key: key, reason: o.reason,
    card_present: interac, terminal_id: term ? term.getString("terminal_id") : "" }));
  return create(app, c, { processor: p.id, sale: o.sale || "", payment: o.payment || "", checkout: o.checkout || "", processor_payment: o.processor_payment, ref: o.ref,
    purpose: o.purpose, amount_cents: o.amount_cents, refund_id: res.id, on_terminal: !!res.on_terminal, terminal_name: term ? term.getString("name") : "",
    status: res.status, card_type: o.card_type, last4: o.last4 });
}

// b: {sale, ref, purpose: return|void, amount_cents}. Goes back to the sale's linked card payments, oldest first.
function start(app, c, b) {
  const saleId = String(b.sale || ""), ref = String(b.ref || ""), purpose = b.purpose === "void" ? "void" : "return";
  if (!/^[a-z0-9]{15}$/.test(ref)) bad("The return id is not valid.");
  let s;
  try { s = app.findRecordById("sales", saleId); } catch (_) { bad("Unknown sale."); }
  if (s.getString("status") !== "completed") bad("This sale is voided.");
  if (purpose === "void" && ref !== s.id) bad("A void refunds its own sale.");
  let amt = Number(b.amount_cents);
  if (!(amt > 0) || amt !== Math.floor(amt)) bad("The amount is not valid.");
  // Already refunded for this return (the till lost the answer): the same refunds back
  const done = app.findRecordsByFilter("processor_refunds", "ref = {:r} && sale = {:s} && used_by = '' && (status = 'pending' || status = 'completed')", "created_at", 0, 0, { r: ref, s: s.id });
  const doneAmt = done.reduce((a, x) => a + x.getInt("amount_cents"), 0);
  if (doneAmt >= amt) return { items: done.map(view) };
  amt -= doneAmt;
  const left = linkedLeft(app, s.id);
  if (left.reduce((a, x) => a + x.left, 0) < amt) bad("Only " + left.reduce((a, x) => a + x.left, 0) + " cents can go back to the card through the processor.");
  const out = done.map(view);
  for (let i = 0; i < left.length && amt > 0; i++) {
    const x = left[i];
    if (!x.left) continue;
    const part = Math.min(x.left, amt);
    out.push(view(send(app, c, { sale: s.id, payment: x.p.id, checkout: x.p.getString("checkout"), processor_payment: x.p.getString("processor_payment"), ref: ref, purpose: purpose,
      amount_cents: part, card_type: x.p.getString("card_type"), last4: x.p.getString("last4"), reason: (purpose === "void" ? "Void " : "Return ") + s.getString("number") })));
    amt -= part;
  }
  return { items: out };
}

function poll(app, c, id) {
  let r;
  try { r = app.findRecordById("processor_refunds", id); } catch (_) { bad("Refund not found."); }
  if (r.getString("status") !== "pending") return view(r);
  const p = app.findRecordById("payment_processors", r.getString("processor"));
  const s = pp().call(app, p, (cn, ad) => ad.refundStatus(cn, r.getString("refund_id"), r.getBool("on_terminal")));
  if (s.status !== r.getString("status")) {
    app.runInTransaction((tx) => { const x = tx.findRecordById("processor_refunds", id); x.set("status", s.status); pp().stamp(x, SYS); tx.save(x); });
    r = app.findRecordById("processor_refunds", id);
  }
  return view(r);
}

function unused(app, ref) {
  return app.findRecordsByFilter("processor_refunds", "ref = {:r} && used_by = ''", "created_at", 0, 0, { r: String(ref || "") }).filter(ACCEPTED).map(view);
}

// A paid checkout that no sale took (lib/terminal.js orphans): the whole amount back to the card
function refundUnused(app, c, id) {
  let t;
  try { t = app.findRecordById("terminal_checkouts", id); } catch (_) { bad("Checkout not found."); }
  if (t.getString("status") !== "completed" || t.getString("used_sale")) bad("Only a paid checkout that no sale took can be refunded here (use a return).");
  if (t.getString("refund")) {
    const r = app.findRecordById("processor_refunds", t.getString("refund"));
    if (r.getString("status") === "pending" || r.getString("status") === "completed") return view(r);
  }
  const r = send(app, c, { sale: "", checkout: t.id, processor_payment: t.getString("payment_id"), ref: t.id, purpose: "unused", amount_cents: t.getInt("amount_cents"),
    card_type: t.getString("card_type"), last4: t.getString("last4"), reason: "Card payment without a sale" });
  app.runInTransaction((tx) => { const x = tx.findRecordById("terminal_checkouts", t.id); x.set("refund", r.id); pp().stamp(x, c); tx.save(x); });
  return view(r);
}

// Inside a return's or void's transaction: the named processor refund must be accepted, of this sale, this
// ref, this amount, not used. Fills the refund line.
function claim(app, rec, id, amt, o) {
  let r = null;
  try { r = app.findRecordById("processor_refunds", String(id)); } catch (_) { r = null; }
  if (!r) bad("The card refund was not found.");
  if (!ACCEPTED(r)) bad("The card refund has not gone through (" + r.getString("status") + ").");
  if (r.getString("sale") !== o.sale || r.getString("ref") !== o.ref) bad("This card refund was made for another sale or return.");
  if (r.getInt("amount_cents") !== amt) bad("The card refund was " + r.getInt("amount_cents") + " cents, not " + amt + ".");
  if (r.getString("used_by")) bad("This card refund is already recorded.");
  if (rec) { rec.processor_refund = r.id; rec.last4 = r.getString("last4"); rec.reference = r.getString("refund_id").substring(0, 60); }
  r.set("used_by", o.ref);
  if (o.ctx) pp().stamp(r, o.ctx);
  app.save(r);
  return r;
}

// Hourly when connected: the fee of each linked payment of the last 7 days that Square had not set yet, and
// the payouts of the last 45 days.
// now: asked from the screen (no internet check first; a failure is reported as usual)
function syncFees(app, now) {
  const p = pp().processor(app);
  if (!p || !p.getString("location_id") || (!now && !require(`${__hooks}/lib/net.js`).online(app))) return { skipped: true };
  const since = new Date(Date.now() - 7 * 86400000).toISOString().replace("T", " ");
  let fees = 0, payouts = 0;
  app.findRecordsByFilter("terminal_checkouts", "status = 'completed' && fee_known = false && completed_at >= {:s} && processor = {:p}", "", 200, 0, { s: since, p: p.id }).forEach((t) => {
    try {
      const pay = pp().call(app, p, (cn, ad) => ad.payment(cn, t.getString("payment_id")));
      if (!pay.fee_known) return;
      app.runInTransaction((tx) => { const x = tx.findRecordById("terminal_checkouts", t.id); x.set("fee_cents", pay.fee_cents); x.set("fee_known", true); pp().stamp(x, SYS); tx.save(x); });
      fees++;
    } catch (_) { /* next hour */ }
  });
  try {
    const list = pp().call(app, p, (cn, ad) => ad.payouts(cn, new Date(Date.now() - 45 * 86400000).toISOString(), new Date().toISOString()));
    app.runInTransaction((tx) => {
      list.forEach((po) => {
        let r = tx.findRecordsByFilter("processor_payouts", "payout_id = {:i}", "", 1, 0, { i: po.id })[0];
        if (r && r.getString("status") === po.status && r.getInt("amount_cents") === po.amount_cents) return;
        if (!r) { r = new Record(tx.findCollectionByNameOrId("processor_payouts")); r.set("processor", p.id); r.set("payout_id", po.id); }
        r.set("status", po.status); r.set("amount_cents", po.amount_cents); r.set("arrival_date", po.arrival_date);
        pp().stamp(r, SYS); tx.save(r);
        payouts++;
      });
    });
  } catch (_) { /* next hour */ }
  return { fees: fees, payouts: payouts };
}

function payoutList(app) {
  return app.findRecordsByFilter("processor_payouts", "deleted_at = ''", "-arrival_date", 100, 0).map((r) => ({ id: r.id, payout_id: r.getString("payout_id"), status: r.getString("status"),
    amount_cents: r.getInt("amount_cents"), arrival_date: r.getString("arrival_date") }));
}

module.exports = { start, poll, unused, refundUnused, claim, syncFees, payoutList, linkedRefundable, view };

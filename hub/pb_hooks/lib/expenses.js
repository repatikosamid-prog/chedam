// Expenses and petty cash (P3 step 6; FR-9.01-9.03).
// A claim: day, vendor, amount with GST/PST, category, how it was paid (own money to reimburse, petty cash,
// company card, cash from the till), note, receipt photos. Submitted → approved / rejected (a reason) →
// reimbursed (till cash: a pay-out on an open till; petty cash; cheque; e-transfer; next pay) when it was
// paid with the person's own money. Flags (FR-9.02): a possible duplicate (same amount and vendor within 3
// days, any claimant) and a missing receipt (over expenses.receipt_over_cents). Everyone sees their own
// claims; approvers (expenses.approve) see all. Petty cash (FR-9.03): every expense paid from the box,
// top-ups and counts; the balance is what should be there, a count records the difference.

const st = () => require(`${__hooks}/lib/stock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
function shift(ymd, n) { const a = ymd.split("-").map(Number); const d = new Date(a[0], a[1] - 1, a[2] + n); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }

function view(app, e) {
  return { id: e.id, number: e.getString("number"), claimant: e.getString("claimant"), claimant_name: e.getString("claimant_name"), day: e.getString("day"), vendor_name: e.getString("vendor_name"),
    party: e.getString("party"), amount_cents: e.getInt("amount_cents"), gst_cents: e.getInt("gst_cents"), pst_cents: e.getInt("pst_cents"), category: e.getString("category"),
    paid_with: e.getString("paid_with"), note: e.getString("note"), receipts: e.get("receipts") || [], collectionId: e.collection().id, status: e.getString("status"), flags: j(e, "flags", []),
    decided_by: e.getString("decided_by"), decided_at: e.getString("decided_at"), reject_reason: e.getString("reject_reason"),
    reimbursed_with: e.getString("reimbursed_with"), reimbursed_ref: e.getString("reimbursed_ref"), reimbursed_at: e.getString("reimbursed_at"), created_at: e.getString("created_at") };
}

function flagsOf(app, e) {
  const f = [];
  const day = e.getString("day");
  const dup = app.findRecordsByFilter("expenses", "id != {:id} && amount_cents = {:a} && status != 'rejected' && day >= {:f} && day <= {:t} && deleted_at = ''", "", 5, 0,
    { id: e.id || "", a: e.getInt("amount_cents"), f: shift(day, -3), t: shift(day, 3) })
    .filter((x) => !e.getString("vendor_name") || !x.getString("vendor_name") || x.getString("vendor_name").toLowerCase() === e.getString("vendor_name").toLowerCase());
  dup.forEach((x) => f.push("duplicate:" + x.getString("number")));
  const over = Number(setting(app, "expenses.receipt_over_cents", 0)) || 0;
  if (!(e.get("receipts") || []).length && e.getInt("amount_cents") > over) f.push("missing_receipt");
  return f;
}

function pettyBalance(app) {
  const last = app.findRecordsByFilter("petty_cash", "deleted_at = ''", "-created_at", 1, 0)[0];
  return last ? last.getInt("balance_cents") : 0;
}
function petty(app, c, kind, amount, note, expense, counted) {
  const bal = pettyBalance(app);
  if (amount < 0 && bal + amount < 0 && kind !== "adjust") bad("Petty cash has only " + (bal / 100).toFixed(2) + " in it; top it up first.");
  const r = new Record(app.findCollectionByNameOrId("petty_cash"));
  r.load({ kind: kind, amount_cents: amount, balance_cents: bal + amount, counted_cents: counted === undefined ? 0 : counted, expense: expense || "", note: String(note || "").substring(0, 300),
    by_name: c.user ? c.user.getString("name") : "" });
  stamp(r, c); app.save(r);
  return r;
}

// body: {day, vendor_name, party, amount_cents, gst_cents, pst_cents, category, paid_with, note}; files: receipts
function submit(app, c, b, files) {
  if (!c.user) bad("Sign in as a person to claim an expense.");
  const amt = Math.round(Number(b.amount_cents));
  if (!(amt > 0)) bad("Enter the amount paid.");
  const gst = Math.round(Number(b.gst_cents) || 0), pst = Math.round(Number(b.pst_cents) || 0);
  if (gst < 0 || pst < 0 || gst + pst >= amt) bad("The taxes are part of the amount paid.");
  const cats = setting(app, "expenses.categories", []) || [];
  const cat = String(b.category || "");
  if (cats.length && cats.indexOf(cat) < 0) bad("Choose a category.");
  const paid = ["own_money", "petty_cash", "company_card", "till_cash"].indexOf(b.paid_with) >= 0 ? b.paid_with : "own_money";
  if (!String(b.vendor_name || "").trim()) bad("Where was it bought?");
  const e = new Record(app.findCollectionByNameOrId("expenses"));
  e.load({ claimant: c.user.id, claimant_name: c.user.getString("name"), day: ymdOk(b.day) ? b.day : st().today(), vendor_name: String(b.vendor_name).trim().substring(0, 120), party: String(b.party || ""),
    amount_cents: amt, gst_cents: gst, pst_cents: pst, category: cat, paid_with: paid, note: String(b.note || "").substring(0, 1000), status: "submitted" });
  e.set("number", "EX-" + ("000000" + require(`${__hooks}/lib/sales.js`).nextNumber(app, "ex", c)).slice(-6));
  if (files && files.length) e.set("receipts", files.slice(0, 5));
  e.set("flags", flagsOf(app, e));
  stamp(e, c); app.save(e);
  // Paid from the petty cash box: the box goes down now
  if (paid === "petty_cash") petty(app, c, "expense", -amt, e.getString("number") + " " + e.getString("vendor_name"), e.id);
  return e;
}

function addReceipts(app, c, id, files) {
  const e = app.findRecordById("expenses", id);
  if (!c.user || (e.getString("claimant") !== c.user.id && !c.can("expenses.approve"))) throw new ForbiddenError("Not your claim.");
  if (!files || !files.length) bad("Choose the photo.");
  e.set("receipts+", files.slice(0, 5 - (e.get("receipts") || []).length));
  e.set("flags", flagsOf(app, e));
  stamp(e, c); app.save(e);
  return e;
}

// approve | reject {reason} | reimburse {with, reference, till}
function decide(app, c, id, action, b) {
  const e = app.findRecordById("expenses", id);
  const s = e.getString("status");
  if (c.user && e.getString("claimant") === c.user.id && !require(`${__hooks}/lib/access.js`).isOwner(app, c.user)) bad("Someone else approves your own claims.");
  const who = c.user ? c.user.getString("name") : "Chedam";
  if (action === "approve" || action === "reject") {
    if (s !== "submitted") bad("This claim is " + s + ".");
    if (action === "reject" && !String(b.reason || "").trim()) bad("Say why it is rejected.");
    e.set("status", action === "approve" ? "approved" : "rejected"); e.set("decided_by", who); e.set("decided_at", new DateTime());
    if (action === "reject") {
      e.set("reject_reason", String(b.reason).substring(0, 300));
      // Paid from petty cash and rejected: the money goes back in the box record as an adjustment to look into
      if (e.getString("paid_with") === "petty_cash") petty(app, c, "adjust", e.getInt("amount_cents"), "Rejected " + e.getString("number") + ": put the money back", e.id);
    }
    // Approved and paid by the store already (petty cash, company card, till): nothing to give back
    if (action === "approve" && e.getString("paid_with") !== "own_money") { e.set("status", "reimbursed"); e.set("reimbursed_with", ""); e.set("reimbursed_at", new DateTime()); }
  } else if (action === "reimburse") {
    if (s !== "approved") bad(s === "submitted" ? "Approve it first." : "This claim is " + s + ".");
    const how = String(b.with || "");
    if (["till_cash", "petty_cash", "cheque", "e_transfer", "next_pay"].indexOf(how) < 0) bad("Choose how it is paid back.");
    if (how === "till_cash") {
      if (!b.till) bad("Choose the open till the cash comes from.");
      require(`${__hooks}/lib/tills.js`).cash(app, b.till, { type: "payout", amount_cents: e.getInt("amount_cents"), reason: "Expense " + e.getString("number") + " " + e.getString("claimant_name") }, c);
    }
    if (how === "petty_cash") petty(app, c, "reimburse", -e.getInt("amount_cents"), "Paid back " + e.getString("number") + " to " + e.getString("claimant_name"), e.id);
    e.set("status", "reimbursed"); e.set("reimbursed_with", how); e.set("reimbursed_ref", String(b.reference || "").substring(0, 80)); e.set("reimbursed_at", new DateTime());
  } else throw new NotFoundError("Unknown action.");
  stamp(e, c); app.save(e);
  return e;
}

function list(app, c, q) {
  const all = c.can("expenses.approve") && q.who !== "mine";
  const parts = ["deleted_at = ''"], params = {};
  if (!all) { parts.push("claimant = {:u}"); params.u = c.user ? c.user.id : "-"; }
  if (q.status) { parts.push("status = {:s}"); params.s = q.status; }
  const items = app.findRecordsByFilter("expenses", parts.join(" && "), "-day,-created_at", 300, 0, params).map((e) => view(app, e));
  const byCat = {};
  items.filter((x) => x.status !== "rejected").forEach((x) => { byCat[x.category || "Other"] = (byCat[x.category || "Other"] || 0) + x.amount_cents; });
  return { items: items, can_approve: c.can("expenses.approve"), categories: setting(app, "expenses.categories", []), by_category: byCat,
    waiting: items.filter((x) => x.status === "submitted").length, to_pay_back_cents: items.filter((x) => x.status === "approved").reduce((a, x) => a + x.amount_cents, 0) };
}

function pettyView(app) {
  return { float_cents: Number(setting(app, "petty_cash.float_cents", 20000)) || 0, balance_cents: pettyBalance(app),
    moves: app.findRecordsByFilter("petty_cash", "deleted_at = ''", "-created_at", 100, 0).map((r) => ({ id: r.id, kind: r.getString("kind"), amount_cents: r.getInt("amount_cents"),
      balance_cents: r.getInt("balance_cents"), counted_cents: r.getInt("counted_cents"), note: r.getString("note"), by: r.getString("by_name"), at: r.getString("created_at") })) };
}

// top_up {amount_cents, note} | count {counted_cents, note}
function pettyAct(app, c, action, b) {
  if (action === "top_up") {
    const a = Math.round(Number(b.amount_cents));
    if (!(a > 0)) bad("Enter the amount put in.");
    petty(app, c, "top_up", a, b.note || "Top-up");
  } else if (action === "count") {
    const n = Math.round(Number(b.counted_cents));
    if (!(n >= 0)) bad("Enter what is in the box.");
    const diff = n - pettyBalance(app);
    petty(app, c, "count", diff, (diff ? (diff < 0 ? "Short " : "Over ") + (Math.abs(diff) / 100).toFixed(2) : "Counted, balanced") + (b.note ? ": " + b.note : ""), "", n);
  } else throw new NotFoundError("Unknown action.");
  return pettyView(app);
}

module.exports = { submit, addReceipts, decide, list, view, pettyView, pettyAct };

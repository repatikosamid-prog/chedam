// Bills, invoices, payments, statements, vendor returns, vendor performance (P3 step 4; FR-8.04-8.06).
// Documents: bill (we owe a vendor), vendor_credit (a vendor owes us / lowers what we owe), invoice (a client
// owes us), client_credit. Each keeps its currency and the rate of its date (P3-b), lines, taxes, total, paid,
// due date from the party's terms, status open → partial → paid (or void, with a reason, only when nothing is
// paid). A bill can come from a received PO (its lines at what was received) and says when it differs from
// what was received. Payments: cash, cheque, e-transfer, card, bank transfer, till cash, or a credit of the same
// party applied. Statement: opening balance, documents and payments in the dates, closing balance, aging.
// Vendor returns: stock out ("Returned to vendor", FEFO at cost), then the vendor's credit is recorded.

const st = () => require(`${__hooks}/lib/stock.js`);
const P = () => require(`${__hooks}/lib/purchasing.js`);
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const PREFIX = { bill: "B", vendor_credit: "VC", invoice: "INV", client_credit: "CC" };
const PAYABLE = ["bill", "vendor_credit"], CREDIT = ["vendor_credit", "client_credit"];
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
function addDays(ymd, n) { const a = ymd.split("-").map(Number); const d = new Date(a[0], a[1] - 1, a[2] + n); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
function partyOf(app, id, kind) {
  let p = null;
  try { p = app.findRecordById("parties", id); } catch (_) { p = null; }
  if (!p || p.getString("deleted_at")) bad("Choose a vendor or client.");
  const k = p.getString("kind");
  if (PAYABLE.indexOf(kind) >= 0 && k === "client") bad("A bill is from a vendor.");
  if (PAYABLE.indexOf(kind) < 0 && k === "vendor") bad("An invoice is to a client.");
  return p;
}

function view(app, b) {
  let pname = "";
  try { pname = app.findRecordById("parties", b.getString("party")).getString("name"); } catch (_) { pname = ""; }
  const pays = app.findRecordsByFilter("bill_payments", "bill = {:b} && voided = false", "day", 0, 0, { b: b.id }).map((x) => ({ id: x.id, day: x.getString("day"), amount_cents: x.getInt("amount_cents"),
    cad_cents: x.getInt("cad_cents"), method: x.getString("method"), reference: x.getString("reference"), credit_doc: x.getString("credit_doc"), by: x.getString("by_name") }));
  const due = b.getString("due_date"), open = ["open", "partial"].indexOf(b.getString("status")) >= 0;
  const today = st().today();
  return { id: b.id, kind: b.getString("kind"), number: b.getString("number"), party: b.getString("party"), party_name: pname, party_ref: b.getString("party_ref"), po: b.getString("po"),
    status: b.getString("status"), doc_date: b.getString("doc_date"), due_date: due, currency: b.getString("currency"), fx_rate: b.getFloat("fx_rate"),
    lines: j(b, "lines", []), taxes: j(b, "taxes", []), subtotal_cents: b.getInt("subtotal_cents"), tax_cents: b.getInt("tax_cents"), total_cents: b.getInt("total_cents"),
    total_cad_cents: b.getInt("total_cad_cents"), paid_cents: b.getInt("paid_cents"), balance_cents: b.getInt("total_cents") - b.getInt("paid_cents"),
    overdue_days: open && due && due < today ? Math.round((new Date(today) - new Date(due)) / 86400000) : 0,
    notes: b.getString("notes"), match_note: b.getString("match_note"), void_reason: b.getString("void_reason"), attachment: b.get("attachment") || [], collectionId: b.collection().id, payments: pays };
}

function cleanLines(lines) {
  if (!Array.isArray(lines) || !lines.length) bad("Add at least one line.");
  if (lines.length > 300) bad("At most 300 lines.");
  return lines.map((l, i) => {
    const qty = Number(l.qty === undefined || l.qty === "" ? 1 : l.qty), unit = Math.round(Number(l.unit_cents));
    if (!(qty > 0) || !(unit >= 0)) bad("Line " + (i + 1) + ": quantity and amount.");
    const desc = String(l.description || "").trim();
    if (!desc && !l.product) bad("Line " + (i + 1) + ": say what it is.");
    return { description: desc.substring(0, 200), product: String(l.product || ""), qty: Math.round(qty * 1000) / 1000, unit_cents: unit, total_cents: Math.round(qty * unit), category: String(l.category || "").substring(0, 60) };
  });
}
function cleanTaxes(taxes) {
  return (Array.isArray(taxes) ? taxes : []).filter((x) => Number(x.cents)).map((x) => ({ code: String(x.code || "").substring(0, 20), label: String(x.label || x.code || "Tax").substring(0, 40), cents: Math.round(Number(x.cents)) }));
}

// body: {kind, party, party_ref, po?, doc_date, due_date?, lines, taxes, notes}
function create(app, c, b, files) {
  const kind = PREFIX[b.kind] ? b.kind : "bill";
  const p = partyOf(app, b.party, kind);
  const day = ymdOk(b.doc_date) ? b.doc_date : st().today();
  const cur = p.getString("currency") || "CAD";
  const fx = P().fx(app, cur, day);
  if (!fx) bad("Enter an exchange rate for " + cur + " on or before " + day + " first.");
  if (b.party_ref && kind === "bill" && app.findRecordsByFilter("bills", "party = {:p} && party_ref = {:r} && kind = 'bill' && status != 'void'", "", 1, 0, { p: p.id, r: String(b.party_ref) }).length) {
    bad("Bill " + b.party_ref + " from " + p.getString("name") + " is already recorded.");
  }
  const lines = cleanLines(b.lines), taxes = cleanTaxes(b.taxes);
  const sub = lines.reduce((a, l) => a + l.total_cents, 0), tax = taxes.reduce((a, t) => a + t.cents, 0);
  const r = new Record(app.findCollectionByNameOrId("bills"));
  r.load({ kind: kind, party: p.id, party_ref: String(b.party_ref || "").substring(0, 60), status: "open", doc_date: day,
    due_date: ymdOk(b.due_date) ? b.due_date : addDays(day, p.getInt("payment_terms_days") || 0), currency: cur, fx_rate: fx.rate,
    lines: lines, taxes: taxes, subtotal_cents: sub, tax_cents: tax, total_cents: sub + tax, total_cad_cents: Math.round((sub + tax) * fx.rate), paid_cents: 0, notes: String(b.notes || "").substring(0, 2000) });
  r.set("number", PREFIX[kind] + "-" + ("000000" + require(`${__hooks}/lib/sales.js`).nextNumber(app, PREFIX[kind].toLowerCase(), c)).slice(-6));
  if (b.po) {
    let po = null;
    try { po = app.findRecordById("purchase_orders", b.po); } catch (_) { po = null; }
    if (!po || po.getString("vendor") !== p.id) bad("That order is not from this vendor.");
    r.set("po", po.id);
    // Three-way match: the bill against what was received on the order
    let got = 0;
    app.findRecordsByFilter("po_lines", "po = {:p} && deleted_at = ''", "", 0, 0, { p: po.id }).forEach((l) => { got += Math.round(l.getFloat("received_qty") * l.getInt("cost_cents")); });
    if (Math.abs(got - sub) > 1) r.set("match_note", "Bill " + (sub > got ? "above" : "below") + " what was received on " + po.getString("number") + " by " + ((Math.abs(sub - got)) / 100).toFixed(2) + " " + cur);
  }
  if (files && files.length) r.set("attachment", files.slice(0, 3));
  stamp(r, c); app.save(r);
  return r;
}

// A bill from a received order: its lines at the received quantities and costs
function fromPO(app, c, poId, b) {
  const po = app.findRecordById("purchase_orders", poId);
  const lines = app.findRecordsByFilter("po_lines", "po = {:p} && deleted_at = '' && received_qty > 0", "line_no", 0, 0, { p: po.id }).map((l) => {
    let n = "";
    try { n = app.findRecordById("products", l.getString("product")).getString("name"); } catch (_) { n = ""; }
    return { description: (l.getString("vendor_sku") ? l.getString("vendor_sku") + " " : "") + n, product: l.getString("product"), qty: l.getFloat("received_qty"), unit_cents: l.getInt("cost_cents") };
  });
  if (!lines.length) bad("Nothing has been received on " + po.getString("number") + " yet.");
  return create(app, c, { kind: "bill", party: po.getString("vendor"), po: po.id, party_ref: b.party_ref, doc_date: b.doc_date, lines: lines, taxes: b.taxes, notes: b.notes });
}

function list(app, q) {
  const parts = ["deleted_at = ''"], params = {};
  if (q.side === "payable") parts.push("(kind = 'bill' || kind = 'vendor_credit')");
  if (q.side === "receivable") parts.push("(kind = 'invoice' || kind = 'client_credit')");
  if (q.status === "open") parts.push("(status = 'open' || status = 'partial')");
  if (q.party) { parts.push("party = {:p}"); params.p = q.party; }
  const items = app.findRecordsByFilter("bills", parts.join(" && "), "due_date", 300, 0, params).map((b) => view(app, b));
  return { items: items, aging: aging(items.filter((x) => ["open", "partial"].indexOf(x.status) >= 0)) };
}

// Aging of open documents in CAD (credits count against): current, 1-30, 31-60, 61-90, over 90 days late
function aging(items) {
  const a = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 };
  items.forEach((x) => {
    const bal = Math.round(x.balance_cents * x.fx_rate) * (CREDIT.indexOf(x.kind) >= 0 ? -1 : 1);
    const k = x.overdue_days <= 0 ? "current" : x.overdue_days <= 30 ? "d30" : x.overdue_days <= 60 ? "d60" : x.overdue_days <= 90 ? "d90" : "over90";
    a[k] += bal; a.total += bal;
  });
  return a;
}

function refresh(app, b) {
  const paid = app.findRecordsByFilter("bill_payments", "bill = {:b} && voided = false", "", 0, 0, { b: b.id }).reduce((a, x) => a + x.getInt("amount_cents"), 0);
  b.set("paid_cents", paid);
  if (b.getString("status") !== "void") b.set("status", paid <= 0 ? "open" : paid + 0 >= b.getInt("total_cents") ? "paid" : "partial");
}

// {day, amount_cents, method, reference, credit_doc (method credit)}
function pay(app, c, id, x) {
  const b = app.findRecordById("bills", id);
  if (["open", "partial"].indexOf(b.getString("status")) < 0) bad("This document is " + b.getString("status") + ".");
  const amt = Math.round(Number(x.amount_cents));
  const left = b.getInt("total_cents") - b.getInt("paid_cents");
  if (!(amt > 0)) bad("Enter the amount.");
  if (amt > left) bad("More than what is left (" + (left / 100).toFixed(2) + ").");
  const method = String(x.method || "");
  const day = ymdOk(x.day) ? x.day : st().today();
  let creditDoc = "";
  if (method === "credit") {
    let cr = null;
    try { cr = app.findRecordById("bills", String(x.credit_doc || "")); } catch (_) { cr = null; }
    const want = b.getString("kind") === "bill" ? "vendor_credit" : "client_credit";
    if (!cr || cr.getString("kind") !== want || cr.getString("party") !== b.getString("party") || cr.getString("currency") !== b.getString("currency")) bad("Choose a credit of the same party and currency.");
    if (cr.getInt("total_cents") - cr.getInt("paid_cents") < amt) bad("The credit has only " + ((cr.getInt("total_cents") - cr.getInt("paid_cents")) / 100).toFixed(2) + " left.");
    // The credit is used up by the same amount
    const use = new Record(app.findCollectionByNameOrId("bill_payments"));
    use.load({ bill: cr.id, day: day, amount_cents: amt, cad_cents: Math.round(amt * cr.getFloat("fx_rate")), method: "credit", reference: "Applied to " + b.getString("number"), credit_doc: b.id, by_name: c.user ? c.user.getString("name") : "" });
    stamp(use, c); app.save(use);
    refresh(app, cr); stamp(cr, c); app.save(cr);
    creditDoc = cr.id;
  }
  const fx = P().fx(app, b.getString("currency"), day);
  const p = new Record(app.findCollectionByNameOrId("bill_payments"));
  p.load({ bill: b.id, day: day, amount_cents: amt, cad_cents: Math.round(amt * (fx ? fx.rate : b.getFloat("fx_rate"))), method: method, reference: String(x.reference || "").substring(0, 80), credit_doc: creditDoc,
    by_name: c.user ? c.user.getString("name") : "" });
  stamp(p, c); app.save(p);
  refresh(app, b); stamp(b, c); app.save(b);
  return b;
}

function voidDoc(app, c, id, reason) {
  const b = app.findRecordById("bills", id);
  if (b.getInt("paid_cents") > 0) bad("Payments are recorded on it; take them off first (void the payment).");
  if (!String(reason || "").trim()) bad("Say why it is void.");
  b.set("status", "void"); b.set("void_reason", String(reason).substring(0, 300));
  stamp(b, c); app.save(b);
  return b;
}

function voidPayment(app, c, payId) {
  const p = app.findRecordById("bill_payments", payId);
  if (p.getBool("voided")) bad("Already taken off.");
  p.set("voided", true); stamp(p, c); app.save(p);
  const b = app.findRecordById("bills", p.getString("bill"));
  refresh(app, b); stamp(b, c); app.save(b);
  // A credit applied: the credit gets its amount back
  if (p.getString("method") === "credit" && p.getString("credit_doc")) {
    app.findRecordsByFilter("bill_payments", "bill = {:c} && credit_doc = {:b} && voided = false", "", 1, 0, { c: p.getString("credit_doc"), b: b.id }).forEach((u) => {
      u.set("voided", true); stamp(u, c); app.save(u);
      const cr = app.findRecordById("bills", u.getString("bill")); refresh(app, cr); stamp(cr, c); app.save(cr);
    });
  }
  return b;
}

// Statement of account (FR-8.04): in the party's currency
function statement(app, partyId, q) {
  const p = app.findRecordById("parties", partyId);
  const to = ymdOk(q.to) ? q.to : st().today(), from = ymdOk(q.from) ? q.from : addDays(to, -90);
  const docs = app.findRecordsByFilter("bills", "party = {:p} && deleted_at = '' && status != 'void'", "doc_date", 0, 0, { p: p.id });
  const sign = (k) => (k === "bill" || k === "invoice" ? 1 : -1);
  let opening = 0;
  const rows = [];
  docs.forEach((d) => {
    const s = sign(d.getString("kind"));
    if (d.getString("doc_date") < from) opening += s * d.getInt("total_cents");
    else if (d.getString("doc_date") <= to) rows.push({ day: d.getString("doc_date"), what: d.getString("kind"), ref: d.getString("number") + (d.getString("party_ref") ? " / " + d.getString("party_ref") : ""), amount_cents: s * d.getInt("total_cents"), due: d.getString("due_date") });
    app.findRecordsByFilter("bill_payments", "bill = {:b} && voided = false && method != 'credit'", "day", 0, 0, { b: d.id }).forEach((x) => {
      const amt = -s * x.getInt("amount_cents");
      if (x.getString("day") < from) opening += amt;
      else if (x.getString("day") <= to) rows.push({ day: x.getString("day"), what: "payment", ref: x.getString("method") + (x.getString("reference") ? " " + x.getString("reference") : "") + " (" + d.getString("number") + ")", amount_cents: amt });
    });
  });
  rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let bal = opening;
  rows.forEach((r) => { bal += r.amount_cents; r.balance_cents = bal; });
  const open = docs.filter((d) => ["open", "partial"].indexOf(d.getString("status")) >= 0).map((d) => view(app, d));
  return { party: { id: p.id, name: p.getString("name"), kind: p.getString("kind"), currency: p.getString("currency"), street: p.getString("street"), city: p.getString("city"), province: p.getString("province"), postal_code: p.getString("postal_code") },
    from: from, to: to, opening_cents: opening, rows: rows, closing_cents: bal, aging: aging(open), open: open.map((x) => ({ number: x.number, doc_date: x.doc_date, due_date: x.due_date, balance_cents: x.balance_cents, overdue_days: x.overdue_days, kind: x.kind })) };
}

// ---- Vendor returns (FR-8.05) ------------------------------------------------------------------------------

function vrView(app, r) {
  let vname = "";
  try { vname = app.findRecordById("parties", r.getString("vendor")).getString("name"); } catch (_) { vname = ""; }
  return { id: r.id, number: r.getString("number"), vendor: r.getString("vendor"), vendor_name: vname, po: r.getString("po"), status: r.getString("status"), lines: j(r, "lines", []),
    reason: r.getString("reason"), rma: r.getString("rma"), credit: r.getString("credit"), value_cad_cents: r.getInt("value_cad_cents"), created_at: r.getString("created_at") };
}

// body: {vendor, po?, reason, rma, lines: [{product, selling_unit, qty, reason}]}: takes the stock out now
function vendorReturn(app, c, b) {
  const v = P().vendorOf(app, b.vendor);
  const lines = Array.isArray(b.lines) ? b.lines.filter((l) => Number(l.qty) > 0) : [];
  if (!lines.length) bad("Add what goes back.");
  const out = [];
  let value = 0;
  lines.forEach((l, i) => {
    const m = st().adjust(app, { product: l.product, selling_unit: l.selling_unit, qty: l.qty, type: "adjust", direction: "out", reason: "Returned to vendor",
      note: v.getString("name") + (b.rma ? " RMA " + b.rma : "") + (l.reason ? ": " + l.reason : "") }, { actor: c.actor, device: c.device, op: "" }, true);
    value += -m.getInt("value_cents");
    let pname = "";
    try { pname = app.findRecordById("products", l.product).getString("name"); } catch (_) { pname = ""; }
    out.push({ product: l.product, name: pname, selling_unit: m.getString("selling_unit"), qty: Number(l.qty), value_cents: -m.getInt("value_cents"), reason: String(l.reason || "").substring(0, 100), movement: m.id });
    void i;
  });
  const r = new Record(app.findCollectionByNameOrId("vendor_returns"));
  r.load({ vendor: v.id, po: b.po || "", status: "shipped", lines: out, reason: String(b.reason || "").substring(0, 200), rma: String(b.rma || "").substring(0, 60), value_cad_cents: value });
  r.set("number", "VR-" + ("000000" + require(`${__hooks}/lib/sales.js`).nextNumber(app, "vr", c)).slice(-6));
  stamp(r, c); app.save(r);
  return r;
}

// The vendor's credit for a return: a vendor credit document (in the vendor's currency) linked to it
function creditReturn(app, c, id, b) {
  const r = app.findRecordById("vendor_returns", id);
  if (r.getString("status") !== "shipped") bad("This return is " + r.getString("status") + ".");
  const amt = Math.round(Number(b.amount_cents));
  if (!(amt > 0)) bad("Enter the credit amount (in the vendor's currency).");
  const cr = create(app, c, { kind: "vendor_credit", party: r.getString("vendor"), party_ref: b.party_ref, doc_date: b.doc_date, po: r.getString("po") || undefined,
    lines: [{ description: "Credit for " + r.getString("number"), qty: 1, unit_cents: amt }], taxes: b.taxes, notes: b.notes });
  r.set("status", "credited"); r.set("credit", cr.id); stamp(r, c); app.save(r);
  return r;
}

// ---- Vendor performance (FR-8.06) --------------------------------------------------------------------------

function performance(app) {
  const vendors = app.findRecordsByFilter("parties", "(kind = 'vendor' || kind = 'both') && deleted_at = ''", "name", 0, 0);
  return { vendors: vendors.map((v) => {
    const pos = app.findRecordsByFilter("purchase_orders", "vendor = {:v} && (status = 'received' || status = 'closed')", "", 0, 0, { v: v.id });
    let onTime = 0, lines = 0, short = 0, received = 0;
    pos.forEach((po) => {
      if (po.getString("received_at") && po.getString("expected_date") && po.getString("received_at").substring(0, 10) <= po.getString("expected_date")) onTime++;
      app.findRecordsByFilter("po_lines", "po = {:p} && deleted_at = ''", "", 0, 0, { p: po.id }).forEach((l) => {
        lines++; received += l.getFloat("received_qty") * (l.getFloat("pack_qty") || 1);
        if (l.getFloat("received_qty") + 1e-9 < l.getFloat("qty")) short++;
      });
    });
    let damaged = 0;
    app.findRecordsByFilter("vendor_returns", "vendor = {:v} && status != 'cancelled'", "", 0, 0, { v: v.id }).forEach((r) => j(r, "lines", []).forEach((l) => {
      if (/damag|broken|leak|expired|spoil/i.test(l.reason || r.getString("reason"))) damaged += Number(l.qty) || 0;
    }));
    const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
    return { id: v.id, name: v.getString("name"), orders: pos.length, on_time_pct: pct(onTime, pos.length), short_pct: pct(short, lines), damage_pct: pct(damaged, received) };
  }).filter((x) => x.orders) };
}

module.exports = { view, list, create, fromPO, pay, voidDoc, voidPayment, statement, aging, vrView, vendorReturn, creditReturn, performance };

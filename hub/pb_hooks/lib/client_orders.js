// Layaway, special orders, quotes, house accounts (P3 step 7; FR-3.18-3.20, 6.10).
// Orders: a layaway keeps the goods (reserved stock, FR-6.10) until a date against a deposit (at least
// orders.layaway.min_deposit_pct); a special order is bought from a vendor for the client (a purchase order can
// be made) and reserved when it arrives (ready); a quote fixes prices until a date and becomes a layaway or
// special order, an invoice (clients with an account) or a sale. Deposits and refunds are taken at a till
// (cash in the drawer, card on the terminal): the till's summary counts them. At pickup the till rings the
// order up and applies the deposit as a payment ("deposit"); the sale marks the order picked up and releases
// what was reserved, in the same transaction. A client with a house account (a credit limit) can charge a sale
// to it ("house_account"): an invoice is made for the amount; statements come from the client's invoices.

const st = () => require(`${__hooks}/lib/stock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const PREFIX = { layaway: "LA", special_order: "SO", quote: "QT" };
const r3 = (x) => Math.round(x * 1000) / 1000;

function view(app, o) {
  let who = o.getString("name");
  if (o.getString("party")) { try { who = app.findRecordById("parties", o.getString("party")).getString("name"); } catch (_) { /* gone */ } }
  else if (o.getString("customer")) { try { who = app.findRecordById("customers", o.getString("customer")).getString("first_name"); } catch (_) { /* gone */ } }
  const pays = app.findRecordsByFilter("client_order_payments", "order = {:o}", "created_at", 0, 0, { o: o.id }).map((p) => ({ id: p.id, kind: p.getString("kind"), method: p.getString("method"),
    amount_cents: p.getInt("amount_cents"), by: p.getString("by_name"), at: p.getString("created_at") }));
  return { id: o.id, kind: o.getString("kind"), number: o.getString("number"), party: o.getString("party"), customer: o.getString("customer"), who: who, phone: o.getString("phone"),
    lines: j(o, "lines", []), total_cents: o.getInt("total_cents"), deposit_required_cents: o.getInt("deposit_required_cents"), paid_cents: o.getInt("paid_cents"),
    applied_cents: o.getInt("applied_cents"), deposit_left_cents: o.getInt("paid_cents") - o.getInt("applied_cents"), status: o.getString("status"), reserved: o.getBool("reserved"),
    due_date: o.getString("due_date"), po: o.getString("po"), sale: o.getString("sale"), converted_to: o.getString("converted_to"), notes: o.getString("notes"), created_at: o.getString("created_at"), payments: pays };
}

// Lines at today's price (or the price given, e.g. agreed on a quote)
function priceLines(app, lines) {
  if (!Array.isArray(lines) || !lines.length) bad("Add at least one item.");
  return lines.slice(0, 100).map((l, i) => {
    let p = null, u = null;
    try { p = app.findRecordById("products", l.product); } catch (_) { p = null; }
    if (!p || p.getString("deleted_at") || p.getString("status") === "archived") bad("Line " + (i + 1) + ": choose a product.");
    const units = require(`${__hooks}/lib/catalogue.js`).unitsOf(app, p.id);
    u = l.selling_unit ? units.find((x) => x.id === l.selling_unit) : (units.find((x) => x.getBool("is_default")) || units[0]);
    if (!u) bad("Line " + (i + 1) + ": that unit is not one of the product's units.");
    const qty = Number(l.qty);
    if (!(qty > 0)) bad("Line " + (i + 1) + ": a quantity above 0.");
    const price = l.price_cents === undefined || l.price_cents === null || l.price_cents === "" ? u.getInt("price_cents") : Math.round(Number(l.price_cents));
    if (!(price >= 0)) bad("Line " + (i + 1) + ": the price is not valid.");
    return { product: p.id, selling_unit: u.id, name: p.getString("name") + (u.getString("name") && u.getString("kind") !== "single" ? " · " + u.getString("name") : ""), qty: r3(qty),
      base: r3(qty * (u.getFloat("base_qty") || 1)), price_cents: price, regular_cents: u.getInt("price_cents"), total_cents: Math.round(price * qty) };
  });
}

function reserve(app, c, o, on) {
  if (o.getBool("reserved") === on) return;
  j(o, "lines", []).forEach((l) => {
    const lv = st().level(app, l.product, c);
    if (on) {
      const avail = lv.getFloat("on_hand") - lv.getFloat("reserved");
      if (avail + 1e-9 < l.base) bad("Only " + r3(Math.max(0, avail)) + " of '" + l.name + "' is free to keep aside.");
    }
    lv.set("reserved", Math.max(0, r3(lv.getFloat("reserved") + (on ? l.base : -l.base))));
    st().stamp(lv, c); app.save(lv);
  });
  o.set("reserved", on);
}

// body: {kind, party | customer | name+phone, lines: [{product, selling_unit, qty, price_cents?}], due_date, notes, deposit: {amount_cents, method, till}}
function create(app, c, b) {
  const kind = PREFIX[b.kind] ? b.kind : "layaway";
  if (!b.party && !b.customer && !String(b.name || "").trim()) bad("Who is it for? A client, a member, or a name and phone.");
  if (b.party) { let p = null; try { p = app.findRecordById("parties", b.party); } catch (_) { p = null; } if (!p || p.getString("kind") === "vendor") bad("Choose a client."); }
  if (b.customer) { try { app.findRecordById("customers", b.customer); } catch (_) { bad("Unknown member."); } }
  const lines = priceLines(app, b.lines);
  const total = lines.reduce((a, l) => a + l.total_cents, 0);
  const lay = Object.assign({ min_deposit_pct: 20, days: 30 }, setting(app, "orders.layaway", {}) || {});
  const o = new Record(app.findCollectionByNameOrId("client_orders"));
  o.load({ kind: kind, party: b.party || "", customer: b.customer || "", name: String(b.name || "").substring(0, 80), phone: String(b.phone || "").substring(0, 30), lines: lines, total_cents: total,
    deposit_required_cents: kind === "layaway" ? Math.round((total * lay.min_deposit_pct) / 100) : kind === "special_order" ? Math.round(Number(b.deposit_required_cents) || 0) : 0,
    paid_cents: 0, applied_cents: 0, status: "open", reserved: false, notes: String(b.notes || "").substring(0, 1000),
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || "") ? b.due_date : kind === "layaway" ? st().today(lay.days) : kind === "quote" ? st().today(Number(setting(app, "orders.quote_days", 14)) || 14) : "" });
  o.set("number", PREFIX[kind] + "-" + ("000000" + require(`${__hooks}/lib/sales.js`).nextNumber(app, PREFIX[kind].toLowerCase(), c)).slice(-6));
  stamp(o, c); app.save(o);
  if (kind === "layaway") {
    const dep = b.deposit || {};
    if ((Number(dep.amount_cents) || 0) < o.getInt("deposit_required_cents")) bad("A layaway needs a deposit of at least " + (o.getInt("deposit_required_cents") / 100).toFixed(2) + ".");
    reserve(app, c, o, true);
    stamp(o, c); app.save(o);
  }
  if (b.deposit && Number(b.deposit.amount_cents) > 0) money(app, c, o, "deposit", b.deposit);
  return o;
}

// A deposit or a refund at a till: {amount_cents, method: cash|card, till}
function money(app, c, o, kind, x) {
  const amt = Math.round(Number(x.amount_cents));
  if (!(amt > 0)) bad("Enter the amount.");
  const method = x.method === "card" ? "card" : "cash";
  let till = null;
  try { till = app.findRecordById("tills", String(x.till || "")); } catch (_) { till = null; }
  if (!till || till.getString("status") !== "open") bad("Open the till first: the money goes in (or out of) it.");
  if (kind === "refund" && amt > o.getInt("paid_cents") - o.getInt("applied_cents")) bad("Only " + ((o.getInt("paid_cents") - o.getInt("applied_cents")) / 100).toFixed(2) + " of the deposit is left.");
  if (kind === "deposit" && o.getInt("paid_cents") + amt > o.getInt("total_cents") * 2) bad("That is more than the order.");
  const p = new Record(app.findCollectionByNameOrId("client_order_payments"));
  p.load({ order: o.id, kind: kind, method: method, amount_cents: amt, till: till.id, by_name: c.user ? c.user.getString("name") : "" });
  stamp(p, c); app.save(p);
  o.set("paid_cents", o.getInt("paid_cents") + (kind === "deposit" ? amt : -amt));
  stamp(o, c); app.save(o);
  return p;
}

// pay {amount_cents, method, till} | refund {...} | ordered {po} | ready | cancel {refund: {method, till}} | convert {to: layaway|special_order|invoice}
function act(app, c, id, action, b) {
  const o = app.findRecordById("client_orders", id);
  const s = o.getString("status"), kind = o.getString("kind");
  const live = ["open", "ordered", "ready"].indexOf(s) >= 0;
  if (action === "pay" || action === "refund") {
    if (!live) bad("This order is " + s + ".");
    money(app, c, o, action === "pay" ? "deposit" : "refund", b);
  } else if (action === "ordered") {
    if (kind !== "special_order" || s !== "open") bad("Only an open special order is marked ordered.");
    o.set("status", "ordered"); o.set("po", String(b.po || ""));
  } else if (action === "ready") {
    if (kind === "quote" || !live || s === "ready") bad("This order cannot be made ready.");
    if (kind === "special_order") reserve(app, c, o, true);
    o.set("status", "ready");
  } else if (action === "cancel") {
    if (!live) bad("This order is " + s + ".");
    const left = o.getInt("paid_cents") - o.getInt("applied_cents");
    if (left > 0) {
      if (!b.refund) bad("Give back the deposit (" + (left / 100).toFixed(2) + ") or keep it: choose how.");
      if (b.refund.keep) { if (!c.can("sales.approve")) throw new ForbiddenError("A manager decides to keep a deposit."); }
      else money(app, c, o, "refund", Object.assign({ amount_cents: left }, b.refund));
    }
    reserve(app, c, o, false);
    o.set("status", "cancelled");
  } else if (action === "convert") {
    if (kind !== "quote" || s !== "open") bad("Only an open quote is turned into something else.");
    if (b.to === "invoice") {
      if (!o.getString("party")) bad("An invoice needs a client with an account.");
      const inv = require(`${__hooks}/lib/bills.js`).create(app, c, { kind: "invoice", party: o.getString("party"), party_ref: o.getString("number"),
        lines: j(o, "lines", []).map((l) => ({ description: l.name, product: l.product, qty: l.qty, unit_cents: l.price_cents })), taxes: b.taxes, notes: "From quote " + o.getString("number") });
      o.set("converted_to", "invoice:" + inv.id);
    } else if (b.to === "layaway" || b.to === "special_order") {
      const n = create(app, c, { kind: b.to, party: o.getString("party"), customer: o.getString("customer"), name: o.getString("name"), phone: o.getString("phone"),
        lines: j(o, "lines", []).map((l) => ({ product: l.product, selling_unit: l.selling_unit, qty: l.qty, price_cents: l.price_cents })), notes: "From quote " + o.getString("number"), deposit: b.deposit });
      o.set("converted_to", "order:" + n.id);
    } else bad("Turn it into a layaway, a special order or an invoice (or ring it up at the till).");
    o.set("status", "converted");
  } else throw new NotFoundError("Unknown action.");
  stamp(o, c); app.save(o);
  return o;
}

// Expired: layaways past their date stay (a person decides); quotes past their date expire (job)
function expireQuotes(app) {
  app.findRecordsByFilter("client_orders", "kind = 'quote' && status = 'open' && due_date != '' && due_date < {:d}", "", 0, 0, { d: st().today() }).forEach((o) => {
    o.set("status", "expired"); o.set("updated_by", "system:orders"); o.set("@actor", "system:orders"); app.save(o);
  });
}

function list(app, q) {
  const parts = ["deleted_at = ''"], params = {};
  if (q.kind) { parts.push("kind = {:k}"); params.k = q.kind; }
  if (q.open) parts.push("(status = 'open' || status = 'ordered' || status = 'ready')");
  return { items: app.findRecordsByFilter("client_orders", parts.join(" && "), "-created_at", 300, 0, params).map((o) => view(app, o)) };
}

// What the till rings up for an order or a quote: its lines at the agreed prices (a different price than
// today's is an override with the order as its reason) and the deposit to apply.
function toTill(app, id) {
  const o = app.findRecordById("client_orders", id);
  const s = o.getString("status");
  if (["open", "ready"].indexOf(s) < 0 || (o.getString("kind") === "special_order" && s !== "ready")) bad(o.getString("kind") === "special_order" ? "The special order has not arrived yet (mark it ready)." : "This order is " + s + ".");
  return { order: view(app, o), lines: j(o, "lines", []).map((l) => {
    const now = (() => { try { return app.findRecordById("selling_units", l.selling_unit).getInt("price_cents"); } catch (_) { return l.price_cents; } })();
    return { product: l.product, selling_unit: l.selling_unit, name: l.name, qty: l.qty, price_cents: now !== l.price_cents ? l.price_cents : undefined, override_reason: now !== l.price_cents ? "Price agreed on " + o.getString("number") : undefined };
  }), deposit_cents: o.getInt("paid_cents") - o.getInt("applied_cents") };
}

// ---- Payments of a sale (called by lib/sales.js inside the sale's transaction) ----------------------------

function useDeposit(app, rec, amt, relaxed, o) {
  let ord = null;
  try { ord = app.findRecordById("client_orders", rec.reference); } catch (_) { ord = null; }
  if (!ord) { if (relaxed) return; bad("Deposit: unknown order."); }
  const left = ord.getInt("paid_cents") - ord.getInt("applied_cents");
  if (!relaxed && amt > left) bad("The deposit on " + ord.getString("number") + " is " + (left / 100).toFixed(2) + ".");
  rec.processor = ord.getString("number");
  ord.set("applied_cents", ord.getInt("applied_cents") + amt);
  const c = o.ctx || { actor: "system:sales", device: "" };
  if (ord.getBool("reserved")) reserve(app, c, ord, false);
  ord.set("status", "picked_up"); ord.set("sale", o.sale_id || "");
  stamp(ord, c); app.save(ord);
}

function balance(app, partyId) {
  return app.findRecordsByFilter("bills", "party = {:p} && (kind = 'invoice' || kind = 'client_credit') && (status = 'open' || status = 'partial')", "", 0, 0, { p: partyId })
    .reduce((a, b) => a + (b.getString("kind") === "invoice" ? 1 : -1) * (b.getInt("total_cents") - b.getInt("paid_cents")), 0);
}

function chargeAccount(app, rec, amt, relaxed, o) {
  let p = null;
  try { p = app.findRecordById("parties", rec.reference); } catch (_) { p = null; }
  if (!p || p.getString("kind") === "vendor") { if (relaxed) return; bad("House account: choose a client."); }
  const limit = p.getInt("credit_limit_cents");
  if (!relaxed) {
    if (!limit) bad(p.getString("name") + " has no house account (no credit limit).");
    if ((p.getString("currency") || "CAD") !== "CAD") bad("House accounts are in CAD.");
    const owed = balance(app, p.id);
    if (owed + amt > limit) bad(p.getString("name") + " would owe " + ((owed + amt) / 100).toFixed(2) + ", over the limit of " + (limit / 100).toFixed(2) + ".");
  }
  const c = o.ctx || { actor: "system:sales", device: "" };
  const inv = require(`${__hooks}/lib/bills.js`).create(app, c, { kind: "invoice", party: p.id, party_ref: o.number || "",
    lines: [{ description: "Purchases " + (o.number || "at the till"), qty: 1, unit_cents: amt }], notes: "Charged to the house account at the till" });
  rec.processor = inv.getString("number");
}

// House accounts: clients with a credit limit, what they owe
function accounts(app) {
  return { items: app.findRecordsByFilter("parties", "kind != 'vendor' && credit_limit_cents > 0 && deleted_at = ''", "name", 0, 0)
    .map((p) => ({ id: p.id, name: p.getString("name"), credit_limit_cents: p.getInt("credit_limit_cents"), owed_cents: balance(app, p.id) })) };
}

// Till summary: deposits and refunds taken at a till, by method
function tillMoney(app, tillId) {
  const o = { cash_in: 0, cash_out: 0, card_in: 0, card_out: 0 };
  app.findRecordsByFilter("client_order_payments", "till = {:t}", "", 0, 0, { t: tillId }).forEach((p) => {
    const k = p.getString("method") + "_" + (p.getString("kind") === "deposit" ? "in" : "out");
    o[k] += p.getInt("amount_cents");
  });
  return o;
}

module.exports = { view, create, act, list, toTill, useDeposit, chargeAccount, accounts, expireQuotes, tillMoney, priceLines };

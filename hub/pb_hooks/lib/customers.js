// Customers and loyalty (P2 step 3): FR-7.01-7.06, 7.08, 4.12, BR-24. Customers are identified, never
// contacted (DL-16). Points live on the customer; every change is a loyalty_ledger row with the balance after.
// program():      the loyalty programme (null when off: module off, or not set by the owner).
// find()/join():  at the till: by phone or card; join with a first name, phone and/or card, "customer agreed".
// cards:          numbers made by Chedam (13 digits, 29 + serial + check digit), printed with label layouts;
//                 a card is linked to a customer; a lost card is blocked (the points stay with the customer).
// saleLoyalty():  earn and redeem on a sale (lib/sales.js); returned items take points back (FR-4.12).
// dataOf()/erase(): BC PIPA access and deletion on request (personal values are never in the audit log).

const st = () => require(`${__hooks}/lib/stock.js`);
const core = () => require(`${__hooks}/lib/pricing_core.js`);
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function bad(msg) { throw new BadRequestError(msg); }

function moduleOn(app) { return require(`${__hooks}/lib/catalogue.js`).moduleOn(app, "customers_loyalty"); }

function program(app) {
  if (!moduleOn(app)) return null;
  const p = setting(app, "loyalty.program", {}) || {};
  if (!p.enabled) return null;
  return { points_per_dollar: Number(p.points_per_dollar) || 0, points_per_dollar_off: Number(p.points_per_dollar_off) || 0,
    min_redeem: Number(p.min_redeem) || 0, earn_on_promotions: p.earn_on_promotions !== false,
    exclude_categories: Array.isArray(p.exclude_categories) ? p.exclude_categories : [], expiry_months: Number(p.expiry_months) || 0 };
}

// Phone numbers as digits; a leading 1 of an 11-digit North American number is dropped.
function normPhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 11 && d.charAt(0) === "1") d = d.substring(1);
  return d;
}
function salt(app) { try { return app.findRecordsByFilter("business", "id != ''", "", 1, 0)[0].id; } catch (_) { return "chedam"; } }
function phoneHash(app, phone) { return phone ? $security.sha256(salt(app) + ":" + phone) : ""; }

const masked = (p) => (p ? "•••-•••-" + p.substring(p.length - 4) : "");

function view(c, full) {
  const v = { id: c.id, first_name: c.getString("first_name"), phone: masked(c.getString("phone")), card: c.getString("card"),
    points: c.getInt("points"), visits: c.getInt("visits"), spent_cents: c.getInt("spent_cents"), last_visit_at: c.getString("last_visit_at"),
    status: c.getString("status"), created_at: c.getString("created_at") };
  if (full) { v.phone_full = c.getString("phone"); v.notes = c.getString("notes"); v.agreed_at = c.getString("agreed_at"); }
  return v;
}

function get(app, id) {
  let c;
  try { c = app.findRecordById("customers", String(id || "")); } catch (_) { bad("Unknown customer."); }
  if (c.getString("status") !== "active") bad("This customer's details were deleted on request.");
  return c;
}

// q: a phone number, a card number, or (people who manage customers) part of a first name.
function find(app, q, mayBrowse) {
  const t = String(q || "").trim();
  if (!t) return [];
  const card = app.findRecordsByFilter("loyalty_cards", "number = {:n}", "", 1, 0, { n: t.replace(/\s/g, "") })[0];
  if (card) {
    if (card.getString("status") === "blocked") bad("This card was reported lost and is blocked.");
    if (!card.getString("customer")) return [{ new_card: card.getString("number") }];
    try { const c = app.findRecordById("customers", card.getString("customer")); if (c.getString("status") === "active") return [view(c, false)]; } catch (_) { /* gone */ }
    return [];
  }
  const ph = normPhone(t);
  if (ph.length >= 7 && /^[\d\s()+.-]+$/.test(t)) {
    return app.findRecordsByFilter("customers", "phone = {:p} && status = 'active'", "", 5, 0, { p: ph }).map((c) => view(c, false));
  }
  if (mayBrowse && t.length >= 2) {
    return app.findRecordsByFilter("customers", "first_name ~ {:q} && status = 'active'", "first_name", 30, 0, { q: t }).map((c) => view(c, false));
  }
  return [];
}

function useCard(app, number, customer, ctx) {
  const card = app.findRecordsByFilter("loyalty_cards", "number = {:n}", "", 1, 0, { n: String(number).replace(/\s/g, "") })[0];
  if (!card) bad("Unknown card " + number + ". Use a card printed from Chedam.");
  if (card.getString("status") === "blocked") bad("This card is blocked.");
  if (card.getString("customer") && card.getString("customer") !== customer.id) bad("This card belongs to another customer.");
  // The customer's previous card is blocked (one card in use)
  const old = customer.getString("card");
  if (old && old !== card.getString("number")) {
    app.findRecordsByFilter("loyalty_cards", "number = {:n}", "", 1, 0, { n: old }).forEach((o) => { o.set("status", "blocked"); st().stamp(o, ctx); app.save(o); });
  }
  card.set("customer", customer.id); card.set("status", "active");
  st().stamp(card, ctx);
  app.save(card);
  customer.set("card", card.getString("number"));
}

// body: {first_name, phone, card, agreed}
function join(app, body, ctx) {
  if (!moduleOn(app)) bad("Customers and Loyalty is switched off.");
  const name = String(body.first_name || "").trim().substring(0, 60);
  if (!name) bad("Enter the customer's first name.");
  if (body.agreed !== true) bad("Ask the customer and tick 'customer agreed' first.");
  const phone = normPhone(body.phone);
  if (phone && (phone.length < 7 || phone.length > 15)) bad("The phone number is not valid.");
  if (!phone && !body.card) bad("Enter a phone number or scan a loyalty card.");
  if (phone && app.findRecordsByFilter("customers", "phone = {:p} && status = 'active'", "", 1, 0, { p: phone }).length) bad("A customer with this phone number is already a member.");
  const c = new Record(app.findCollectionByNameOrId("customers"));
  c.load({ first_name: name, phone: phone, phone_hash: phoneHash(app, phone), card: "", points: 0, agreed: true, agreed_at: new DateTime(),
    status: "active", visits: 0, spent_cents: 0 });
  st().stamp(c, ctx);
  app.save(c);
  if (body.card) { useCard(app, body.card, c, ctx); st().stamp(c, ctx); app.save(c); }
  return c;
}

// body: {first_name, phone, notes, card}
function update(app, id, body, ctx) {
  const c = get(app, id);
  if (body.first_name !== undefined) { const n = String(body.first_name).trim().substring(0, 60); if (!n) bad("Enter the first name."); c.set("first_name", n); }
  if (body.phone !== undefined) {
    const phone = normPhone(body.phone);
    if (phone && (phone.length < 7 || phone.length > 15)) bad("The phone number is not valid.");
    if (phone && app.findRecordsByFilter("customers", "phone = {:p} && status = 'active' && id != {:id}", "", 1, 0, { p: phone, id: c.id }).length) bad("Another customer has this phone number.");
    c.set("phone", phone); c.set("phone_hash", phoneHash(app, phone));
  }
  if (body.notes !== undefined) c.set("notes", String(body.notes).substring(0, 500));
  if (body.card) useCard(app, body.card, c, ctx);
  st().stamp(c, ctx);
  app.save(c);
  return c;
}

function ledger(app, c, type, points, extra, ctx) {
  const balance = c.getInt("points") + points;
  c.set("points", balance);
  const r = new Record(app.findCollectionByNameOrId("loyalty_ledger"));
  r.load(Object.assign({ customer: c.id, type: type, points: points, balance_after: balance }, extra || {}));
  st().stamp(r, ctx);
  app.save(r);
  return balance;
}

// A manager adds or takes off points with a reason (e.g. a goodwill gesture, a mistake).
function adjust(app, id, body, ctx) {
  const c = get(app, id);
  const pts = Math.trunc(Number(body.points) || 0);
  const note = String(body.note || "").trim().substring(0, 200);
  if (!pts) bad("Enter the points to add (or take off, with a minus).");
  if (!note) bad("Give a reason.");
  if (c.getInt("points") + pts < 0) bad("The balance would go below 0.");
  ledger(app, c, "adjust", pts, { note: note }, ctx);
  st().stamp(c, ctx);
  app.save(c);
  return c;
}

// Two records for one person: the points (and card) move to the other customer; the first is deleted.
function move(app, fromId, toId, ctx) {
  const from = get(app, fromId), to = get(app, toId);
  if (from.id === to.id) bad("Choose two different customers.");
  const pts = from.getInt("points");
  if (pts) { ledger(app, from, "move_out", -pts, { note: "To " + to.id }, ctx); ledger(app, to, "move_in", pts, { note: "From " + from.id }, ctx); }
  to.set("visits", to.getInt("visits") + from.getInt("visits"));
  to.set("spent_cents", to.getInt("spent_cents") + from.getInt("spent_cents"));
  st().stamp(to, ctx); app.save(to);
  erase(app, from.id, ctx, from);
  return to;
}

// FR-7.05: a card reported lost: blocked; the points stay with the customer, ready for a new card.
function blockCard(app, number, ctx) {
  const card = app.findRecordsByFilter("loyalty_cards", "number = {:n}", "", 1, 0, { n: String(number || "").trim() })[0];
  if (!card) bad("Unknown card.");
  card.set("status", "blocked");
  st().stamp(card, ctx);
  app.save(card);
  if (card.getString("customer")) {
    try {
      const c = app.findRecordById("customers", card.getString("customer"));
      if (c.getString("card") === card.getString("number")) { c.set("card", ""); st().stamp(c, ctx); app.save(c); }
    } catch (_) { /* gone */ }
  }
  return card;
}

function checkDigit(body) { let s = 0; for (let i = 0; i < body.length; i++) s += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1); return String((10 - (s % 10)) % 10); }

// FR-7.05: n new card numbers (13 digits: 29, a 10-digit serial, check digit), ready to print.
function generateCards(app, n, ctx) {
  const count = Math.floor(Number(n) || 0);
  if (!(count >= 1 && count <= 500)) bad("1 to 500 cards at a time.");
  const r = app.findFirstRecordByData("settings", "key", "loyalty.next_card");
  let next = Number(JSON.parse(r.getString("value") || "1")) || 1;
  const batch = st().today().replace(/-/g, "") + "-" + next;
  const out = [];
  for (let i = 0; i < count; i++, next++) {
    const body = "29" + ("0000000000" + next).slice(-10);
    const number = body + checkDigit(body);
    const c = new Record(app.findCollectionByNameOrId("loyalty_cards"));
    c.load({ number: number, status: "new", batch: batch });
    st().stamp(c, ctx);
    app.save(c);
    out.push(number);
  }
  r.set("value", next); r.set("updated_by", ctx.actor); r.set("@actor", ctx.actor);
  app.save(r);
  return { batch: batch, numbers: out };
}

// FR-7.08 (BC PIPA): everything Chedam holds about a customer, for them to see.
function dataOf(app, id) {
  let c;
  try { c = app.findRecordById("customers", id); } catch (_) { bad("Unknown customer."); }
  const sales = app.findRecordsByFilter("sales", "customer = {:c}", "-completed_at", 0, 0, { c: id }).map((s) => ({ number: s.getString("number"), date: s.getString("completed_at"),
    total_cents: s.getInt("total_cents"), points_earned: s.getInt("loyalty_earned"), points_redeemed: s.getInt("loyalty_redeemed"), status: s.getString("status") }));
  const moves = app.findRecordsByFilter("loyalty_ledger", "customer = {:c}", "created_at", 0, 0, { c: id }).map((l) => ({ date: l.getString("created_at"), type: l.getString("type"),
    points: l.getInt("points"), balance_after: l.getInt("balance_after"), note: l.getString("note") }));
  const cards = app.findRecordsByFilter("loyalty_cards", "customer = {:c}", "", 0, 0, { c: id }).map((x) => ({ number: x.getString("number"), status: x.getString("status") }));
  return { customer: view(c, true), cards: cards, purchases: sales, points: moves, made_at: new Date().toISOString(),
    note: "Chedam keeps a first name, phone number, loyalty card, notes, purchases and points. It never contacts customers." };
}

// FR-7.08 (BC PIPA): deleted on request. Name, phone and notes are removed; cards are blocked; the points
// are gone. Sales keep their numbers (6-year records) without the person's details.
function erase(app, id, ctx, rec) {
  const c = rec || get(app, id);
  if (c.getInt("points") > 0) ledger(app, c, "adjust", -c.getInt("points"), { note: "Deleted on request" }, ctx);
  app.findRecordsByFilter("loyalty_cards", "customer = {:c}", "", 0, 0, { c: c.id }).forEach((x) => { x.set("status", "blocked"); st().stamp(x, ctx); app.save(x); });
  c.load({ first_name: "Deleted customer", phone: "", phone_hash: "", notes: "", card: "", status: "erased" });
  st().stamp(c, ctx);
  app.save(c);
  return c;
}

// ---- On a sale (BR-24, FR-7.04) -----------------------------------------------------------------

// input: {customer, redeem_points}; maxCents: what the sale costs before tax after other discounts.
// Returns {customer, prog, redeem: {points, cents}, problems} (no change saved yet).
function prepare(app, input, maxCents, training) {
  if (!input.customer) return null;
  const prog = program(app);
  let c;
  try { c = app.findRecordById("customers", String(input.customer)); } catch (_) { bad("Unknown customer."); }
  if (c.getString("status") !== "active") bad("This customer's details were deleted on request.");
  const out = { c: c, prog: prog, redeem: { points: 0, cents: 0 }, problems: [] };
  if (!prog || training) return out;
  if (input.redeem_points) {
    const r = core().loyaltyRedeem(input.redeem_points, c.getInt("points"), maxCents, prog);
    if (r.error) out.problems.push({ type: "loyalty", message: r.error });
    else out.redeem = r;
  }
  return out;
}

// Points earned on the priced lines: after discounts (and the redemption), before tax; not on excluded
// categories, not on items with a deal unless the programme says so.
function earned(prog, lines, mode) {
  if (!prog) return 0;
  const base = lines.reduce((a, l) => {
    if (prog.exclude_categories.indexOf(l.category) >= 0) return a;
    if (!prog.earn_on_promotions && l.promo_cents > 0) return a;
    const tax = mode === "tax_included" ? (l.taxes || []).reduce((x, t) => x + (t.tax_cents || 0), 0) : 0;
    return a + Math.max(0, l.net_cents - tax);
  }, 0);
  return core().loyaltyEarn(base, prog);
}

// After the sale is saved: the ledger and the customer's totals. offline: the till's figures are kept
// even when the balance no longer covers a redemption (the customer has gone): a task says so (FR-7.06).
function settle(app, c, sale, earn, redeem, ctx, offline) {
  let balance = c.getInt("points");
  if (redeem.points) {
    if (offline && redeem.points > balance) {
      const t = new Record(app.findCollectionByNameOrId("tasks"));
      t.load({ title: "Loyalty points used twice? Offline sale " + sale.getString("number") + " used " + redeem.points + " points; the customer had " + balance + ".",
        kind: "loyalty", source: "rule", rule_key: "loyalty:double:" + sale.id, status: "open", priority: "normal", link_collection: "customers", link_id: c.id });
      st().stamp(t, ctx);
      app.save(t);
    }
    balance = ledger(app, c, "redeem", -redeem.points, { sale: sale.id, note: sale.getString("number") }, ctx);
  }
  if (earn) balance = ledger(app, c, "earn", earn, { sale: sale.id, note: sale.getString("number") }, ctx);
  c.set("visits", c.getInt("visits") + 1);
  c.set("spent_cents", c.getInt("spent_cents") + sale.getInt("total_cents"));
  c.set("last_visit_at", new DateTime());
  st().stamp(c, ctx);
  app.save(c);
  return balance;
}

// FR-4.12: returned items take back their share of the points earned and give back their share of the
// points redeemed (by net value returned / net value sold).
function onReturn(app, saleRec, ret, returnedNet, ctx) {
  const cid = saleRec.getString("customer");
  if (!cid) return;
  let c;
  try { c = app.findRecordById("customers", cid); } catch (_) { return; }
  if (c.getString("status") !== "active") return;
  const soldNet = app.findRecordsByFilter("sale_lines", "sale = {:s} && voided = false", "", 0, 0, { s: saleRec.id }).reduce((a, l) => a + l.getInt("net_cents"), 0);
  if (!soldNet) return;
  const ratio = Math.min(1, returnedNet / soldNet);
  const before = app.findRecordsByFilter("returns", "sale = {:s} && id != {:r}", "", 0, 0, { s: saleRec.id, r: ret.id });
  const doneRev = before.reduce((a, r) => a + r.getInt("loyalty_reversed"), 0), doneRet = before.reduce((a, r) => a + r.getInt("loyalty_returned"), 0);
  const rev = Math.min(saleRec.getInt("loyalty_earned") - doneRev, Math.round(saleRec.getInt("loyalty_earned") * ratio));
  const back = Math.min(saleRec.getInt("loyalty_redeemed") - doneRet, Math.round(saleRec.getInt("loyalty_redeemed") * ratio));
  if (rev > 0) ledger(app, c, "reverse_earn", -rev, { sale: saleRec.id, return_id: ret.id, note: ret.getString("number") }, ctx);
  if (back > 0) ledger(app, c, "return_redeem", back, { sale: saleRec.id, return_id: ret.id, note: ret.getString("number") }, ctx);
  if (rev > 0 || back > 0) {
    st().stamp(c, ctx); app.save(c);
    ret.set("loyalty_reversed", Math.max(0, rev)); ret.set("loyalty_returned", Math.max(0, back));
    st().stamp(ret, ctx); app.save(ret);
  }
}

// For the till's offline pack (FR-7.06): first names, card numbers and balances, phone numbers only as
// salted hashes, so a till can find a member by phone without holding phone numbers.
function offlineList(app) {
  if (!program(app)) return null;
  return { salt: salt(app), customers: app.findRecordsByFilter("customers", "status = 'active'", "", 5000, 0).map((c) => ({ id: c.id, first_name: c.getString("first_name"),
    phone_hash: c.getString("phone_hash"), card: c.getString("card"), points: c.getInt("points") })) };
}

// One transaction for a request; returns what fn returned.
function inTx(e, fn) { let out = null; e.app.runInTransaction((t) => { out = fn(t); }); return out; }

module.exports = { inTx, program, normPhone, phoneHash, view, get, find, join, update, adjust, move, blockCard, generateCards, dataOf, erase, prepare, earned, settle, onReturn, offlineList };

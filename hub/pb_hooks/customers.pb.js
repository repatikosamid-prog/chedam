/// <reference path="../pb_data/types.d.ts" />
// Customers and loyalty (P2 step 3). Logic: lib/customers.js (points on sales: lib/sales.js, returns: lib/returns.js).
// (Each handler runs in its own JS engine: helpers are required inside the handlers.)

// Find at the till: ?q= phone or card; people with customers.manage may also search first names.
routerAdd("GET", "/api/chedam/customers/find", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "customers.view");
  return e.json(200, { results: require(`${__hooks}/lib/customers.js`).find(e.app, e.request.url.query().get("q"), c.can("customers.manage")), program: require(`${__hooks}/lib/customers.js`).program(e.app) });
});

// Join (FR-7.02): {first_name, phone, card, agreed: true}
routerAdd("POST", "/api/chedam/customers", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "customers.view");
  return e.json(200, require(`${__hooks}/lib/customers.js`).inTx(e, (t) => require(`${__hooks}/lib/customers.js`).view(require(`${__hooks}/lib/customers.js`).join(t, c.body, c), false)));
});

// A customer with points history and purchases (managers see the phone number in full).
routerAdd("GET", "/api/chedam/customers/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "customers.view");
  const id = e.request.pathValue("id");
  const cu = require(`${__hooks}/lib/customers.js`).get(e.app, id);
  const out = require(`${__hooks}/lib/customers.js`).view(cu, c.can("customers.manage"));
  out.ledger = e.app.findRecordsByFilter("loyalty_ledger", "customer = {:c}", "-created_at", 30, 0, { c: id }).map((l) => ({ at: l.getString("created_at"), type: l.getString("type"),
    points: l.getInt("points"), balance_after: l.getInt("balance_after"), note: l.getString("note") }));
  out.sales = e.app.findRecordsByFilter("sales", "customer = {:c}", "-completed_at", 20, 0, { c: id }).map((s) => ({ id: s.id, number: s.getString("number"),
    at: s.getString("completed_at"), total_cents: s.getInt("total_cents"), earned: s.getInt("loyalty_earned"), redeemed: s.getInt("loyalty_redeemed") }));
  return e.json(200, out);
});

// Edit (managers): {first_name, phone, notes, card}; a card can also be linked at the till (customers.view).
routerAdd("POST", "/api/chedam/customers/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "customers.view");
  const body = c.can("customers.manage") ? c.body : { card: c.body.card };
  return e.json(200, require(`${__hooks}/lib/customers.js`).inTx(e, (t) => require(`${__hooks}/lib/customers.js`).view(require(`${__hooks}/lib/customers.js`).update(t, e.request.pathValue("id"), body, c), c.can("customers.manage"))));
});

routerAdd("POST", "/api/chedam/customers/{id}/adjust", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "customers.manage");
  return e.json(200, require(`${__hooks}/lib/customers.js`).inTx(e, (t) => require(`${__hooks}/lib/customers.js`).view(require(`${__hooks}/lib/customers.js`).adjust(t, e.request.pathValue("id"), c.body, c), true)));
});

// Two records of one person: {into: customer id}
routerAdd("POST", "/api/chedam/customers/{id}/move", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "customers.manage");
  return e.json(200, require(`${__hooks}/lib/customers.js`).inTx(e, (t) => require(`${__hooks}/lib/customers.js`).view(require(`${__hooks}/lib/customers.js`).move(t, e.request.pathValue("id"), String(c.body.into || ""), c), true)));
});

// BC PIPA (FR-7.08): what Chedam holds about the customer; deletion on request.
routerAdd("GET", "/api/chedam/customers/{id}/data", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "customers.manage");
  return e.json(200, require(`${__hooks}/lib/customers.js`).dataOf(e.app, e.request.pathValue("id")));
});
routerAdd("POST", "/api/chedam/customers/{id}/erase", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "customers.manage");
  if (c.body.confirm !== true) throw new BadRequestError("Confirm the deletion.");
  return e.json(200, require(`${__hooks}/lib/customers.js`).inTx(e, (t) => require(`${__hooks}/lib/customers.js`).view(require(`${__hooks}/lib/customers.js`).erase(t, e.request.pathValue("id"), c), true)));
});

// Cards (FR-7.05): make new numbers to print; block a lost card.
routerAdd("POST", "/api/chedam/loyalty/cards", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "customers.manage");
  return e.json(200, require(`${__hooks}/lib/customers.js`).inTx(e, (t) => require(`${__hooks}/lib/customers.js`).generateCards(t, c.body.count, c)));
});
routerAdd("POST", "/api/chedam/loyalty/cards/block", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "customers.view");
  const card = require(`${__hooks}/lib/customers.js`).inTx(e, (t) => require(`${__hooks}/lib/customers.js`).blockCard(t, c.body.number, c));
  return e.json(200, { number: card.getString("number"), status: card.getString("status") });
});

// The programme (FR-7.03): set by the owner (loyalty.manage). Reading it: anyone serving customers.
routerAdd("GET", "/api/chedam/loyalty/program", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "customers.view");
  return e.json(200, { program: require(`${__hooks}/lib/auth.js`).setting(e.app, "loyalty.program", {}), active: require(`${__hooks}/lib/customers.js`).program(e.app) });
});
routerAdd("POST", "/api/chedam/loyalty/program", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "loyalty.manage");
  const b = c.body || {};
  const num = (v, name, lo, hi) => { const n = Number(v); if (!(n >= lo && n <= hi)) throw new BadRequestError(name + " is " + lo + " to " + hi + "."); return n; };
  const v = { enabled: !!b.enabled, points_per_dollar: num(b.points_per_dollar, "Points per $1", 0, 100), points_per_dollar_off: num(b.points_per_dollar_off, "Points for $1 off", 1, 100000),
    min_redeem: Math.floor(num(b.min_redeem, "The minimum to redeem", 0, 1000000)), earn_on_promotions: b.earn_on_promotions !== false,
    exclude_categories: Array.isArray(b.exclude_categories) ? b.exclude_categories.map(String).slice(0, 100) : [], expiry_months: Math.floor(num(b.expiry_months || 0, "Expiry (months)", 0, 120)),
    set_by_owner: true };
  require(`${__hooks}/lib/customers.js`).inTx(e, (t) => {
    const r = t.findFirstRecordByData("settings", "key", "loyalty.program");
    r.set("value", v); r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || "");
    t.save(r);
  });
  return e.json(200, { program: v, active: require(`${__hooks}/lib/customers.js`).program(e.app) });
});

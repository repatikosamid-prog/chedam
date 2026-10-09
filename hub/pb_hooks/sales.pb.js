/// <reference path="../pb_data/types.d.ts" />
// Selling and till endpoints (P1 step 3). Logic: lib/sales.js, lib/tills.js, lib/pricing_core.js;
// request helpers: lib/sales_http.js. Every change is one transaction (BR-10).

// Price a cart without saving: totals, tax, problems to fix, approvals needed.
routerAdd("POST", "/api/chedam/sales/quote", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  const sales = require(`${__hooks}/lib/sales.js`);
  return e.json(200, sales.quoteView(sales.build(e.app, c.body, c.user), null));
});

// Complete a sale (cart + payments). A repeat of the same sale id returns the first result.
routerAdd("POST", "/api/chedam/sales", (e) => {
  const h = require(`${__hooks}/lib/sales_http.js`);
  const c = h.ctx(e, "sales.sell");
  return h.run(e, (tx) => require(`${__hooks}/lib/sales.js`).complete(tx, c.body, c));
});

// Offline selling (FR-3.16): what a till keeps so it can sell while the hub is unreachable.
routerAdd("GET", "/api/chedam/sales/offline-pack", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/offline.js`).pack(e.app));
});

// Upload one sale made offline (Section 8.2). The till sends them in order; a repeat id returns the
// first result (BR-10). Stock may go negative, with an urgent task (BR-12).
routerAdd("POST", "/api/chedam/sales/offline", (e) => {
  const h = require(`${__hooks}/lib/sales_http.js`);
  const c = h.ctx(e, "sales.sell");
  return h.run(e, (tx) => require(`${__hooks}/lib/offline.js`).complete(tx, c.body, c));
});

// Manager PIN on the till -> a one-time approval for 5 minutes (BR-18).
routerAdd("POST", "/api/chedam/sales/approvals", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/sales.js`).newApproval(e.app, e, c.body));
});

// Tax-exempt sales report (FR-4.05): ?from=YYYY-MM-DD&to=YYYY-MM-DD
routerAdd("GET", "/api/chedam/sales/reports/exempt", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.view");
  const q = e.request.url.query();
  const st = require(`${__hooks}/lib/stock.js`);
  const from = String(q.get("from") || st.today(-30)), to = String(q.get("to") || st.today());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new BadRequestError("Dates are YYYY-MM-DD.");
  const day = (t, plus) => { const a = t.split("-").map(Number); return new Date(a[0], a[1] - 1, a[2] + (plus || 0)).toISOString().replace("T", " "); };
  const rows = [];
  e.app.findRecordsByFilter("tax_exemptions", "created_at >= {:f} && created_at < {:t}", "created_at", 0, 0, { f: day(from), t: day(to, 1) }).forEach((x) => {
    const s = e.app.findRecordById("sales", x.getString("sale"));
    if (s.getString("status") !== "completed" || s.getBool("training")) return;
    rows.push({ sale: s.id, number: s.getString("number"), at: s.getString("completed_at"), reason: x.getString("reason"),
      reference: x.getString("reference"), exempt_cents: x.getInt("exempt_cents"), total_cents: s.getInt("total_cents") });
  });
  return e.json(200, { from: from, to: to, rows: rows, total_exempt_cents: rows.reduce((a, r) => a + r.exempt_cents, 0) });
});

// Soft holds for low-stock items in an open cart (BR-13)
routerAdd("POST", "/api/chedam/sales/soft-holds", (e) => {
  const h = require(`${__hooks}/lib/sales_http.js`);
  const c = h.ctx(e, "sales.sell");
  return h.run(e, (tx) => require(`${__hooks}/lib/sales.js`).softHold(tx, c.body, c));
});

routerAdd("GET", "/api/chedam/sales/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|sales.view");
  let v;
  try { v = require(`${__hooks}/lib/sales.js`).saleView(e.app, e.request.pathValue("id"), c.showCost); } catch (_) { throw new NotFoundError("No such sale."); }
  return e.json(200, v);
});

routerAdd("POST", "/api/chedam/sales/{id}/void", (e) => {
  const h = require(`${__hooks}/lib/sales_http.js`);
  const c = h.ctx(e, "sales.sell");
  return h.run(e, (tx) => require(`${__hooks}/lib/sales.js`).voidSale(tx, e.request.pathValue("id"), c.body, c));
});

// ---- Held sales (FR-3.10) -----------------------------------------------------------------------

routerAdd("GET", "/api/chedam/holds", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  const name = (id) => { try { return e.app.findRecordById("users", id).getString("name"); } catch (_) { return ""; } };
  return e.json(200, e.app.findRecordsByFilter("holds", "status = 'held'", "-created_at", 50, 0).map((h) => ({
    id: h.id, label: h.getString("label"), total_cents: h.getInt("total_cents"), items: h.getFloat("items"),
    held_by: name(h.getString("held_by")), at: h.getString("created_at") })));
});

routerAdd("POST", "/api/chedam/holds", (e) => {
  const h = require(`${__hooks}/lib/sales_http.js`);
  const c = h.ctx(e, "sales.sell");
  return h.run(e, (tx) => ({ id: require(`${__hooks}/lib/sales.js`).hold(tx, c.body, c).id }));
});

routerAdd("POST", "/api/chedam/holds/{id}/{action}", (e) => {
  const h = require(`${__hooks}/lib/sales_http.js`);
  const c = h.ctx(e, "sales.sell");
  const action = e.request.pathValue("action");
  if (action !== "recall" && action !== "cancel") throw new NotFoundError("Unknown action.");
  return h.run(e, (tx) => {
    const r = require(`${__hooks}/lib/sales.js`).recall(tx, e.request.pathValue("id"), c, action === "cancel");
    let cart = null;
    try { cart = JSON.parse(r.getString("cart") || "null"); } catch (_) { cart = null; }
    return { id: r.id, status: r.getString("status"), cart: action === "recall" ? cart : null };
  });
});

// ---- Tills (FR-3.01, 1.12) ----------------------------------------------------------------------

// This device's open till with its running summary, and the settings the till screen needs.
routerAdd("GET", "/api/chedam/tills/current", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|till.manage");
  const sales = require(`${__hooks}/lib/sales.js`);
  const auth = require(`${__hooks}/lib/auth.js`);
  const t = sales.openTill(e.app, c.device);
  return e.json(200, {
    till: t ? require(`${__hooks}/lib/tills.js`).view(e.app, t) : null,
    settings: {
      payment_methods: auth.setting(e.app, "sales.payment_methods", ["cash", "card"]),
      cash_rounding: auth.setting(e.app, "sales.cash_rounding", true),
      usd_rate: auth.setting(e.app, "sales.usd_rate", 1.35),
      discount_limit_pct: auth.setting(e.app, "sales.discount_limit_pct", 10),
      override_limit_pct: auth.setting(e.app, "sales.override_limit_pct", 10),
      float_default_cents: auth.setting(e.app, "till.float_default_cents", 0),
      denominations: auth.setting(e.app, "till.denominations", []),
      exempt_reasons: auth.setting(e.app, "sales.exempt_reasons", {}),
      staff_discount: (() => { const d = auth.setting(e.app, "sales.staff_discount", {}) || {}; return { enabled: !!d.enabled, pct: d.pct || 0 }; })(),
    },
    business: sales.business(e.app),
  });
});

routerAdd("POST", "/api/chedam/tills/open", (e) => {
  const h = require(`${__hooks}/lib/sales_http.js`);
  const c = h.ctx(e, "sales.sell");
  return h.run(e, (tx) => { const t = require(`${__hooks}/lib/tills.js`); return t.view(tx, t.open(tx, c.body, c)); });
});

// A till opened while the hub was unreachable (DL-90): uploaded before its offline sales.
routerAdd("POST", "/api/chedam/tills/offline-open", (e) => {
  const h = require(`${__hooks}/lib/sales_http.js`);
  const c = h.ctx(e, "sales.sell");
  return h.run(e, (tx) => { const t = require(`${__hooks}/lib/tills.js`); const r = t.openOffline(tx, c.body, c); return { duplicate: r.duplicate, till: t.view(tx, r.till) }; });
});

routerAdd("POST", "/api/chedam/tills/{id}/cash", (e) => {
  const h = require(`${__hooks}/lib/sales_http.js`);
  const c = h.ctx(e, "sales.sell|till.manage");
  return h.run(e, (tx) => {
    const m = require(`${__hooks}/lib/tills.js`).cash(tx, e.request.pathValue("id"), c.body, c);
    return { id: m.id, type: m.getString("type") };
  });
});

routerAdd("POST", "/api/chedam/tills/{id}/close", (e) => {
  const h = require(`${__hooks}/lib/sales_http.js`);
  const c = h.ctx(e, "sales.sell|till.manage");
  return h.run(e, (tx) => { const t = require(`${__hooks}/lib/tills.js`); return t.view(tx, t.close(tx, e.request.pathValue("id"), c.body, c)); });
});

routerAdd("GET", "/api/chedam/tills/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|till.manage|sales.view");
  const tills = require(`${__hooks}/lib/tills.js`);
  const t = tills.till(e.app, e.request.pathValue("id"));
  if (!c.can("till.manage") && !c.can("sales.view")) tills.mayUse(e.app, t, c);
  return e.json(200, tills.view(e.app, t));
});

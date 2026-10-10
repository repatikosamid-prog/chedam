/// <reference path="../pb_data/types.d.ts" />
// Money and audit reports (P1 step 9). Logic: lib/reports.js, lib/audit.js, lib/retention.js.

// No hard delete of business records inside the retention window, through any API call (also superusers,
// e.g. the admin dashboard). BR-34.
onRecordDeleteRequest((e) => { require(`${__hooks}/lib/retention.js`).guardDelete(e.app, e.record); e.next(); });

// Till reconciliation (FR-10.01): ?from=YYYY-MM-DD&to=YYYY-MM-DD
routerAdd("GET", "/api/chedam/reports/tills", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.view|till.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/reports.js`).tillRecon(e.app, { from: q.get("from"), to: q.get("to") }));
});

// Record the card terminal's settlement for a closed till: {card_settlement_cents, settlement_ref, note}
routerAdd("POST", "/api/chedam/reports/tills/{id}/reconcile", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "till.manage");
  let out = null;
  e.app.runInTransaction((tx) => { out = require(`${__hooks}/lib/reports.js`).reconcile(tx, e.request.pathValue("id"), c.body, c); });
  return e.json(200, out);
});

// Loss prevention (FR-10.11): ?from&to; with &cashier=<user id>: the events behind that person's figures
routerAdd("GET", "/api/chedam/reports/loss", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.view|till.manage");
  const q = e.request.url.query();
  const R = require(`${__hooks}/lib/reports.js`);
  const args = { from: q.get("from"), to: q.get("to"), cashier: q.get("cashier") };
  return e.json(200, args.cashier ? R.details(e.app, args) : R.lossPrevention(e.app, args));
});

// Audit log (FR-10.13)
routerAdd("GET", "/api/chedam/audit", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "events.view");
  const q = e.request.url.query();
  const args = {};
  ["from", "to", "actor", "device", "table", "action", "record", "page"].forEach((k) => { if (q.get(k)) args[k] = q.get(k); });
  return e.json(200, require(`${__hooks}/lib/audit.js`).search(e.app, args, c.showCost));
});

routerAdd("GET", "/api/chedam/audit/options", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "events.view");
  return e.json(200, require(`${__hooks}/lib/audit.js`).options(e.app));
});

// Retention rules (FR-10.09)
routerAdd("GET", "/api/chedam/retention", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "events.view|settings.manage");
  return e.json(200, require(`${__hooks}/lib/retention.js`).rules(e.app));
});

// Promotion results (FR-5.12): ?from&to; compared with the period just before. Margin with costs.view.
routerAdd("GET", "/api/chedam/reports/promotions", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.view|promotions.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/engage_reports.js`).promotions(e.app, { from: q.get("from"), to: q.get("to") }, c.showCost));
});

// Loyalty (FR-7.07): ?from&to[&top=20]; top customers only with customers.manage.
routerAdd("GET", "/api/chedam/reports/loyalty", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.view|customers.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/engage_reports.js`).loyalty(e.app, { from: q.get("from"), to: q.get("to"), top: q.get("top") }, c.can("customers.manage")));
});

// Dashboard (FR-2.01): what this person needs, by permission (attention list, today, month, P&L, stock).
routerAdd("GET", "/api/chedam/dashboard", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/insights.js`).dashboard(e.app, c));
});

// Sales insights (FR-10.10): ?from&to: weekday × hour, best/worst sellers, sell-through, year over year.
routerAdd("GET", "/api/chedam/reports/insights", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.view");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/insights.js`).insights(e.app, { from: q.get("from"), to: q.get("to") }, c.showCost));
});

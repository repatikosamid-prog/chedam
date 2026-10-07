/// <reference path="../pb_data/types.d.ts" />
// Stock endpoints (P1 step 2). Logic: lib/stock.js; request helpers: lib/stock_http.js (each handler runs
// in its own JS VM, so helpers live in a library).

// Add stock (FR-6.02 phone, FR-6.04 bulk grid): {op_id, lines: [{product, selling_unit, qty, cost_cents, lot_code, expiry_date, storage_area}]}
routerAdd("POST", "/api/chedam/stock/receive", (e) => {
  const ctx = require(`${__hooks}/lib/stock_http.js`).ctx(e, "stock.receive");
  return require(`${__hooks}/lib/stock_http.js`).once(e, ctx, (tx) => require(`${__hooks}/lib/stock.js`).receive(tx, ctx.body, ctx));
});

// Adjust, damage or loss (FR-6.06): JSON, or multipart with an optional "photo".
routerAdd("POST", "/api/chedam/stock/adjust", (e) => {
  const ctx = require(`${__hooks}/lib/stock_http.js`).ctx(e, "stock.adjust");
  let photo = null;
  try { const f = e.findUploadedFiles("photo"); if (f && f.length) photo = f[0]; } catch (_) { photo = null; }
  return require(`${__hooks}/lib/stock_http.js`).once(e, ctx, (tx) => require(`${__hooks}/lib/stock.js`).adjust(tx, ctx.body, ctx, ctx.can("stock.approve"), photo));
});

routerAdd("POST", "/api/chedam/stock/pack-break", (e) => {
  const ctx = require(`${__hooks}/lib/stock_http.js`).ctx(e, "stock.adjust");
  return require(`${__hooks}/lib/stock_http.js`).once(e, ctx, (tx) => require(`${__hooks}/lib/stock.js`).packBreak(tx, ctx.body, ctx));
});

routerAdd("POST", "/api/chedam/stock/pack-make", (e) => {
  const ctx = require(`${__hooks}/lib/stock_http.js`).ctx(e, "stock.adjust");
  return require(`${__hooks}/lib/stock_http.js`).once(e, ctx, (tx) => require(`${__hooks}/lib/stock.js`).packMake(tx, ctx.body, ctx));
});

// Manager decides a write-off waiting for approval.
routerAdd("POST", "/api/chedam/stock/movements/{id}/{decision}", (e) => {
  const ctx = require(`${__hooks}/lib/stock_http.js`).ctx(e, "stock.approve");
  const d = e.request.pathValue("decision");
  if (d !== "approve" && d !== "reject") throw new NotFoundError("Unknown action.");
  let m;
  e.app.runInTransaction((tx) => { m = require(`${__hooks}/lib/stock.js`).decide(tx, e.request.pathValue("id"), d === "approve", ctx); });
  return e.json(200, require(`${__hooks}/lib/stock_http.js`).moveView(m, ctx.can("costs.view")));
});

// Waiting for a manager: write-offs and submitted counts.
routerAdd("GET", "/api/chedam/stock/pending", (e) => {
  const ctx = require(`${__hooks}/lib/stock_http.js`).ctx(e, "stock.approve");
  const show = ctx.can("costs.view");
  const name = (col, id) => { try { return e.app.findRecordById(col, id).getString("name"); } catch (_) { return ""; } };
  const moves = e.app.findRecordsByFilter("stock_movements", "status = 'pending'", "created_at", 0, 0).map((m) =>
    Object.assign(require(`${__hooks}/lib/stock_http.js`).moveView(m, show), { product_name: name("products", m.getString("product")), unit_name: name("selling_units", m.getString("selling_unit")),
      by: m.getString("created_by"), at: m.getString("created_at"), note: m.getString("note"), photo: m.getString("photo") }));
  const counts = e.app.findRecordsByFilter("stock_counts", "status = 'submitted'", "submitted_at", 0, 0).map((c) => ({
    id: c.id, name: c.getString("name"), submitted_by: c.getString("submitted_by"), submitted_at: c.getString("submitted_at") }));
  return e.json(200, { movements: moves, counts: counts });
});

// Stock counts (FR-6.08)
routerAdd("POST", "/api/chedam/stock/counts", (e) => {
  const ctx = require(`${__hooks}/lib/stock_http.js`).ctx(e, "stock.count");
  let c;
  e.app.runInTransaction((tx) => { c = require(`${__hooks}/lib/stock.js`).startCount(tx, ctx.body, ctx); });
  return e.json(200, { id: c.id, name: c.getString("name"), status: c.getString("status") });
});

routerAdd("POST", "/api/chedam/stock/counts/{id}/lines", (e) => {
  const ctx = require(`${__hooks}/lib/stock_http.js`).ctx(e, "stock.count");
  let l;
  e.app.runInTransaction((tx) => { l = require(`${__hooks}/lib/stock.js`).countLine(tx, e.request.pathValue("id"), ctx.body, ctx); });
  return e.json(200, { id: l.id, product: l.getString("product"), counted_base: l.getFloat("counted_base"), expected_base: l.getFloat("expected_base") });
});

routerAdd("POST", "/api/chedam/stock/counts/{id}/{action}", (e) => {
  const action = e.request.pathValue("action");
  const PERM = { submit: "stock.count", approve: "stock.approve", cancel: "stock.approve" };
  if (!PERM[action]) throw new NotFoundError("Unknown action.");
  const ctx = require(`${__hooks}/lib/stock_http.js`).ctx(e, PERM[action]);
  const stock = require(`${__hooks}/lib/stock.js`);
  const id = e.request.pathValue("id");
  let c;
  e.app.runInTransaction((tx) => {
    if (action === "submit") c = stock.setCountStatus(tx, id, ["open"], "submitted", ctx, "submitted");
    else if (action === "cancel") c = stock.setCountStatus(tx, id, ["open", "submitted"], "cancelled", ctx, "");
    else c = stock.approveCount(tx, id, ctx);
  });
  return e.json(200, { id: c.id, status: c.getString("status") });
});

// One product's stock: level, sealed and loose, lots by expiry, recent movements (costs: costs.view).
routerAdd("GET", "/api/chedam/stock/products/{id}", (e) => {
  const ctx = require(`${__hooks}/lib/stock_http.js`).ctx(e, "");
  return e.json(200, require(`${__hooks}/lib/stock.js`).productView(e.app, e.request.pathValue("id"), ctx.can("costs.view")));
});

// Shrink and loss report (FR-6.07), at cost: ?from=YYYY-MM-DD&to=YYYY-MM-DD
routerAdd("GET", "/api/chedam/stock/shrink", (e) => {
  require(`${__hooks}/lib/stock_http.js`).ctx(e, "costs.view");
  const q = e.request.url.query();
  const stock = require(`${__hooks}/lib/stock.js`);
  const to = String(q.get("to") || stock.today());
  const from = String(q.get("from") || stock.today(-30));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new BadRequestError("Dates are YYYY-MM-DD.");
  return e.json(200, stock.shrink(e.app, from, to));
});

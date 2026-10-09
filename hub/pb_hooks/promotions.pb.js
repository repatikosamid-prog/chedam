/// <reference path="../pb_data/types.d.ts" />
// Promotions and scheduled prices (P2 step 1). Logic: lib/promotions.js, lib/promotions_core.js.

// Every minute: shelf labels for deals and scheduled prices that started or ended (BR-25).
cronAdd("chedam_promotion_labels", "* * * * *", () => {
  try { require(`${__hooks}/lib/promotions.js`).labelsJob($app); } catch (err) { $app.logger().error("promotion labels", "error", String(err)); }
  try { require(`${__hooks}/lib/promotions.js`).markdownJob($app); } catch (err) { $app.logger().error("markdown labels", "error", String(err)); }
});

// Near-expiry stock marked down now (FR-5.11), for the Promotions screen: product, lot, expiry, % off, qty.
routerAdd("GET", "/api/chedam/promotions/markdowns", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "promotions.manage|sales.view|stock.receive");
  const segs = require(`${__hooks}/lib/promotions.js`).markdownSegments(e.app, null);
  const rows = [];
  Object.keys(segs).forEach((pid) => {
    let name = "";
    try { name = e.app.findRecordById("products", pid).getString("name"); } catch (_) { name = ""; }
    segs[pid].forEach((x) => rows.push({ product: pid, name: name, lot: x.lot, expiry: x.expiry, pct: x.pct, qty: x.qty }));
  });
  return e.json(200, { rows: rows });
});

// Promotions and scheduled prices, with what each deal is and whether it is in force now.
routerAdd("GET", "/api/chedam/promotions", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "promotions.manage|sales.view");
  return e.json(200, require(`${__hooks}/lib/promotions.js`).list(e.app));
});

// Create or change a promotion. Body: see lib/promotions.js save()
routerAdd("POST", "/api/chedam/promotions", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "promotions.manage");
  let out = null;
  e.app.runInTransaction((tx) => { out = require(`${__hooks}/lib/promotions.js`).plain(require(`${__hooks}/lib/promotions.js`).save(tx, c.body, c)); });
  return e.json(200, out);
});

// End a promotion now.
routerAdd("POST", "/api/chedam/promotions/{id}/end", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "promotions.manage");
  let out = null;
  e.app.runInTransaction((tx) => { out = require(`${__hooks}/lib/promotions.js`).plain(require(`${__hooks}/lib/promotions.js`).end(tx, e.request.pathValue("id"), c)); });
  return e.json(200, out);
});

// FR-5.09 preview of a promotion being edited (body: the promotion's fields): regular vs promo price, and
// with costs.view the cost and new margin, below-cost rows flagged.
routerAdd("POST", "/api/chedam/promotions/preview", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "promotions.manage");
  return e.json(200, require(`${__hooks}/lib/promotions.js`).preview(e.app, c.body, c.showCost));
});

// A scheduled price (FR-5.06). Body: {id?, selling_unit, price_cents, starts_at, ends_at, note, remove}
routerAdd("POST", "/api/chedam/scheduled-prices", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "promotions.manage");
  let out = null;
  e.app.runInTransaction((tx) => { out = require(`${__hooks}/lib/promotions.js`).plainScheduled(require(`${__hooks}/lib/promotions.js`).saveScheduled(tx, c.body, c)); });
  return e.json(200, out);
});

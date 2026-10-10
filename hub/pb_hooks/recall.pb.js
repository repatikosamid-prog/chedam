/// <reference path="../pb_data/types.d.ts" />
// Recall trace and customer feedback (P3 step 10). Logic: lib/recall.js.

// Trace: ?product&lot_codes=a,b&expiry_from&expiry_to
routerAdd("GET", "/api/chedam/recalls/trace", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "stock.approve|purchasing.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/recall.js`).trace(e.app, { product: q.get("product"), lot_codes: q.get("lot_codes"), expiry_from: q.get("expiry_from"), expiry_to: q.get("expiry_to") }));
});
routerAdd("GET", "/api/chedam/recalls", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "stock.approve|purchasing.manage");
  return e.json(200, require(`${__hooks}/lib/recall.js`).recalls(e.app));
});
// Recall: {product, lot_codes, expiry_from, expiry_to, lots, reason, source}
routerAdd("POST", "/api/chedam/recalls", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "stock.approve");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/recall.js`).recall(t, c, c.body); });
  return e.json(200, out);
});

// Feedback from the kiosk (a device paired as a kiosk) or the receipt link (no sign-in): {rating, comment, sale, code}
routerAdd("POST", "/api/chedam/feedback", (e) => {
  const b = e.requestInfo().body || {};
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/recall.js`).give(t, e, b); });
  return e.json(200, out);
});
// The question for the kiosk / feedback page (no sign-in)
routerAdd("GET", "/api/chedam/feedback/question", (e) => {
  const f = require(`${__hooks}/lib/auth.js`).setting(e.app, "feedback", {}) || {};
  let name = "";
  try { const b = e.app.findRecordsByFilter("business", "id != ''", "", 1, 0)[0]; name = b.getString("trade_name") || b.getString("legal_name"); } catch (_) { name = ""; }
  return e.json(200, { question: f.question || "How was your visit today?", store: name });
});
routerAdd("GET", "/api/chedam/feedback/report", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.view|customers.manage");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/recall.js`).report(e.app, { from: q.get("from"), to: q.get("to") }));
});
routerAdd("POST", "/api/chedam/feedback/{id}/read", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.view|customers.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/recall.js`).markRead(t, c, e.request.pathValue("id")); });
  return e.json(200, out);
});

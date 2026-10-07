/// <reference path="../pb_data/types.d.ts" />
// Shelf labels (P1 step 7). Logic: lib/labels.js. The app draws the labels as an exact-size PDF
// (client/src/lib/labels/); the hub keeps the batch, the printed batches and what each label shows.

// The pending batch with each label's content.
routerAdd("GET", "/api/chedam/labels/batch", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "labels.manage");
  return e.json(200, require(`${__hooks}/lib/labels.js`).view(e.app));
});

// Add by scan/code {code, qty}, by category {category}, or a list {items: [{selling_unit, qty}]}.
routerAdd("POST", "/api/chedam/labels/batch", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "labels.manage");
  const L = require(`${__hooks}/lib/labels.js`);
  let n = 0;
  e.app.runInTransaction((tx) => { n = L.add(tx, c.body, c); });
  return e.json(200, Object.assign({ added: n }, L.view(e.app)));
});

// How many labels for a line; 0 takes it off the batch.
routerAdd("POST", "/api/chedam/labels/batch/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "labels.manage");
  e.app.runInTransaction((tx) => { require(`${__hooks}/lib/labels.js`).setQty(tx, e.request.pathValue("id"), c.body.qty, c); });
  return e.json(200, require(`${__hooks}/lib/labels.js`).view(e.app));
});

// Make a batch to print: {items?: [{id, qty}], layout, template, start}. Nothing leaves the batch yet.
routerAdd("POST", "/api/chedam/labels/batches", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "labels.manage");
  let out = null;
  e.app.runInTransaction((tx) => { out = require(`${__hooks}/lib/labels.js`).make(tx, c.body, c); });
  return e.json(200, out);
});

// The last 10 printed batches (reprint).
routerAdd("GET", "/api/chedam/labels/batches", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "labels.manage");
  return e.json(200, { batches: require(`${__hooks}/lib/labels.js`).recent(e.app) });
});

routerAdd("GET", "/api/chedam/labels/batches/{id}", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "labels.manage");
  let b;
  try { b = e.app.findRecordById("label_batches", e.request.pathValue("id")); } catch (_) { throw new NotFoundError("Unknown batch."); }
  return e.json(200, require(`${__hooks}/lib/labels.js`).batchView(b));
});

// "The labels came out right": their lines leave the batch.
routerAdd("POST", "/api/chedam/labels/batches/{id}/confirm", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "labels.manage");
  let out = null;
  e.app.runInTransaction((tx) => { out = require(`${__hooks}/lib/labels.js`).confirm(tx, e.request.pathValue("id"), c); });
  return e.json(200, out);
});

// Checks a layout fits its page before it is saved.
routerAdd("POST", "/api/chedam/labels/layouts/check", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "labels.manage");
  return e.json(200, require(`${__hooks}/lib/labels.js`).checkLayout(c.body));
});

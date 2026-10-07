/// <reference path="../pb_data/types.d.ts" />
// Receipt printers and the cash drawer (P1 step 5). Logic: lib/printing.js, lib/receipt_layout.js.
// Printing runs after the sale is saved and never changes it, apart from the reprint count and the
// "drawer opened" mark (each in its own short transaction).

// The store's printers, this device's printer and the receipt options.
routerAdd("GET", "/api/chedam/printers", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|settings.manage|devices.manage");
  const pr = require(`${__hooks}/lib/printing.js`);
  return e.json(200, { printers: pr.printers(e.app), mine: pr.forDevice(e.app, c.device), options: pr.options(e.app) });
});

routerAdd("PUT", "/api/chedam/printers", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "settings.manage");
  const pr = require(`${__hooks}/lib/printing.js`);
  let out = null;
  e.app.runInTransaction((tx) => { out = pr.savePrinters(tx, c.body.printers, c); });
  return e.json(200, { printers: out });
});

// Printers on the store network (port 9100 open). Takes a few seconds.
routerAdd("POST", "/api/chedam/printers/scan", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "settings.manage");
  return e.json(200, { found: require(`${__hooks}/lib/printing.js`).scan(e.app, Number(c.body.port) || 9100) });
});

// Test page on a printer (saved or not yet saved); kick: also open its drawer.
routerAdd("POST", "/api/chedam/printers/test", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "settings.manage");
  return e.json(200, require(`${__hooks}/lib/printing.js`).test(e.app, c.body, c));
});

// Print (or reprint) a sale's receipt on this device's printer. Body: {reprint, buyer, kick}
routerAdd("POST", "/api/chedam/sales/{id}/print", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/printing.js`).printSale(e.app, e.request.pathValue("id"), c.body, c));
});

// The receipt as the printer prints it, as text (preview, and a check without a printer).
routerAdd("GET", "/api/chedam/sales/{id}/receipt-text", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|sales.view");
  return e.json(200, require(`${__hooks}/lib/printing.js`).saleText(e.app, e.request.pathValue("id"), e.request.url.query().get("chars"), c));
});

// Z report (closed till) or X report (open till) on this device's printer.
routerAdd("POST", "/api/chedam/tills/{id}/print", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|till.manage");
  return e.json(200, require(`${__hooks}/lib/printing.js`).printTill(e.app, e.request.pathValue("id"), c));
});

// Open the drawer for a no-sale just recorded on this device. Body: {movement}
routerAdd("POST", "/api/chedam/drawer/no-sale", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|till.manage");
  return e.json(200, require(`${__hooks}/lib/printing.js`).kickNoSale(e.app, c.body.movement, c));
});

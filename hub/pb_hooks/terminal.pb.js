/// <reference path="../pb_data/types.d.ts" />
// Linked card payments at the till (P5 step 2). Logic: lib/terminal.js. sales.sell; the unused paid checkouts
// list is for managers (sales.view).

routerAdd("POST", "/api/chedam/terminal/checkouts", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/terminal.js`).start(e.app, c, c.body));
});
routerAdd("GET", "/api/chedam/terminal/checkouts", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell|sales.view");
  const sale = e.request.url.query().get("sale");
  const t = require(`${__hooks}/lib/terminal.js`);
  if (sale) return e.json(200, { items: t.unused(e.app, sale) });
  if (!c.can("sales.view")) throw new ForbiddenError("You do not have permission for this.");
  return e.json(200, { items: t.orphans(e.app) });
});
routerAdd("GET", "/api/chedam/terminal/checkouts/{id}", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/terminal.js`).poll(e.app, c, e.request.pathValue("id")));
});
routerAdd("POST", "/api/chedam/terminal/checkouts/{id}/cancel", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/terminal.js`).cancel(e.app, c, e.request.pathValue("id")));
});

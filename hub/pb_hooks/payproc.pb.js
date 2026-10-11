/// <reference path="../pb_data/types.d.ts" />
// Card processor and linked terminals (P5 step 1). Logic: lib/payproc.js. payments.connect (the owner), except
// GET /api/chedam/payproc/till: any seller asks whether Card is linked on this till.

routerAdd("GET", "/api/chedam/payproc", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "payments.connect");
  return e.json(200, require(`${__hooks}/lib/payproc.js`).status(e.app));
});
routerAdd("POST", "/api/chedam/payproc/connect", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payments.connect");
  return e.json(200, require(`${__hooks}/lib/payproc.js`).connect(e.app, c, c.body));
});
routerAdd("POST", "/api/chedam/payproc/location", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payments.connect");
  return e.json(200, require(`${__hooks}/lib/payproc.js`).setLocation(e.app, c, c.body));
});
routerAdd("POST", "/api/chedam/payproc/disconnect", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payments.connect");
  return e.json(200, require(`${__hooks}/lib/payproc.js`).disconnect(e.app, c));
});
routerAdd("POST", "/api/chedam/payproc/terminals", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payments.connect");
  return e.json(200, require(`${__hooks}/lib/payproc.js`).pairStart(e.app, c, c.body));
});
routerAdd("POST", "/api/chedam/payproc/terminals/{id}/refresh", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payments.connect");
  return e.json(200, require(`${__hooks}/lib/payproc.js`).refresh(e.app, c, e.request.pathValue("id")));
});
routerAdd("POST", "/api/chedam/payproc/terminals/{id}/assign", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payments.connect");
  return e.json(200, require(`${__hooks}/lib/payproc.js`).assign(e.app, c, e.request.pathValue("id"), c.body));
});
routerAdd("POST", "/api/chedam/payproc/terminals/{id}/remove", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "payments.connect");
  return e.json(200, require(`${__hooks}/lib/payproc.js`).remove(e.app, c, e.request.pathValue("id")));
});
routerAdd("GET", "/api/chedam/payproc/till", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  return e.json(200, require(`${__hooks}/lib/payproc.js`).tillInfo(e.app, c.device));
});

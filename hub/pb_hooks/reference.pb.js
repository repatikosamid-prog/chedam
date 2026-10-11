/// <reference path="../pb_data/types.d.ts" />
// Reference data (P5 step 7). Logic: lib/reference.js. Suggestions only, for anyone signed in (nothing is written).

routerAdd("GET", "/api/chedam/reference", (e) => { const R = require(`${__hooks}/lib/reference.js`); R.ctx(e); return e.json(200, R.about(e.app)); });
routerAdd("GET", "/api/chedam/reference/product", (e) => { const R = require(`${__hooks}/lib/reference.js`); return e.json(200, R.product(e.app, R.ctx(e).get("barcode"))); });
routerAdd("GET", "/api/chedam/reference/shelf-life", (e) => { const R = require(`${__hooks}/lib/reference.js`); return e.json(200, R.shelfLife(e.app, R.ctx(e).get("name"))); });
routerAdd("GET", "/api/chedam/reference/hs", (e) => { const R = require(`${__hooks}/lib/reference.js`); return e.json(200, R.hs(e.app, R.ctx(e).get("q"))); });
routerAdd("GET", "/api/chedam/reference/tax-presets", (e) => { const R = require(`${__hooks}/lib/reference.js`); R.ctx(e); return e.json(200, R.taxPresets(e.app)); });
routerAdd("GET", "/api/chedam/reference/units", (e) => { const R = require(`${__hooks}/lib/reference.js`); R.ctx(e); return e.json(200, R.units(e.app)); });
routerAdd("GET", "/api/chedam/reference/fx", (e) => { const R = require(`${__hooks}/lib/reference.js`); const q = R.ctx(e); return e.json(200, R.fx(e.app, q.get("currency"), q.get("day"))); });

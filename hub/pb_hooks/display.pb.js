/// <reference path="../pb_data/types.d.ts" />
// Customer-facing display (P2 step 5, FR-3.14). Logic: lib/display.js.

// The till: what its customer should see now. {state: {kind: idle|sale|pay|done, ...}}
routerAdd("POST", "/api/chedam/display", (e) => e.json(200, require(`${__hooks}/lib/display.js`).publish(e)));

// The customer display device (paired, linked to a till; nobody signs in): ?v=<last version>
routerAdd("GET", "/api/chedam/display", (e) => e.json(200, require(`${__hooks}/lib/display.js`).read(e)));

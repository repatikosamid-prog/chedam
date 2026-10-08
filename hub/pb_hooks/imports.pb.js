/// <reference path="../pb_data/types.d.ts" />
// Product import and data export (P1 step 8). Logic: lib/imports.js, lib/data_export.js. The file is read,
// profiled and mapped in the back-office browser (client/src/lib/import/); the hub checks and commits rows.

// What would happen to each row; nothing is saved.
routerAdd("POST", "/api/chedam/imports/check", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "catalogue.edit");
  return e.json(200, require(`${__hooks}/lib/imports.js`).check(e.app, c.body, c.can("prices.edit")));
});

// Import: one transaction, all or nothing; the job record says what happened (also when it failed).
routerAdd("POST", "/api/chedam/imports", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "catalogue.edit");
  c.mayPrice = c.can("prices.edit");
  return e.json(200, require(`${__hooks}/lib/imports.js`).commit(e.app, c.body, c));
});

// The job log (the last 30).
routerAdd("GET", "/api/chedam/imports", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "catalogue.edit");
  const I = require(`${__hooks}/lib/imports.js`);
  return e.json(200, { jobs: e.app.findRecordsByFilter("import_jobs", "id != ''", "-created_at", 30, 0).map((j) => { const v = I.jobView(j); delete v.result; return v; }) });
});

routerAdd("GET", "/api/chedam/imports/{id}", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "catalogue.edit");
  let j;
  try { j = e.app.findRecordById("import_jobs", e.request.pathValue("id")); } catch (_) { throw new NotFoundError("Unknown import."); }
  return e.json(200, require(`${__hooks}/lib/imports.js`).jobView(j));
});

// Full business export (owner, NFR-22): the dictionary, then each table page by page.
routerAdd("GET", "/api/chedam/export/dictionary", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "data.export");
  return e.json(200, { tables: require(`${__hooks}/lib/data_export.js`).dictionary(e.app), at: new Date().toISOString() });
});

routerAdd("GET", "/api/chedam/export/table/{name}", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "data.export");
  const q = e.request.url.query();
  return e.json(200, require(`${__hooks}/lib/data_export.js`).table(e.app, e.request.pathValue("name"), q.get("page"), q.get("per_page")));
});

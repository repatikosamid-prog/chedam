/// <reference path="../pb_data/types.d.ts" />
// Parties: vendors and clients (P3 step 1). Logic: lib/parties.js.

onRecordCreateRequest((e) => { require(`${__hooks}/lib/parties.js`).check(e.record); e.next(); }, "parties");
onRecordUpdateRequest((e) => { require(`${__hooks}/lib/parties.js`).check(e.record); e.next(); }, "parties");
onRecordCreateRequest((e) => { require(`${__hooks}/lib/parties.js`).checkContact(e.record); e.next(); }, "party_contacts");
onRecordUpdateRequest((e) => { require(`${__hooks}/lib/parties.js`).checkContact(e.record); e.next(); }, "party_contacts");
onRecordCreateRequest((e) => { require(`${__hooks}/lib/parties.js`).checkRate(e.record); e.next(); }, "fx_rates");
onRecordUpdateRequest((e) => { require(`${__hooks}/lib/parties.js`).checkRate(e.record); e.next(); }, "fx_rates");

// A party with its contacts and communication log
routerAdd("GET", "/api/chedam/parties/{id}", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "parties.view|parties.manage");
  return e.json(200, require(`${__hooks}/lib/parties.js`).view(e.app, e.request.pathValue("id")));
});
// Log a call, email, visit, meeting, note or order: {kind, text, contact, follow_up_at}
routerAdd("POST", "/api/chedam/parties/{id}/log", (e) => {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "parties.view|parties.manage");
  let out = null;
  e.app.runInTransaction((t) => { out = require(`${__hooks}/lib/parties.js`).addLog(t, c, e.request.pathValue("id"), c.body); });
  return e.json(200, out);
});
// Exchange rate on a day: ?currency=USD&day=YYYY-MM-DD
routerAdd("GET", "/api/chedam/fx", (e) => {
  require(`${__hooks}/lib/sales_http.js`).ctx(e, "");
  const q = e.request.url.query();
  const r = require(`${__hooks}/lib/parties.js`).rateOn(e.app, q.get("currency"), q.get("day") || require(`${__hooks}/lib/stock.js`).today());
  if (!r) throw new NotFoundError("No exchange rate entered for " + q.get("currency") + " on or before that day.");
  return e.json(200, r);
});

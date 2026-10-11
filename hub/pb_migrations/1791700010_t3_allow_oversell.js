/// <reference path="../../pb_data/types.d.ts" />
// Testing round 3 (2026-10-11): selling more than is in stock goes through (perishables, produce counted late);
// stock goes below zero and managers and stock staff are told off the till. Setting sales.allow_oversell.

migrate((app) => {
  const r = new Record(app.findCollectionByNameOrId("settings"));
  r.load({ key: "sales.allow_oversell", value: true,
    description: "Sell more than is in stock without stopping the sale: stock goes below zero and managers and stock staff get a task and an inbox alert (off = the till refuses, as before)" });
  r.set("created_by", "system"); r.set("updated_by", "system");
  app.save(r);
}, (app) => {
  try { app.delete(app.findFirstRecordByData("settings", "key", "sales.allow_oversell")); } catch (_) { /* gone */ }
});

/// <reference path="../../pb_data/types.d.ts" />
// UI request (2026-10-09, U1, DL-115): the owner chooses whether the store's logo (the receipt logo) is
// also shown in the app: the top bar and Home. Off until the owner says yes. Down drops the field.

migrate((app) => {
  const c = app.findCollectionByNameOrId("business");
  c.fields.add(new Field({ name: "logo_in_app", type: "bool" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("business");
  c.fields.removeByName("logo_in_app");
  app.save(c);
});

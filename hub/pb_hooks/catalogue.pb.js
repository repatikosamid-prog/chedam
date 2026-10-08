/// <reference path="../pb_data/types.d.ts" />
// Catalogue endpoints (P1 step 1). Rules: lib/catalogue.js (run on every save), lib/tax.js.

// Save a product with its selling units in one transaction (product form, phone new-product form,
// import). Body: { product: {id?, ...fields}, units: [{id?, ...fields, deleted?}], activate, keep_draft }
// activate: make it Active (needs prices.edit). If it still has problems: 400 with the list, or, with
// keep_draft (import, DL-66), it stays a Draft with its reasons.
routerAdd("POST", "/api/chedam/catalogue/products", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const devices = require(`${__hooks}/lib/devices.js`);
  const su = e.hasSuperuserAuth();
  if (!su) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "catalogue.edit")) throw new ForbiddenError("You do not have permission for this.");
  }
  const body = e.requestInfo().body || {};
  const opts = { actor: su ? "system:superuser" : devices.actorOf(e), device: devices.currentId(e), su: su,
    mayPrice: su || access.can(e.app, e.auth, "prices.edit") };
  let productId = "";
  let refused = null;   // BR-07 problems: answered as a list after the transaction rolled back
  try {
    e.app.runInTransaction((tx) => {
      const r = require(`${__hooks}/lib/catalogue_save.js`).saveProduct(tx, body, opts);
      productId = r.productId;
      if (r.refused) { refused = r.refused; throw new BadRequestError("This product cannot be active yet."); }
    });
  } catch (err) {
    if (!refused) throw err;
    return e.json(400, { status: 400, message: "This product cannot be active yet: " + refused.map((x) => x.message).join(" "), data: { problems: refused } });
  }
  return e.json(200, require(`${__hooks}/lib/catalogue.js`).view(e.app, productId, undefined, su || access.can(e.app, e.auth, "costs.view")));
});

// Scan or type a code at the till or on a phone: barcode, PLU or scale code. Several units sharing a
// barcode means "packs or singles?" (FR-6.03).
routerAdd("GET", "/api/chedam/catalogue/lookup", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth() && !access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
  const code = String(e.request.url.query().get("code") || "").trim();
  if (!/^[0-9A-Za-z-]{1,48}$/.test(code)) throw new BadRequestError("Enter a barcode, PLU or scale code.");
  return e.json(200, require(`${__hooks}/lib/catalogue.js`).lookup(e.app, code));
});

// One product with its units, what keeps it a Draft, the taxes it charges now (or ?at=<date>, FR-12.03)
// and recent price changes.
routerAdd("GET", "/api/chedam/catalogue/products/{id}", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth() && !access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
  const id = e.request.pathValue("id");
  try { e.app.findRecordById("products", id); } catch (_) { throw new NotFoundError("No such product."); }
  const at = String(e.request.url.query().get("at") || "");
  if (at && isNaN(new Date(at).getTime())) throw new BadRequestError("Invalid date.");
  const costs = e.hasSuperuserAuth() || access.can(e.app, e.auth, "costs.view");
  return e.json(200, require(`${__hooks}/lib/catalogue.js`).view(e.app, id, at || undefined, costs));
});

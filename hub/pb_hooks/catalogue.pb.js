/// <reference path="../pb_data/types.d.ts" />
// Catalogue endpoints (P1 step 1). Rules: lib/catalogue.js (run on every save), lib/tax.js.

// Save a product with its selling units in one transaction (product form, phone new-product form,
// import). Body: { product: {id?, ...fields}, units: [{id?, ...fields, deleted?}], activate, keep_draft }
// activate: make it Active (needs prices.edit). If it still has problems: 400 with the list, or, with
// keep_draft (import, DL-66), it stays a Draft with its reasons.
routerAdd("POST", "/api/chedam/catalogue/products", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const devices = require(`${__hooks}/lib/devices.js`);
  const cat = require(`${__hooks}/lib/catalogue.js`);
  const su = e.hasSuperuserAuth();
  if (!su) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "catalogue.edit")) throw new ForbiddenError("You do not have permission for this.");
  }
  const body = e.requestInfo().body || {};
  const inP = body.product || {};
  const inUnits = Array.isArray(body.units) ? body.units : [];
  if (inUnits.length > 20) throw new BadRequestError("At most 20 selling units per product.");
  const actor = su ? "system:superuser" : devices.actorOf(e);
  const dev = devices.currentId(e);
  const PRODUCT_FIELDS = ["name", "name_fr", "category", "base_unit", "tax_class", "cost_cents", "plu", "pos_button", "reorder_point",
    "description", "tare", "scale_code", "scale_ack", "perishable", "shelf_life_days", "expiry_at_receiving", "storage_area",
    "age_restricted", "min_age", "deposits_fees", "imported", "hs_code", "origin_country", "non_returnable"];
  const UNIT_FIELDS = ["name", "kind", "contains_qty", "contains_unit", "barcodes", "price_cents", "sell_at_pos", "is_default", "sort"];
  const ID = /^[a-z0-9]{15}$/;
  const stamp = (r) => {
    if (r.isNew()) { r.set("created_by", actor); if (dev) r.set("device_id", dev); }
    r.set("updated_by", actor); r.set("@actor", actor); r.set("@device", dev); r.set("@batch", true);
  };
  const mayPrice = su || access.can(e.app, e.auth, "prices.edit");

  let productId = "";
  let problems = [];
  let refused = null;   // BR-07 problems: answered as a list after the transaction rolled back
  try {
    e.app.runInTransaction((tx) => {
      let p;
      if (inP.id && !ID.test(String(inP.id))) throw new BadRequestError("Invalid product id.");
      try { p = inP.id ? tx.findRecordById("products", inP.id) : null; } catch (_) { p = null; }
      const wasActive = !!p && p.getString("status") === "active";
      if (p && p.getString("deleted_at")) throw new BadRequestError("This product was removed.");
      if (!p) {
        p = new Record(tx.findCollectionByNameOrId("products"));
        if (inP.id) p.set("id", inP.id);
        p.set("status", "draft");
      }
      PRODUCT_FIELDS.forEach((f) => { if (inP[f] !== undefined) p.set(f, inP[f]); });
      stamp(p);
      tx.save(p);
      productId = p.id;

      // Units that contain other units of this request are saved after them.
      const pending = inUnits.slice();
      const saved = {};
      for (let pass = 0; pending.length && pass < 8; pass++) {
        for (let i = 0; i < pending.length; i++) {
          const u = pending[i];
          const inner = u.contains_unit;
          if (inner && pending.some((o) => o !== u && o.id === inner)) continue;
          let r;
          if (u.id && !ID.test(String(u.id))) throw new BadRequestError("Invalid selling unit id.");
          try { r = u.id ? tx.findRecordById("selling_units", u.id) : null; } catch (_) { r = null; }
          if (r && r.getString("product") !== p.id) throw new BadRequestError("A selling unit belongs to another product.");
          const oldPrice = r ? r.getInt("price_cents") : 0;
          if (!r) {
            r = new Record(tx.findCollectionByNameOrId("selling_units"));
            if (u.id) r.set("id", u.id);
            r.set("product", p.id);
          }
          UNIT_FIELDS.forEach((f) => { if (u[f] !== undefined) r.set(f, u[f]); });
          if (u.deleted) r.set("deleted_at", new DateTime());
          if (wasActive && !mayPrice && (r.getInt("price_cents") !== oldPrice || u.deleted)) {
            throw new ForbiddenError("Changing the price of an active product needs prices.edit.");
          }
          stamp(r);
          tx.save(r);
          saved[r.id] = true;
          pending.splice(i, 1); i--;
        }
      }
      if (pending.length) throw new BadRequestError("Packs contain each other in a loop.");

      // Final state, checked once with every unit in place (BR-07).
      problems = cat.problems(tx, p, cat.unitsOf(tx, p.id));
      const wantActive = wasActive || !!body.activate;
      if (body.activate && !wasActive && !mayPrice) throw new ForbiddenError("Making a product active needs prices.edit.");
      if (wantActive && problems.length && (wasActive || !body.keep_draft)) {
        refused = problems;
        throw new BadRequestError("This product cannot be active yet.");
      }
      const status = wantActive && !problems.length ? "active" : p.getString("status");
      if (status !== p.getString("status") || p.getString("draft_reasons") !== JSON.stringify(problems)) {
        p.set("status", status);
        stamp(p);
        tx.save(p);
      }
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

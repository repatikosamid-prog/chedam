// Saving a product with its selling units (P1 step 1; used by the product form, the phone's new-product
// form and the import, P1 step 8). Runs inside the caller's transaction.
// body: { product: {id?, ...fields}, units: [{id?, ...fields, deleted?}], activate, keep_draft }
// opts: { actor, device, su, mayPrice, noLabels }
// activate: make it Active (needs prices.edit). If it still has problems it is refused (BR-07), or with
// keep_draft (import, DL-66) it stays a Draft with its reasons. Returns { productId, problems, refused }:
// refused (a list) means the caller must roll back and answer with the list.

const PRODUCT_FIELDS = ["name", "name_fr", "category", "base_unit", "tax_class", "cost_cents", "plu", "pos_button", "reorder_point", "reorder_max",
  "description", "tare", "scale_code", "scale_ack", "perishable", "shelf_life_days", "expiry_at_receiving", "storage_area", "temp_min_c", "temp_max_c", "is_bundle", "components", "serial_tracked", "warranty_days",
  "age_restricted", "min_age", "deposits_fees", "imported", "hs_code", "origin_country", "non_returnable",
  "size_qty", "size_unit"];
const UNIT_FIELDS = ["name", "kind", "contains_qty", "contains_unit", "barcodes", "price_cents", "sell_at_pos", "is_default", "sort"];
const ID = /^[a-z0-9]{15}$/;

function saveProduct(tx, body, opts) {
  const cat = require(`${__hooks}/lib/catalogue.js`);
  const inP = body.product || {};
  const inUnits = Array.isArray(body.units) ? body.units : [];
  if (inUnits.length > 20) throw new BadRequestError("At most 20 selling units per product.");
  const stamp = (r) => {
    if (r.isNew()) { r.set("created_by", opts.actor); if (opts.device) r.set("device_id", opts.device); }
    r.set("updated_by", opts.actor); r.set("@actor", opts.actor); r.set("@device", opts.device || ""); r.set("@batch", true);
    if (opts.noLabels) r.set("@nolabels", true);
  };

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
  require(`${__hooks}/lib/variety.js`).checkBundle(tx, p);          // P3 step 8: components are stocked items
  stamp(p);
  tx.save(p);

  // Units that contain other units of this request are saved after them.
  const pending = inUnits.slice();
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
      if (wasActive && !opts.mayPrice && (r.getInt("price_cents") !== oldPrice || u.deleted)) {
        throw new ForbiddenError("Changing the price of an active product needs prices.edit.");
      }
      stamp(r);
      tx.save(r);
      pending.splice(i, 1); i--;
    }
  }
  if (pending.length) throw new BadRequestError("Packs contain each other in a loop.");

  // Final state, checked once with every unit in place (BR-07).
  const problems = cat.problems(tx, p, cat.unitsOf(tx, p.id));
  const wantActive = wasActive || !!body.activate;
  if (body.activate && !wasActive && !opts.mayPrice) throw new ForbiddenError("Making a product active needs prices.edit.");
  if (wantActive && problems.length && (wasActive || !body.keep_draft)) return { productId: p.id, problems, refused: problems };
  const status = wantActive && !problems.length ? "active" : p.getString("status");
  if (status !== p.getString("status") || p.getString("draft_reasons") !== JSON.stringify(problems)) {
    p.set("status", status);
    stamp(p);
    tx.save(p);
  }
  return { productId: p.id, problems, refused: null, status };
}

module.exports = { saveProduct, PRODUCT_FIELDS, UNIT_FIELDS };

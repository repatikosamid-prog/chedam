// Catalogue rules (P1 step 1): FR-5.01-5.05, BR-01, 03, 06-08; DL-64..69.
// - problems(): BR-07, what a product still needs before it can be Active. Saved as draft_reasons.
// - checkProduct()/checkUnit(): run on every save inside its transaction (lib/event_log.js), so the
//   API, endpoints and imports all follow the same rules (FR-11.05).
// - afterWrite(): price history (FR-5.05) and the Drafts task (BR-08), inside the event-log transaction.

const MAX_NEST = 5;

function forbid(msg, data) { throw new BadRequestError(msg, data || {}); }

function moduleOn(app, code) {
  try { return app.findFirstRecordByData("modules", "module", code).getBool("enabled"); } catch (_) { return false; }
}

// JSON fields: get() returns raw bytes in the JS hooks, so parse getString().
function barcodesOf(unit) {
  let v;
  try { v = JSON.parse(unit.getString("barcodes") || "[]"); } catch (_) { v = []; }
  return Array.isArray(v) ? v.map(String) : [];
}

// Live (not deleted) units of a product. `replace` swaps in the unit being saved (not in the DB yet).
function unitsOf(app, productId, replace) {
  const list = productId ? app.findRecordsByFilter("selling_units", "product = {:p} && deleted_at = ''", "sort", 0, 0, { p: productId }) : [];
  if (!replace) return list;
  const out = list.filter((u) => u.id !== replace.id);
  if (!replace.getString("deleted_at")) out.push(replace);
  return out;
}

// BR-07 (and DL-69): returns [{field, message}] that keep the product a Draft. Empty = can be Active.
function problems(app, product, units) {
  const out = [];
  const add = (field, message) => out.push({ field: field, message: message });
  const base = product.getString("base_unit");
  const byWeight = base === "kg" || base === "lb";

  if (!product.getString("name").trim()) add("name", "Enter a name.");
  if (!product.getString("category")) add("category", "Choose a category.");
  if (!product.getString("tax_class")) add("tax_class", "Choose a tax class.");

  const selling = units.filter((u) => u.getBool("sell_at_pos"));
  if (!selling.length) add("selling_units", "Add a selling unit that is sold at the till.");
  selling.forEach((u) => { if (u.getInt("price_cents") < 1) add("price_cents", "'" + u.getString("name") + "' needs a price of at least $0.01."); });

  const hasBarcode = units.some((u) => barcodesOf(u).length > 0);
  if (!hasBarcode && !product.getString("plu") && !product.getBool("pos_button") && !product.getString("scale_code")) {
    add("barcodes", "Add a barcode, a PLU or a till button.");
  }

  if (byWeight) {
    if (!moduleOn(app, "weighed_goods")) add("base_unit", "Switch on Weighed Goods to sell by weight.");
    if (!units.some((u) => u.getString("kind") === "weight" && u.getBool("sell_at_pos"))) add("selling_units", "Add a 'by weight' selling unit with a price per " + base + ".");
    if (!product.getString("plu") && !product.getString("scale_code")) add("plu", "Add a PLU or scale code.");
    if (!product.getBool("scale_ack")) add("scale_ack", "Confirm the item is weighed on a Measurement Canada approved scale.");
  }
  if (product.getBool("perishable")) {
    if (product.getInt("shelf_life_days") < 1 && !product.getBool("expiry_at_receiving")) add("shelf_life_days", "Enter a shelf life, or choose 'expiry entered when receiving'.");
    if (!product.getString("storage_area")) add("storage_area", "Choose a storage area.");
  }
  if (product.getBool("age_restricted")) {
    if (!moduleOn(app, "regulated_items")) add("age_restricted", "Switch on Regulated Items for age-restricted products.");
    if (product.getInt("min_age") < 1) add("min_age", "Enter the minimum age.");
  }
  if ((product.get("deposits_fees") || []).length && !moduleOn(app, "regulated_items")) add("deposits_fees", "Switch on Regulated Items for deposits and fees.");
  if (product.getBool("imported")) {
    if (!product.getString("hs_code")) add("hs_code", "Enter the HS code.");
    if (!product.getString("origin_country")) add("origin_country", "Enter the country of origin.");
  }
  return out;
}

function threeDecimals(n) { return Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6; }

// Every product save (create or update, any source).
function checkProduct(app, product) {
  if (!product.getString("status")) product.set("status", "draft");
  if (!product.getString("base_unit")) product.set("base_unit", "each");
  if (!threeDecimals(product.getFloat("tare"))) forbid("Tare has at most 3 decimals.");
  const plu = product.getString("plu");
  if (plu && !product.getString("deleted_at")) {
    const same = app.findRecordsByFilter("products", "plu = {:p} && id != {:id} && deleted_at = ''", "", 1, 0, { p: plu, id: product.id });
    if (same.length) forbid("PLU " + plu + " is already used by '" + same[0].getString("name") + "'.");
  }
  const was = product.get("@was");
  if (was) {
    if (was.base_unit !== product.getString("base_unit") && unitsOf(app, product.id).length) {
      forbid("The base unit cannot change once the product has selling units.");
    }
  }
  const list = problems(app, product, unitsOf(app, product.isNew() ? "" : product.id));
  product.set("draft_reasons", list);
  // A batch save (product + units endpoint) is checked once at its end, with every unit in place.
  if (product.getString("status") === "active" && list.length && !product.get("@batch")) {
    forbid("This product cannot be active yet: " + list.map((p) => p.message).join(" "), { problems: list });
  }
}

// base_qty of a unit = contains_qty x base_qty of what it contains (DL-64).
function baseQty(app, unit, depth) {
  const kind = unit.getString("kind");
  if (kind === "single" || kind === "weight") return 1;
  if ((depth || 0) > MAX_NEST) forbid("Packs are nested too deep, or a pack contains itself.");
  const inner = unit.getString("contains_unit");
  let innerQty = 1;
  if (inner) {
    if (inner === unit.id) forbid("A pack cannot contain itself.");
    let u;
    try { u = app.findRecordById("selling_units", inner); } catch (_) { forbid("The unit this pack contains does not exist."); }
    if (u.getString("product") !== unit.getString("product")) forbid("A pack can only contain units of the same product.");
    if (u.getString("deleted_at")) forbid("The unit this pack contains was removed.");
    innerQty = baseQty(app, u, (depth || 0) + 1);
  }
  return unit.getFloat("contains_qty") * innerQty;
}

const CODE = /^[0-9A-Za-z-]{1,48}$/;

// Every selling unit save.
function checkUnit(app, unit) {
  let product;
  try { product = app.findRecordById("products", unit.getString("product")); } catch (_) { forbid("Unknown product."); }
  const base = product.getString("base_unit");
  const kind = unit.getString("kind");
  if (kind === "weight" && base === "each") forbid("'By weight' units need a product sold by kg or lb.");
  if (kind === "single" && base !== "each") forbid("A product sold by weight has no 'single' unit; use 'by weight' or a pack.");
  if (kind === "pack" || kind === "case") {
    const q = unit.getFloat("contains_qty");
    if (!(q > 0)) forbid("Enter how many a " + kind + " contains.");
    if (base === "each" && q !== Math.floor(q)) forbid("A pack of single items contains a whole number (BR-03).");
    if (!threeDecimals(q)) forbid("Pack contents have at most 3 decimals.");
  } else {
    unit.set("contains_qty", 0);
    unit.set("contains_unit", "");
  }
  unit.set("base_qty", baseQty(app, unit, 0));
  if (unit.getInt("price_cents") < 0) forbid("Prices cannot be negative (BR-01).");

  // Barcodes: trimmed, unique in the list, and owned by one product only (DL-65).
  const codes = [];
  barcodesOf(unit).forEach((c) => {
    const v = String(c).trim();
    if (!v) return;
    if (!CODE.test(v)) forbid("Barcode '" + v + "' has characters a scanner does not produce.");
    if (codes.indexOf(v) < 0) codes.push(v);
  });
  unit.set("barcodes", codes);
  if (unit.getString("deleted_at") && !unit.isNew()) {
    const outer = app.findRecordsByFilter("selling_units", "contains_unit = {:u} && deleted_at = ''", "", 1, 0, { u: unit.id });
    if (outer.length) forbid("'" + outer[0].getString("name") + "' contains this unit; change or remove it first.");
  }
  if (!unit.getString("deleted_at")) {
    codes.forEach((c) => {
      const other = app.findRecordsByFilter("selling_units", "product != {:p} && deleted_at = '' && barcodes ~ {:q}", "", 0, 0,
        { p: unit.getString("product"), q: '"' + c + '"' }).filter((u) => barcodesOf(u).indexOf(c) >= 0);
      if (other.length) {
        let name = "another product";
        try { name = "'" + app.findRecordById("products", other[0].getString("product")).getString("name") + "'"; } catch (_) { /* keep generic */ }
        forbid("Barcode " + c + " already belongs to " + name + ".");
      }
    });
  }

  // An active product must stay valid with this change (e.g. a price removed, the last unit deleted).
  if (product.getString("status") === "active" && !unit.get("@batch")) {
    const list = problems(app, product, unitsOf(app, product.id, unit));
    if (list.length) forbid("This change would make '" + product.getString("name") + "' incomplete: " + list.map((p) => p.message).join(" "), { problems: list });
  }
}

// ---- Inside the event-log transaction ------------------------------------------------------

function history(app, product, unit, field, oldCents, newCents, actor, device) {
  const r = new Record(app.findCollectionByNameOrId("price_history"));
  r.load({ product: product, selling_unit: unit || "", field: field, old_cents: oldCents, new_cents: newCents, changed_by: actor });
  r.set("created_by", actor); r.set("updated_by", actor); r.set("@actor", actor);
  r.set("@device", device || "");
  if (device) r.set("device_id", device);
  app.save(r);
}

// BR-08: one open task lists the Drafts; it closes when there are none.
function syncDraftsTask(app) {
  const n = app.countRecords("products", $dbx.exp("status = 'draft' AND (deleted_at = '' OR deleted_at IS NULL)"));
  const key = "catalogue:drafts";
  const open = app.findRecordsByFilter("tasks", "rule_key = {:k} && status = 'open' && deleted_at = ''", "", 0, 0, { k: key });
  const title = n === 1 ? "1 product is a Draft and cannot be sold" : n + " products are Drafts and cannot be sold";
  const stampSys = (t) => { t.set("updated_by", "system:catalogue"); t.set("@actor", "system:catalogue"); };
  if (n > 0 && !open.length) {
    // Reopen the last one rather than add a task each time a product passes through Draft.
    const last = app.findRecordsByFilter("tasks", "rule_key = {:k} && status = 'done' && deleted_at = ''", "-updated_at", 1, 0, { k: key });
    const t = last.length ? last[0] : new Record(app.findCollectionByNameOrId("tasks"));
    t.load({ title: title, kind: "draft_products", source: "rule", rule_key: key, status: "open", priority: "normal", link_collection: "products", closed_at: "" });
    if (t.isNew()) t.set("created_by", "system:catalogue");
    stampSys(t);
    app.save(t);
  } else if (n > 0 && open[0].getString("title") !== title) {
    open[0].set("title", title); stampSys(open[0]); app.save(open[0]);
  } else if (n === 0) {
    open.forEach((t) => { t.set("status", "done"); t.set("closed_at", new DateTime()); stampSys(t); app.save(t); });
  }
}

function afterWrite(app, record, action) {
  const name = record.collection().name;
  const actor = record.get("@actor") || record.getString("updated_by") || "system";
  const device = record.get("@device") || "";
  const prev = record.get("@was") || { price_cents: 0, cost_cents: 0 };
  if (name === "selling_units") {
    const was = action === "create" ? 0 : prev.price_cents;
    const now = action === "delete" ? 0 : record.getInt("price_cents");
    if (was !== now) history(app, record.getString("product"), record.id, "price", was, now, actor, device);
    // Packs and cases built on this unit follow its size (their base_qty is recomputed on save).
    if (action !== "delete") {
      app.findRecordsByFilter("selling_units", "contains_unit = {:u} && deleted_at = ''", "", 0, 0, { u: record.id }).forEach((o) => {
        if (o.getFloat("base_qty") === o.getFloat("contains_qty") * record.getFloat("base_qty")) return;
        o.set("updated_by", actor); o.set("@actor", actor); o.set("@device", device);
        app.save(o);
      });
    }
    // Keep the product's draft_reasons current when its units change (not on superuser hard deletes).
    let p = null;
    if (action !== "delete") {
      try { p = app.findRecordById("products", record.getString("product")); } catch (_) { p = null; }
    }
    if (p && !p.getString("deleted_at") && p.getString("draft_reasons") !== JSON.stringify(problems(app, p, unitsOf(app, p.id)))) {
      p.set("updated_by", actor); p.set("@actor", actor); p.set("@device", device);
      app.save(p);
    }
  }
  if (name === "products") {
    const was = action === "create" ? 0 : prev.cost_cents;
    const now = action === "delete" ? 0 : record.getInt("cost_cents");
    if (was !== now) history(app, record.id, "", "cost", was, now, actor, device);
    syncDraftsTask(app);
  }
}

// ---- Read views ------------------------------------------------------------------------------

function unitView(u) {
  return { id: u.id, name: u.getString("name"), kind: u.getString("kind"), contains_qty: u.getFloat("contains_qty"),
    contains_unit: u.getString("contains_unit"), base_qty: u.getFloat("base_qty"), barcodes: barcodesOf(u),
    price_cents: u.getInt("price_cents"), sell_at_pos: u.getBool("sell_at_pos"), is_default: u.getBool("is_default"), sort: u.getInt("sort") };
}

// showCosts false (no costs.view, DL-72): no cost, no cost history.
function view(app, id, atIso, showCosts) {
  const p = app.findRecordById("products", id);
  const units = unitsOf(app, id);
  let taxes = [];
  if (p.getString("tax_class")) {
    try { taxes = require(`${__hooks}/lib/tax.js`).ratesFor(app, p.getString("tax_class"), undefined, atIso); } catch (_) { taxes = []; }
  }
  const history = app.findRecordsByFilter("price_history", "product = {:p}", "-created_at", 20, 0, { p: id }).map((h) => ({
    at: h.getString("created_at"), field: h.getString("field"), selling_unit: h.getString("selling_unit"),
    old_cents: h.getInt("old_cents"), new_cents: h.getInt("new_cents"), changed_by: h.getString("changed_by") }));
  const product = JSON.parse(JSON.stringify(p.publicExport()));
  if (showCosts === false) delete product.cost_cents;
  return { product: product, units: units.map(unitView), problems: problems(app, p, units), taxes: taxes,
    price_history: showCosts === false ? history.filter((h) => h.field !== "cost") : history };
}

// Barcode, PLU or scale code -> the units it sells (FR-3.02, 6.02, 6.03). Drafts are returned too
// (the phone opens them to finish), marked sellable: false.
function lookup(app, code) {
  const matches = [];
  app.findRecordsByFilter("selling_units", "deleted_at = '' && barcodes ~ {:q}", "sort", 0, 0, { q: '"' + code + '"' })
    .filter((u) => barcodesOf(u).indexOf(code) >= 0)
    .forEach((u) => matches.push({ unit: u, via: "barcode" }));
  app.findRecordsByFilter("products", "deleted_at = '' && (plu = {:c} || scale_code = {:c})", "", 0, 0, { c: code }).forEach((p) => {
    unitsOf(app, p.id).filter((u) => u.getBool("sell_at_pos") && (u.getBool("is_default") || u.getString("kind") === "weight" || u.getString("kind") === "single"))
      .slice(0, 1).forEach((u) => matches.push({ unit: u, via: p.getString("plu") === code ? "plu" : "scale_code" }));
  });
  const out = [];
  matches.forEach((m) => {
    let p;
    try { p = app.findRecordById("products", m.unit.getString("product")); } catch (_) { return; }
    if (p.getString("deleted_at") || p.getString("status") === "archived") return;
    out.push({ via: m.via, sellable: p.getString("status") === "active" && m.unit.getBool("sell_at_pos"),
      product: { id: p.id, name: p.getString("name"), status: p.getString("status"), base_unit: p.getString("base_unit"),
        tax_class: p.getString("tax_class"), age_restricted: p.getBool("age_restricted"), min_age: p.getInt("min_age") },
      unit: unitView(m.unit) });
  });
  return { code: code, matches: out, choose: out.filter((m) => m.sellable).length > 1 };
}

// The stored values before this save, read inside the transaction. (record.original() can be stale
// when the same record object is saved twice, e.g. created and then activated.)
function stored(app, record) {
  if (record.isNew()) return null;
  let db;
  try { db = app.findRecordById(record.collection().name, record.id); } catch (_) { return null; }
  return { base_unit: db.getString("base_unit"), price_cents: db.getInt("price_cents"), cost_cents: db.getInt("cost_cents") };
}

function beforeWrite(app, record, action) {
  if (action === "delete") return;   // hard deletes are superuser-only; soft deletes are updates
  record.set("@was", stored(app, record));
  if (record.collection().name === "products") checkProduct(app, record);
  else checkUnit(app, record);
}

module.exports = { beforeWrite, view, lookup, problems, checkProduct, checkUnit, unitsOf, barcodesOf, afterWrite, syncDraftsTask, moduleOn };

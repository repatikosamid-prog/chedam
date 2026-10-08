// Product import (P1 step 8): FR-11.03-11.07. The back-office browser reads the file, profiles and maps
// the columns and sends rows already in Chedam's fields (client/src/lib/import/). The hub:
//   check():  each row against the catalogue and the rest of the file, without saving: create, update or
//             skip (already in the catalogue), Draft reasons (the same rules as the product form, DL-66),
//             errors that stop the row, warnings (suspicious values), and the gaps (categories and tax
//             values that do not exist yet).
//   commit(): every row that is not excluded and has no error, in ONE transaction: all or nothing
//             (FR-11.07). Complete rows become Active; the others Drafts with their reasons. A job record
//             keeps what happened; a failed job is rolled back and says which line stopped it.
// Row fields (strings or numbers; empty = not given):
//   line, name, name_fr, category (name), tax (the file's value), tax_class (id chosen for it),
//   base_unit (each|kg|lb), price_cents, cost_cents, barcode, plu, size_qty, size_unit, pack_qty,
//   pack_price_cents, pack_barcode, origin_country, hs_code, reorder_point, description, age_restricted, min_age
// options: { on_existing: skip|update, price_includes_tax, create_categories, labels, scale_ack, categories: {name: id} }

const cat = () => require(`${__hooks}/lib/catalogue.js`);
function bad(msg) { throw new BadRequestError(msg); }
const MAX_ROWS = 2000;
const CODE = /^[0-9A-Za-z-]{1,48}$/;
const lc = (s) => String(s || "").trim().toLowerCase();
const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

function lookups(app) {
  const categories = {};
  app.findRecordsByFilter("categories", "deleted_at = ''", "", 0, 0).forEach((c) => { categories[lc(c.getString("name"))] = c.id; });
  const classes = {};
  app.findRecordsByFilter("tax_classes", "deleted_at = ''", "", 0, 0).forEach((c) => { classes[c.id] = c; });
  return { categories, classes };
}

// Existing product for a row: by barcode, then PLU, then the same name.
function existing(app, r) {
  if (r.barcode) {
    const m = cat().lookup(app, String(r.barcode)).matches.filter((x) => x.via === "barcode");
    if (m.length) return { product: m[0].product.id, unit: m[0].unit.id, via: "barcode" };
  }
  if (r.plu) {
    const p = app.findRecordsByFilter("products", "plu = {:p} && deleted_at = ''", "", 1, 0, { p: String(r.plu) });
    if (p.length) return { product: p[0].id, unit: "", via: "PLU" };
  }
  if (r.name) {
    const p = app.findRecordsByFilter("products", "name = {:n} && deleted_at = ''", "", 1, 0, { n: String(r.name).trim() });
    if (p.length) return { product: p[0].id, unit: "", via: "name" };
  }
  return null;
}

// One row: what would happen, and why.
function checkRow(app, r, L, seen, options, mayPrice) {
  const out = { line: r.line, name: String(r.name || "").trim(), action: "create", errors: [], drafts: [], warnings: [], match: null };
  const err = (m) => out.errors.push(m), warn = (m) => out.warnings.push(m), draft = (m) => out.drafts.push(m);
  if (!out.name) err("No name.");
  if (out.name.length > 160) err("The name is longer than 160 characters.");
  const base = r.base_unit || "each";
  if (["each", "kg", "lb"].indexOf(base) < 0) err("Sold by '" + base + "': use each, kg or lb.");
  const price = num(r.price_cents), cost = num(r.cost_cents);
  if (price !== null && (!(price >= 0) || price !== Math.floor(price))) err("The price is not a valid amount.");
  if (cost !== null && (!(cost >= 0) || cost !== Math.floor(cost))) err("The cost is not a valid amount.");
  [["barcode", r.barcode], ["pack barcode", r.pack_barcode]].forEach(([n, v]) => { if (v && !CODE.test(String(v))) err("The " + n + " '" + v + "' has characters a scanner does not produce."); });
  if (r.plu && !/^[0-9]{4,6}$/.test(String(r.plu))) err("PLU '" + r.plu + "' is not 4 to 6 digits.");
  if (r.origin_country && !/^[A-Z]{2}$/.test(String(r.origin_country))) warn("Country '" + r.origin_country + "' is not a 2-letter code: left out.");
  if (r.hs_code && !/^[0-9.]{4,14}$/.test(String(r.hs_code))) warn("HS code '" + r.hs_code + "' is not valid: left out.");
  const pq = num(r.pack_qty);
  if (pq !== null && (!(pq >= 2) || pq !== Math.floor(pq))) err("Pack size '" + r.pack_qty + "' is not a whole number of 2 or more.");
  if (pq && base !== "each") err("Packs are for products sold by the item.");
  // Duplicates inside the file
  [r.barcode, r.pack_barcode].filter(Boolean).forEach((b) => {
    if (seen.barcodes[b] && seen.barcodes[b] !== r.line) err("Barcode " + b + " is also on line " + seen.barcodes[b] + ".");
    else seen.barcodes[b] = r.line;
  });
  if (r.plu) { if (seen.plus[r.plu] && seen.plus[r.plu] !== r.line) err("PLU " + r.plu + " is also on line " + seen.plus[r.plu] + "."); else seen.plus[r.plu] = r.line; }
  const nk = lc(out.name) + "|" + (r.size_qty || "") + (r.size_unit || "");
  if (out.name && seen.names[nk] && seen.names[nk] !== r.line) warn("Same name as line " + seen.names[nk] + ".");
  else seen.names[nk] = r.line;
  // Already in the catalogue?
  const ex = existing(app, r);
  if (ex) {
    out.match = ex;
    out.action = options.on_existing === "update" ? "update" : "skip";
    if (ex.via === "name" && r.barcode) warn("A product with this name exists (with other barcodes).");
    if (out.action === "update" && !mayPrice && num(r.price_cents) !== null) warn("Its price is not changed: changing prices needs a manager.");
  }
  // What keeps it a Draft (the product form's rules, simplified to what a file can carry)
  const catId = r.category ? (L.categories[lc(r.category)] || (options.categories || {})[r.category] || "") : "";
  if (!r.category) draft("No category.");
  else if (!catId && options.create_categories) warn("Category '" + r.category + "' will be created.");
  else if (!catId) draft("Category '" + r.category + "' does not exist.");
  if (!r.tax_class) draft("No tax class" + (r.tax ? " for '" + r.tax + "'" : "") + ".");
  else if (!L.classes[r.tax_class]) err("Unknown tax class.");
  if (!price) draft("No price.");
  if (!r.barcode && !r.plu) draft("No barcode or PLU.");
  if (base !== "each" && !r.plu) draft("Sold by weight: needs a PLU.");
  if (base !== "each" && !options.scale_ack) draft("Sold by weight: confirm the approved scale.");
  if (out.action === "create" && !mayPrice) draft("A manager makes it active (prices need a manager).");
  // Suspicious values (FR-11.06)
  if (price !== null && cost !== null && cost > price && price > 0) warn("Costs more than it sells for.");
  if (price !== null && price > 100000) warn("Price over $1,000.");
  if (price === 0) warn("Price is $0.00.");
  if (cost === null && price) warn("No cost (margins will not show).");
  if (out.action === "create" && catId === "" && r.category && options.create_categories) out.new_category = r.category;
  return out;
}

// mayPrice: the person importing may set prices (prices.edit); without it new products stay Drafts.
function check(app, input, mayPrice) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) bad("The file has no rows to import.");
  if (rows.length > MAX_ROWS) bad("Up to " + MAX_ROWS + " rows at a time: split the file.");
  const options = input.options || {};
  const L = lookups(app);
  const seen = { barcodes: {}, plus: {}, names: {} };
  const results = rows.map((r) => checkRow(app, r, L, seen, options, mayPrice !== false));
  const missingCats = {}, noTax = {};
  rows.forEach((r, i) => {
    if (r.category && !L.categories[lc(r.category)] && !(options.categories || {})[r.category]) missingCats[r.category] = (missingCats[r.category] || 0) + 1;
    if (!r.tax_class && results[i].action !== "skip") noTax[r.tax || "(empty)"] = (noTax[r.tax || "(empty)"] || 0) + 1;
  });
  const count = (f) => results.filter(f).length;
  return {
    results,
    summary: { rows: rows.length, create: count((x) => x.action === "create" && !x.errors.length), update: count((x) => x.action === "update" && !x.errors.length),
      skip: count((x) => x.action === "skip"), errors: count((x) => x.errors.length > 0), drafts: count((x) => !x.errors.length && x.action !== "skip" && x.drafts.length > 0),
      warnings: count((x) => x.warnings.length > 0) },
    gaps: { categories: Object.keys(missingCats).map((n) => ({ name: n, rows: missingCats[n] })), tax: Object.keys(noTax).map((n) => ({ value: n, rows: noTax[n] })) },
  };
}

function newId() { return $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"); }

// The save body for one row (new product, or the fields to change on an existing one).
function bodyFor(app, r, L, options, catId, match, mayPrice) {
  const base = r.base_unit || "each";
  let price = num(r.price_cents) || 0, packPrice = num(r.pack_price_cents) || 0;
  // Prices that include tax become prices before tax (FR-11.04), at the class's rates today.
  if (options.price_includes_tax && r.tax_class && L.classes[r.tax_class]) {
    const rates = require(`${__hooks}/lib/tax.js`).ratesFor(app, r.tax_class).reduce((a, t) => a + t.rate, 0);
    if (rates) { price = Math.round(price / (1 + rates / 100)); packPrice = Math.round(packPrice / (1 + rates / 100)); }
  }
  const product = {};
  const set = (k, v) => { if (v !== null && v !== undefined && v !== "") product[k] = v; };
  set("name", String(r.name || "").trim());
  set("name_fr", r.name_fr ? String(r.name_fr).trim().substring(0, 160) : "");
  set("category", catId);
  set("tax_class", r.tax_class || "");
  if (num(r.cost_cents) !== null) product.cost_cents = num(r.cost_cents);
  set("plu", r.plu ? String(r.plu) : "");
  if (num(r.size_qty)) { product.size_qty = num(r.size_qty); product.size_unit = r.size_unit || "g"; }
  if (r.origin_country && /^[A-Z]{2}$/.test(String(r.origin_country))) product.origin_country = String(r.origin_country);
  if (r.hs_code && /^[0-9.]{4,14}$/.test(String(r.hs_code))) { product.hs_code = String(r.hs_code); product.imported = true; }
  if (num(r.reorder_point)) product.reorder_point = num(r.reorder_point);
  set("description", r.description ? String(r.description).substring(0, 1000) : "");
  if (r.age_restricted) { product.age_restricted = true; product.min_age = num(r.min_age) || 19; }
  if (match) {
    // Update: the product's fields from the file, and the price of the unit the barcode found (or its default unit).
    const units = [];
    let unitId = match.unit;
    if (!unitId) {
      const u = cat().unitsOf(app, match.product).filter((x) => !x.getString("deleted_at"));
      const d = u.find((x) => x.getBool("is_default")) || u[0];
      unitId = d ? d.id : "";
    }
    if (unitId && num(r.price_cents) !== null && mayPrice) units.push({ id: unitId, price_cents: price });
    product.id = match.product;
    return { product, units, activate: false, keep_draft: true };
  }
  product.base_unit = base;
  if (base !== "each" && options.scale_ack) product.scale_ack = true;
  const single = { id: newId(), name: base === "each" ? "Single" : "per " + base, kind: base === "each" ? "single" : "weight",
    barcodes: r.barcode ? [String(r.barcode)] : [], price_cents: price, sell_at_pos: true, is_default: true, sort: 1 };
  const units = [single];
  const pq = num(r.pack_qty);
  if (pq) units.push({ id: newId(), name: pq + "-pack", kind: "pack", contains_qty: pq, contains_unit: single.id,
    barcodes: r.pack_barcode ? [String(r.pack_barcode)] : [], price_cents: packPrice || price * pq, sell_at_pos: true, is_default: false, sort: 2 });
  return { product, units, activate: !!mayPrice, keep_draft: true };
}

function commit(app, input, ctx) {
  const started = Date.now();
  const options = input.options || {};
  const exclude = {};
  (input.exclude || []).forEach((l) => { exclude[l] = true; });
  const rows = (Array.isArray(input.rows) ? input.rows : []);
  const pre = check(app, input, ctx.mayPrice);
  const results = [];
  const counts = { created: 0, updated: 0, drafts: 0, skipped: 0, excluded: 0, categories_created: 0 };
  let failedAt = null, error = "";
  try {
    app.runInTransaction((tx) => {
      const L = lookups(tx);
      // Missing categories first (FR-11.06 "create missing records")
      if (options.create_categories) {
        const last = tx.findRecordsByFilter("categories", "deleted_at = ''", "-sort", 1, 0);
        let sort = last.length ? last[0].getInt("sort") : 0;
        pre.gaps.categories.forEach((g) => {
          const c = new Record(tx.findCollectionByNameOrId("categories"));
          c.load({ name: String(g.name).trim().substring(0, 80), sort: ++sort, pos_visible: true });
          c.set("created_by", ctx.actor); c.set("updated_by", ctx.actor); c.set("@actor", ctx.actor); c.set("@device", ctx.device || "");
          tx.save(c);
          L.categories[lc(g.name)] = c.id;
          counts.categories_created++;
        });
      }
      const save = require(`${__hooks}/lib/catalogue_save.js`).saveProduct;
      rows.forEach((r, i) => {
        const pr = pre.results[i];
        if (exclude[r.line]) { counts.excluded++; results.push({ line: r.line, action: "excluded" }); return; }
        if (pr.errors.length) { failedAt = r.line; throw new BadRequestError("Line " + r.line + ": " + pr.errors[0] + " Fix it or exclude the line."); }
        if (pr.action === "skip") { counts.skipped++; results.push({ line: r.line, action: "skipped", product: pr.match.product }); return; }
        const catId = r.category ? (L.categories[lc(r.category)] || (options.categories || {})[r.category] || "") : "";
        failedAt = r.line;
        const res = save(tx, bodyFor(tx, r, L, options, catId, pr.action === "update" ? pr.match : null, ctx.mayPrice),
          { actor: ctx.actor, device: ctx.device, mayPrice: ctx.mayPrice, noLabels: !options.labels });
        failedAt = null;
        if (pr.action === "update") { counts.updated++; results.push({ line: r.line, action: "updated", product: res.productId }); return; }
        counts.created++;
        if (res.status !== "active") counts.drafts++;
        results.push({ line: r.line, action: res.status === "active" ? "created" : "draft", product: res.productId, reasons: res.problems.map((p) => p.message) });
      });
    });
  } catch (err) {
    error = String((err && err.message) || err);
    if (failedAt && error.indexOf("Line ") !== 0) error = "Line " + failedAt + ": " + error;
  }
  const job = new Record(app.findCollectionByNameOrId("import_jobs"));
  job.load(Object.assign({ kind: "products", file_name: String(input.file_name || "").substring(0, 200), status: error ? "failed" : "completed",
    rows: rows.length, mapping: { columns: input.mapping || {}, options: options }, result: error ? [] : results, error: error.substring(0, 2000),
    seconds: Math.round((Date.now() - started) / 100) / 10 }, error ? { created: 0, updated: 0, drafts: 0, skipped: 0, excluded: 0, categories_created: 0 } : counts));
  job.set("created_by", ctx.actor); job.set("updated_by", ctx.actor); job.set("@actor", ctx.actor); job.set("@device", ctx.device || "");
  app.save(job);
  return jobView(job);
}

function jobView(j) {
  const g = (f) => { try { return JSON.parse(j.getString(f) || "null"); } catch (_) { return null; } };
  return { id: j.id, file_name: j.getString("file_name"), status: j.getString("status"), rows: j.getInt("rows"), created: j.getInt("created"),
    updated: j.getInt("updated"), drafts: j.getInt("drafts"), skipped: j.getInt("skipped"), excluded: j.getInt("excluded"),
    categories_created: j.getInt("categories_created"), error: j.getString("error"), seconds: j.getFloat("seconds"),
    created_at: j.getString("created_at"), by: j.getString("created_by"), result: g("result") || [], mapping: g("mapping") || {} };
}

module.exports = { check, commit, jobView, MAX_ROWS };

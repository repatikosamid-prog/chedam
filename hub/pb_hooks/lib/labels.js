// Shelf labels (P1 step 7): FR-5.13-5.16, BR-25.
// queue():   adds a product's selling unit to the label batch, merging duplicates (one pending line per
//            product and unit; reasons collected). Called by catalogue.js on a price change or when a
//            product goes on sale (BR-25), and from the Labels screen (scan, category, list).
// view():    the pending batch with what each label shows (name, prices, unit size, barcode, PLU, origin).
// make():    a printed batch: a snapshot of exactly what goes on the labels, with the layout and template,
//            kept for reprints (the last 10 are listed). confirm() takes its lines off the batch, unless
//            they changed since (a newer price is printed again).
// Promotion, promotion-end and markdown labels arrive with promotions (P2).

const st = () => require(`${__hooks}/lib/stock.js`);
function bad(msg) { throw new BadRequestError(msg); }
const REASONS = ["price_change", "new_product", "manual", "promotion", "markdown"];

function moduleOn(app) { return require(`${__hooks}/lib/catalogue.js`).moduleOn(app, "labels"); }

function reasonsOf(r) { try { return JSON.parse(r.getString("reasons") || "[]") || []; } catch (_) { return []; } }

// One pending line per product + unit (FR-5.13 "duplicates merged"). qty: labels wanted (manual adds may
// raise it; automatic adds keep what is there).
function queue(app, productId, unitId, reason, ctx, qty) {
  if (REASONS.indexOf(reason) < 0) reason = "manual";
  const found = app.findRecordsByFilter("label_batch_items", "status = 'pending' && product = {:p} && selling_unit = {:u}", "", 1, 0, { p: productId, u: unitId });
  const r = found.length ? found[0] : new Record(app.findCollectionByNameOrId("label_batch_items"));
  const reasons = found.length ? reasonsOf(r) : [];
  if (reasons.indexOf(reason) < 0) reasons.push(reason);
  r.load({ product: productId, selling_unit: unitId, reasons: reasons, status: "pending" });
  const want = Math.max(1, Math.min(999, Math.floor(Number(qty) || 1)));
  if (!found.length) r.set("qty", want);
  else if (qty && want > r.getInt("qty")) r.set("qty", want);
  st().stamp(r, ctx);
  app.save(r);
  return r;
}

// Automatic adds from catalogue.js (inside the product's own transaction). Only with the Labels module.
function autoPrice(app, unit, actor, device) {
  if (!moduleOn(app) || unit.getString("deleted_at") || !unit.getBool("sell_at_pos")) return;
  let p;
  try { p = app.findRecordById("products", unit.getString("product")); } catch (_) { return; }
  if (p.getString("status") !== "active" || p.getString("deleted_at")) return;   // a Draft gets its labels when it goes on sale
  queue(app, p.id, unit.id, "price_change", { actor: actor, device: device });
}

function autoNewProduct(app, product, actor, device) {
  if (!moduleOn(app)) return;
  app.findRecordsByFilter("selling_units", "product = {:p} && deleted_at = '' && sell_at_pos = true", "sort", 0, 0, { p: product.id })
    .forEach((u) => queue(app, product.id, u.id, "new_product", { actor: actor, device: device }));
}

function firstBarcode(u) { try { const b = JSON.parse(u.getString("barcodes") || "[]") || []; return b[0] || ""; } catch (_) { return ""; } }

// What one label shows, from the product and unit as they are now.
function labelData(app, p, u) {
  return { product: p.id, selling_unit: u.id, name: p.getString("name"), name_fr: p.getString("name_fr"), unit_name: u.getString("name"),
    kind: u.getString("kind"), price_cents: u.getInt("price_cents"), base_unit: p.getString("base_unit"), base_qty: u.getFloat("base_qty") || 1,
    size_qty: p.getFloat("size_qty"), size_unit: p.getString("size_unit"), barcode: firstBarcode(u), plu: p.getString("plu"),
    origin: p.getString("origin_country"), promo: null };
}

function itemView(app, r) {
  let p, u;
  try { p = app.findRecordById("products", r.getString("product")); u = app.findRecordById("selling_units", r.getString("selling_unit")); } catch (_) { return null; }
  return Object.assign(labelData(app, p, u), { id: r.id, qty: r.getInt("qty"), reasons: reasonsOf(r), version: r.getString("updated_at"),
    added_at: r.getString("created_at"), removed: !!(p.getString("deleted_at") || u.getString("deleted_at")) });
}

function view(app) {
  const items = app.findRecordsByFilter("label_batch_items", "status = 'pending'", "created_at", 0, 0).map((r) => itemView(app, r)).filter((x) => x);
  return { items: items, labels: items.reduce((a, x) => a + x.qty, 0) };
}

// Adds by scan/code, by category, or a list of {product, selling_unit, qty}. Returns how many lines.
function add(app, body, ctx) {
  let n = 0;
  if (body.code) {
    const m = require(`${__hooks}/lib/catalogue.js`).lookup(app, String(body.code).trim());
    if (!m.matches || !m.matches.length) bad("No product with code " + body.code + ".");
    const hit = m.matches[0];
    queue(app, hit.product.id, hit.unit.id, "manual", ctx, body.qty || 1); n++;
  }
  if (body.category) {
    const ps = app.findRecordsByFilter("products", "category = {:c} && status = 'active' && deleted_at = ''", "name", 0, 0, { c: String(body.category) });
    if (!ps.length) bad("No products on sale in that category.");
    ps.forEach((p) => app.findRecordsByFilter("selling_units", "product = {:p} && deleted_at = '' && sell_at_pos = true", "sort", 0, 0, { p: p.id })
      .forEach((u) => { queue(app, p.id, u.id, "manual", ctx); n++; }));
  }
  (Array.isArray(body.items) ? body.items : []).slice(0, 500).forEach((it, i) => {
    let u;
    try { u = app.findRecordById("selling_units", String(it.selling_unit || "")); } catch (_) { bad("Line " + (i + 1) + ": unknown unit."); }
    if (it.product && u.getString("product") !== it.product) bad("Line " + (i + 1) + ": that unit belongs to another product.");
    queue(app, u.getString("product"), u.id, "manual", ctx, it.qty || 1); n++;
  });
  if (!n) bad("Scan a code, choose a category or pick products.");
  return n;
}

function setQty(app, id, qty, ctx) {
  let r;
  try { r = app.findRecordById("label_batch_items", id); } catch (_) { bad("Unknown label line."); }
  if (r.getString("status") !== "pending") bad("That label was already printed.");
  if (Number(qty) === 0) { r.set("status", "removed"); }
  else {
    const q = Number(qty);
    if (!(q >= 1 && q <= 999) || q !== Math.floor(q)) bad("1 to 999 labels.");
    r.set("qty", q);
  }
  st().stamp(r, ctx);
  app.save(r);
  return r;
}

// ---- Printed batches (FR-5.16) --------------------------------------------------------------------

const num = (v, lo, hi) => { const n = Number(v); if (!(n >= lo && n <= hi)) bad("A layout size is out of range."); return n; };

// Checks a layout fits its page (labels inside the paper).
function checkLayout(l) {
  const out = { name: String(l.name || "Layout").substring(0, 80), paper: String(l.paper || "custom"),
    page_w_mm: num(l.page_w_mm, 10, 500), page_h_mm: num(l.page_h_mm, 10, 500), cols: Math.floor(num(l.cols, 1, 20)), rows: Math.floor(num(l.rows, 1, 40)),
    label_w_mm: num(l.label_w_mm, 5, 500), label_h_mm: num(l.label_h_mm, 5, 500), margin_top_mm: num(l.margin_top_mm || 0, 0, 200),
    margin_left_mm: num(l.margin_left_mm || 0, 0, 200), gap_x_mm: num(l.gap_x_mm || 0, 0, 100), gap_y_mm: num(l.gap_y_mm || 0, 0, 100),
    cut_lines: !!l.cut_lines, offset_x_mm: num(l.offset_x_mm || 0, -20, 20), offset_y_mm: num(l.offset_y_mm || 0, -20, 20) };
  const w = out.margin_left_mm + out.cols * out.label_w_mm + (out.cols - 1) * out.gap_x_mm;
  const h = out.margin_top_mm + out.rows * out.label_h_mm + (out.rows - 1) * out.gap_y_mm;
  if (w > out.page_w_mm + 0.5 || h > out.page_h_mm + 0.5) bad("The labels do not fit on the page (" + Math.round(w) + " × " + Math.round(h) + " mm on " + out.page_w_mm + " × " + out.page_h_mm + " mm).");
  return out;
}

// body: {items: [{id, qty}] (default: all pending), layout (id), template (id), start (1 = top left)}
function make(app, body, ctx) {
  let layout, template;
  try { layout = app.findRecordById("label_layouts", String(body.layout || "")); } catch (_) { bad("Choose a layout."); }
  try { template = app.findRecordById("label_templates", String(body.template || "")); } catch (_) { bad("Choose a template."); }
  const L = checkLayout(JSON.parse(JSON.stringify(layout.publicExport())));
  let fields = {};
  try { fields = JSON.parse(template.getString("fields") || "{}") || {}; } catch (_) { fields = {}; }
  const perPage = L.cols * L.rows;
  const start = Math.floor(Number(body.start || 1));
  if (!(start >= 1 && start <= perPage)) bad("Start position 1 to " + perPage + ".");
  const pick = Array.isArray(body.items) && body.items.length ? body.items : null;
  const items = [];
  (pick || app.findRecordsByFilter("label_batch_items", "status = 'pending'", "created_at", 0, 0).map((r) => ({ id: r.id }))).forEach((x) => {
    let r;
    try { r = app.findRecordById("label_batch_items", String(x.id)); } catch (_) { bad("Unknown label line."); }
    if (r.getString("status") !== "pending") return;
    const v = itemView(app, r);
    if (!v || v.removed) return;
    const q = x.qty !== undefined ? Math.floor(Number(x.qty)) : v.qty;
    if (!(q >= 1 && q <= 999)) bad("1 to 999 labels for '" + v.name + "'.");
    v.qty = q;
    items.push(v);
  });
  if (!items.length) bad("Nothing to print.");
  const labels = items.reduce((a, x) => a + x.qty, 0);
  if (labels > 3000) bad("Up to 3000 labels at a time.");
  const last = app.findRecordsByFilter("label_batches", "id != ''", "-number", 1, 0);
  const b = new Record(app.findCollectionByNameOrId("label_batches"));
  b.load({ number: last.length ? last[0].getInt("number") + 1 : 1, status: "made", layout: L, template: { name: template.getString("name"), fields: fields },
    items: items, labels: labels, start: start });
  st().stamp(b, ctx);
  app.save(b);
  return batchView(b);
}

function batchView(b) {
  const j = (f, d) => { try { return JSON.parse(b.getString(f) || "null") || d; } catch (_) { return d; } };
  return { id: b.id, number: b.getInt("number"), status: b.getString("status"), layout: j("layout", {}), template: j("template", {}), items: j("items", []),
    labels: b.getInt("labels"), start: b.getInt("start"), created_at: b.getString("created_at"), printed_at: b.getString("printed_at") };
}

// "Printed": its lines leave the batch, unless one changed after the batch was made (e.g. a new price):
// that one stays to be printed again.
function confirm(app, id, ctx) {
  let b;
  try { b = app.findRecordById("label_batches", id); } catch (_) { bad("Unknown batch."); }
  if (b.getString("status") === "printed") return { batch: batchView(b), done: 0, kept: 0 };
  let done = 0, kept = 0;
  batchView(b).items.forEach((x) => {
    let r;
    try { r = app.findRecordById("label_batch_items", x.id); } catch (_) { return; }
    if (r.getString("status") !== "pending") return;
    if (r.getString("updated_at") !== x.version) { kept++; return; }
    r.set("status", "printed"); r.set("batch", b.id);
    st().stamp(r, ctx);
    app.save(r);
    done++;
  });
  b.set("status", "printed"); b.set("printed_at", new DateTime()); b.set("printed_by", ctx.actor);
  st().stamp(b, ctx);
  app.save(b);
  return { batch: batchView(b), done, kept };
}

function recent(app) {
  return app.findRecordsByFilter("label_batches", "status = 'printed'", "-printed_at", 10, 0).map((b) => {
    const v = batchView(b);
    v.names = v.items.slice(0, 4).map((x) => x.name);
    return v;
  });
}

module.exports = { queue, autoPrice, autoNewProduct, view, add, setQty, make, confirm, recent, batchView, checkLayout, labelData };

// Stock (P1 step 2): FR-6.01-6.08, BR-05, 10, 14, 15, 18; DL-73..76.
// Every operation runs inside one transaction opened by its endpoint (stock.pb.js), so stock changes
// are processed one at a time (BR-10). Quantities are in the product's base unit (DL-64):
//   stock_levels.loose_qty   loose base units (singles, kg)
//   stock_levels.sealed      {selling_unit: sealed packs/cases}
//   on_hand = loose + sum(sealed x base_qty)
// stock_lots hold the same total by expiry and cost; decreases take the oldest expiry first (FEFO).

function bad(msg) { throw new BadRequestError(msg); }

function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }

const r3 = (n) => Math.round(n * 1000) / 1000;

// Store-local date "YYYY-MM-DD" (the hub's clock zone is the store time zone).
function today(offsetDays) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
const dbDate = (ymd) => ymd + " 00:00:00.000Z";
const ymd = (s) => String(s || "").substring(0, 10);

function stamp(r, ctx) {
  if (r.isNew()) { r.set("created_by", ctx.actor); if (ctx.device) r.set("device_id", ctx.device); }
  r.set("updated_by", ctx.actor); r.set("@actor", ctx.actor); r.set("@device", ctx.device || "");
}

function product(app, id) {
  let p;
  try { p = app.findRecordById("products", String(id || "")); } catch (_) { bad("Unknown product."); }
  if (p.getString("deleted_at") || p.getString("status") === "archived") bad("'" + p.getString("name") + "' is archived.");
  return p;
}

function unitOf(app, p, id) {
  const units = require(`${__hooks}/lib/catalogue.js`).unitsOf(app, p.id);
  if (!id) {
    // No unit given: the loose unit (single or by weight)
    const u = units.find((x) => x.getString("kind") === "single" || x.getString("kind") === "weight");
    if (!u) bad("'" + p.getString("name") + "' has no single or by-weight unit; choose a pack.");
    return u;
  }
  const u = units.find((x) => x.id === id);
  if (!u) bad("That selling unit is not part of '" + p.getString("name") + "'.");
  return u;
}

const isLooseUnit = (u) => u.getString("kind") === "single" || u.getString("kind") === "weight";

// Whole numbers for anything counted (BR-03); up to 3 decimals by weight.
function checkQty(u, q, label) {
  const n = Number(q);
  if (!(n > 0)) bad((label || "Quantity") + " must be more than 0.");
  if (u.getString("kind") === "weight") { if (Math.abs(r3(n) - n) > 1e-9) bad("Weights have at most 3 decimals."); }
  else if (n !== Math.floor(n)) bad((label || "Quantity") + " must be a whole number.");
  return n;
}

// ---- Levels and lots ---------------------------------------------------------------------------

function level(app, productId, ctx) {
  const found = app.findRecordsByFilter("stock_levels", "product = {:p}", "", 1, 0, { p: productId });
  if (found.length) return found[0];
  const lv = new Record(app.findCollectionByNameOrId("stock_levels"));
  lv.load({ product: productId, loose_qty: 0, sealed: {}, on_hand: 0, reserved: 0, incoming: 0 });
  stamp(lv, ctx);
  app.save(lv);
  return lv;
}

function sealedOf(lv) {
  try { return JSON.parse(lv.getString("sealed") || "{}") || {}; } catch (_) { return {}; }
}

function saveLevel(app, lv, sealed, ctx) {
  let total = lv.getFloat("loose_qty");
  Object.keys(sealed).forEach((uid) => {
    if (!sealed[uid]) { delete sealed[uid]; return; }
    try { total += sealed[uid] * app.findRecordById("selling_units", uid).getFloat("base_qty"); } catch (_) { /* removed unit */ }
  });
  lv.set("sealed", sealed);
  lv.set("loose_qty", r3(lv.getFloat("loose_qty")));
  lv.set("on_hand", r3(total));
  stamp(lv, ctx);
  app.save(lv);
}

function addLot(app, productId, qty, cost, opts, ctx) {
  const lot = new Record(app.findCollectionByNameOrId("stock_lots"));
  lot.load({ product: productId, lot_code: opts.lot_code || "", expiry_date: opts.expiry ? dbDate(opts.expiry) : "",
    received_qty: r3(qty), qty: r3(qty), cost_cents: Math.round(cost * 10000) / 10000, storage_area: opts.storage_area || "",
    source: opts.source, received_at: new DateTime() });
  stamp(lot, ctx);
  app.save(lot);
  return lot;
}

// FEFO (BR-14): lots with the earliest expiry first, lots without expiry last, then oldest received.
// Expired lots are skipped unless allowExpired (write-offs and counts may take them; sales may not).
function fefoLots(app, productId, opts) {
  const now = today();
  return app.findRecordsByFilter("stock_lots", "product = {:p} && qty > 0 && deleted_at = ''", "received_at", 0, 0, { p: productId })
    .filter((l) => opts.allowExpired || !l.getString("expiry_date") || ymd(l.getString("expiry_date")) >= now)
    .sort((a, b) => {
      if (opts.lot) { if (a.id === opts.lot) return -1; if (b.id === opts.lot) return 1; }
      const ea = ymd(a.getString("expiry_date")) || "9999", eb = ymd(b.getString("expiry_date")) || "9999";
      return ea < eb ? -1 : ea > eb ? 1 : a.getString("received_at") < b.getString("received_at") ? -1 : 1;
    });
}

// Takes qty from lots. dry: only work out which lots and the value. Returns {taken, value, short}.
function takeLots(app, productId, qty, opts, ctx) {
  let left = r3(qty), value = 0;
  const taken = [];
  fefoLots(app, productId, opts).forEach((l) => {
    if (left <= 0) return;
    const t = Math.min(left, l.getFloat("qty"));
    taken.push({ lot: l.id, qty: r3(t), cost_cents: l.getFloat("cost_cents"), expiry: ymd(l.getString("expiry_date")) });
    value += t * l.getFloat("cost_cents");
    left = r3(left - t);
    if (!opts.dry) { l.set("qty", r3(l.getFloat("qty") - t)); stamp(l, ctx); app.save(l); }
  });
  return { taken: taken, value: Math.round(value), short: left };
}

function movement(app, data, ctx, line) {
  const m = new Record(app.findCollectionByNameOrId("stock_movements"));
  m.load(Object.assign({ status: "posted", op_id: ctx.op || "", op_line: line || 0 }, data));
  stamp(m, ctx);
  app.save(m);
  return m;
}

// Refuses when there is not `n` of unit `u` (sealed for packs, loose for singles/weight).
function checkAvailable(p, u, n, lv, sealed) {
  const name = p.getString("name");
  if (isLooseUnit(u)) {
    if (lv.getFloat("loose_qty") + 1e-9 < r3(n)) {
      const packs = Object.keys(sealed).filter((k) => sealed[k] > 0).length;
      bad("Only " + r3(lv.getFloat("loose_qty")) + " loose of '" + name + "'" + (packs ? "; break a pack first." : "."));
    }
  } else if ((sealed[u.id] || 0) < n) {
    bad("Only " + (sealed[u.id] || 0) + " sealed '" + u.getString("name") + "' of '" + name + "'.");
  }
}

// Takes `n` of unit `u` out of the level. Returns the base quantity taken.
function removeFromLevel(app, p, u, n, lv, sealed) {
  checkAvailable(p, u, n, lv, sealed);
  if (isLooseUnit(u)) {
    lv.set("loose_qty", lv.getFloat("loose_qty") - r3(n));
    return r3(n);
  }
  sealed[u.id] = sealed[u.id] - n;
  return r3(n * u.getFloat("base_qty"));
}

function addToLevel(u, n, lv, sealed) {
  if (isLooseUnit(u)) { lv.set("loose_qty", lv.getFloat("loose_qty") + r3(n)); return r3(n); }
  sealed[u.id] = (sealed[u.id] || 0) + n;
  return r3(n * u.getFloat("base_qty"));
}

// ---- Receiving (FR-6.02, 6.04) --------------------------------------------------------------------

function receive(app, body, ctx) {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) bad("Add at least one line.");
  if (lines.length > 200) bad("At most 200 lines at a time.");
  const out = [];
  lines.forEach((ln, i) => {
    const p = product(app, ln.product);
    const u = unitOf(app, p, ln.selling_unit);
    const n = checkQty(u, ln.qty);
    const bq = u.getFloat("base_qty") || 1;
    const base = r3(n * bq);
    let unitCost = ln.cost_cents === undefined || ln.cost_cents === null || ln.cost_cents === "" ? null : Number(ln.cost_cents);
    if (unitCost !== null && !(unitCost >= 0 && unitCost === Math.floor(unitCost))) bad("Line " + (i + 1) + ": the cost is not a valid amount.");
    const perBase = unitCost === null ? p.getInt("cost_cents") : unitCost / bq;
    let expiry = ln.expiry_date ? ymd(ln.expiry_date) : "";
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) bad("Line " + (i + 1) + ": the expiry date is not valid.");
    if (!expiry && p.getBool("perishable")) {
      if (p.getInt("shelf_life_days") > 0 && !p.getBool("expiry_at_receiving")) expiry = today(p.getInt("shelf_life_days"));
      else bad("Enter the expiry date for '" + p.getString("name") + "'.");
    }
    const lot = addLot(app, p.id, base, perBase, { lot_code: String(ln.lot_code || "").substring(0, 60), expiry: expiry,
      storage_area: ln.storage_area || p.getString("storage_area"), source: "receive" }, ctx);
    const lv = level(app, p.id, ctx);
    const sealed = sealedOf(lv);
    addToLevel(u, n, lv, sealed);
    lv.set("last_received_at", new DateTime());
    saveLevel(app, lv, sealed, ctx);
    out.push(movement(app, { product: p.id, type: "receive", qty_base: base, selling_unit: u.id, unit_qty: n, lot: lot.id,
      cost_cents: Math.round(perBase * 10000) / 10000, value_cents: Math.round(base * perBase), note: String(ln.note || "").substring(0, 1000) }, ctx, i));
    // Last cost becomes the product's cost (FR-6.04 "last cost"); the change goes to price history.
    if (unitCost !== null && Math.round(perBase) !== p.getInt("cost_cents")) {
      p.set("cost_cents", Math.round(perBase));
      stamp(p, ctx);
      app.save(p);
    }
  });
  return out;
}

// ---- Adjust, damage, loss (FR-6.06, BR-05, BR-18) -------------------------------------------------

function reasons(app, type) {
  const all = setting(app, "stock.reasons", {}) || {};
  return all[type] || [];
}

// body: {product, selling_unit?, qty, type: adjust|damage|loss, direction: in|out (adjust only), reason, note, lot?}
// Returns the movement; status "pending" when it waits for a manager (value above the approval limit).
function adjust(app, body, ctx, canApprove, photo) {
  const type = String(body.type || "");
  if (["adjust", "damage", "loss"].indexOf(type) < 0) bad("Choose adjust, damage or loss.");
  const out = type !== "adjust" || body.direction !== "in";
  const reason = String(body.reason || "").trim();
  if (!reason) bad("Choose a reason (BR-05).");
  if (reasons(app, type).indexOf(reason) < 0) bad("Unknown reason '" + reason + "'.");
  const p = product(app, body.product);
  const u = unitOf(app, p, body.selling_unit);
  const n = checkQty(u, body.qty);
  const base = r3(n * (u.getFloat("base_qty") || 1));
  const lv = level(app, p.id, ctx);
  const sealed = sealedOf(lv);
  const data = { product: p.id, type: type, selling_unit: u.id, unit_qty: n, reason: reason, note: String(body.note || "").substring(0, 1000) };
  if (photo) data.photo = photo;

  if (!out) {
    const lot = addLot(app, p.id, base, p.getInt("cost_cents"), { source: "adjust", storage_area: p.getString("storage_area") }, ctx);
    addToLevel(u, n, lv, sealed);
    saveLevel(app, lv, sealed, ctx);
    return movement(app, Object.assign(data, { qty_base: base, lot: lot.id, cost_cents: p.getInt("cost_cents"),
      value_cents: Math.round(base * p.getInt("cost_cents")) }), ctx);
  }

  // Check there is enough, and what it is worth at cost, before deciding who must approve.
  checkAvailable(p, u, n, lv, sealed);
  const peek = takeLots(app, p.id, base, { allowExpired: true, dry: true, lot: body.lot }, ctx);
  const limit = Number(setting(app, "stock.approval_value_cents", 2500));
  if (!canApprove && (limit === 0 || peek.value > limit)) {
    const m = movement(app, Object.assign(data, { status: "pending", qty_base: -base, value_cents: -peek.value, lot: body.lot || "" }), ctx);
    syncApprovals(app, ctx);
    return m;
  }
  return applyOut(app, p, u, n, Object.assign(data, { lot: body.lot || "" }), ctx);
}

function applyOut(app, p, u, n, data, ctx, existing) {
  const lv = level(app, p.id, ctx);
  const sealed = sealedOf(lv);
  const base = removeFromLevel(app, p, u, n, lv, sealed);
  saveLevel(app, lv, sealed, ctx);
  const t = takeLots(app, p.id, base, { allowExpired: true, lot: data.lot }, ctx);
  const fields = { qty_base: -base, lots_taken: t.taken, value_cents: -t.value,
    cost_cents: base ? Math.round((t.value / base) * 10000) / 10000 : 0 };
  if (existing) {
    existing.load(Object.assign(fields, { status: "posted", approved_by: ctx.actor, approved_at: new DateTime() }));
    stamp(existing, ctx);
    app.save(existing);
    return existing;
  }
  return movement(app, Object.assign(data, fields), ctx);
}

// Manager approves or rejects a pending write-off (FR-6.06).
function decide(app, id, approve, ctx) {
  let m;
  try { m = app.findRecordById("stock_movements", id); } catch (_) { bad("Unknown stock change."); }
  if (m.getString("status") !== "pending") bad("This change was already decided.");
  if (approve) {
    const p = product(app, m.getString("product"));
    const u = unitOf(app, p, m.getString("selling_unit"));
    applyOut(app, p, u, m.getFloat("unit_qty"), { lot: m.getString("lot") }, ctx, m);
  } else {
    m.set("status", "rejected"); m.set("approved_by", ctx.actor); m.set("approved_at", new DateTime());
    stamp(m, ctx);
    app.save(m);
  }
  syncApprovals(app, ctx);
  return m;
}

function syncApprovals(app, ctx) {
  const n = app.countRecords("stock_movements", $dbx.exp("status = 'pending'"))
    + app.countRecords("stock_counts", $dbx.exp("status = 'submitted'"));
  require(`${__hooks}/lib/tasks.js`).syncRuleTask(app, "stock:approvals", n,
    n === 1 ? "1 stock change waits for approval" : n + " stock changes wait for approval",
    { kind: "stock_approval", link_collection: "stock_movements", priority: "normal" }, ctx ? ctx.actor : "system:stock");
}

// ---- Packs (FR-6.05, BR-15) ---------------------------------------------------------------------

// The sealed unit a pack opens into (a case of 12-packs), or "" when it opens into loose stock
// (a pack of singles, or a pack with no inner unit).
function sealedInner(app, u) {
  const id = u.getString("contains_unit");
  if (!id) return "";
  try { return isLooseUnit(app.findRecordById("selling_units", id)) ? "" : id; } catch (_) { return ""; }
}

// Opens `count` sealed packs/cases into what they contain. damaged: base units found damaged on opening.
function packBreak(app, body, ctx) {
  const p = product(app, body.product);
  const u = unitOf(app, p, body.selling_unit);
  if (isLooseUnit(u)) bad("Choose a pack or case to break.");
  const n = checkQty(u, body.count, "Number of packs");
  const lv = level(app, p.id, ctx);
  const sealed = sealedOf(lv);
  if ((sealed[u.id] || 0) < n) bad("Only " + (sealed[u.id] || 0) + " sealed '" + u.getString("name") + "'.");
  sealed[u.id] -= n;
  const inner = sealedInner(app, u);
  const qty = r3(n * u.getFloat("contains_qty"));
  if (inner) sealed[inner] = (sealed[inner] || 0) + qty;
  else lv.set("loose_qty", lv.getFloat("loose_qty") + qty);
  saveLevel(app, lv, sealed, ctx);
  const m = movement(app, { product: p.id, type: "pack_break", qty_base: 0, selling_unit: u.id, unit_qty: n,
    note: "Opened " + n + " x " + u.getString("name") }, ctx);
  const damaged = Number(body.damaged || 0);
  if (damaged > 0) {
    if (inner) bad("Damaged units are recorded when breaking into single items.");
    const single = unitOf(app, p, "");
    // Second movement of the same operation: its own op line.
    const dctx = Object.assign({}, ctx, { op: ctx.op ? ctx.op.substring(0, 37) + "-d" : "" });
    applyOut(app, p, single, checkQty(single, damaged, "Damaged units"), { product: p.id, type: "damage", selling_unit: single.id,
      unit_qty: damaged, reason: "Damaged when opening a pack", note: "Found when opening " + u.getString("name") }, dctx);
  }
  return m;
}

// Makes `count` packs out of what they contain (e.g. hampers, re-packing singles).
function packMake(app, body, ctx) {
  const p = product(app, body.product);
  const u = unitOf(app, p, body.selling_unit);
  if (isLooseUnit(u)) bad("Choose a pack or case to make.");
  const n = checkQty(u, body.count, "Number of packs");
  const lv = level(app, p.id, ctx);
  const sealed = sealedOf(lv);
  const inner = sealedInner(app, u);
  const qty = r3(n * u.getFloat("contains_qty"));
  if (inner) {
    if ((sealed[inner] || 0) < qty) bad("Not enough sealed inner packs.");
    sealed[inner] -= qty;
  } else {
    if (lv.getFloat("loose_qty") + 1e-9 < qty) bad("Only " + r3(lv.getFloat("loose_qty")) + " loose.");
    lv.set("loose_qty", lv.getFloat("loose_qty") - qty);
  }
  sealed[u.id] = (sealed[u.id] || 0) + n;
  saveLevel(app, lv, sealed, ctx);
  return movement(app, { product: p.id, type: "pack_make", qty_base: 0, selling_unit: u.id, unit_qty: n,
    note: "Made " + n + " x " + u.getString("name") }, ctx);
}

// ---- Counts (FR-6.08) ---------------------------------------------------------------------------

function count(app, id) {
  let c;
  try { c = app.findRecordById("stock_counts", id); } catch (_) { bad("Unknown count."); }
  return c;
}

function startCount(app, body, ctx) {
  const c = new Record(app.findCollectionByNameOrId("stock_counts"));
  c.load({ name: String(body.name || "Stock count " + today()).substring(0, 120), status: "open",
    category: body.category || "", storage_area: body.storage_area || "", note: String(body.note || "").substring(0, 1000) });
  stamp(c, ctx);
  app.save(c);
  return c;
}

// detail: {loose, sealed: {unit: n}} or counted_base. Expected = on hand at this moment, so sales
// during the count do not show up as variance.
function countLine(app, id, body, ctx) {
  const c = count(app, id);
  if (c.getString("status") !== "open") bad("This count is no longer open.");
  const p = product(app, body.product);
  let counted = 0, detail = null;
  if (body.detail) {
    const loose = Number(body.detail.loose || 0);
    if (!(loose >= 0)) bad("Loose quantity cannot be negative.");
    detail = { loose: r3(loose), sealed: {} };
    counted = loose;
    Object.keys(body.detail.sealed || {}).forEach((uid) => {
      const u = unitOf(app, p, uid);
      const k = Number(body.detail.sealed[uid] || 0);
      if (!(k >= 0) || k !== Math.floor(k)) bad("Sealed packs are whole numbers.");
      if (k) { detail.sealed[u.id] = k; counted += k * u.getFloat("base_qty"); }
    });
  } else {
    counted = Number(body.counted_base);
    if (!(counted >= 0)) bad("Enter the quantity counted.");
  }
  if (p.getString("base_unit") === "each" && counted !== Math.floor(counted)) bad("Counted items are whole numbers.");
  const found = app.findRecordsByFilter("stock_count_lines", "count = {:c} && product = {:p}", "", 1, 0, { c: c.id, p: p.id });
  const line = found.length ? found[0] : new Record(app.findCollectionByNameOrId("stock_count_lines"));
  line.load({ count: c.id, product: p.id, expected_base: level(app, p.id, ctx).getFloat("on_hand"), counted_base: r3(counted),
    counted_detail: detail, counted_by: ctx.actor, counted_at: new DateTime() });
  stamp(line, ctx);
  app.save(line);
  return line;
}

function setCountStatus(app, id, from, to, ctx, who) {
  const c = count(app, id);
  if (from.indexOf(c.getString("status")) < 0) bad("This count is " + c.getString("status") + ".");
  c.set("status", to);
  if (who) { c.set(who + "_by", ctx.actor); c.set(who + "_at", new DateTime()); }
  stamp(c, ctx);
  app.save(c);
  syncApprovals(app, ctx);
  return c;
}

// Applies each line's variance (counted - expected) as a "count" movement.
function approveCount(app, id, ctx) {
  const c = count(app, id);
  if (c.getString("status") !== "submitted") bad("Submit the count before approving it.");
  app.findRecordsByFilter("stock_count_lines", "count = {:c}", "", 0, 0, { c: c.id }).forEach((line, i) => {
    const p = product(app, line.getString("product"));
    const delta = r3(line.getFloat("counted_base") - line.getFloat("expected_base"));
    const lv = level(app, p.id, ctx);
    let detail = null;
    try { detail = JSON.parse(line.getString("counted_detail") || "null"); } catch (_) { detail = null; }
    let sealed = sealedOf(lv);
    if (detail) {
      // What was seen on the shelf: sealed packs as counted, the rest loose (plus sales since counting).
      sealed = Object.assign({}, detail.sealed);
      let sealedBase = 0;
      Object.keys(sealed).forEach((uid) => { try { sealedBase += sealed[uid] * app.findRecordById("selling_units", uid).getFloat("base_qty"); } catch (_) { /* gone */ } });
      lv.set("loose_qty", r3(lv.getFloat("on_hand") + delta - sealedBase));
    } else {
      lv.set("loose_qty", lv.getFloat("loose_qty") + delta);
    }
    lv.set("last_counted_at", new DateTime());
    saveLevel(app, lv, sealed, ctx);
    if (!delta) return;
    const data = { product: p.id, type: "count", qty_base: delta, reason: "Count variance", ref_collection: "stock_counts", ref_id: c.id };
    if (delta < 0) {
      const t = takeLots(app, p.id, -delta, { allowExpired: true }, ctx);
      movement(app, Object.assign(data, { lots_taken: t.taken, value_cents: -t.value }), ctx, i);
    } else {
      const lot = addLot(app, p.id, delta, p.getInt("cost_cents"), { source: "count", storage_area: p.getString("storage_area") }, ctx);
      movement(app, Object.assign(data, { lot: lot.id, cost_cents: p.getInt("cost_cents"), value_cents: Math.round(delta * p.getInt("cost_cents")) }), ctx, i);
    }
  });
  return setCountStatus(app, id, ["submitted"], "approved", ctx, "approved");
}

// ---- Views and reports ------------------------------------------------------------------------

// on hand vs reorder point (FR-6.01 colour status): out, low, ok
function statusOf(p, onHand) {
  if (onHand <= 0) return "out";
  if (p.getFloat("reorder_point") > 0 && onHand <= p.getFloat("reorder_point")) return "low";
  return "ok";
}

function productView(app, id, showCost) {
  const p = product(app, id);
  const units = require(`${__hooks}/lib/catalogue.js`).unitsOf(app, p.id);
  const found = app.findRecordsByFilter("stock_levels", "product = {:p}", "", 1, 0, { p: p.id });
  const lv = found[0];
  const sealed = lv ? sealedOf(lv) : {};
  const onHand = lv ? lv.getFloat("on_hand") : 0;
  const now = today();
  const lots = app.findRecordsByFilter("stock_lots", "product = {:p} && qty > 0", "received_at", 0, 0, { p: p.id }).map((l) => {
    const e = ymd(l.getString("expiry_date"));
    const v = { id: l.id, lot_code: l.getString("lot_code"), expiry_date: e, qty: l.getFloat("qty"), received_at: l.getString("received_at"),
      storage_area: l.getString("storage_area"), expired: !!e && e < now };
    if (showCost) v.cost_cents = l.getFloat("cost_cents");
    return v;
  }).sort((a, b) => (a.expiry_date || "9999") < (b.expiry_date || "9999") ? -1 : 1);
  const moves = app.findRecordsByFilter("stock_movements", "product = {:p}", "-created_at", 30, 0, { p: p.id }).map((m) => {
    const v = { id: m.id, at: m.getString("created_at"), type: m.getString("type"), status: m.getString("status"), qty_base: m.getFloat("qty_base"),
      selling_unit: m.getString("selling_unit"), unit_qty: m.getFloat("unit_qty"), reason: m.getString("reason"), note: m.getString("note"),
      by: m.getString("created_by"), photo: m.getString("photo") };
    if (showCost) v.value_cents = m.getInt("value_cents");
    return v;
  });
  return {
    product: { id: p.id, name: p.getString("name"), base_unit: p.getString("base_unit"), reorder_point: p.getFloat("reorder_point"), status: p.getString("status") },
    units: units.map((u) => ({ id: u.id, name: u.getString("name"), kind: u.getString("kind"), base_qty: u.getFloat("base_qty"), contains_unit: u.getString("contains_unit") })),
    level: { on_hand: onHand, loose_qty: lv ? lv.getFloat("loose_qty") : 0, sealed: sealed, reserved: lv ? lv.getFloat("reserved") : 0,
      incoming: lv ? lv.getFloat("incoming") : 0, available: onHand - (lv ? lv.getFloat("reserved") : 0),
      last_received_at: lv ? lv.getString("last_received_at") : "", last_counted_at: lv ? lv.getString("last_counted_at") : "" },
    status: statusOf(p, onHand),
    lots: lots, movements: moves, reasons: setting(app, "stock.reasons", {}),
  };
}

// FR-6.07: write-offs (damage, loss), stock taken out by adjustment and negative count variances,
// by reason and by product, at cost. from/to are store dates (inclusive).
// Start of a store-local day as a stored UTC time.
function dayStart(ymdText, plusDays) {
  const a = ymdText.split("-").map(Number);
  return new Date(a[0], a[1] - 1, a[2] + (plusDays || 0)).toISOString().replace("T", " ");
}

function shrink(app, from, to) {
  const rows = app.findRecordsByFilter("stock_movements",
    "status = 'posted' && qty_base < 0 && (type = 'damage' || type = 'loss' || type = 'adjust' || type = 'count') && created_at >= {:f} && created_at < {:t}",
    "created_at", 0, 0, { f: dayStart(from), t: dayStart(to, 1) });
  const byReason = {}, byProduct = {};
  let total = 0;
  rows.forEach((m) => {
    const v = -m.getInt("value_cents");
    const key = (m.getString("type") === "count" ? "Count variance" : m.getString("reason")) || "Other";
    const r = byReason[key] || (byReason[key] = { reason: key, type: m.getString("type"), value_cents: 0, entries: 0 });
    r.value_cents += v; r.entries++;
    const pid = m.getString("product");
    const p = byProduct[pid] || (byProduct[pid] = { product: pid, name: "", qty_base: 0, value_cents: 0 });
    p.qty_base = r3(p.qty_base - m.getFloat("qty_base")); p.value_cents += v;
    total += v;
  });
  Object.keys(byProduct).forEach((pid) => {
    try {
      const pr = app.findRecordById("products", pid);
      byProduct[pid].name = pr.getString("name"); byProduct[pid].base_unit = pr.getString("base_unit");
    } catch (_) { byProduct[pid].name = "(removed)"; }
  });
  const sort = (a, b) => b.value_cents - a.value_cents;
  return { from: from, to: to, total_cents: total, entries: rows.length,
    by_reason: Object.values(byReason).sort(sort), by_product: Object.values(byProduct).sort(sort) };
}

module.exports = { receive, adjust, decide, packBreak, packMake, startCount, countLine, setCountStatus, approveCount,
  productView, shrink, syncApprovals, takeLots, fefoLots, level, today, statusOf,
  // used by selling (lib/sales.js)
  sealedOf, saveLevel, removeFromLevel, addToLevel, checkAvailable, sealedInner, isLooseUnit, movement, stamp, r3, dbDate, ymd };

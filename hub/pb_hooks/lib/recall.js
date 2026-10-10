// Recall trace and customer feedback (P3 step 10; FR-6.15, 7.09).
// trace(): a product's lots (optionally only some lot codes, or expiry dates in a range): where each came from
//   (receipt / count / return, when, the purchase order's vendor when known), how much is left, and every sale
//   that took from it: when, how many, which member bought it (first name only, for calling them back).
// recall(): the chosen lots are marked recalled (FEFO never takes them again) and what is left is written off
//   ("Recall"); when a lot cannot be written off by itself (sealed packs), a task asks someone to pull it.
// Feedback: a rating 1-5 and a comment, from a kiosk tablet (a device paired as a kiosk, nobody signed in) or the
//   receipt's link (a code made from the sale, so links cannot be made up); a report with the average.

const st = () => require(`${__hooks}/lib/stock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const r3 = (x) => Math.round(x * 1000) / 1000;

// q: {product, lot_codes: [..], expiry_from, expiry_to}
function lotsFor(app, q) {
  const p = app.findRecordById("products", String(q.product || ""));
  const codes = (Array.isArray(q.lot_codes) ? q.lot_codes : String(q.lot_codes || "").split(",")).map((x) => String(x).trim()).filter(Boolean);
  let lots = app.findRecordsByFilter("stock_lots", "product = {:p} && deleted_at = ''", "received_at", 0, 0, { p: p.id });
  if (codes.length) lots = lots.filter((l) => codes.indexOf(l.getString("lot_code")) >= 0);
  const from = String(q.expiry_from || ""), to = String(q.expiry_to || "");
  if (from) lots = lots.filter((l) => l.getString("expiry_date").substring(0, 10) >= from);
  if (to) lots = lots.filter((l) => l.getString("expiry_date") && l.getString("expiry_date").substring(0, 10) <= to);
  return { p: p, lots: lots };
}

function trace(app, q) {
  const f = lotsFor(app, q);
  const out = f.lots.map((l) => {
    // Where it came from: the receive movement of this lot (and its purchase order note)
    const mv = app.findRecordsByFilter("stock_movements", "lot = {:l}", "created_at", 1, 0, { l: l.id })[0];
    const sales = app.findRecordsByFilter("sale_lines", "lots ~ {:l} && voided = false", "", 0, 0, { l: l.id }).map((sl) => {
      const t = j(sl, "lots", []).filter((x) => x.lot === l.id).reduce((a, x) => a + (Number(x.qty) || 0), 0);
      let s = null, member = "";
      try { s = app.findRecordById("sales", sl.getString("sale")); } catch (_) { s = null; }
      if (s && s.getString("customer")) { try { const c = app.findRecordById("customers", s.getString("customer")); member = c.getString("status") === "active" ? c.getString("first_name") + (c.getString("phone") ? " (…" + c.getString("phone").slice(-4) + ")" : "") : ""; } catch (_) { member = ""; } }
      return { sale: sl.getString("sale"), number: s ? s.getString("number") : "", at: s ? s.getString("completed_at") : "", qty: r3(t), member: member, customer: s ? s.getString("customer") : "" };
    }).filter((x) => x.qty > 0);
    return { id: l.id, lot_code: l.getString("lot_code"), expiry: l.getString("expiry_date").substring(0, 10), received_at: l.getString("received_at"), source: l.getString("source"),
      received_qty: l.getFloat("received_qty"), left: l.getFloat("qty"), recalled: l.getBool("recalled"), how: mv ? (mv.getString("note") || mv.getString("type")) : "",
      sold: r3(sales.reduce((a, x) => a + x.qty, 0)), sales: sales };
  });
  const members = {};
  out.forEach((l) => l.sales.forEach((x) => { if (x.customer) members[x.customer] = x.member; }));
  return { product: { id: f.p.id, name: f.p.getString("name") }, lots: out, members: Object.keys(members).map((id) => ({ id: id, name: members[id] })),
    sold: r3(out.reduce((a, l) => a + l.sold, 0)), left: r3(out.reduce((a, l) => a + l.left, 0)) };
}

// body: q + {lots: [ids] (default: all matched), reason, source}
function recall(app, c, b) {
  const f = lotsFor(app, b);
  const ids = Array.isArray(b.lots) && b.lots.length ? b.lots : f.lots.map((l) => l.id);
  const chosen = f.lots.filter((l) => ids.indexOf(l.id) >= 0);
  if (!chosen.length) bad("No lots to recall.");
  if (!String(b.reason || "").trim()) bad("Say why (the recall notice).");
  const r = new Record(app.findCollectionByNameOrId("recalls"));
  r.load({ product: f.p.id, lots: chosen.map((l) => l.id), reason: String(b.reason).substring(0, 500), source: String(b.source || "").substring(0, 200), written_off: [], by_name: c.user ? c.user.getString("name") : "" });
  r.set("number", "RC-" + ("000000" + require(`${__hooks}/lib/sales.js`).nextNumber(app, "recall", c)).slice(-6));
  stamp(r, c); app.save(r);
  const done = [];
  chosen.forEach((l) => {
    const left = l.getFloat("qty");
    const flag = () => { const x = app.findRecordById("stock_lots", l.id); x.set("recalled", true); x.set("recall", r.id); st().stamp(x, c); app.save(x); };
    if (left <= 0) { flag(); return; }
    try {
      // Written off from this lot as loose units; a product kept only in sealed packs needs a person to pull it
      const m = st().adjust(app, { product: f.p.id, qty: left, type: "loss", reason: "Recall", lot: l.id, note: r.getString("number") + ": " + r.getString("reason").substring(0, 200) },
        { actor: c.actor, device: c.device, op: "" }, true);
      done.push({ lot: l.id, qty: left, movement: m.id });
      flag();
    } catch (err) {
      flag();
      const t = new Record(app.findCollectionByNameOrId("tasks"));
      t.load({ title: ("Pull recalled " + f.p.getString("name") + (l.getString("lot_code") ? " lot " + l.getString("lot_code") : "") + " (" + left + ") off the shelf and write it off").substring(0, 200),
        kind: "recall", source: "manual", status: "open", priority: "urgent", link_collection: "products", link_id: f.p.id, note: r.getString("reason") });
      stamp(t, c); app.save(t);
      done.push({ lot: l.id, qty: left, task: t.id });
    }
  });
  r.set("written_off", done); stamp(r, c); app.save(r);
  return { recall: { id: r.id, number: r.getString("number") }, lots: chosen.length, written_off: done, trace: trace(app, Object.assign({}, b, { lot_codes: [] })).lots.filter((x) => ids.indexOf(x.id) >= 0) };
}

function recalls(app) {
  return { items: app.findRecordsByFilter("recalls", "deleted_at = ''", "-created_at", 100, 0).map((r) => {
    let name = "";
    try { name = app.findRecordById("products", r.getString("product")).getString("name"); } catch (_) { name = ""; }
    return { id: r.id, number: r.getString("number"), product: r.getString("product"), product_name: name, lots: j(r, "lots", []).length, reason: r.getString("reason"),
      source: r.getString("source"), written_off: j(r, "written_off", []), by: r.getString("by_name"), at: r.getString("created_at") };
  }) };
}

// ---- Feedback (FR-7.09) ------------------------------------------------------------------------------------

function saleCode(app, saleId) {
  let key = "";
  try { key = app.findRecordsByFilter("business", "id != ''", "", 1, 0)[0].id; } catch (_) { key = "chedam"; }
  return $security.sha256(saleId + ":feedback:" + key).substring(0, 8);
}

// body: {rating, comment, sale?, code?}; from a kiosk device or a receipt link
function give(app, e, b) {
  const rating = Math.round(Number(b.rating));
  if (!(rating >= 1 && rating <= 5)) bad("Choose 1 to 5 stars.");
  let source = "", sale = "";
  const dev = require(`${__hooks}/lib/devices.js`).current(e);
  if (b.sale) {
    if (String(b.code || "") !== saleCode(app, String(b.sale))) bad("This link is not valid.");
    let s = null;
    try { s = app.findRecordById("sales", String(b.sale)); } catch (_) { s = null; }
    if (!s) bad("This link is not valid.");
    if (app.findRecordsByFilter("feedback", "sale = {:s}", "", 1, 0, { s: s.id }).length) bad("Thank you: we already have your feedback for this visit.");
    source = "receipt"; sale = s.id;
  } else if (dev && dev.getString("type") === "kiosk") source = "kiosk";
  else bad("Feedback comes from the store's kiosk or the link on your receipt.");
  const f = new Record(app.findCollectionByNameOrId("feedback"));
  f.load({ rating: rating, comment: String(b.comment || "").trim().substring(0, 1000), source: source, sale: sale, read: false });
  f.set("created_by", "guest:" + source); f.set("updated_by", "guest:" + source); f.set("@actor", "guest:" + source); f.set("@device", dev ? dev.id : "");
  app.save(f);
  return { ok: true, thanks: "Thank you!" };
}

function report(app, q) {
  const r = require(`${__hooks}/lib/reports.js`).range(q);
  const items = app.findRecordsByFilter("feedback", "created_at >= {:f} && created_at < {:t} && deleted_at = ''", "-created_at", 500, 0, { f: r.f, t: r.t });
  const by = [0, 0, 0, 0, 0];
  items.forEach((x) => { by[x.getInt("rating") - 1]++; });
  return { from: r.from, to: r.to, count: items.length, average: items.length ? Math.round((100 * items.reduce((a, x) => a + x.getInt("rating"), 0)) / items.length) / 100 : null, by_rating: by,
    unread: items.filter((x) => !x.getBool("read")).length, question: (setting(app, "feedback", {}) || {}).question || "",
    items: items.map((x) => ({ id: x.id, rating: x.getInt("rating"), comment: x.getString("comment"), source: x.getString("source"), sale: x.getString("sale"), at: x.getString("created_at"), read: x.getBool("read") })) };
}

function markRead(app, c, id) {
  const f = app.findRecordById("feedback", id);
  f.set("read", true); stamp(f, c); app.save(f);
  return { ok: true };
}

module.exports = { trace, recall, recalls, give, report, markRead, saleCode };

// Customer-facing display (P2 step 5, FR-3.14).
// The till sends what its customer should see (items, savings, total, the member's points, "thank you")
// after every change; the hub keeps the latest per till in memory only (app.store, shared by all hooks),
// never in the database or the event log. A device paired as a customer display, linked to one till,
// asks for it about once a second; nobody signs in on it. Nothing personal beyond the first name and
// points the customer already sees on the till.
// publish(): from the till (sales.sell).   read(): from the display device.   link(): device manager.

const KEY = "chedam.display.";
const MAX = 30000;                          // characters of one state
const STALE_MS = 15 * 60000;                // a till silent this long: the display goes back to the logo
const KINDS = ["idle", "sale", "pay", "done"];

function bad(msg) { throw new BadRequestError(msg); }
function devices() { return require(`${__hooks}/lib/devices.js`); }

function publish(e) {
  const c = require(`${__hooks}/lib/sales_http.js`).ctx(e, "sales.sell");
  if (!c.device) bad("Use a paired till.");
  const st = c.body.state;
  if (!st || typeof st !== "object" || KINDS.indexOf(st.kind) < 0) bad("Unknown display state.");
  const text = JSON.stringify(st);
  if (text.length > MAX) bad("Too much for the customer display.");
  const prev = get(e.app, c.device);
  const v = (prev ? prev.v : 0) + 1;
  e.app.store().set(KEY + c.device, JSON.stringify({ v: v, at: Date.now(), state: st }));
  return { v: v };
}

function get(app, tillId) {
  const raw = app.store().get(KEY + tillId);
  if (!raw) return null;
  try { return JSON.parse(String(raw)); } catch (_) { return null; }
}

function brand(app) {
  try {
    const b = app.findRecordsByFilter("business", "id != ''", "", 1, 0)[0];
    const logo = b.getString("logo");
    return { name: b.getString("trade_name") || b.getString("legal_name"), logo: logo ? "/api/files/" + b.collection().id + "/" + b.id + "/" + logo : "" };
  } catch (_) { return { name: "", logo: "" }; }
}

// ?v=<last version seen>: {same: true} when nothing changed (the display polls).
function read(e) {
  const dev = devices().current(e);
  if (!dev) bad("This request did not come from a paired device.");
  if (dev.getString("type") !== "customer_display") throw new ForbiddenError("Only a device paired as a customer display shows this.");
  const tillId = dev.getString("display_for");
  const seen = Number(e.request.url.query().get("v") || 0);
  if (!tillId) return { linked: false, v: 0, state: { kind: "idle" }, brand: brand(e.app) };
  const s = get(e.app, tillId);
  const fresh = s && Date.now() - s.at < STALE_MS;
  const v = fresh ? s.v : 0;
  if (seen && seen === v) return { same: true, v: v };
  let till = "";
  try { till = e.app.findRecordById("devices", tillId).getString("name"); } catch (_) { till = ""; }
  return { linked: true, till: till, v: v, state: fresh ? s.state : { kind: "idle" }, brand: brand(e.app) };
}

// Device manager: which till a customer display shows ("" = none).
function link(app, dev, tillId) {
  if (dev.getString("type") !== "customer_display") bad("Only a device paired as a customer display can show a till's sale.");
  const id = String(tillId || "");
  if (id) {
    let t = null;
    try { t = app.findRecordById("devices", id); } catch (_) { t = null; }
    if (!t || t.getString("deleted_at") || t.getString("status") === "revoked") bad("Unknown till.");
    if (t.getString("type") === "customer_display") bad("Choose a till, not another display.");
  }
  dev.set("display_for", id);
}

// The displays showing this device's sales (names), for the device manager and the till.
function displaysOf(app, id) {
  try { return app.findRecordsByFilter("devices", "display_for = {:id} && status != 'revoked' && deleted_at = ''", "name", 0, 0, { id: id }).map((d) => d.getString("name")); }
  catch (_) { return []; }
}

module.exports = { publish, read, link, displaysOf };

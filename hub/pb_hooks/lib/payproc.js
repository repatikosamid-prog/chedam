// The common payment interface (P5-a; FR-3.21, 3.22; DL-114): the store's own card processor and its terminals.
// One adapter per processor (lib/payproc_<kind>.js, Square first) behind the same calls. The hub talks to the
// processor (outbound HTTPS only, P5-b); the token is sealed on the hub (lib/secrets.js, P5-c). Calls to the
// processor are made outside transactions; the records are saved afterwards.
//   status()          the processor (no token), its locations and terminals
//   connect()         verify a token, save the account (one processor at a time), pick the location
//   pairStart()       a code to type on the terminal; refresh() until it is paired; assign() to a till
//   forDevice()       the till's linked terminal and connection, for the linked payments (step 2)

const KINDS = { square: "Square" };
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const SYS = { actor: "system:payproc", device: "" };
const sec = () => require(`${__hooks}/lib/secrets.js`);

function adapter(kind) {
  if (kind === "square") return require(`${__hooks}/lib/payproc_square.js`);
  bad("Unknown card processor '" + kind + "'.");
}

function processor(app) {
  return app.findRecordsByFilter("payment_processors", "status = 'connected' && deleted_at = ''", "-created_at", 1, 0)[0] || null;
}

function conn(app, p) {
  return { kind: p.getString("kind"), base: adapter(p.getString("kind")).baseUrl(p.getString("environment")), token: sec().open(app, p.getString("token_enc")),
    location_id: p.getString("location_id"), currency: p.getString("currency") || "CAD" };
}

// Runs a processor call and keeps the last problem on the processor record (outside any transaction)
function call(app, p, fn) {
  try {
    const out = fn(conn(app, p), adapter(p.getString("kind")));
    if (p.getString("last_error")) {
      const r = app.findRecordById("payment_processors", p.id);
      r.set("last_error", ""); r.set("last_ok_at", new Date().toISOString()); stamp(r, SYS); app.save(r);
    }
    return out;
  } catch (err) {
    const msg = String(err && err.message || err).substring(0, 300);
    try { const r = app.findRecordById("payment_processors", p.id); r.set("last_error", msg); stamp(r, SYS); app.save(r); } catch (_) { /* best effort */ }
    throw new BadRequestError(msg);
  }
}

function terminalView(app, t) {
  let till = "";
  if (t.getString("till_device")) { try { till = app.findRecordById("devices", t.getString("till_device")).getString("name"); } catch (_) { till = "(device removed)"; } }
  return { id: t.id, name: t.getString("name"), status: t.getString("status"), code: t.getString("status") === "pairing" ? t.getString("code") : "",
    pair_by: t.getString("pair_by"), till_device: t.getString("till_device"), till_name: till, paired_at: t.getString("paired_at") };
}

function status(app) {
  const p = processor(app);
  const out = { kinds: Object.keys(KINDS).map((k) => ({ kind: k, name: KINDS[k] })), processor: null, terminals: [], linked: require(`${__hooks}/lib/auth.js`).setting(app, "payments.linked", {}) };
  if (!p) return out;
  out.processor = { id: p.id, kind: p.getString("kind"), name: KINDS[p.getString("kind")], environment: p.getString("environment"), account_name: p.getString("account_name"),
    merchant_id: p.getString("merchant_id"), currency: p.getString("currency"), location_id: p.getString("location_id"), location_name: p.getString("location_name"),
    locations: JSON.parse(p.getString("locations") || "[]") || [], connected_at: p.getString("connected_at"), connected_by: p.getString("connected_by"),
    last_error: p.getString("last_error"), last_ok_at: p.getString("last_ok_at") };
  out.terminals = app.findRecordsByFilter("card_terminals", "processor = {:p} && status != 'removed' && deleted_at = ''", "name", 0, 0, { p: p.id }).map((t) => terminalView(app, t));
  return out;
}

// b: {kind, environment, token}. Verifies the token with the processor first (outside a transaction).
function connect(app, c, b) {
  const kind = String(b.kind || "square");
  adapter(kind);
  const env = b.environment === "production" ? "production" : "sandbox";
  const token = String(b.token || "").trim();
  if (token.length < 20) bad("Paste the access token from the processor's developer dashboard.");
  const ad = adapter(kind);
  let info;
  try { info = ad.verify({ base: ad.baseUrl(env), token: token, location_id: "", currency: "CAD" }); } catch (err) { bad(String(err.message || err)); }
  if (info.currency && info.currency !== "CAD") bad("This account works in " + info.currency + "; Chedam's prices are in CAD.");
  if (!info.locations.length) bad("The account has no active location.");
  const loc = info.locations.length === 1 ? info.locations[0] : info.locations.find((l) => l.id === info.main_location_id) || null;
  app.runInTransaction((tx) => {
    tx.findRecordsByFilter("payment_processors", "status = 'connected' && deleted_at = ''", "", 0, 0).forEach((old) => {
      old.set("status", "disconnected"); old.set("token_enc", ""); stamp(old, c); tx.save(old);
    });
    const p = new Record(tx.findCollectionByNameOrId("payment_processors"));
    p.set("kind", kind); p.set("environment", env); p.set("status", "connected"); p.set("token_enc", sec().seal(tx, token));
    p.set("merchant_id", info.merchant_id); p.set("account_name", info.account_name); p.set("currency", info.currency || "CAD");
    p.set("locations", info.locations); p.set("location_id", loc ? loc.id : ""); p.set("location_name", loc ? loc.name : "");
    p.set("connected_at", new Date().toISOString()); p.set("connected_by", c.user ? c.user.getString("name") : "system");
    stamp(p, c); tx.save(p);
  });
  return status(app);
}

function setLocation(app, c, b) {
  const p = processor(app) || bad("No card processor is connected.");
  const loc = (JSON.parse(p.getString("locations") || "[]") || []).find((l) => l.id === b.location_id) || bad("Choose one of the account's locations.");
  app.runInTransaction((tx) => {
    const r = tx.findRecordById("payment_processors", p.id);
    r.set("location_id", loc.id); r.set("location_name", loc.name); stamp(r, c); tx.save(r);
  });
  return status(app);
}

function disconnect(app, c) {
  const p = processor(app) || bad("No card processor is connected.");
  app.runInTransaction((tx) => {
    const r = tx.findRecordById("payment_processors", p.id);
    r.set("status", "disconnected"); r.set("token_enc", ""); stamp(r, c); tx.save(r);
  });
  return status(app);
}

function tillDevice(app, id) {
  if (!id) return "";
  let d;
  try { d = app.findRecordById("devices", id); } catch (_) { bad("That device was not found."); }
  if (d.getString("status") === "revoked" || d.getString("deleted_at")) bad("That device has been removed.");
  return d.id;
}

function freeTill(tx, c, deviceId, exceptId) {
  if (!deviceId) return;
  tx.findRecordsByFilter("card_terminals", "till_device = {:d} && id != {:x} && deleted_at = ''", "", 0, 0, { d: deviceId, x: exceptId || "" }).forEach((o) => {
    o.set("till_device", ""); stamp(o, c); tx.save(o);
  });
}

// b: {name, till_device}. Asks the processor for a pairing code (shown on the screen, typed on the terminal).
function pairStart(app, c, b) {
  const p = processor(app) || bad("Connect the card processor first.");
  if (!p.getString("location_id")) bad("Choose the store's location first.");
  const name = String(b.name || "").trim().substring(0, 60) || bad("Give the terminal a name (e.g. Front till terminal).");
  const dev = tillDevice(app, b.till_device);
  const code = call(app, p, (cn, ad) => ad.pairStart(cn, name, $security.randomString(24)));
  let id = "";
  app.runInTransaction((tx) => {
    freeTill(tx, c, dev, "");
    const t = new Record(tx.findCollectionByNameOrId("card_terminals"));
    t.set("processor", p.id); t.set("name", name); t.set("status", "pairing"); t.set("code_id", code.code_id); t.set("code", code.code);
    t.set("pair_by", code.pair_by || ""); t.set("till_device", dev); stamp(t, c); tx.save(t);
    id = t.id;
  });
  return terminalView(app, app.findRecordById("card_terminals", id));
}

function terminal(app, id) {
  let t;
  try { t = app.findRecordById("card_terminals", id); } catch (_) { bad("Card terminal not found."); }
  if (t.getString("status") === "removed" || t.getString("deleted_at")) bad("That terminal was removed.");
  return t;
}

function refresh(app, c, id) {
  const t = terminal(app, id);
  if (t.getString("status") !== "pairing") return terminalView(app, t);
  const p = app.findRecordById("payment_processors", t.getString("processor"));
  if (p.getString("status") !== "connected") bad("The card processor is not connected.");
  const s = call(app, p, (cn, ad) => ad.pairStatus(cn, t.getString("code_id")));
  if (s.status === "pairing") return terminalView(app, t);
  app.runInTransaction((tx) => {
    const r = tx.findRecordById("card_terminals", t.id);
    r.set("status", s.status);
    if (s.status === "paired") { r.set("terminal_id", s.terminal_id); r.set("paired_at", new Date().toISOString()); r.set("code", ""); }
    stamp(r, c); tx.save(r);
  });
  return terminalView(app, app.findRecordById("card_terminals", t.id));
}

function assign(app, c, id, b) {
  const t = terminal(app, id);
  const dev = tillDevice(app, b.till_device);
  app.runInTransaction((tx) => {
    freeTill(tx, c, dev, t.id);
    const r = tx.findRecordById("card_terminals", t.id);
    r.set("till_device", dev); stamp(r, c); tx.save(r);
  });
  return terminalView(app, app.findRecordById("card_terminals", t.id));
}

function remove(app, c, id) {
  const t = terminal(app, id);
  app.runInTransaction((tx) => {
    const r = tx.findRecordById("card_terminals", t.id);
    r.set("status", "removed"); r.set("till_device", ""); stamp(r, c); tx.save(r);
  });
  return status(app);
}

// The till's linked terminal: {processor, terminal} or null (then the till uses the standalone dialog, P5-d)
function forDevice(app, deviceId) {
  const set = require(`${__hooks}/lib/auth.js`).setting(app, "payments.linked", {}) || {};
  if (set.enabled === false || !deviceId) return null;
  const p = processor(app);
  if (!p || !p.getString("location_id")) return null;
  const t = app.findRecordsByFilter("card_terminals", "processor = {:p} && till_device = {:d} && status = 'paired' && deleted_at = ''", "", 1, 0, { p: p.id, d: deviceId })[0];
  return t ? { processor: p, terminal: t } : null;
}

// For the till: is Card linked here? (No secrets, no account details.)
function tillInfo(app, deviceId) {
  const l = forDevice(app, deviceId);
  const set = require(`${__hooks}/lib/auth.js`).setting(app, "payments.linked", {}) || {};
  return { linked: !!l, processor: l ? KINDS[l.processor.getString("kind")] : "", terminal: l ? l.terminal.getString("name") : "",
    poll_seconds: Number(set.poll_seconds || 2), wait_seconds: Number(set.wait_seconds || 300) };
}

module.exports = { KINDS, adapter, processor, conn, call, status, connect, setLocation, disconnect, pairStart, refresh, assign, remove, forDevice, tillInfo, stamp };

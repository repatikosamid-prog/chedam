// Devices (FR-1.07, 1.08). A device proves who it is on every request with two headers:
//   X-Chedam-Device: <device id>      X-Chedam-Device-Key: <key given once at pairing>
// verify() runs for every /api/ request (pb_hooks/devices.pb.js) and decides:
//   - a wrong or unknown key, or a revoked device: 401 (the device must pair again)
//   - a pending or locked device: refused, except GET /api/chedam/devices/me (so it can show why)
//   - people other than the owner work only from an approved device; the owner may use any device (FR-1.09)
//   - one person is signed in per device: a token used on a device where someone else signed in later
//     (or where the device was signed out) is refused
// The verified device id is kept on the request (e.get(REQ_KEY)); the event log stamps it from there.

const REQ_KEY = "chedamDevice";
const SEEN = "chedam.seen.";              // in-memory last-seen time per device (shared by all hooks)
const PERSIST_MS = 30 * 60000;            // write last_seen_at to the database at most every 30 min
const PAIR_FAILS = "chedam.pairFails";   // recent wrong pairing codes (times), from any device
const TYPES = ["till", "back_office_pc", "phone", "tablet", "customer_display", "kiosk"];
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Paths a device may call while its key is unknown (pairing itself) or while pending/locked.
const PAIRING_PATHS = ["/api/chedam/devices/pair", "/api/chedam/devices/request", "/api/health"];
const STATUS_PATH = "/api/chedam/devices/me";

function header(e, name) {
  return String(e.requestInfo().headers[name] || "").trim();
}

function hash(secret) {
  return $security.sha256(secret);
}

function setting(app, key, fallback) {
  return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback);
}

function newKey() {
  return $security.randomString(48);
}

function newCode() {
  return $security.randomStringWithAlphabet(8, CODE_ALPHABET).replace(/^(.{4})/, "$1-");
}

function normCode(code) {
  const c = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 8 ? c.substring(0, 4) + "-" + c.substring(4) : "";
}

function cleanName(v) {
  const name = String(v || "").replace(/\s+/g, " ").trim().substring(0, 80);
  if (!name) throw new BadRequestError("Give the device a name, for example 'Till 1'.");
  return name;
}

function checkType(v) {
  const type = String(v || "");
  if (TYPES.indexOf(type) < 0) throw new BadRequestError("Unknown device type.");
  return type;
}

// 20 wrong codes within 10 minutes pause pairing (guessing a code is then hopeless).
function recentPairFails(app) {
  return (app.store().get(PAIR_FAILS) || []).filter((t) => Date.now() - Number(t) < 10 * 60000);
}

function checkPairingPause(app) {
  if (recentPairFails(app).length >= 20) throw new TooManyRequestsError("Too many wrong pairing codes. Wait 10 minutes and try again.");
}

function pairingFailed(app) {
  const list = recentPairFails(app);
  list.push(Date.now());
  app.store().set(PAIR_FAILS, list);
}

// The device behind the request headers, or null when there are none. Throws for a bad key.
function fromHeaders(e) {
  const id = header(e, "x_chedam_device");
  if (!id) return null;
  const key = header(e, "x_chedam_device_key");
  let dev = null;
  try { dev = e.app.findRecordById("devices", id); } catch (_) { /* unknown */ }
  const stored = dev ? dev.getString("key_hash") : "";
  if (!dev || !stored || !key || !$security.equal(stored, hash(key)) || dev.getString("deleted_at")) {
    throw new UnauthorizedError("This device is not paired with the hub. Pair it again.", { device: "unpaired" });
  }
  if (dev.getString("status") === "revoked") {
    throw new UnauthorizedError("This device was removed from the store. Pair it again.", { device: "revoked" });
  }
  return dev;
}

function isOwnerUser(app, auth) {
  return require(`${__hooks}/lib/access.js`).isOwner(app, auth);
}

// Middleware body (see devices.pb.js).
function verify(e) {
  const path = e.request.url.path;
  if (path.indexOf("/api/") !== 0) return;
  if (PAIRING_PATHS.indexOf(path) >= 0) return;

  const dev = fromHeaders(e);
  if (dev) {
    const status = dev.getString("status");
    if (status !== "approved" && !(path === STATUS_PATH && e.request.method === "GET")) {
      if (status === "locked") throw new ApiError(423, "This device is locked. Ask a manager to unlock it.", { device: "locked" });
      throw new ForbiddenError("This device is waiting for a manager to approve it.", { device: "pending" });
    }
    e.set(REQ_KEY, dev.id);
    touch(e, dev);
  }

  const auth = e.auth;
  if (!auth || auth.collection().name !== "users") return;     // guests and superusers
  if (!dev) {
    if (!isOwnerUser(e.app, auth)) throw new ForbiddenError("Use a paired device. Only the owner can sign in on any device.", { device: "required" });
    return;
  }
  if (dev.getString("current_user") !== auth.id && path !== STATUS_PATH) {
    throw new UnauthorizedError("You were signed out on this device.", { device: "signed_out" });
  }
}

// Last seen, kept in memory for the "online" dot; written to the database at most every 30 minutes
// (and when the app version or browser changes), so the event log is not flooded.
function touch(e, dev) {
  const now = Date.now();
  e.app.store().set(SEEN + dev.id, now);
  const version = header(e, "x_chedam_version").substring(0, 40);
  const ua = header(e, "user_agent").substring(0, 400);
  const lastStr = dev.getString("last_seen_at");
  const last = lastStr ? new Date(lastStr.replace(" ", "T")).getTime() : 0;
  const changed = (version && version !== dev.getString("app_version")) || (ua && ua !== dev.getString("user_agent"));
  if (!changed && now - last < PERSIST_MS) return;
  if (version) dev.set("app_version", version);
  if (ua) dev.set("user_agent", ua);
  dev.set("last_seen_at", new DateTime());
  stamp(dev, "system:devices", dev.id);
  e.app.save(dev);
}

function lastSeen(app, dev) {
  const mem = app.store().get(SEEN + dev.id);
  if (mem) return new Date(Number(mem));
  const s = dev.getString("last_seen_at");
  return s ? new Date(s.replace(" ", "T")) : null;
}

// The verified device of this request (record), or null.
function current(e) {
  const id = e.get(REQ_KEY);
  if (!id) return null;
  try { return e.app.findRecordById("devices", id); } catch (_) { return null; }
}

function currentId(e) {
  return String(e.get(REQ_KEY) || "");
}

function stamp(rec, actor, deviceId) {
  rec.set("updated_by", actor);
  rec.set("@actor", actor);
  rec.set("@device", deviceId || "");
}

function actorOf(e) {
  return e.auth ? e.auth.collection().name + ":" + e.auth.id : "guest";
}

// Who is signed in on this device now (set at sign-in, cleared at sign-out).
function setUser(e, dev, userId) {
  if (!dev || dev.getString("current_user") === (userId || "")) return;
  dev.set("current_user", userId || "");
  stamp(dev, userId ? "users:" + userId : actorOf(e), dev.id);
  e.app.save(dev);
}

function nameOf(app, userId) {
  if (!userId) return "";
  try { return app.findRecordById("users", userId).getString("name"); } catch (_) { return ""; }
}

// What the device manager shows for one device (never the key or code hashes).
function view(app, dev) {
  const seen = lastSeen(app, dev);
  const online = !!seen && Date.now() - seen.getTime() < setting(app, "devices.online_seconds", 120) * 1000;
  return {
    id: dev.id,
    name: dev.getString("name"),
    type: dev.getString("type"),
    status: dev.getString("status"),
    online: online && dev.getString("status") === "approved",
    last_seen_at: seen ? seen.toISOString() : "",
    current_user: dev.getString("current_user") ? { id: dev.getString("current_user"), name: nameOf(app, dev.getString("current_user")) } : null,
    assigned_user: dev.getString("assigned_user") ? { id: dev.getString("assigned_user"), name: nameOf(app, dev.getString("assigned_user")) } : null,
    assigned_printer: dev.getString("assigned_printer"),
    app_version: dev.getString("app_version"),
    user_agent: dev.getString("user_agent"),
    paired_via: dev.getString("paired_via"),
    paired_at: dev.getString("paired_at"),
    approved_by: dev.getString("approved_by"),
    pairing_expires_at: dev.getString("status") === "pending" && dev.getString("pairing_code_hash") ? dev.getString("pairing_expires_at") : "",
  };
}

module.exports = { REQ_KEY, TYPES, cleanName, checkType, checkPairingPause, pairingFailed, verify, fromHeaders, current, currentId, hash, newKey, newCode, normCode, setting, stamp, actorOf, setUser, view };

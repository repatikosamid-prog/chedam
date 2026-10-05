// Sign-in helpers (FR-1.03, 1.04, 1.09, NFR-11).
// - PIN: 4-6 digits, bcrypt-hashed in the hidden "pin" field. Sign-in = pick your name, enter PIN.
// - Lockout: after security.pin_max_attempts wrong PINs or passwords (default 5) the person is locked
//   for security.pin_lockout_minutes (default 15). A manager above them can unlock early.
// - Owner recovery code: shown once for printing, stored bcrypt-hashed, used once.
// Every failure, lockout and unlock is saved on the user record, so the event log keeps the history.

function setting(app, key, fallback) {
  try {
    return JSON.parse(app.findFirstRecordByData("settings", "key", key).getString("value"));
  } catch (_) {
    return fallback;
  }
}

// Reject PINs anyone would guess: all one digit, or a straight run up or down.
function pinProblem(pin) {
  if (!/^[0-9]{4,6}$/.test(pin || "")) return "A PIN is 4 to 6 digits.";
  if (/^(\d)\1+$/.test(pin)) return "A PIN cannot be one digit repeated.";
  const up = "01234567890", down = "09876543210";
  if (up.indexOf(pin) >= 0 || down.indexOf(pin) >= 0) return "A PIN cannot be a straight run like 1234.";
  return "";
}

function lockedUntil(user) {
  const s = user.getString("pin_locked_until");
  if (!s) return "";
  return new Date(s.replace(" ", "T")) > new Date() ? s : "";
}

function stampSystem(user, e) {
  user.set("updated_by", "system:auth");
  user.set("@actor", "system:auth");
  if (e) user.set("@device", require(`${__hooks}/lib/devices.js`).currentId(e));
}

// Called after a wrong PIN, password or recovery code.
function registerFailure(app, user, e) {
  const max = setting(app, "security.pin_max_attempts", 5);
  const minutes = setting(app, "security.pin_lockout_minutes", 15);
  const n = user.getInt("pin_failed_count") + 1;
  if (n >= max) {
    const until = new Date(Date.now() + minutes * 60000).toISOString().replace("T", " ");
    user.set("pin_locked_until", until);
    user.set("pin_failed_count", 0);
  } else {
    user.set("pin_failed_count", n);
  }
  stampSystem(user, e);
  app.save(user);
}

// Count a wrong PIN, password or recovery code, then throw. The try that reaches the limit answers
// "locked" (423) on every sign-in path, so the screen can show the lock at once.
function failAndThrow(app, user, e, err) {
  registerFailure(app, user, e);
  const now = lockedUntil(app.findRecordById("users", user.id));
  if (now) throw lockedError(now);
  throw err;
}

function registerSuccess(app, user, e) {
  if (user.getInt("pin_failed_count") === 0 && !user.getString("pin_locked_until")) return;
  user.set("pin_failed_count", 0);
  user.set("pin_locked_until", "");
  stampSystem(user, e);
  app.save(user);
}

function tempPinExpired(user) {
  if (!user.getBool("pin_must_change")) return false;
  const s = user.getString("pin_temp_expires_at");
  return !!s && new Date(s.replace(" ", "T")) < new Date();
}

// Someone signed in with a temporary PIN may only set their own new PIN (and read who they are,
// check the device, sign out) until they do. Called from the request middleware (devices.pb.js).
function pinChangeGate(e) {
  const a = e.auth;
  if (!a || a.collection().name !== "users" || !a.getBool("pin_must_change")) return;
  const path = e.request.url.path;
  const m = e.request.method;
  if (m === "POST" && path === "/api/chedam/users/" + a.id + "/pin") return;
  if (m === "GET" && (path === "/api/chedam/access/me" || path === "/api/chedam/devices/me")) return;
  if (m === "POST" && (path === "/api/chedam/devices/me/sign-out" || path === "/api/collections/users/auth-refresh")) return;
  if (path.indexOf("/api/") !== 0) return;
  throw new ForbiddenError("Choose your own new PIN first.", { pin: "change_required" });
}

function canSignIn(user) {
  return user.getString("status") === "active" && !user.getString("deleted_at");
}

function lockedError(until) {
  return new ApiError(423, "Too many wrong tries. Locked until " + until + " UTC, or ask a manager to unlock.", { locked_until: until });
}

// Password fields keep a bcrypt hash; validate() compares without exposing it.
function checkSecret(user, field, plain) {
  const v = user.getRaw(field);
  return !!(v && v.hash && plain && v.validate(plain));
}

function newRecoveryCode() {
  const raw = $security.randomStringWithAlphabet(20, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  return raw.match(/.{5}/g).join("-");
}

module.exports = { setting, pinProblem, lockedUntil, registerFailure, failAndThrow, tempPinExpired, pinChangeGate, registerSuccess, canSignIn, lockedError, checkSecret, newRecoveryCode, stampSystem };

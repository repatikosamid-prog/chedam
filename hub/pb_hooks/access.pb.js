/// <reference path="../pb_data/types.d.ts" />
// Access hooks and endpoints (P0 step 3). Logic: lib/access.js (permissions), lib/auth.js (sign-in).
// Loaded before event_log.pb.js (alphabetical), so a refused request never reaches the log.

// ---- Permission check on every API request -----------------------------------------------------
onRecordsListRequest((e) => { require(`${__hooks}/lib/access.js`).guard(e, "list"); e.next(); });
onRecordViewRequest((e) => { require(`${__hooks}/lib/access.js`).guard(e, "view"); e.next(); });
onRecordCreateRequest((e) => { require(`${__hooks}/lib/access.js`).guard(e, "create"); e.next(); });
onRecordUpdateRequest((e) => { require(`${__hooks}/lib/access.js`).guard(e, "update"); e.next(); });
onRecordDeleteRequest((e) => { require(`${__hooks}/lib/access.js`).guard(e, "delete"); e.next(); });

// ---- Password sign-in: same lockout as PINs; only active people -------------------------------
onRecordAuthWithPasswordRequest((e) => {
  const auth = require(`${__hooks}/lib/auth.js`);
  // e.record is the person matching the identity (empty if none); e.next() checks the password.
  const user = e.record;
  const dev = require(`${__hooks}/lib/devices.js`).current(e);
  if (user) {
    const until = auth.lockedUntil(user);
    if (until) throw auth.lockedError(until);
    if (!auth.canSignIn(user)) throw new ForbiddenError("This account is not active.");
    // FR-1.09: only the owner signs in on any device; everyone else needs a paired device.
    if (!dev && !require(`${__hooks}/lib/access.js`).isOwner(e.app, user)) {
      throw new ForbiddenError("Use a paired device. Only the owner can sign in on any device.", { device: "required" });
    }
  }
  try {
    e.next();
  } catch (err) {
    if (!user) throw err;
    auth.failAndThrow(e.app, user, e, err);
  }
  if (user) {
    auth.registerSuccess(e.app, user, e);
    require(`${__hooks}/lib/devices.js`).setUser(e, dev, user.id);
  }
}, "users");

// Refreshing a token re-checks that the person is still active.
onRecordAuthRefreshRequest((e) => {
  if (!require(`${__hooks}/lib/auth.js`).canSignIn(e.record)) throw new ForbiddenError("This account is not active.");
  e.next();
}, "users");

// ---- PIN sign-in --------------------------------------------------------------------------------
// People who can sign in by PIN: step 1 of "pick your name, then PIN" (DL-28). Paired devices only.
// A device assigned to one person (FR-1.08) lists only that person and the owner.
routerAdd("GET", "/api/chedam/auth/pin-users", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const dev = require(`${__hooks}/lib/devices.js`).current(e);
  if (!dev) throw new ForbiddenError("Pair this device with the hub first.", { device: "required" });
  const assigned = dev.getString("assigned_user");
  const list = e.app.findRecordsByFilter("users", "status = 'active' && deleted_at = '' && pin_set = true", "name", 0, 0)
    .filter((u) => !assigned || u.id === assigned || access.isOwner(e.app, u));
  return e.json(200, list.map((u) => {
    let role = "";
    try { role = e.app.findRecordById("roles", u.getString("role")).getString("name"); } catch (_) { /* no role */ }
    return { id: u.id, name: u.getString("name"), role: role };
  }));
});

routerAdd("POST", "/api/chedam/auth/pin", (e) => {
  const auth = require(`${__hooks}/lib/auth.js`);
  const devices = require(`${__hooks}/lib/devices.js`);
  const dev = devices.current(e);
  if (!dev) throw new ForbiddenError("Pair this device with the hub first.", { device: "required" });
  const body = e.requestInfo().body || {};
  let user = null;
  try { user = e.app.findRecordById("users", String(body.user || "")); } catch (_) { /* unknown */ }
  if (!user || !auth.canSignIn(user) || !user.getBool("pin_set")) {
    throw new BadRequestError("Wrong name or PIN.");
  }
  const assigned = dev.getString("assigned_user");
  if (assigned && assigned !== user.id && !require(`${__hooks}/lib/access.js`).isOwner(e.app, user)) {
    throw new ForbiddenError("This device is assigned to someone else.");
  }
  const until = auth.lockedUntil(user);
  if (until) throw auth.lockedError(until);
  if (!auth.checkSecret(user, "pin", String(body.pin || ""))) {
    auth.failAndThrow(e.app, user, e, new BadRequestError("Wrong name or PIN."));
  }
  if (auth.tempPinExpired(user)) throw new BadRequestError("Your temporary PIN has expired. Ask a manager for a new one.");
  auth.registerSuccess(e.app, user, e);
  devices.setUser(e, dev, user.id);
  return $apis.recordAuthResponse(e, user, "pin");
});

// Set or change a PIN: yourself, or someone below you with users.manage (superuser for setup/tests).
// A PIN set by someone else is TEMPORARY (forgot-PIN flow): it works for security.temp_pin_hours and
// the person must choose their own PIN at their next sign-in.
routerAdd("POST", "/api/chedam/users/{id}/pin", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const auth = require(`${__hooks}/lib/auth.js`);
  const target = e.app.findRecordById("users", e.request.pathValue("id"));
  if (!e.hasSuperuserAuth()) {
    const actor = e.auth;
    if (!access.isActive(actor)) throw new UnauthorizedError("Sign in first.");
    if (actor.id !== target.id) {
      if (!access.can(e.app, actor, "users.manage")) throw new ForbiddenError("You do not have permission for this.");
      access.checkTargetUser(e.app, actor, target);
    }
  }
  const pin = String((e.requestInfo().body || {}).pin || "");
  const problem = auth.pinProblem(pin);
  if (problem) throw new BadRequestError(problem);
  const own = !e.hasSuperuserAuth() && e.auth && e.auth.id === target.id;
  if (own && target.getBool("pin_must_change") && auth.checkSecret(target, "pin", pin)) {
    throw new BadRequestError("Choose a new PIN, not the temporary one.");
  }
  target.set("pin", pin);
  target.set("pin_set", true);
  target.set("pin_must_change", !own);
  target.set("pin_temp_expires_at", own ? "" :
    new Date(Date.now() + auth.setting(e.app, "security.temp_pin_hours", 24) * 3600000).toISOString().replace("T", " "));
  target.set("pin_failed_count", 0);
  target.set("pin_locked_until", "");
  target.set("updated_by", e.auth ? e.auth.collection().name + ":" + e.auth.id : "system:auth");
  target.set("@actor", target.getString("updated_by"));
  e.app.save(target);
  return e.json(200, { ok: true, temporary: !own });
}, $apis.requireAuth());

// Unlock someone locked out by wrong tries (manager above them, or superuser).
routerAdd("POST", "/api/chedam/users/{id}/unlock", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const target = e.app.findRecordById("users", e.request.pathValue("id"));
  if (!e.hasSuperuserAuth()) {
    const actor = e.auth;
    if (!access.isActive(actor) || !access.can(e.app, actor, "users.manage")) throw new ForbiddenError("You do not have permission for this.");
    if (actor.id === target.id) throw new ForbiddenError("Ask someone else to unlock you.");
    access.checkTargetUser(e.app, actor, target);
  }
  target.set("pin_failed_count", 0);
  target.set("pin_locked_until", "");
  target.set("updated_by", e.auth.collection().name + ":" + e.auth.id);
  target.set("@actor", target.getString("updated_by"));
  e.app.save(target);
  return e.json(200, { ok: true });
}, $apis.requireAuth());

// ---- Owner recovery code (FR-1.03) -------------------------------------------------------------
// Creates a new code for the signed-in owner and returns it ONCE for printing. Any older code stops working.
routerAdd("POST", "/api/chedam/owner/recovery-code", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const auth = require(`${__hooks}/lib/auth.js`);
  const owner = e.auth;
  if (!access.isActive(owner) || !access.isOwner(e.app, owner)) throw new ForbiddenError("Only the owner has a recovery code.");
  const code = auth.newRecoveryCode();
  owner.set("recovery_code", code);
  owner.set("recovery_code_created_at", new DateTime());
  owner.set("updated_by", "users:" + owner.id);
  owner.set("@actor", "users:" + owner.id);
  e.app.save(owner);
  return e.json(200, { code: code, note: "Print this and keep it safe. It is shown only once and works once." });
}, $apis.requireAuth("users"));

// Owner forgot password and PIN: recovery code + new password. The code is used up.
routerAdd("POST", "/api/chedam/auth/recover", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const auth = require(`${__hooks}/lib/auth.js`);
  const body = e.requestInfo().body || {};
  let user = null;
  try { user = e.app.findAuthRecordByEmail("users", String(body.email || "")); } catch (_) { /* unknown */ }
  if (!user || !access.isOwner(e.app, user) || !auth.canSignIn(user)) throw new BadRequestError("Wrong email or recovery code.");
  const until = auth.lockedUntil(user);
  if (until) throw auth.lockedError(until);
  const code = String(body.code || "").toUpperCase().replace(/\s/g, "");
  if (!auth.checkSecret(user, "recovery_code", code)) {
    auth.failAndThrow(e.app, user, e, new BadRequestError("Wrong email or recovery code."));
  }
  const pw = String(body.new_password || "");
  if (pw.length < 10) throw new BadRequestError("The new password needs at least 10 characters.");
  user.setPassword(pw);
  user.set("recovery_code", "");
  user.set("recovery_code_created_at", "");
  user.set("pin_failed_count", 0);
  user.set("pin_locked_until", "");
  auth.stampSystem(user, e);
  e.app.save(user);
  const devices = require(`${__hooks}/lib/devices.js`);
  devices.setUser(e, devices.current(e), user.id);
  return $apis.recordAuthResponse(e, user, "recovery_code");
});

// ---- Access views (FR-1.10) ---------------------------------------------------------------------
// My own effective permissions (the client uses this to show or hide screens).
routerAdd("GET", "/api/chedam/access/me", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
  const role = access.roleOf(e.app, e.auth);
  return e.json(200, {
    user: { id: e.auth.id, name: e.auth.getString("name"), pin_must_change: e.auth.getBool("pin_must_change"),
      large_text: e.auth.getBool("large_text"), high_contrast: e.auth.getBool("high_contrast"), language: e.auth.getString("language") },
    role: role ? { code: role.getString("code"), name: role.getString("name"), level: role.getInt("level") } : null,
    permissions: access.effective(e.app, e.auth),
  });
}, $apis.requireAuth("users"));

// One person's effective permissions and where each comes from (role or override).
routerAdd("GET", "/api/chedam/access/users/{id}", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const target = e.app.findRecordById("users", e.request.pathValue("id"));
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (e.auth.id !== target.id && !access.can(e.app, e.auth, "users.view")) throw new ForbiddenError("You do not have permission for this.");
  }
  return e.json(200, { id: target.id, name: target.getString("name"), permissions: access.effective(e.app, target) });
}, $apis.requireAuth());

// "Who can do this?": everyone holding a permission, and how.
routerAdd("GET", "/api/chedam/access/who-can/{code}", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "users.view")) throw new ForbiddenError("You do not have permission for this.");
  }
  const code = e.request.pathValue("code");
  e.app.findFirstRecordByData("permissions", "code", code);   // 404 for unknown codes
  return e.json(200, access.whoCan(e.app, code));
}, $apis.requireAuth());

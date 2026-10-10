/// <reference path="../pb_data/types.d.ts" />
// Devices (P0 step 4, FR-1.07, 1.08). Logic: lib/devices.js.
// Pairing: a manager makes a code (or shows it as a QR code); the new device sends the code and gets
// its id + key, already approved. A device without a code can ask to join; it waits for approval.

// ---- Every /api/ request: check the device key, status and who is signed in on it --------------
routerUse((e) => {
  require(`${__hooks}/lib/devices.js`).verify(e);
  require(`${__hooks}/lib/auth.js`).pinChangeGate(e);
  return e.next();
});

// ---- Pairing (FR-1.07) --------------------------------------------------------------------------
// A manager makes a one-time code for a new device. Shown once; works for devices.pairing_code_minutes.
routerAdd("POST", "/api/chedam/devices/pairing-code", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const devices = require(`${__hooks}/lib/devices.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "devices.manage")) throw new ForbiddenError("You do not have permission for this.");
  }
  const body = e.requestInfo().body || {};
  const name = devices.cleanName(body.name);
  const type = devices.checkType(body.type);

  const actor = devices.actorOf(e);
  const here = devices.currentId(e);
  // Codes that expired unused are tidied away (soft delete) so the list stays readable.
  e.app.findRecordsByFilter("devices",
    "status = 'pending' && paired_via = 'code' && key_hash = '' && pairing_expires_at < @now && deleted_at = ''", "", 0, 0)
    .forEach((old) => {
      old.set("deleted_at", new DateTime());
      old.set("pairing_code_hash", "");
      devices.stamp(old, actor, here);
      e.app.save(old);
    });

  const minutes = devices.setting(e.app, "devices.pairing_code_minutes", 10);
  const code = devices.newCode();
  const expires = new Date(Date.now() + minutes * 60000).toISOString().replace("T", " ");
  const dev = new Record(e.app.findCollectionByNameOrId("devices"));
  dev.set("name", name);
  dev.set("type", type);
  dev.set("status", "pending");
  dev.set("paired_via", "code");
  dev.set("pairing_code_hash", devices.hash(code));
  dev.set("pairing_expires_at", expires);
  dev.set("created_by", actor);
  dev.set("device_id", here);
  devices.stamp(dev, actor, here);
  e.app.save(dev);
  return e.json(200, { device_id: dev.id, name: name, type: type, code: code, expires_at: expires });
});

// The new device sends the code and receives its id and key (the key is shown only here).
routerAdd("POST", "/api/chedam/devices/pair", (e) => {
  const devices = require(`${__hooks}/lib/devices.js`);
  devices.checkPairingPause(e.app);

  const body = e.requestInfo().body || {};
  const code = devices.normCode(body.code);
  let dev = null;
  if (code) {
    try { dev = e.app.findFirstRecordByData("devices", "pairing_code_hash", devices.hash(code)); } catch (_) { /* wrong */ }
  }
  const expired = dev && new Date(dev.getString("pairing_expires_at").replace(" ", "T")) < new Date();
  if (!dev || dev.getString("status") !== "pending" || dev.getString("deleted_at") || expired) {
    devices.pairingFailed(e.app);
    throw new BadRequestError("This pairing code is wrong or has expired. Ask a manager for a new one.");
  }
  const key = devices.newKey();
  dev.set("key_hash", devices.hash(key));
  dev.set("pairing_code_hash", "");
  dev.set("pairing_expires_at", "");
  dev.set("status", "approved");
  dev.set("approved_by", dev.getString("created_by"));   // whoever made the code approved it
  dev.set("approved_at", new DateTime());
  dev.set("paired_at", new DateTime());
  dev.set("user_agent", String(e.requestInfo().headers["user_agent"] || "").substring(0, 400));
  dev.set("app_version", String(body.app_version || "").substring(0, 40));
  devices.stamp(dev, "system:pairing", dev.id);
  e.app.save(dev);
  return e.json(200, { device_id: dev.id, key: key, name: dev.getString("name"), type: dev.getString("type"), status: "approved" });
});

// A device without a code asks to join. It gets its id and key now, but stays "pending" until a
// manager approves it in the device manager.
routerAdd("POST", "/api/chedam/devices/request", (e) => {
  const devices = require(`${__hooks}/lib/devices.js`);
  const body = e.requestInfo().body || {};
  const name = devices.cleanName(body.name);
  const type = devices.checkType(body.type);
  const max = devices.setting(e.app, "devices.max_pending_requests", 10);
  const open = e.app.findRecordsByFilter("devices", "status = 'pending' && paired_via = 'request' && deleted_at = ''", "", max, 0);
  if (open.length >= max) throw new TooManyRequestsError("Too many devices are waiting for approval. Ask a manager to approve or remove them.");

  const key = devices.newKey();
  const dev = new Record(e.app.findCollectionByNameOrId("devices"));
  dev.set("name", name);
  dev.set("type", type);
  dev.set("status", "pending");
  dev.set("paired_via", "request");
  dev.set("key_hash", devices.hash(key));
  dev.set("paired_at", new DateTime());
  dev.set("user_agent", String(e.requestInfo().headers["user_agent"] || "").substring(0, 400));
  dev.set("app_version", String(body.app_version || "").substring(0, 40));
  dev.set("created_by", "system:pairing");
  devices.stamp(dev, "system:pairing", "");
  e.app.save(dev);
  dev.set("device_id", dev.id);
  devices.stamp(dev, "system:pairing", dev.id);
  e.app.save(dev);
  return e.json(200, { device_id: dev.id, key: key, name: name, type: type, status: "pending" });
});

// ---- The device itself --------------------------------------------------------------------------
// Status of this device (works while pending or locked, so the screen can say why it waits).
routerAdd("GET", "/api/chedam/devices/me", (e) => {
  const devices = require(`${__hooks}/lib/devices.js`);
  const dev = devices.current(e);
  if (!dev) throw new BadRequestError("This request did not come from a paired device.");
  return e.json(200, devices.view(e.app, dev));
});

// Sign out whoever is signed in on this device.
routerAdd("POST", "/api/chedam/devices/me/sign-out", (e) => {
  const devices = require(`${__hooks}/lib/devices.js`);
  const dev = devices.current(e);
  if (!dev) throw new BadRequestError("This request did not come from a paired device.");
  devices.setUser(e, dev, "");
  return e.json(200, { ok: true });
});

// ---- Device manager (FR-1.08) -------------------------------------------------------------------
routerAdd("GET", "/api/chedam/devices", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const devices = require(`${__hooks}/lib/devices.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "devices.view")) throw new ForbiddenError("You do not have permission for this.");
  }
  const list = e.app.findRecordsByFilter("devices", "deleted_at = ''", "name", 0, 0).map((d) => devices.view(e.app, d));
  return e.json(200, { this_device: devices.currentId(e), devices: list });
});

// approve | lock | unlock | sign-out | revoke | display (link a customer display to a till)
routerAdd("POST", "/api/chedam/devices/{id}/{action}", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const devices = require(`${__hooks}/lib/devices.js`);
  const action = e.request.pathValue("action");
  const dev = e.app.findRecordById("devices", e.request.pathValue("id"));
  if (dev.getString("deleted_at")) throw new NotFoundError("Unknown device.");
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "devices.manage")) throw new ForbiddenError("You do not have permission for this.");
    // BR-33: someone's personal device can be managed only by people above them.
    const assigned = dev.getString("assigned_user");
    if (assigned && assigned !== e.auth.id) access.checkTargetUser(e.app, e.auth, e.app.findRecordById("users", assigned));
  }
  const here = devices.currentId(e);
  if ((action === "lock" || action === "revoke") && dev.id === here) {
    throw new BadRequestError("You cannot lock or remove the device you are using.");
  }
  const status = dev.getString("status");
  const now = new DateTime();
  if (action === "approve") {
    if (status !== "pending") throw new BadRequestError("Only a waiting device can be approved.");
    if (!dev.getString("key_hash")) throw new BadRequestError("This device has not used its pairing code yet.");
    dev.set("status", "approved");
    dev.set("approved_by", devices.actorOf(e));
    dev.set("approved_at", now);
  } else if (action === "lock") {
    if (status !== "approved") throw new BadRequestError("Only an approved device can be locked.");
    dev.set("status", "locked");
    dev.set("current_user", "");
  } else if (action === "unlock") {
    if (status !== "locked") throw new BadRequestError("This device is not locked.");
    dev.set("status", "approved");
  } else if (action === "sign-out") {
    dev.set("current_user", "");
  } else if (action === "revoke") {
    if (status === "revoked") throw new BadRequestError("This device is already removed.");
    dev.set("status", "revoked");
    dev.set("key_hash", "");
    dev.set("pairing_code_hash", "");
    dev.set("pairing_expires_at", "");
    dev.set("current_user", "");
    dev.set("revoked_at", now);
  } else if (action === "display") {
    // A customer display shows one till's sale: {till: <device id> | ""}
    require(`${__hooks}/lib/display.js`).link(e.app, dev, (e.requestInfo().body || {}).till);
  } else {
    throw new NotFoundError("Unknown device action.");
  }
  devices.stamp(dev, devices.actorOf(e), here);
  e.app.save(dev);
  return e.json(200, devices.view(e.app, dev));
});

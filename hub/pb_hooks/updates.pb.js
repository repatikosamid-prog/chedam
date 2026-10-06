/// <reference path="../pb_data/types.d.ts" />
// Update endpoints (P0 step 9). Logic: lib/updates.js; root work: /opt/chedam/bin/chedam-update.

cronAdd("chedam_updates", "* * * * *", () => {
  require(`${__hooks}/lib/updates.js`).tick($app);
});

// Installed version, available updates, history, last check (updates.view).
routerAdd("GET", "/api/chedam/updates/status", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "updates.view")) throw new ForbiddenError("You do not have permission for this.");
  }
  return e.json(200, require(`${__hooks}/lib/updates.js`).status(e.app));
});

// Look for updates online, or on a USB stick (source=usb).
routerAdd("POST", "/api/chedam/updates/check", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "updates.view")) throw new ForbiddenError("You do not have permission for this.");
  }
  const updates = require(`${__hooks}/lib/updates.js`);
  const usb = (e.requestInfo().body || {}).source === "usb";
  const actor = e.auth ? e.auth.collection().name + ":" + e.auth.id : "system";
  updates.check(e.app, actor, !usb);
  return e.json(200, updates.status(e.app));
});

// Install now, or tonight in the install window (owner only: updates.install).
routerAdd("POST", "/api/chedam/updates/{id}/install", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "updates.install")) throw new ForbiddenError("Only the owner installs updates.");
  }
  const updates = require(`${__hooks}/lib/updates.js`);
  const rec = e.app.findRecordById("updates", e.request.pathValue("id"));
  if (["verified", "scheduled"].indexOf(rec.getString("status")) < 0) throw new BadRequestError("This update cannot be installed now.");
  if (!updates.newer(rec.getString("version"), updates.installed())) throw new BadRequestError("This version is not newer than the installed one.");
  const actor = e.auth ? e.auth.collection().name + ":" + e.auth.id : "system";
  const when = (e.requestInfo().body || {}).when === "now" ? "now" : "window";
  if (when === "now") {
    updates.startInstall(e.app, rec, actor);
  } else {
    rec.set("status", "scheduled");
    rec.set("scheduled_for", new DateTime());
    rec.set("updated_by", actor); rec.set("@actor", actor);
    e.app.save(rec);
  }
  return e.json(200, updates.view(rec));
});

// Tests and support: run the every-minute update check now (superuser only).
routerAdd("POST", "/api/chedam/updates/tick", (e) => {
  if (!e.hasSuperuserAuth()) throw new ForbiddenError("Superuser only.");
  require(`${__hooks}/lib/updates.js`).tick(e.app);
  return e.json(200, { ok: true });
});

/// <reference path="../pb_data/types.d.ts" />
// Backup endpoints (P0 step 7). Logic: lib/backup.js; privileged work: /opt/chedam/bin/chedam-backup.

cronAdd("chedam_backup", "* * * * *", () => {
  // Test hubs drive the schedule through /api/chedam/backups/tick instead (no race with the test).
  if ($os.getenv("CHEDAM_TEST_NO_BACKUP_CRON") === "1") return;
  require(`${__hooks}/lib/backup.js`).tick($app);
});

// Drive, schedule, key, latest and last good backup, last restore test.
routerAdd("GET", "/api/chedam/backups/status", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "backups.view")) throw new ForbiddenError("You do not have permission for this.");
  }
  return e.json(200, require(`${__hooks}/lib/backup.js`).status(e.app));
});

// USB drives the hub can see (asks the root helper; takes a few seconds).
routerAdd("POST", "/api/chedam/backups/drives", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "settings.manage")) throw new ForbiddenError("You do not have permission for this.");
  }
  const backup = require(`${__hooks}/lib/backup.js`);
  const id = backup.request(e.app, "drives", {});
  const res = backup.wait(e.app, id, 25);
  if (!res) throw new ApiError(504, "The hub's backup helper did not answer.");
  if (!res.ok) throw new BadRequestError(res.error || "Could not list drives.");
  return e.json(200, { drives: res.drives || [] });
});

// Choose the backup drive.
routerAdd("POST", "/api/chedam/backups/drive", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "settings.manage")) throw new ForbiddenError("You do not have permission for this.");
  }
  const b = e.requestInfo().body || {};
  const uuid = String(b.uuid || "").substring(0, 64);
  if (!/^[A-Za-z0-9-]+$/.test(uuid)) throw new BadRequestError("Unknown drive.");
  const drive = { uuid: uuid, label: String(b.label || "").substring(0, 80), fstype: String(b.fstype || "").substring(0, 20),
    size_bytes: Number(b.size_bytes) || 0, chosen_at: new Date().toISOString() };
  const actor = e.auth ? e.auth.collection().name + ":" + e.auth.id : "system";
  require(`${__hooks}/lib/backup.js`).saveSetting(e.app, "backup.drive", drive, actor);
  return e.json(200, drive);
});

// The backup encryption key (NFR-12): made once; the owner prints it (needed to restore on a new hub).
// show=true shows it again (owner only). The secret never stays in the result file.
routerAdd("POST", "/api/chedam/backups/key", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.isOwner(e.app, e.auth)) throw new ForbiddenError("Only the owner can see the backup key.");
  }
  const backup = require(`${__hooks}/lib/backup.js`);
  const show = !!(e.requestInfo().body || {}).show;
  const id = backup.request(e.app, show ? "key-show" : "key-init", {});
  const res = backup.wait(e.app, id, 20);
  backup.forgetResult(e.app);
  if (!res) throw new ApiError(504, "The hub's backup helper did not answer.");
  if (!res.ok) throw new BadRequestError(res.error || "Could not make the backup key.");
  return e.json(200, { created: !!res.created, secret: res.secret, recipient: res.recipient });
});

// Back up now (manual, or the first backup from the setup wizard).
routerAdd("POST", "/api/chedam/backups/run", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "backups.run")) throw new ForbiddenError("You do not have permission for this.");
  }
  const backup = require(`${__hooks}/lib/backup.js`);
  const kind = (e.requestInfo().body || {}).first ? "first_backup" : "manual";
  const actor = e.auth ? e.auth.collection().name + ":" + e.auth.id : "system";
  const rec = backup.start(e.app, kind, actor, require(`${__hooks}/lib/devices.js`).currentId(e));
  return e.json(200, backup.view(rec));
});

// Restore test (NFR-03): rebuild the newest backup into a temporary copy and compare with live data.
// The live store is not touched. Owner only (backups.restore).
routerAdd("POST", "/api/chedam/backups/test-restore", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "backups.restore")) throw new ForbiddenError("Only the owner can test a restore.");
  }
  const backup = require(`${__hooks}/lib/backup.js`);
  const auth = require(`${__hooks}/lib/auth.js`);
  const drive = auth.setting(e.app, "backup.drive", {}) || {};
  if (!drive.uuid) throw new BadRequestError("Choose a backup drive first.");
  const id = backup.request(e.app, "test-restore", { drive: drive.uuid });
  const res = backup.wait(e.app, id, 110);
  if (!res) throw new ApiError(504, "The restore test is taking long; check again in a minute.");
  const out = { at: new Date().toISOString(), ok: !!res.ok && !!res.consistent, file_name: res.file_name || "",
    consistent: !!res.consistent, seconds: res.seconds || 0, error: res.error || "",
    restored_counts: res.restored_counts || {}, live_counts: res.live_counts || {} };
  const actor = e.auth ? e.auth.collection().name + ":" + e.auth.id : "system";
  backup.saveSetting(e.app, "backup.last_restore_test", out, actor);
  return e.json(200, out);
});

// Tests and support: run the every-minute backup check now (superuser only).
routerAdd("POST", "/api/chedam/backups/tick", (e) => {
  if (!e.hasSuperuserAuth()) throw new ForbiddenError("Superuser only.");
  return e.json(200, { started: require(`${__hooks}/lib/backup.js`).tick(e.app) });
});

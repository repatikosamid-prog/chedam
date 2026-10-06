// Backups (FR-1.14, NFR-03/04/12). The hub has no root rights, so the privileged work (USB drives,
// mounting, encryption) is done by the root helper /opt/chedam/bin/chedam-backup:
//   hub writes pb_data/backup/request.json {id, action, ...}  ->  chedam-backup.path starts the helper
//   helper writes pb_data/backup/result.json {id, ok, ...}    ->  the hub reads it (consume())
// A backup run has a "backups" record (job_id = request id) that goes running -> verified | failed.
// Nightly schedule: backup.schedule (store time = the hub's clock zone). Failures raise one urgent task
// (rule_key backup:failed); the next good backup closes it. A first backup from the wizard completes
// the setup step "backup".

const SCHEDULED_RETRY_MIN = 60;      // a failed nightly backup is tried again after an hour, 3 times a day
const STALE_MIN = 30;                // a job with no answer for 30 minutes is marked failed

function dir(app) { return app.dataDir() + "/backup"; }

function setting(app, key, fallback) {
  return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback);
}

function saveSetting(app, key, value, actor) {
  const r = app.findFirstRecordByData("settings", "key", key);
  r.set("value", value);
  r.set("updated_by", actor); r.set("@actor", actor);
  app.save(r);
}

function readJson(path) {
  try { return JSON.parse(toString($os.readFile(path))); } catch (_) { return null; }
}

// The helper writes the public half of the backup key here once the key exists.
function keyReady(app) {
  try { return toString($os.readFile(dir(app) + "/recipient.txt")).indexOf("age1") === 0; } catch (_) { return false; }
}

function storeId(app) {
  const b = require(`${__hooks}/lib/setup.js`).business(app);
  return b ? b.id : "store";
}

// Ask the root helper for something. Only one job at a time.
function request(app, action, extra) {
  try { $os.mkdirAll(dir(app), 488); } catch (_) { /* exists */ }   // 488 = 0750
  const busy = app.store().get("chedam.backup.busy");
  if (busy && Date.now() - Number(busy.at) < (busy.action === "drives" || busy.action.indexOf("key") === 0 ? 60000 : STALE_MIN * 60000)) {
    const res = readJson(dir(app) + "/result.json");
    // A run is busy only while its record is still "running" (it may have been marked failed as lost)
    const runGone = busy.action === "run" &&
      app.findRecordsByFilter("backups", "job_id = {:j} && status = 'running'", "", 1, 0, { j: busy.id }).length === 0;
    if ((!res || res.id !== busy.id) && !runGone) throw new ApiError(409, "A backup job is still running. Try again in a moment.");
  }
  const id = $security.randomString(12);
  const req = Object.assign({ id: id, action: action, store: storeId(app) }, extra || {});
  $os.writeFile(dir(app) + "/request.json", JSON.stringify(req), 416);           // 416 = 0640
  app.store().set("chedam.backup.busy", { id: id, action: action, at: Date.now() });
  return id;
}

// Waits for the helper's answer to one request (short jobs: drives, key, restore test).
function wait(app, id, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const res = readJson(dir(app) + "/result.json");
    if (res && res.id === id) { app.store().remove("chedam.backup.busy"); return res; }
    sleep(250);
  }
  return null;
}

function forgetResult(app) {
  try { $os.remove(dir(app) + "/result.json"); } catch (_) { /* none */ }
}

// ---- Runs ---------------------------------------------------------------------------------------

function start(app, kind, actor, device) {
  const drive = setting(app, "backup.drive", {}) || {};
  if (!drive.uuid) throw new BadRequestError("Choose a backup drive first.");
  if (!keyReady(app)) throw new BadRequestError("Make the backup key first.");
  const running = app.findRecordsByFilter("backups", "status = 'running' && deleted_at = ''", "", 1, 0);
  if (running.length) throw new ApiError(409, "A backup is already running.");
  const id = request(app, "run", { drive: drive.uuid, kind: kind });
  const r = new Record(app.findCollectionByNameOrId("backups"));
  r.load({ kind: kind, target: "usb", status: "running", started_at: new DateTime(), encrypted: true, job_id: id });
  r.set("created_by", actor); r.set("updated_by", actor); r.set("device_id", device || "");
  r.set("@actor", actor); r.set("@device", device || "");
  app.save(r);
  return r;
}

function task(app, title, open) {
  const key = "backup:failed";
  const list = app.findRecordsByFilter("tasks", "rule_key = {:k} && status = 'open' && deleted_at = ''", "", 0, 0, { k: key });
  if (open) {
    if (list.length) {
      list[0].set("title", title); list[0].set("updated_by", "system:backup"); list[0].set("@actor", "system:backup");
      app.save(list[0]);
      return;
    }
    const t = new Record(app.findCollectionByNameOrId("tasks"));
    t.load({ title: title, kind: "backup_failed", source: "rule", rule_key: key, status: "open", priority: "urgent", link_collection: "backups" });
    t.set("created_by", "system:backup"); t.set("updated_by", "system:backup"); t.set("@actor", "system:backup");
    app.save(t);
  } else {
    list.forEach((t) => {
      t.set("status", "done"); t.set("closed_at", new DateTime());
      t.set("updated_by", "system:backup"); t.set("@actor", "system:backup");
      app.save(t);
    });
  }
}

// Applies a finished run's result to its record (called from the status endpoint and every minute).
function consume(app) {
  const res = readJson(dir(app) + "/result.json");
  // The cron job and the status endpoint can both get here at once: find, save and task run in one
  // transaction (one writer), so a result is applied once and the record never shows without its task.
  if (res && res.action === "run") app.runInTransaction((app) => {
    const recs = app.findRecordsByFilter("backups", "job_id = {:j} && status = 'running'", "", 1, 0, { j: String(res.id) });
    if (recs.length) {
      const r = recs[0];
      const busy = app.store().get("chedam.backup.busy");
      if (busy && busy.id === res.id) app.store().remove("chedam.backup.busy");
      r.set("finished_at", new DateTime());
      r.set("updated_by", "system:backup"); r.set("@actor", "system:backup");
      if (res.ok) {
        r.set("status", "verified");
        r.set("verified_at", new DateTime());
        r.set("file_name", res.file_name || "");
        r.set("size_bytes", res.size_bytes || 0);
        r.set("sha256", res.sha256 || "");
        r.set("free_bytes", res.free_bytes || 0);
        r.set("error", "");
        app.save(r);
        task(app, "", false);
        if (r.getString("kind") === "first_backup") {
          try { require(`${__hooks}/lib/setup.js`).mark(app, "backup", "done", "system:backup", ""); } catch (_) { /* no setup */ }
        }
      } else {
        r.set("status", "failed");
        r.set("error", String(res.error || "Unknown error").substring(0, 2000));
        app.save(r);
        task(app, res.code === "drive_missing" ? "Backup failed: plug in the backup drive" : "Backup failed: " + String(res.error || "").substring(0, 150), true);
      }
    }
  });
  // Jobs that never got an answer (helper missing, hub restarted mid-job)
  const old = new Date(Date.now() - STALE_MIN * 60000).toISOString().replace("T", " ");
  app.runInTransaction((app) => app.findRecordsByFilter("backups", "status = 'running' && started_at < {:t}", "", 0, 0, { t: old }).forEach((r) => {
    r.set("status", "failed");
    r.set("finished_at", new DateTime());
    r.set("error", "No answer from the backup helper.");
    const busy = app.store().get("chedam.backup.busy");
    if (busy && busy.id === r.getString("job_id")) app.store().remove("chedam.backup.busy");
    r.set("updated_by", "system:backup"); r.set("@actor", "system:backup");
    app.save(r);
    task(app, "Backup failed: no answer from the backup helper", true);
  }));
}

// Nightly backup: once per day after backup.schedule (hub clock zone = store time zone); a failed
// attempt is retried after an hour, at most 3 times a day.
function tick(app) {
  consume(app);
  const drive = setting(app, "backup.drive", {}) || {};
  if (!drive.uuid || !keyReady(app)) return "";
  const at = String(setting(app, "backup.schedule", "02:30") || "02:30").split(":");
  const now = new Date();
  const due = new Date(now.getTime());
  due.setHours(Number(at[0]) || 0, Number(at[1]) || 0, 0, 0);
  if (now < due) return "";
  const since = due.toISOString().replace("T", " ");
  const today = app.findRecordsByFilter("backups", "kind = 'scheduled' && started_at >= {:s} && deleted_at = ''", "-started_at", 0, 0, { s: since });
  if (today.some((r) => r.getString("status") !== "failed")) return "";
  if (today.length >= 3) return "";
  if (today.length && now.getTime() - new Date(today[0].getString("started_at").replace(" ", "T")).getTime() < SCHEDULED_RETRY_MIN * 60000) return "";
  try { return start(app, "scheduled", "system:backup", "").id; } catch (_) { return ""; }
}

function view(r) {
  if (!r) return null;
  return {
    id: r.id, kind: r.getString("kind"), status: r.getString("status"), started_at: r.getString("started_at"),
    finished_at: r.getString("finished_at"), file_name: r.getString("file_name"), size_bytes: r.getInt("size_bytes"),
    free_bytes: r.getInt("free_bytes"), error: r.getString("error"), encrypted: r.getBool("encrypted"),
  };
}

function status(app) {
  consume(app);
  const latest = app.findRecordsByFilter("backups", "deleted_at = ''", "-started_at", 1, 0);
  const good = app.findRecordsByFilter("backups", "status = 'verified' && deleted_at = ''", "-started_at", 1, 0);
  return {
    drive: setting(app, "backup.drive", {}) || {},
    schedule: setting(app, "backup.schedule", "02:30"),
    key_ready: keyReady(app),
    latest: view(latest[0]),
    last_good: view(good[0]),
    last_restore_test: setting(app, "backup.last_restore_test", {}) || {},
  };
}

module.exports = { dir, request, wait, forgetResult, start, consume, tick, status, view, saveSetting, keyReady };

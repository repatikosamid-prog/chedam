// Updates (FR-12.02, FR-12.04, NFR-20). Root work (download, signature check, install, rollback) is done
// by /opt/chedam/bin/chedam-update; the hub asks through pb_data/update/request.json and reads
// result.json. An "updates" record per package: verified -> scheduled -> installing -> installed |
// failed | rolled_back. Installs run "now" (owner) or in updates.install_window (outside trading hours).
// A failed install raises one urgent task (rule_key update:failed).

const STALE_MIN = 20;

function dir(app) { return app.dataDir() + "/update"; }

function setting(app, key, fallback) {
  return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback);
}

function saveSetting(app, key, value) {
  const r = app.findFirstRecordByData("settings", "key", key);
  r.set("value", value);
  r.set("updated_by", "system:update"); r.set("@actor", "system:update");
  app.save(r);
}

function readJson(path) {
  try { return JSON.parse(toString($os.readFile(path))); } catch (_) { return null; }
}

function installed() {
  try { return toString($os.readFile(__hooks + "/../VERSION")).trim(); } catch (_) { return ""; }
}

function vt(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
function newer(a, b) {
  const x = vt(a), y = vt(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function request(app, action, extra) {
  try { $os.mkdirAll(dir(app), 488); } catch (_) { /* exists */ }
  const busy = app.findRecordsByFilter("updates", "status = 'installing' && deleted_at = ''", "", 1, 0);
  if (busy.length) throw new ApiError(409, "An update is being installed. Wait a few minutes.");
  const id = $security.randomString(12);
  $os.writeFile(dir(app) + "/request.json", JSON.stringify(Object.assign({ id: id, action: action }, extra || {})), 416);
  return id;
}

function wait(app, id, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const res = readJson(dir(app) + "/result.json");
    if (res && res.id === id) return res;
    sleep(300);
  }
  return null;
}

function stamp(r, actor) { r.set("updated_by", actor); r.set("@actor", actor); }

// Keep one record per package version; new ones start as "verified" (the helper kept only signed ones).
function remember(app, pkgs, actor) {
  (pkgs || []).forEach((p) => {
    const found = app.findRecordsByFilter("updates", "package = {:p} && version = {:v} && deleted_at = ''", "", 1, 0, { p: "chedam-app", v: p.version });
    if (found.length) return;
    const r = new Record(app.findCollectionByNameOrId("updates"));
    r.load({ package: "chedam-app", kind: "app", version: p.version, source: p.source === "usb" ? "usb" : "online", status: "verified",
      sha256: p.sha256 || "", signature_ok: true, file_name: p.file, size_bytes: p.size || 0, notes: String(p.notes || "").substring(0, 4000) });
    r.set("created_by", actor); stamp(r, actor);
    app.save(r);
  });
}

function task(app, title, open) {
  const key = "update:failed";
  const list = app.findRecordsByFilter("tasks", "rule_key = {:k} && status = 'open' && deleted_at = ''", "", 0, 0, { k: key });
  if (open && !list.length) {
    const t = new Record(app.findCollectionByNameOrId("tasks"));
    t.load({ title: title, kind: "update_failed", source: "rule", rule_key: key, status: "open", priority: "urgent", link_collection: "updates" });
    t.set("created_by", "system:update"); stamp(t, "system:update");
    app.save(t);
  } else if (open) {
    list[0].set("title", title); stamp(list[0], "system:update"); app.save(list[0]);
  } else {
    list.forEach((t) => { t.set("status", "done"); t.set("closed_at", new DateTime()); stamp(t, "system:update"); app.save(t); });
  }
}

function check(app, actor, online) {
  const id = request(app, online ? "check" : "scan", online ? { channel_url: setting(app, "updates.channel_url", "") } : {});
  const res = wait(app, id, online ? 120 : 90);
  if (!res) throw new ApiError(504, "The hub's update helper did not answer.");
  if (online) saveSetting(app, "updates.last_check", { at: new Date().toISOString(), ok: !!res.ok, latest: res.latest || "", error: res.error || "" });
  if (!res.ok) throw new BadRequestError(res.error || "The update check failed.");
  remember(app, res.packages, actor);
  return res;
}

function startInstall(app, rec, actor) {
  const id = request(app, "install", { file: rec.getString("file_name") });
  rec.set("status", "installing");
  rec.set("job_id", id);
  rec.set("from_version", installed());
  rec.set("error", "");
  stamp(rec, actor);
  app.save(rec);
  return rec;
}

// Applies an install result (the hub was restarted in between, so this runs from the cron job or the
// status endpoint after the restart).
function consume(app) {
  const res = readJson(dir(app) + "/result.json");
  // Answer to the daily background check (sent by tick() without waiting)
  const last = setting(app, "updates.last_check", {}) || {};
  if (res && (res.action === "check") && last.job && res.id === last.job) {
    if (res.ok) remember(app, res.packages, "system:update");
    saveSetting(app, "updates.last_check", { at: last.at, ok: !!res.ok, latest: res.latest || "", error: res.error || "" });
  }
  // The cron job and the status endpoint can both get here at once: find, save and task run in one
  // transaction (one writer), so a result is applied once and the record never shows without its task.
  if (res && res.action === "install") {
    app.runInTransaction((tx) => {
      const recs = tx.findRecordsByFilter("updates", "job_id = {:j} && status = 'installing'", "", 1, 0, { j: String(res.id) });
      if (!recs.length) return;
      const r = recs[0];
      stamp(r, "system:update");
      if (res.ok) {
        r.set("status", "installed"); r.set("installed_at", new DateTime()); r.set("backup", res.snapshot || "");
        tx.save(r);
        task(tx, "", false);
      } else {
        r.set("status", res.code === "rolled_back" ? "rolled_back" : "failed");
        if (res.code === "rolled_back") r.set("rolled_back_at", new DateTime());
        r.set("error", String(res.error || "").substring(0, 2000));
        tx.save(r);
        task(tx, res.code === "rollback_failed" ? "Update failed and the hub could not roll back: restore from backup"
          : "Update " + r.getString("version") + " failed and was rolled back", true);
      }
    });
  }
  const old = new Date(Date.now() - STALE_MIN * 60000).toISOString().replace("T", " ");
  app.runInTransaction((tx) => {
    tx.findRecordsByFilter("updates", "status = 'installing' && updated_at < {:t}", "", 0, 0, { t: old }).forEach((r) => {
      r.set("status", "failed"); r.set("error", "No answer from the update helper."); stamp(r, "system:update"); tx.save(r);
      task(tx, "Update " + r.getString("version") + " did not finish", true);
    });
  });
}

function inWindow(app) {
  const w = setting(app, "updates.install_window", { start: "02:00", end: "05:00" }) || {};
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const p = (s) => { const a = String(s || "0:0").split(":"); return Number(a[0]) * 60 + Number(a[1]); };
  const s = p(w.start), e = p(w.end);
  return s <= e ? mins >= s && mins < e : mins >= s || mins < e;
}

// Every minute: results, scheduled installs inside the window, the daily online check.
function tick(app) {
  consume(app);
  if (inWindow(app)) {
    const due = app.findRecordsByFilter("updates", "status = 'scheduled' && deleted_at = ''", "created_at", 1, 0);
    if (due.length) { try { startInstall(app, due[0], "system:update"); } catch (_) { /* next minute */ } return; }
  }
  if (setting(app, "updates.auto_check", true)) {
    const last = setting(app, "updates.last_check", {}) || {};
    const net = require(`${__hooks}/lib/net.js`).status(app);
    const ageH = last.at ? (Date.now() - new Date(last.at).getTime()) / 3600000 : Infinity;
    if (net.internet !== "offline" && ageH > 24) {
      try {
        const job = request(app, "check", { channel_url: setting(app, "updates.channel_url", "") });
        saveSetting(app, "updates.last_check", { at: new Date().toISOString(), ok: null, job: job });
      } catch (_) { /* an install is running: next minute */ }
    }
  }
}

function view(r) {
  return { id: r.id, version: r.getString("version"), status: r.getString("status"), source: r.getString("source"),
    notes: r.getString("notes"), size_bytes: r.getInt("size_bytes"), error: r.getString("error"), from_version: r.getString("from_version"),
    scheduled_for: r.getString("scheduled_for"), installed_at: r.getString("installed_at"), rolled_back_at: r.getString("rolled_back_at"),
    created_at: r.getString("created_at") };
}

function status(app) {
  consume(app);
  const cur = installed();
  const list = app.findRecordsByFilter("updates", "deleted_at = ''", "-created_at", 20, 0).map(view);
  return {
    installed: cur,
    available: list.filter((u) => (u.status === "verified" || u.status === "scheduled") && newer(u.version, cur)),
    history: list,
    last_check: setting(app, "updates.last_check", {}) || {},
    window: setting(app, "updates.install_window", { start: "02:00", end: "05:00" }),
    channel_url: setting(app, "updates.channel_url", ""),
  };
}

module.exports = { status, check, startInstall, tick, consume, newer, installed, view };

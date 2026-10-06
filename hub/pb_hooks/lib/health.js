// Hub health page (FR-12.09): uptime, temperature, power, memory, disk, last backup, clock source,
// internet, devices online, queue backlog, versions, pending updates. Each item gets a status:
//   ok | warn | bad | info, and the page shows the worst one at the top.
// Everything is read as the hub's own sandboxed user (no root): /proc, /sys, df, chronyc.
// Results are cached for 20 s so the page can be refreshed often without loading the Pi.

const CACHE = "chedam.health";
const CACHE_MS = 20000;
const RANK = { ok: 0, info: 0, warn: 1, bad: 2 };

function read(path) {
  try { return toString($os.readFile(path)).trim(); } catch (_) { return ""; }
}

function cmd(...args) {
  try { return toString($os.cmd(...args).output()).trim(); } catch (_) { return ""; }
}

function mb(bytes) { return Math.round(bytes / 1048576); }

function age(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(String(iso).replace(" ", "T")).getTime()) / 3600000;   // hours
}

function hoursText(h) {
  if (!isFinite(h)) return "never";
  if (h < 1) return Math.max(1, Math.round(h * 60)) + " min ago";
  if (h < 48) return Math.round(h) + " h ago";
  return Math.round(h / 24) + " days ago";
}

function item(id, label, value, status, detail) {
  return { id: id, label: label, value: value, status: status, detail: detail || "" };
}

function collect(app) {
  const items = [];
  const settings = require(`${__hooks}/lib/auth.js`);

  // Hub and uptime
  const model = read("/proc/device-tree/model").replace(/\u0000/g, "") || "Hub";
  const up = Number((read("/proc/uptime").split(" ")[0]) || 0);
  items.push(item("uptime", "Hub running for", up ? (up > 86400 ? Math.floor(up / 86400) + " d " : "") + Math.floor((up % 86400) / 3600) + " h " + Math.floor((up % 3600) / 60) + " min" : "unknown", "info", model));

  // Temperature: the Pi slows itself down at 80 °C
  const t = Number(read("/sys/class/thermal/thermal_zone0/temp")) / 1000;
  items.push(t ? item("temperature", "Temperature", t.toFixed(1) + " °C", t >= 80 ? "bad" : t >= 70 ? "warn" : "ok", t >= 70 ? "Give the hub more air; it slows down at 80 °C." : "")
    : item("temperature", "Temperature", "unknown", "info"));

  // Power: under-voltage right now (rpi_volt sensor)
  let uv = "";
  for (let i = 0; i < 4 && uv === ""; i++) {
    if (read("/sys/class/hwmon/hwmon" + i + "/name") === "rpi_volt") uv = read("/sys/class/hwmon/hwmon" + i + "/in0_lcrit_alarm");
  }
  items.push(uv === "" ? item("power", "Power supply", "unknown", "info")
    : item("power", "Power supply", uv === "0" ? "OK" : "Too low", uv === "0" ? "ok" : "bad", uv === "0" ? "" : "Use the official power supply; low voltage can damage data."));

  // Memory: device and the hub app itself (NFR-08: under 150 MB)
  const mem = {};
  read("/proc/meminfo").split("\n").forEach((l) => { const m = /^(\w+):\s+(\d+)/.exec(l); if (m) mem[m[1]] = Number(m[2]) * 1024; });
  const rssLine = read("/proc/self/status").split("\n").find((l) => l.indexOf("VmRSS:") === 0) || "";
  const rss = Number((/(\d+)/.exec(rssLine) || [0, 0])[1]) * 1024;
  if (rss) items.push(item("app_memory", "Hub app memory", mb(rss) + " MB of 150 MB", rss > 150 * 1048576 ? "warn" : "ok", "Budget NFR-08"));
  if (mem.MemTotal) {
    const free = mem.MemAvailable || 0;
    items.push(item("memory", "Free memory", mb(free) + " MB of " + mb(mem.MemTotal) + " MB", free < 50 * 1048576 ? "bad" : free < 100 * 1048576 ? "warn" : "ok"));
  }

  // Disk (the SD card holding the database)
  const df = cmd("df", "-B1", "--output=size,avail", app.dataDir()).split("\n").pop().trim().split(/\s+/);
  if (df.length === 2 && Number(df[0])) {
    const size = Number(df[0]), avail = Number(df[1]), pct = Math.round((avail / size) * 100);
    items.push(item("disk", "Free storage", (avail / 1e9).toFixed(1) + " GB (" + pct + "%)", pct < 5 ? "bad" : pct < 15 ? "warn" : "ok"));
  }
  let dbBytes = 0;
  ["data.db", "data.db-wal"].forEach((f) => { try { dbBytes += $os.stat(app.dataDir() + "/" + f).size(); } catch (_) { /* none */ } });
  if (dbBytes) items.push(item("database", "Store data", dbBytes < 1048576 ? Math.round(dbBytes / 1024) + " KB" : mb(dbBytes) + " MB", "info"));

  // Clock (BR-30): chrony status; no RTC on the dev hub (DL-23)
  const tr = cmd("chronyc", "-c", "tracking").split(",");
  const hasRtc = (() => { try { $os.stat("/dev/rtc0"); return true; } catch (_) { return false; } })();
  if (tr.length > 13) {
    const stratum = Number(tr[2]), offsetMs = Math.abs(Number(tr[4]) * 1000), leap = tr[13];
    const synced = stratum > 0 && stratum < 16 && leap !== "Not synchronised";
    items.push(item("clock", "Clock", synced ? "Set by internet time (" + (offsetMs < 1 ? "<1" : offsetMs.toFixed(0)) + " ms off)" : "Not synchronised",
      synced ? (offsetMs > 2000 ? "warn" : "ok") : "warn",
      (hasRtc ? "Battery clock fitted." : "No battery clock (RTC): after a power cut without internet the time can be wrong.")));
  } else {
    items.push(item("clock", "Clock", "unknown", "info", hasRtc ? "Battery clock fitted." : "No battery clock (RTC)."));
  }

  // Internet (FR-12.01)
  const net = require(`${__hooks}/lib/net.js`).status(app);
  items.push(item("internet", "Internet", net.internet === "offline" ? "Offline (store network only)" : net.internet === "hotspot" ? "Online (hotspot)" : "Online (router)", "info"));

  // Backups (NFR-04: nightly, verified; NFR-03: restore tested)
  const b = require(`${__hooks}/lib/backup.js`).status(app);
  const lastGood = b.last_good ? age(b.last_good.finished_at || b.last_good.started_at) : Infinity;
  if (!b.drive || !b.drive.uuid) {
    items.push(item("backup", "Last backup", "Not set up", "bad", "Choose a backup drive (Backups)."));
  } else {
    items.push(item("backup", "Last backup", hoursText(lastGood), lastGood > 50 ? "bad" : lastGood > 26 ? "warn" : "ok",
      (b.latest && b.latest.status === "failed" ? "Latest attempt failed: " + b.latest.error : "Nightly at " + b.schedule)));
    const rt = b.last_restore_test || {};
    const rtAge = age(rt.at);
    items.push(item("restore_test", "Last restore test", !isFinite(rtAge) ? "never" : hoursText(rtAge) + (rt.ok ? "" : " (failed)"),
      rt.at && !rt.ok ? "bad" : rtAge > 24 * 35 ? "warn" : "ok", "Test a restore at least monthly (Backups)."));
  }

  // Devices
  const devs = app.findRecordsByFilter("devices", "deleted_at = ''", "", 0, 0).map((d) => require(`${__hooks}/lib/devices.js`).view(app, d));
  const approved = devs.filter((d) => d.status === "approved");
  const waiting = devs.filter((d) => d.status === "pending" && d.paired_via === "request");
  items.push(item("devices", "Devices online", approved.filter((d) => d.online).length + " of " + approved.length,
    waiting.length ? "warn" : "info", waiting.length ? waiting.length + " waiting for approval" : ""));

  // Offline queue (sales made on a till while the hub was unreachable: arrives with selling, P1)
  items.push(item("queue", "Waiting to sync", "0", "info", "Offline sales queue arrives with selling (P1)."));

  // Versions
  let schema = "";
  try {
    const row = new DynamicModel({ file: "" });
    // Newest real schema migration (dev sample-data migrations are not the schema)
    app.db().newQuery("SELECT file FROM _migrations WHERE instr(file, '_dev_') = 0 ORDER BY file DESC LIMIT 1").one(row);
    schema = row.file;
  } catch (_) { /* unknown */ }
  const swText = read(__hooks + "/../pb_public/sw.js");
  const appBuild = (/const BUILD = "([^"]+)"/.exec(swText) || [])[1] || "";
  const os = (/PRETTY_NAME="([^"]+)"/.exec(read("/etc/os-release")) || [])[1] || "";
  const caddy = cmd("caddy", "version").split(" ")[0];
  items.push(item("versions", "Versions", "App " + (appBuild || "unknown"), "info",
    ["Schema " + (schema.replace(/\.js$/, "") || "?"), cmd(cmdPath(), "--version").replace("pocketbase version ", "PocketBase "),
      caddy ? "Caddy " + caddy : "", os, read("/proc/sys/kernel/osrelease")]
      .filter(Boolean).join(" · ")));

  // Updates (update channel arrives in P0 step 9)
  const pending = app.findRecordsByFilter("updates", "status != 'installed' && status != 'rolled_back' && deleted_at = ''", "", 0, 0);
  items.push(item("updates", "Pending updates", String(pending.length), pending.some((u) => u.getString("status") === "failed") ? "warn" : "info",
    pending.length ? "" : "Update channel arrives with the next step."));

  const worst = items.reduce((w, x) => (RANK[x.status] > RANK[w] ? x.status : w), "ok");
  return { overall: worst, checked_at: new Date().toISOString(), items: items };
}

function cmdPath() {
  // The running PocketBase binary
  return "/proc/self/exe";
}

function report(app, fresh) {
  const c = app.store().get(CACHE);
  if (!fresh && c && Date.now() - Number(c.at) < CACHE_MS) return c.data;
  const data = collect(app);
  app.store().set(CACHE, { at: Date.now(), data: data });
  return data;
}

module.exports = { report };

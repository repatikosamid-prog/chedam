// The owner's remote view (P5 step 5; FR-12.05). Every remote.view minutes (15) the hub builds a summary of the
// store (today's sales against the same day last week, the month, open tills, who is clocked in, what needs
// attention, stock warnings, last backup, the hub's health), encrypts it with the remote view key and puts it on
// the owner's cloud drive (lib/cloud.js) as chedam-summary.enc. The hub is never reached from outside.
// The owner's own devices are enrolled at the store (owner only): they get the key and a read-only way to fetch
// the file from the cloud drive, and show it away from the store with its "last updated" time (#away).
// The key is AES-256-GCM ($security.encrypt: base64 of nonce + ciphertext + tag), so a browser decrypts it with
// WebCrypto. "Forget enrolled devices" makes a new key: devices enrolled before can't read the next summaries.

const FILE = "chedam-summary.enc";
function bad(msg) { throw new BadRequestError(msg); }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
const cl = () => require(`${__hooks}/lib/cloud.js`);
const sec = () => require(`${__hooks}/lib/secrets.js`);

function keyPath(app) { return app.dataDir() + "/chedam-remote.key"; }
function key(app, fresh) {
  let k = "";
  if (!fresh) { try { k = String(toString($os.readFile(keyPath(app)))).trim(); } catch (_) { k = ""; } }
  if (k.length !== 32) { k = $security.randomString(32); $os.writeFile(keyPath(app), k, 0o600); }
  return k;
}

// The summary, as the owner would see it (costs and margins included)
function summary(app) {
  const ctx = { can: () => true, showCost: true, user: null, actor: "system:remote", device: "" };
  const d = require(`${__hooks}/lib/insights.js`).dashboard(app, ctx);
  let biz = {};
  try { const b = app.findRecordsByFilter("business", "", "", 1, 0)[0]; biz = { name: b.getString("trade_name") || b.getString("legal_name") }; } catch (_) { biz = { name: "" }; }
  const tills = app.findRecordsByFilter("tills", "status = 'open'", "opened_at", 0, 0).map((t) => {
    let who = "";
    try { who = app.findRecordById("users", t.getString("opened_by")).getString("name"); } catch (_) { who = ""; }
    return { number: require(`${__hooks}/lib/tills.js`).tillNo(t), opened_at: t.getString("opened_at"), by: who };
  });
  let clocked = [];
  try { clocked = require(`${__hooks}/lib/timeclock.js`).who(app).items.map((x) => ({ name: x.name, since: x.since, on_break: x.on_break })); } catch (_) { clocked = []; }
  let backup = null, health = null;
  try { const b = require(`${__hooks}/lib/backup.js`).status(app); backup = { last_good: b.last_good ? b.last_good.finished_at || b.last_good.started_at : "", latest_status: b.latest ? b.latest.status : "" }; } catch (_) { backup = null; }
  try { const h = require(`${__hooks}/lib/health.js`).report(app, false); health = { overall: h.overall, problems: h.items.filter((i) => i.status === "bad" || i.status === "warn").map((i) => i.label + ": " + i.value).slice(0, 8) }; } catch (_) { health = null; }
  const inv = d.inventory || {};
  return {
    v: 1, generated_at: new Date().toISOString(), business: biz, today: d.today,
    kpis: d.kpis || null, pnl: d.pnl || null, attention: d.attention || [], tasks: (d.tasks || []).slice(0, 8),
    stock: { out_of_stock: inv.out_of_stock || 0, low_stock: inv.low_stock || 0, expired_lots: inv.expired_lots || 0, near_expiry_lots: inv.near_expiry_lots || 0, value_cents: inv.value_cents || 0 },
    tills: tills, clocked_in: clocked, backup: backup, health: health,
  };
}

function sealed(app) { return $security.encrypt(JSON.stringify(summary(app)), key(app)); }

// Every minute (cron): when due, upload. now: asked from the screen.
function publish(app, now) {
  const set = setting(app, "remote.view", { enabled: true, minutes: 15 }) || {};
  const link = cl().connected(app);
  if (!link || set.enabled === false) return { skipped: "off" };
  const last = link.getString("summary_at");
  const due = !last || Date.now() - new Date(last.replace(" ", "T")).getTime() >= Math.max(5, Number(set.minutes) || 15) * 60000 - 20000;
  if (!now && (!due || !require(`${__hooks}/lib/net.js`).online(app))) return { skipped: "not_due" };
  try {
    cl().putText(app, link, FILE, sealed(app));
    app.runInTransaction((tx) => { const r = tx.findRecordById("cloud_links", link.id); r.set("summary_at", new Date().toISOString()); r.set("summary_error", ""); r.set("updated_by", "system:remote"); r.set("@actor", "system:remote"); tx.save(r); });
    return { uploaded: true };
  } catch (err) {
    const msg = String(err && err.message || err).substring(0, 300);
    app.runInTransaction((tx) => { const r = tx.findRecordById("cloud_links", link.id); r.set("summary_error", msg); r.set("updated_by", "system:remote"); r.set("@actor", "system:remote"); tx.save(r); });
    return { uploaded: false, error: msg };
  }
}

function status(app) {
  const link = cl().connected(app);
  const set = setting(app, "remote.view", { enabled: true, minutes: 15 }) || {};
  return { connected: !!link, provider: link ? link.getString("provider") : "", enabled: set.enabled !== false, minutes: Number(set.minutes) || 15,
    summary_at: link ? link.getString("summary_at") : "", summary_error: link ? link.getString("summary_error") : "", file: FILE };
}

// What an owner's device keeps to read the summary away from the store (owner only, on the store's network)
function enrol(app) {
  const link = cl().connected(app) || bad("Connect the cloud drive first (Home → Cloud drive).");
  const p = link.getString("provider");
  const read = { provider: p, client_id: link.getString("client_id"), refresh_token: sec().open(app, link.getString("refresh_enc")) };
  if (p === "google") read.client_secret = sec().open(app, link.getString("client_secret_enc"));
  read.urls = p === "google" ? { token: cl().url("g_oauth") + "/token", api: cl().url("g_api") } : { token: cl().url("ms_login") + "/token", api: cl().url("ms_graph") };
  read.scope = cl().PROVIDERS[p].scope;
  let biz = "";
  try { const b = app.findRecordsByFilter("business", "", "", 1, 0)[0]; biz = b.getString("trade_name") || b.getString("legal_name"); } catch (_) { biz = ""; }
  return { v: 1, key: key(app), file: FILE, business: biz, read: read, enrolled_at: new Date().toISOString() };
}

function forget(app) { key(app, true); return status(app); }

module.exports = { FILE, summary, sealed, publish, status, enrol, forget, key };

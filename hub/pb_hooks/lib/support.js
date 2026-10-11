// Remote support session (P5 step 8; FR-12.10). Only the owner switches it on (support.manage), for 1 to 8 hours.
// The root helper /opt/chedam/bin/chedam-support (request.json -> result.json in pb_data/support, like the backup
// helper) opens a time-limited SSH login for the support person's key through an OUTBOUND tunnel (cloudflared
// quick tunnel: an address on trycloudflare.com; nothing on the store's network is opened). The helper also ends
// it by itself at the end time. Every session is recorded with who switched it on and off, the address, and the
// support logins seen. The keys of the people allowed in (public SSH keys, setting support.keys) are the owner's
// choice.

function bad(msg) { throw new BadRequestError(msg); }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
const pp = () => require(`${__hooks}/lib/payproc.js`);
const KEY_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/=]{40,}( [^\n\r]{0,100})?$/;
const SYS = { actor: "system:support", device: "" };

function dir(app) { const d = app.dataDir() + "/support"; try { $os.mkdirAll(d, 488); } catch (_) { /* exists */ } return d; }
function readJson(p) { try { return JSON.parse(toString($os.readFile(p))); } catch (_) { return null; } }

function ask(app, action, extra, seconds) {
  const id = $security.randomString(12);
  $os.writeFile(dir(app) + "/request.json", JSON.stringify(Object.assign({ id: id, action: action }, extra || {})), 416);
  const end = Date.now() + (seconds || 20) * 1000;
  while (Date.now() < end) {
    const res = readJson(dir(app) + "/result.json");
    if (res && res.id === id) return res;
    sleep(250);
  }
  return null;
}

function keys(app) { return (setting(app, "support.keys", []) || []).filter((k) => k && k.key); }
function keyView(k) { const p = String(k.key).split(" "); return { name: k.name, type: p[0], end: (p[1] || "").slice(-8), comment: p.slice(2).join(" ") }; }

// b: {keys: [...]} replaces them all; {add: {name, key}} adds one; {remove: index} removes one
function setKeys(app, c, b) {
  let given = Array.isArray(b.keys) ? b.keys : keys(app);
  if (b.add) given = given.concat([b.add]);
  if (b.remove !== undefined) given = given.filter((_, i) => i !== Number(b.remove));
  const list = given.slice(0, 10).map((k) => ({ name: String(k.name || "").trim().substring(0, 60), key: String(k.key || "").trim().split(/\s+/).join(" ") }));
  list.forEach((k, i) => { if (!k.name) bad("Key " + (i + 1) + ": whose key is it?"); if (!KEY_RE.test(k.key)) bad("Key " + (i + 1) + " is not an SSH public key (it starts with ssh-ed25519 or ssh-rsa)."); });
  app.runInTransaction((tx) => {
    let r;
    try { r = tx.findFirstRecordByData("settings", "key", "support.keys"); } catch (_) { r = new Record(tx.findCollectionByNameOrId("settings")); r.set("key", "support.keys"); r.set("description", "Remote support (FR-12.10): public SSH keys of the people the owner lets in during a support session"); }
    r.set("value", list); pp().stamp(r, c); tx.save(r);
  });
  return status(app);
}

function current(app) {
  return app.findRecordsByFilter("support_sessions", "status = 'active' && deleted_at = ''", "-created_at", 1, 0)[0] || null;
}
function view(r) {
  return { id: r.id, status: r.getString("status"), hours: r.getInt("hours"), until: r.getString("until"), host: r.getString("host"), command: r.getString("command"),
    started_by: r.getString("started_by"), ended_by: r.getString("ended_by"), ended_at: r.getString("ended_at"), error: r.getString("error"),
    logins: JSON.parse(r.getString("logins") || "[]") || [], created_at: r.getString("created_at") };
}
function save(app, id, f, c) {
  app.runInTransaction((tx) => { const r = tx.findRecordById("support_sessions", id); Object.keys(f).forEach((k) => r.set(k, f[k])); pp().stamp(r, c || SYS); tx.save(r); });
}

function status(app, refresh) {
  expire(app);
  const cur = current(app);
  if (cur && refresh) {
    const res = ask(app, "status", { since: cur.getString("started_at") }, 10);
    if (res && res.ok) {
      if (!res.active) save(app, cur.id, { status: "ended", ended_at: new Date().toISOString(), ended_by: "the hub (the tunnel stopped)" });
      else if (JSON.stringify(res.logins || []) !== cur.getString("logins")) save(app, cur.id, { logins: res.logins || [] });
    }
  }
  const c2 = current(app);
  return { keys: keys(app).map(keyView), current: c2 ? view(c2) : null,
    history: app.findRecordsByFilter("support_sessions", "deleted_at = ''", "-created_at", 10, 0).map(view) };
}

function start(app, c, b) {
  const ks = keys(app);
  if (!ks.length) bad("Add the support person's SSH key first.");
  if (current(app)) bad("A support session is already on.");
  const hours = Math.max(1, Math.min(8, Math.round(Number(b.hours) || 2)));
  let id = "";
  app.runInTransaction((tx) => {
    const r = new Record(tx.findCollectionByNameOrId("support_sessions"));
    r.load({ status: "starting", hours: hours, started_by: c.user ? c.user.getString("name") : c.actor, keys: ks.map((k) => k.name), logins: [] });
    pp().stamp(r, c); tx.save(r);
    id = r.id;
  });
  const res = ask(app, "start", { hours: hours, keys: ks.map((k) => k.key) }, 45);
  if (!res || !res.ok) {
    save(app, id, { status: "failed", error: res ? String(res.error || "").substring(0, 300) : "The support helper did not answer.", ended_at: new Date().toISOString() }, c);
    bad(res ? res.error : "The support helper did not answer (is it installed on the hub?).");
  }
  save(app, id, { status: "active", host: res.host, command: res.command, until: res.until, started_at: res.started_at || "" }, c);
  return status(app);
}

function stop(app, c) {
  const cur = current(app) || bad("No support session is on.");
  const res = ask(app, "stop", {}, 20);
  save(app, cur.id, { status: "ended", ended_at: new Date().toISOString(), ended_by: c.user ? c.user.getString("name") : c.actor, error: res && res.ok ? "" : "The helper did not confirm; it also ends by itself at the end time." }, c);
  return status(app);
}

// Every minute: a session past its end time is over (the helper's own timer has closed it)
function expire(app) {
  const cur = current(app);
  if (cur && cur.getString("until") && new Date(cur.getString("until").replace(" ", "T")) < new Date()) {
    save(app, cur.id, { status: "ended", ended_at: new Date().toISOString(), ended_by: "the end time" });
  }
}

module.exports = { status, start, stop, setKeys, expire };

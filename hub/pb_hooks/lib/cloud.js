// The owner's cloud drive (P5 step 4; FR-12.08, P5-e): Google Drive or OneDrive, the app's own folder only.
// Sign-in by device code (the owner types a short code on google.com/device or microsoft.com/devicelogin), so
// no address on the hub has to be reachable from outside. Needs the store's app registration (D2: a client id,
// and for Google its "TVs and limited input" secret), entered by the owner until Chedam ships its own.
// Tokens are sealed on the hub (lib/secrets.js). The encrypted nightly backup is copied there: the backup
// helper leaves the verified files in pb_data/backup/outbox, this uploads them (every 5 minutes, outbound only),
// removes them from the outbox and keeps the newest sets in the cloud (setting cloud.backup_keep).
// Uploads of files use curl (binary bodies; the token is passed in a header file, never on the command line).

const PROVIDERS = {
  google: { name: "Google Drive", verify: "https://www.google.com/device", scope: "https://www.googleapis.com/auth/drive.file" },
  microsoft: { name: "OneDrive", verify: "https://microsoft.com/devicelogin", scope: "Files.ReadWrite.AppFolder offline_access User.Read" },
};
const FOLDER = "Chedam";
const SYS = { actor: "system:cloud", device: "" };
function bad(msg) { throw new BadRequestError(msg); }
const sec = () => require(`${__hooks}/lib/secrets.js`);
const pp = () => require(`${__hooks}/lib/payproc.js`);
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }

// Service addresses; tests point CHEDAM_CLOUD_BASE at a fake (tools/devhub/fake-cloud.mjs)
function url(kind) {
  const b = String($os.getenv("CHEDAM_CLOUD_BASE") || "").replace(/\/+$/, "");
  const real = { g_oauth: "https://oauth2.googleapis.com", g_api: "https://www.googleapis.com", g_upload: "https://www.googleapis.com/upload",
    ms_login: "https://login.microsoftonline.com/common/oauth2/v2.0", ms_graph: "https://graph.microsoft.com/v1.0" };
  return b ? b + "/" + kind : real[kind];
}

function form(o) { return Object.keys(o).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(o[k])).join("&"); }
function send(req) {
  let res;
  try { res = $http.send(Object.assign({ timeout: 20 }, req)); } catch (err) { throw new Error("could not be reached (" + String(err && err.message || err).substring(0, 100) + ")"); }
  let json = res.json;
  if (!json) { try { json = JSON.parse(toString(res.body || res.raw || "")); } catch (_) { json = {}; } }
  return { status: res.statusCode, json: json || {}, headers: res.headers || {} };
}
function header(h, name) {
  const k = Object.keys(h || {}).find((x) => x.toLowerCase() === name.toLowerCase());
  if (!k) return "";
  const v = h[k];
  return Array.isArray(v) ? String(v[0]) : String(v);
}

function link(app, provider) {
  return app.findRecordsByFilter("cloud_links", "provider = {:p} && deleted_at = ''", "-created_at", 1, 0, { p: provider })[0] || null;
}
function connected(app) {
  return app.findRecordsByFilter("cloud_links", "status = 'connected' && deleted_at = ''", "-created_at", 1, 0)[0] || null;
}

function view(app, r) {
  if (!r) return null;
  return { id: r.id, provider: r.getString("provider"), name: PROVIDERS[r.getString("provider")].name, status: r.getString("status"), account: r.getString("account"),
    has_app: !!r.getString("client_id"), client_id_hint: sec().hint(r.getString("client_id")),
    user_code: r.getString("status") === "waiting" ? r.getString("user_code") : "", verify_url: r.getString("status") === "waiting" ? r.getString("verify_url") : "",
    code_expires: r.getString("code_expires"), connected_at: r.getString("connected_at"), connected_by: r.getString("connected_by"),
    last_upload_at: r.getString("last_upload_at"), last_upload_name: r.getString("last_upload_name"), last_error: r.getString("last_error") };
}

function status(app) {
  const out = { providers: Object.keys(PROVIDERS).map((k) => ({ provider: k, name: PROVIDERS[k].name, link: view(app, link(app, k)) })), connected: null, outbox: outbox(app).length };
  const c = connected(app);
  out.connected = c ? view(app, c) : null;
  return out;
}

function update(app, id, f, c) {
  app.runInTransaction((tx) => { const x = tx.findRecordById("cloud_links", id); Object.keys(f).forEach((k) => x.set(k, f[k])); pp().stamp(x, c || SYS); tx.save(x); });
  return app.findRecordById("cloud_links", id);
}

// The store's app registration (D2). b: {provider, client_id, client_secret}
function setApp(app, c, b) {
  const provider = PROVIDERS[b.provider] ? b.provider : bad("Choose Google Drive or OneDrive.");
  const id = String(b.client_id || "").trim();
  if (id.length < 10) bad("Paste the app's client ID.");
  const secret = String(b.client_secret || "").trim();
  if (provider === "google" && secret.length < 10) bad("Google also needs the client secret of the 'TVs and limited input devices' client.");
  let r = link(app, provider);
  app.runInTransaction((tx) => {
    const x = r ? tx.findRecordById("cloud_links", r.id) : new Record(tx.findCollectionByNameOrId("cloud_links"));
    if (!r) { x.set("provider", provider); x.set("status", "disconnected"); }
    x.set("client_id", id); if (secret) x.set("client_secret_enc", sec().seal(tx, secret));
    pp().stamp(x, c); tx.save(x);
  });
  return status(app);
}

// Step 1 of the sign-in: a code for the owner to type on the provider's page
function connectStart(app, c, b) {
  const provider = PROVIDERS[b.provider] ? b.provider : bad("Choose Google Drive or OneDrive.");
  const r = link(app, provider);
  if (!r || !r.getString("client_id")) bad("Enter the app registration first (the client ID from " + (provider === "google" ? "Google Cloud" : "Microsoft Entra") + ").");
  const other = connected(app);
  if (other && other.getString("provider") !== provider) bad(PROVIDERS[other.getString("provider")].name + " is connected: disconnect it first.");
  const res = provider === "google"
    ? send({ url: url("g_oauth") + "/device/code", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ client_id: r.getString("client_id"), scope: PROVIDERS.google.scope }) })
    : send({ url: url("ms_login") + "/devicecode", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ client_id: r.getString("client_id"), scope: PROVIDERS.microsoft.scope }) });
  if (res.status !== 200 || !res.json.device_code) bad(PROVIDERS[provider].name + ": " + (res.json.error_description || res.json.error || "the sign-in could not start (" + res.status + ")."));
  update(app, r.id, { status: "waiting", device_code_enc: sec().seal(app, res.json.device_code), user_code: res.json.user_code,
    verify_url: res.json.verification_url || res.json.verification_uri || PROVIDERS[provider].verify,
    code_expires: new Date(Date.now() + Number(res.json.expires_in || 900) * 1000).toISOString(), last_error: "" }, c);
  return status(app);
}

function tokenCall(app, r, fields) {
  const p = r.getString("provider");
  const body = Object.assign({ client_id: r.getString("client_id") }, fields);
  if (p === "google") body.client_secret = sec().open(app, r.getString("client_secret_enc"));
  else body.scope = PROVIDERS.microsoft.scope;
  return send({ url: p === "google" ? url("g_oauth") + "/token" : url("ms_login") + "/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) });
}

// Step 2: asked every few seconds by the screen until the owner has typed the code
function connectPoll(app, c, b) {
  const r = link(app, String(b.provider || "")) || bad("Nothing is waiting.");
  if (r.getString("status") !== "waiting") return status(app);
  if (new Date(r.getString("code_expires").replace(" ", "T")) < new Date()) { update(app, r.id, { status: "disconnected", device_code_enc: "", user_code: "", last_error: "The code expired." }, c); return status(app); }
  const res = tokenCall(app, r, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: sec().open(app, r.getString("device_code_enc")) });
  if (res.status !== 200) {
    const e = res.json.error || "";
    if (e === "authorization_pending" || e === "slow_down") return status(app);
    update(app, r.id, { status: "disconnected", device_code_enc: "", user_code: "", last_error: e === "access_denied" ? "The sign-in was refused." : String(res.json.error_description || e || res.status).substring(0, 300) }, c);
    return status(app);
  }
  const t = res.json;
  update(app, r.id, { status: "connected", device_code_enc: "", user_code: "", refresh_enc: sec().seal(app, t.refresh_token || ""), access_enc: sec().seal(app, t.access_token),
    access_expires: new Date(Date.now() + (Number(t.expires_in || 3600) - 60) * 1000).toISOString(), connected_at: new Date().toISOString(),
    connected_by: c.user ? c.user.getString("name") : "", folder_id: "", last_error: "" }, c);
  try {
    const fresh = app.findRecordById("cloud_links", r.id);
    update(app, r.id, { account: account(app, fresh) }, c);
  } catch (_) { /* the name is only for the screen */ }
  return status(app);
}

function disconnect(app, c) {
  const r = connected(app) || app.findRecordsByFilter("cloud_links", "status = 'waiting'", "", 1, 0)[0] || bad("No cloud drive is connected.");
  update(app, r.id, { status: "disconnected", refresh_enc: "", access_enc: "", device_code_enc: "", user_code: "", folder_id: "" }, c);
  return status(app);
}

// A valid access token (refreshed when needed, or when the service refused the last one: force)
function token(app, r0, force) {
  const r = app.findRecordById("cloud_links", r0.id);
  if (!force && r.getString("access_enc") && new Date(r.getString("access_expires").replace(" ", "T")) > new Date()) return sec().open(app, r.getString("access_enc"));
  const res = tokenCall(app, r, { grant_type: "refresh_token", refresh_token: sec().open(app, r.getString("refresh_enc")) });
  if (res.status !== 200 || !res.json.access_token) {
    const msg = res.json.error === "invalid_grant" ? "The sign-in has expired or was removed: connect the cloud drive again." : "Could not refresh the sign-in (" + (res.json.error || res.status) + ").";
    update(app, r.id, { last_error: msg });
    throw new Error(msg);
  }
  const f = { access_enc: sec().seal(app, res.json.access_token), access_expires: new Date(Date.now() + (Number(res.json.expires_in || 3600) - 60) * 1000).toISOString() };
  if (res.json.refresh_token) f.refresh_enc = sec().seal(app, res.json.refresh_token);
  update(app, r.id, f);
  return res.json.access_token;
}

function api(app, r, req) {
  const call = (tk) => send(Object.assign({}, req, { headers: Object.assign({ "Authorization": "Bearer " + tk }, req.headers || {}) }));
  let res = call(token(app, r));
  if (res.status === 401) res = call(token(app, r, true));
  if (res.status >= 300) throw new Error(PROVIDERS[r.getString("provider")].name + ": " + ((res.json.error && (res.json.error.message || res.json.error)) || "HTTP " + res.status));
  return res;
}

function account(app, r) {
  if (r.getString("provider") === "google") {
    const res = api(app, r, { url: url("g_api") + "/drive/v3/about?fields=user", method: "GET" });
    return String((res.json.user && (res.json.user.emailAddress || res.json.user.displayName)) || "").substring(0, 120);
  }
  const res = api(app, r, { url: url("ms_graph") + "/me", method: "GET" });
  return String(res.json.userPrincipalName || res.json.mail || res.json.displayName || "").substring(0, 120);
}

// Google: the app's own "Chedam" folder (drive.file sees only what Chedam made). OneDrive: the app folder.
function folder(app, r) {
  if (r.getString("provider") === "microsoft") return "approot";
  const id = app.findRecordById("cloud_links", r.id).getString("folder_id");
  if (id) return id;
  const res = api(app, r, { url: url("g_api") + "/drive/v3/files", method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER, mimeType: "application/vnd.google-apps.folder" }) });
  update(app, r.id, { folder_id: res.json.id });
  return res.json.id;
}

// Scratch files (header file, small uploads) live beside the backups; the folder exists before the first backup
function scratch(app) { const d = app.dataDir() + "/backup"; try { $os.mkdirAll(d, 0o700); } catch (_) { /* exists */ } return d; }

// curl with the token in a header file (0600, removed after)
function curl(app, args, tk) {
  const hdr = scratch(app) + "/.cloud-hdr-" + $security.randomString(8);
  $os.writeFile(hdr, "Authorization: Bearer " + tk + "\n", 0o600);
  try {
    const out = toString($os.cmd("curl", ...["-sS", "--fail-with-body", "--max-time", "900", "-H", "@" + hdr].concat(args)).combinedOutput());
    return out;
  } catch (err) {
    throw new Error("upload failed (" + String(err && err.message || err).substring(0, 160) + ")");
  } finally {
    try { $os.remove(hdr); } catch (_) { /* gone */ }
  }
}

// Uploads one local file under `name`; returns the cloud's id for it
function uploadFile(app, r, path, name, mime) {
  let tk = token(app, r);
  if (r.getString("provider") === "google") {
    const parent = folder(app, r);
    const begin = () => send({ url: url("g_upload") + "/drive/v3/files?uploadType=resumable", method: "POST",
      headers: { "Authorization": "Bearer " + tk, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime },
      body: JSON.stringify({ name: name, parents: [parent] }) });
    let start = begin();
    if (start.status === 401) { tk = token(app, r, true); start = begin(); }
    const loc = header(start.headers, "Location");
    if (start.status !== 200 || !loc) throw new Error("Google Drive: the upload could not start (" + start.status + ").");
    const out = curl(app, ["-X", "PUT", "-H", "Content-Type: " + mime, "--data-binary", "@" + path, loc], tk);
    let j = {};
    try { j = JSON.parse(out); } catch (_) { j = {}; }
    if (!j.id) throw new Error("Google Drive: the upload did not finish.");
    return j.id;
  }
  const out = curl(app, ["-X", "PUT", "-H", "Content-Type: " + mime, "--data-binary", "@" + path,
    url("ms_graph") + "/me/drive/special/approot:/" + encodeURIComponent(name) + ":/content"], tk);
  let j = {};
  try { j = JSON.parse(out); } catch (_) { j = {}; }
  if (!j.id) throw new Error("OneDrive: the upload did not finish.");
  return j.id;
}

// Small text (the remote summary, step 5): replaces the file with that name
function putText(app, r, name, text) {
  const tmp = scratch(app) + "/.cloud-" + $security.randomString(8);
  $os.writeFile(tmp, text, 0o600);
  try {
    if (r.getString("provider") === "google") {
      const ex = list(app, r).filter((f) => f.name === name);
      if (ex.length) {
        const tk = token(app, r);
        const out = curl(app, ["-X", "PATCH", "-H", "Content-Type: application/octet-stream", "--data-binary", "@" + tmp, url("g_upload") + "/drive/v3/files/" + ex[0].id + "?uploadType=media"], tk);
        let j = {}; try { j = JSON.parse(out); } catch (_) { j = {}; }
        if (!j.id) throw new Error("Google Drive: the summary was not saved.");
        ex.slice(1).forEach((f) => remove(app, r, f.id));
        return j.id;
      }
    }
    return uploadFile(app, r, tmp, name, "application/octet-stream");
  } finally { try { $os.remove(tmp); } catch (_) { /* gone */ } }
}

function list(app, r) {
  if (r.getString("provider") === "google") {
    const q = encodeURIComponent("'" + folder(app, r) + "' in parents and trashed = false");
    return (api(app, r, { url: url("g_api") + "/drive/v3/files?q=" + q + "&fields=files(id,name,size,createdTime)&pageSize=1000", method: "GET" }).json.files || [])
      .map((f) => ({ id: f.id, name: f.name, size: Number(f.size || 0) }));
  }
  return (api(app, r, { url: url("ms_graph") + "/me/drive/special/approot/children?$top=1000", method: "GET" }).json.value || []).map((f) => ({ id: f.id, name: f.name, size: Number(f.size || 0) }));
}

function remove(app, r, id) {
  if (r.getString("provider") === "google") api(app, r, { url: url("g_api") + "/drive/v3/files/" + id, method: "DELETE" });
  else api(app, r, { url: url("ms_graph") + "/me/drive/items/" + id, method: "DELETE" });
}

// ---- The off-site backup copy (FR-12.08) -----------------------------------------------------------------

function outboxDir(app) { return app.dataDir() + "/backup/outbox"; }
function outbox(app) {
  try { return $os.readDir(outboxDir(app)).map((d) => d.name()).filter((n) => /^chedam-[0-9-]+-[a-z_]+\.db\.gz\.age(\.keys|\.ca|\.sha256)?$/.test(n)).sort(); } catch (_) { return []; }
}

// Every 5 minutes: each backup set in the outbox goes up (the .db.gz.age last, so a set in the cloud is
// complete once its backup file is there), then old sets beyond cloud.backup_keep are removed in the cloud.
function uploadOutbox(app) {
  const r = connected(app);
  const files = outbox(app);
  if (!r || !files.length) return { uploaded: 0, waiting: files.length };
  let up = 0;
  const order = files.slice().sort((a, b) => (a.endsWith(".age") ? 1 : 0) - (b.endsWith(".age") ? 1 : 0) || (a < b ? -1 : 1));
  try {
    order.forEach((n) => {
      uploadFile(app, r, outboxDir(app) + "/" + n, n, "application/octet-stream");
      $os.remove(outboxDir(app) + "/" + n);
      up++;
    });
    const keep = Number(setting(app, "cloud.backup_keep", 14)) || 14;
    const all = list(app, r);
    const sets = all.filter((f) => /^chedam-.*\.db\.gz\.age$/.test(f.name)).map((f) => f.name).sort().reverse();
    const old = sets.slice(keep);
    all.filter((f) => old.some((o) => f.name === o || f.name.indexOf(o + ".") === 0)).forEach((f) => remove(app, r, f.id));
    update(app, r.id, { last_upload_at: new Date().toISOString(), last_upload_name: order.filter((n) => n.endsWith(".age")).pop() || order[order.length - 1], last_error: "" });
  } catch (err) {
    update(app, r.id, { last_error: String(err && err.message || err).substring(0, 300) });
    return { uploaded: up, waiting: outbox(app).length, error: String(err.message || err) };
  }
  return { uploaded: up, waiting: outbox(app).length };
}

module.exports = { PROVIDERS, status, setApp, connectStart, connectPoll, disconnect, connected, uploadOutbox, putText, list, outbox, outboxDir, token, api, url };

// Dev and test only: a pretend Google (OAuth device flow, Drive) and Microsoft (device flow, Graph OneDrive app
// folder): the parts Chedam uses (P5 steps 4-5). Point the hub at it with CHEDAM_CLOUD_BASE=http://127.0.0.1:<port>.
// In memory; nothing leaves the PC. Tests drive it: fake.approve("google"), fake.deny(...), fake.files, fake.expire().
//   Dev hub: node tools/devhub/fake-cloud.mjs [port=8098] — sign-ins are approved after 8 s.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const rid = (n = 8) => randomBytes(n).toString("hex");

export async function startFakeCloud(port = 0, { auto = false } = {}) {
  const st = { codes: {}, access: {}, refresh: {}, files: [], calls: [], secret: "google-secret-0001" };
  const fake = {
    st,
    get files() { return st.files; },
    approve(provider) { Object.values(st.codes).filter((c) => c.provider === provider).forEach((c) => (c.state = "approved")); },
    deny(provider) { Object.values(st.codes).filter((c) => c.provider === provider).forEach((c) => (c.state = "denied")); },
    expire() { st.access = {}; },                 // every access token stops working: the hub must refresh
    revoke() { st.access = {}; st.refresh = {}; },
    close: null, url: "",
  };

  function token(provider) {
    const a = "acc-" + rid(), r = "ref-" + rid();
    st.access[a] = provider; st.refresh[r] = provider;
    return { access_token: a, refresh_token: r, expires_in: 3600, token_type: "Bearer" };
  }
  function form(raw) { return Object.fromEntries(new URLSearchParams(raw)); }

  function route(m, path, q, raw, h, base) {
    let x;
    const prov = path.startsWith("/g_") ? "google" : "microsoft";
    // ---- OAuth (no bearer)
    if (m === "POST" && (path === "/g_oauth/device/code" || path === "/ms_login/devicecode")) {
      const f = form(raw);
      if (!f.client_id) return [400, { error: "invalid_client" }];
      const c = { provider: prov, device_code: "dc-" + rid(), user_code: rid(3).toUpperCase(), state: "pending", scope: f.scope };
      st.codes[c.device_code] = c;
      if (auto) setTimeout(() => (c.state = "approved"), 8000);
      return [200, { device_code: c.device_code, user_code: c.user_code, expires_in: 900, interval: 5,
        [prov === "google" ? "verification_url" : "verification_uri"]: prov === "google" ? "https://www.google.com/device" : "https://microsoft.com/devicelogin" }];
    }
    if (m === "POST" && (path === "/g_oauth/token" || path === "/ms_login/token")) {
      const f = form(raw);
      if (prov === "google" && f.client_secret !== st.secret) return [401, { error: "invalid_client" }];
      if (f.grant_type === "refresh_token") return st.refresh[f.refresh_token] === prov ? [200, token(prov)] : [400, { error: "invalid_grant" }];
      const c = st.codes[f.device_code];
      if (!c) return [400, { error: "expired_token" }];
      if (c.state === "pending") return [prov === "google" ? 428 : 400, { error: "authorization_pending" }];
      if (c.state === "denied") return [400, { error: "access_denied" }];
      delete st.codes[f.device_code];
      return [200, token(prov)];
    }
    // ---- APIs (bearer)
    const bearer = String(h.authorization || "").replace(/^Bearer /, "");
    const session = path.startsWith("/g_upload/session/");
    if (!session && st.access[bearer] !== prov) return [401, { error: { message: "Invalid Credentials" } }];
    if (m === "GET" && path === "/g_api/drive/v3/about") return [200, { user: { emailAddress: "owner@example.test" } }];
    if (m === "GET" && path === "/ms_graph/me") return [200, { userPrincipalName: "owner@example.test" }];
    if (m === "POST" && path === "/g_api/drive/v3/files") {
      const b = JSON.parse(raw || "{}");
      const f = { id: "g" + rid(), name: b.name, provider: "google", parents: b.parents || [], mimeType: b.mimeType || "", size: 0, content: Buffer.alloc(0) };
      st.files.push(f);
      return [200, { id: f.id, name: f.name }];
    }
    if (m === "GET" && path === "/g_api/drive/v3/files") {
      const parent = (String(q.get("q") || "").match(/'([^']+)' in parents/) || [])[1];
      return [200, { files: st.files.filter((f) => f.provider === "google" && f.parents.includes(parent)).map((f) => ({ id: f.id, name: f.name, size: String(f.size) })) }];
    }
    if (m === "DELETE" && (x = path.match(/^\/g_api\/drive\/v3\/files\/(.+)$/))) { st.files = st.files.filter((f) => f.id !== x[1]); return [204, null]; }
    if (m === "POST" && path === "/g_upload/drive/v3/files" && q.get("uploadType") === "resumable") {
      const b = JSON.parse(raw || "{}");
      const sid = rid();
      st.codes["up-" + sid] = { upload: true, name: b.name, parents: b.parents || [] };
      return [200, {}, { Location: base + "/g_upload/session/" + sid }];
    }
    if (m === "PUT" && (x = path.match(/^\/g_upload\/session\/(.+)$/))) {
      const u = st.codes["up-" + x[1]];
      if (!u) return [404, { error: { message: "No such upload" } }];
      delete st.codes["up-" + x[1]];
      const f = { id: "g" + rid(), name: u.name, provider: "google", parents: u.parents, size: raw.length, content: raw };
      st.files.push(f);
      return [200, { id: f.id, name: f.name }];
    }
    if (m === "PATCH" && (x = path.match(/^\/g_upload\/drive\/v3\/files\/(.+)$/))) {
      const f = st.files.find((y) => y.id === x[1]);
      if (!f) return [404, { error: { message: "File not found" } }];
      f.content = raw; f.size = raw.length;
      return [200, { id: f.id, name: f.name }];
    }
    if (m === "PUT" && (x = path.match(/^\/ms_graph\/me\/drive\/special\/approot:\/(.+):\/content$/))) {
      const name = decodeURIComponent(x[1]);
      let f = st.files.find((y) => y.provider === "microsoft" && y.name === name);
      if (!f) { f = { id: "m" + rid(), name, provider: "microsoft", parents: ["approot"] }; st.files.push(f); }
      f.content = raw; f.size = raw.length;
      return [200, { id: f.id, name: f.name }];
    }
    if (m === "GET" && path === "/ms_graph/me/drive/special/approot/children") return [200, { value: st.files.filter((f) => f.provider === "microsoft").map((f) => ({ id: f.id, name: f.name, size: f.size })) }];
    if (m === "DELETE" && (x = path.match(/^\/ms_graph\/me\/drive\/items\/(.+)$/))) { st.files = st.files.filter((f) => f.id !== x[1]); return [204, null]; }
    return [404, { error: { message: "No such endpoint in the fake: " + m + " " + path } }];
  }

  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      const body = Buffer.concat(chunks);
      st.calls.push(req.method + " " + u.pathname);
      const isText = !u.pathname.startsWith("/g_upload/session/") && !u.pathname.includes(":/content") && !(req.method === "PATCH");
      const [code, out, headers] = route(req.method, u.pathname, u.searchParams, isText ? body.toString("utf8") : body, req.headers, fake.url);
      res.writeHead(code, Object.assign({ "Content-Type": "application/json" }, headers || {}));
      res.end(out === null ? "" : JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  fake.url = "http://127.0.0.1:" + server.address().port;
  fake.close = () => new Promise((r) => server.close(r));
  return fake;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const f = await startFakeCloud(Number(process.argv[2] || 8098), { auto: true });
  console.log("Fake Google/Microsoft at " + f.url + " (Google secret " + f.st.secret + "). Start the dev hub with CHEDAM_CLOUD_BASE=" + f.url);
}

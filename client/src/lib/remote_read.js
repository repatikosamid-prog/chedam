// Reading the owner's remote view away from the store (P5 step 5, FR-12.05, DL-226..228). No hub involved: with
// what this device got when it was enrolled at the store (chedam.remote), it signs in to the owner's cloud drive
// (refresh token), downloads chedam-summary.enc and decrypts it here (AES-256-GCM, WebCrypto). No imports, so the
// hub tests run this same code against a fake cloud drive.

export const KEY = "chedam.remote";

export function enrolment(storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(KEY) || "null"); } catch { return null; }
}
export function saveEnrolment(e, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(e)); } catch { /* private mode */ }
}
export function forgetEnrolment(storage = globalThis.localStorage) {
  try { storage.removeItem(KEY); } catch { /* private mode */ }
}

// The hub's $security.encrypt: base64(nonce 12 bytes + ciphertext + tag), the key is 32 ASCII characters
export async function decrypt(b64, key) {
  const raw = Uint8Array.from(atob(String(b64).trim()), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, k, raw.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function accessToken(r, onRefresh) {
  const body = new URLSearchParams({ client_id: r.client_id, refresh_token: r.refresh_token, grant_type: "refresh_token" });
  if (r.provider === "google") body.set("client_secret", r.client_secret);
  else body.set("scope", r.scope);
  const res = await fetch(r.urls.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(j.error === "invalid_grant" ? "The cloud sign-in was removed or has expired: enrol this device again at the store." : "Could not sign in to the cloud drive (" + (j.error || res.status) + ").");
  if (j.refresh_token && j.refresh_token !== r.refresh_token && onRefresh) onRefresh(j.refresh_token);   // Microsoft hands out a new one
  return j.access_token;
}

// e: the enrolment. Returns the summary object (with generated_at). onRefresh(newRefreshToken) keeps it current.
export async function readSummary(e, onRefresh) {
  if (!e || !e.read || !e.key) throw new Error("This device is not enrolled for the remote view.");
  const r = e.read;
  const tk = await accessToken(r, onRefresh);
  const auth = { Authorization: "Bearer " + tk };
  let text = "";
  if (r.provider === "google") {
    const q = encodeURIComponent(`name = '${e.file}' and trashed = false`);
    const l = await fetch(`${r.urls.api}/drive/v3/files?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`, { headers: auth });
    const files = ((await l.json().catch(() => ({}))).files || []);
    if (!l.ok || !files.length) throw new Error("No summary on the cloud drive yet.");
    const f = await fetch(`${r.urls.api}/drive/v3/files/${files[0].id}?alt=media`, { headers: auth });
    if (!f.ok) throw new Error("Could not download the summary (" + f.status + ").");
    text = await f.text();
  } else {
    const f = await fetch(`${r.urls.api}/me/drive/special/approot:/${encodeURIComponent(e.file)}:/content`, { headers: auth });
    if (f.status === 404) throw new Error("No summary on the cloud drive yet.");
    if (!f.ok) throw new Error("Could not download the summary (" + f.status + ").");
    text = await f.text();
  }
  try { return await decrypt(text, e.key); } catch { throw new Error("The summary can't be opened with this device's key: the owner made a new key. Enrol this device again at the store."); }
}

// Talks to the hub. Every request carries this device's id + key (from pairing), the sign-in token and
// the app version (conventions: Devices). Nothing here is cached; offline data comes in later phases.

export const VERSION = __APP_VERSION__;

const KEYS = { device: "chedam.device", token: "chedam.token" };

export function load(k) {
  try { return JSON.parse(localStorage.getItem(KEYS[k])); } catch { return null; }
}
export function save(k, v) {
  try {
    if (v == null) localStorage.removeItem(KEYS[k]);
    else localStorage.setItem(KEYS[k], JSON.stringify(v));
  } catch { /* private mode: works until the tab closes */ }
}

// Returns { status, ok, json, message }. status 0 = the hub did not answer.
export async function api(method, path, body, { timeout = 8000 } = {}) {
  const h = { "Content-Type": "application/json", "X-Chedam-Version": VERSION };
  const dev = load("device");
  if (dev) { h["X-Chedam-Device"] = dev.id; h["X-Chedam-Device-Key"] = dev.key; }
  const tok = load("token");
  if (tok) h.Authorization = tok;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: "no-store" });
  } catch {
    return { status: 0, ok: false, json: null, message: "The hub is not answering. Check the Wi-Fi." };
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, ok: res.ok, json, message: (json && json.message) || res.statusText };
}

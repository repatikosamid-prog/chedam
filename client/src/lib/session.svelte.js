// What the app shows, decided from this device's status on the hub and who is signed in.
// Screens: boot | pair | wait | names | pin | newpin | owner | home | devices
import { api, load, save } from "./api.js";

export const s = $state({
  screen: "boot",
  device: null,         // GET /api/chedam/devices/me (null on an unpaired browser)
  picked: null,         // person chosen on the name list
  me: null,             // GET /api/chedam/access/me
  notice: { text: "", kind: "" },
  autoLockMin: 5,
});

export function notify(text, kind = "") { s.notice = { text, kind }; }

export function go(screen) {
  s.screen = screen;
  const hash = screen === "devices" ? "#devices" : "";
  if (location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
}

export function applyPrefs(user) {
  const root = document.documentElement;
  root.classList.toggle("large", !!(user && user.large_text));
  root.classList.toggle("contrast", !!(user && user.high_contrast));
}

function forgetSignIn() {
  save("token", null);
  s.me = null;
  applyPrefs(null);
}

// Decide what to show. Called at start, after pairing or sign-in, and when the hub says we were signed out.
export async function refresh() {
  if (!load("device")) {
    s.device = null;
    if (load("token")) return loadMe();          // owner on an unpaired browser (FR-1.09)
    return go("pair");
  }
  const r = await api("GET", "/api/chedam/devices/me");
  if (r.status === 0) {
    // Hub not answering: keep showing what we had (offline shell); the connectivity bar says why.
    if (s.screen === "boot") go(s.me ? "home" : "names");
    return;
  }
  if (r.status === 401) {                       // removed or unknown: pair again
    save("device", null);
    forgetSignIn();
    s.device = null;
    notify(r.message, "bad");
    return go("pair");
  }
  if (!r.ok) return notify(r.message, "bad");
  s.device = r.json;
  if (s.device.status !== "approved") { forgetSignIn(); return go("wait"); }
  // A token from someone else's session on this device is refused by the hub (one person per device).
  if (load("token")) return loadMe();
  return go(s.screen === "pin" && s.picked ? "pin" : "names");
}

async function loadMe() {
  const r = await api("GET", "/api/chedam/access/me");
  if (r.status === 0) return go(s.me ? "home" : "names");
  if (!r.ok) {
    forgetSignIn();
    if (r.status === 401) notify("You were signed out on this device.");
    return go(load("device") ? "names" : "pair");
  }
  s.me = r.json;
  applyPrefs(s.me.user);
  if (s.me.user.pin_must_change) return go("newpin");
  await loadAutoLock();
  return go(location.hash === "#devices" && can("devices.view") ? "devices" : (s.screen === "devices" ? "devices" : "home"));
}

async function loadAutoLock() {
  const r = await api("GET", "/api/collections/settings/records?filter=" + encodeURIComponent("key='security.auto_lock_minutes'"));
  const v = r.ok && r.json.items[0] ? Number(r.json.items[0].value) : 5;
  s.autoLockMin = v > 0 ? v : 5;
}

export function can(code) {
  return !!(s.me && s.me.permissions && s.me.permissions[code]);
}

export async function signedIn(auth) {
  save("token", auth.token);
  s.me = null;
  notify("");
  await loadMe();
}

export async function signOut(text = "") {
  if (load("device")) await api("POST", "/api/chedam/devices/me/sign-out");
  forgetSignIn();
  s.picked = null;
  notify(text);
  await refresh();
}

export function forgetDevice() {
  save("device", null);
  forgetSignIn();
  s.device = null;
  go("pair");
}

// A request was refused because of the session: find out why and show the right screen.
export async function handleRefusal(r) {
  if (r.status === 401) { notify(r.message, "bad"); await refresh(); return true; }
  if (r.status === 403 && /new PIN/i.test(r.message)) { go("newpin"); return true; }
  if (r.status === 423 || (r.status === 403 && /device/i.test(r.message))) { await refresh(); return true; }
  return false;
}

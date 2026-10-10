// Talks to the hub. Every request carries this device's id + key (from pairing), the sign-in token and
// the app version (conventions: Devices). Nothing here is cached; offline data comes in later phases.
//
// Hub down: when the Pi is off, a phone's request does not fail, it just waits (no answer at that
// address). So every request has a short time limit, and once the hub is known to be down, requests
// fail at once (status 0) instead of each waiting again; only the connectivity check keeps trying.
// The first answer from the hub clears that.

import { savedToast } from "./toast.svelte.js";

export const VERSION = __APP_VERSION__;

// me: who is signed in (GET /api/chedam/access/me), kept so a till that reloads while the hub is
// unreachable can keep selling as the same person (DL-89).
const KEYS = { device: "chedam.device", token: "chedam.token", me: "chedam.me", brand: "chedam.brand" };
const PROBE = "/api/chedam/status";

let hubDown = false;
const listeners = new Set();

export function onHubChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setDown(v) {
  if (hubDown === v) return;
  hubDown = v;
  listeners.forEach((fn) => fn(v));
}
export function isHubDown() { return hubDown; }

export function load(k) {
  try { return JSON.parse(localStorage.getItem(KEYS[k])); } catch { return null; }
}
export function save(k, v) {
  try {
    if (v == null) localStorage.removeItem(KEYS[k]);
    else localStorage.setItem(KEYS[k], JSON.stringify(v));
  } catch { /* private mode: works until the tab closes */ }
}

const DOWN = { status: 0, ok: false, json: null, message: "The hub is not answering. Check that it is on and the Wi-Fi works." };

// Returns { status, ok, json, message }. status 0 = the hub did not answer. A change the hub accepted
// pops up "Saved ✓" (lib/toast.svelte.js); quiet: true leaves it out.
export async function api(method, path, body, { timeout = 6000, quiet = false } = {}) {
  if (hubDown && !path.startsWith(PROBE)) return DOWN;
  const form = typeof FormData !== "undefined" && body instanceof FormData;   // a file upload: the browser sets the type
  const h = form ? { "X-Chedam-Version": VERSION } : { "Content-Type": "application/json", "X-Chedam-Version": VERSION };
  const dev = load("device");
  if (dev) { h["X-Chedam-Device"] = dev.id; h["X-Chedam-Device-Key"] = dev.key; }
  const tok = load("token");
  if (tok) h.Authorization = tok;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, { method, headers: h, body: form ? body : body ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: "no-store" });
  } catch {
    setDown(true);
    return DOWN;
  } finally {
    clearTimeout(timer);
  }
  setDown(false);
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (res.ok && !quiet) savedToast(method, path);
  return { status: res.status, ok: res.ok, json, message: (json && json.message) || res.statusText };
}

// Multipart request (file uploads such as the logo). Same headers as api(), no JSON body.
// Every page of a collection list, `perPage` at a time (the hub refuses more than 200 a page for tables
// with costs: each record costs it memory, P1 gate). path: "/api/collections/x/records?filter=..."
export async function apiAll(path, perPage = 200) {
  const items = [];
  for (let page = 1; page <= 500; page++) {
    const r = await api("GET", path + (path.includes("?") ? "&" : "?") + "perPage=" + perPage + "&page=" + page, null, { timeout: 15000 });
    if (!r.ok) return r;
    items.push(...r.json.items);
    if (page >= r.json.totalPages) break;
  }
  return { ok: true, status: 200, json: { items } };
}

export async function apiForm(method, path, form, { timeout = 20000, quiet = false } = {}) {
  if (hubDown) return DOWN;
  const h = { "X-Chedam-Version": VERSION };
  const dev = load("device");
  if (dev) { h["X-Chedam-Device"] = dev.id; h["X-Chedam-Device-Key"] = dev.key; }
  const tok = load("token");
  if (tok) h.Authorization = tok;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, { method, headers: h, body: form, signal: ctl.signal });
  } catch {
    setDown(true);
    return DOWN;
  } finally {
    clearTimeout(timer);
  }
  setDown(false);
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (res.ok && !quiet) savedToast(method, path);
  return { status: res.status, ok: res.ok, json, message: (json && json.message) || res.statusText };
}

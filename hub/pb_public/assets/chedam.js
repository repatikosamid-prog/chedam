// Shared helper for the hub's device pages (P0 step 4): keeps this device's id + key and the sign-in
// token in localStorage and sends them with every request. The Svelte client (step 5) replaces this.
const Chedam = (() => {
  const VERSION = "0.4.0-p0";
  const KEYS = { device: "chedam.device", token: "chedam.token", user: "chedam.user" };

  function load(k) { try { return JSON.parse(localStorage.getItem(KEYS[k])); } catch (_) { return null; } }
  function save(k, v) {
    try { v == null ? localStorage.removeItem(KEYS[k]) : localStorage.setItem(KEYS[k], JSON.stringify(v)); } catch (_) { /* private mode */ }
  }

  async function api(method, path, body) {
    const h = { "Content-Type": "application/json", "X-Chedam-Version": VERSION };
    const dev = load("device");
    if (dev) { h["X-Chedam-Device"] = dev.id; h["X-Chedam-Device-Key"] = dev.key; }
    const tok = load("token");
    if (tok) h.Authorization = tok;
    let res;
    try {
      res = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    } catch (_) {
      return { status: 0, ok: false, json: null, message: "Cannot reach the hub. Check the Wi-Fi." };
    }
    let json = null;
    try { json = await res.json(); } catch (_) { /* empty body */ }
    return { status: res.status, ok: res.ok, json, message: (json && json.message) || res.statusText };
  }

  function signedIn(auth) {          // auth = response of a sign-in endpoint
    save("token", auth.token);
    save("user", { id: auth.record.id, name: auth.record.name });
  }
  function forgetSignIn() { save("token", null); save("user", null); }

  function $(sel) { return document.querySelector(sel); }
  function show(id, on = true) { document.getElementById(id).classList.toggle("hidden", !on); }
  function only(ids, visible) { ids.forEach((id) => show(id, id === visible)); }
  function msg(el, text, kind = "") {
    el = typeof el === "string" ? document.getElementById(el) : el;
    el.textContent = text || "";
    el.className = "msg" + (kind ? " " + kind : "");
    el.classList.toggle("hidden", !text);
  }
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
  function initials(name) { return String(name || "?").split(/\s+/).map((w) => w[0] || "").join("").substring(0, 2).toUpperCase(); }
  function when(iso) {
    if (!iso) return "never";
    const d = new Date(iso.replace(" ", "T"));
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return d.toLocaleString();
  }

  const TYPES = { till: "Till", back_office_pc: "Back-office PC", phone: "Phone", tablet: "Tablet", customer_display: "Customer display", kiosk: "Kiosk" };

  return { VERSION, load, save, api, signedIn, forgetSignIn, $, show, only, msg, esc, initials, when, TYPES };
})();

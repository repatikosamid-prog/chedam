// What the app shows, decided from this device's status on the hub and who is signed in.
// Screens: boot | setup | recovery | pair | wait | names | pin | newpin | owner | home | devices | wizard |
// backups | health | updates | products | product | categories | tax | stock | stockitem | receive |
// counts | approvals | shrink | sell | till | sales
import { api, load, save } from "./api.js";

export const s = $state({
  screen: "boot",
  device: null,         // GET /api/chedam/devices/me (null on an unpaired browser)
  picked: null,         // person chosen on the name list
  me: null,             // GET /api/chedam/access/me
  notice: { text: "", kind: "" },
  autoLockMin: 5,
  recoveryCode: "",     // shown once after setup (FR-1.03)
  productId: "",        // product open in the product form ("" = new)
  productFilter: "",    // status filter the product list opens with (e.g. "draft" from the Drafts task)
  stockProductId: "",   // product open on the stock screen
  receiveProduct: "",   // product to add to the "Add stock" list when it opens
  newBarcode: "",       // unknown barcode scanned while adding stock: the new product form starts with it
  returnTo: "",         // screen to go back to from the product form (e.g. "receive")
  brand: load("brand"), // {name, logo}: the store's logo in the top bar and on Home, when the owner chose it (DL-115)
});

// The store's name and logo for the app (DL-115). Kept on this device so the top bar shows them offline;
// the logo is used only when the owner said yes in Store setup > Logo and receipt.
export async function loadBrand() {
  const r = await api("GET", "/api/collections/business/records?perPage=1&fields=id,collectionId,trade_name,legal_name,logo,logo_in_app", null, { quiet: true });
  if (!r.ok || !r.json.items.length) return;
  const b = r.json.items[0];
  s.brand = { name: b.trade_name || b.legal_name || "", logo: b.logo && b.logo_in_app ? `/api/files/${b.collectionId}/${b.id}/${b.logo}` : "" };
  save("brand", s.brand);
}

export function notify(text, kind = "") { s.notice = { text, kind }; }

const HASH = { devices: "#devices", wizard: "#setup", backups: "#backups", health: "#health", updates: "#updates",
  products: "#products", product: "#products", categories: "#categories", tax: "#tax",
  stock: "#stock", stockitem: "#stock", receive: "#receive", counts: "#counts", approvals: "#approvals", shrink: "#shrink",
  sell: "#sell", till: "#till", sales: "#sales", printers: "#printers", returns: "#returns", labels: "#labels", data: "#data", reports: "#reports", promotions: "#promotions", customers: "#customers", dashboard: "#dashboard", team: "#team", messages: "#messages", pings: "#pings", inbox: "#inbox" };

export function go(screen) {
  s.screen = screen;
  const hash = HASH[screen] || "";
  if (location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
}

export function applyPrefs(user) {
  const root = document.documentElement;
  root.classList.toggle("large", !!(user && user.large_text));
  root.classList.toggle("contrast", !!(user && user.high_contrast));
}

function forgetSignIn() {
  save("token", null);
  save("me", null);
  s.me = null;
  applyPrefs(null);
}

// Decide what to show. Called at start, after pairing or sign-in, and when the hub says we were signed out.
export async function refresh() {
  if (!load("device")) {
    s.device = null;
    if (load("token")) return loadMe();          // owner on an unpaired browser (FR-1.09)
    // A new hub (no owner yet): the setup wizard starts here (setup code from the hub's screen)
    const st = await api("GET", "/api/chedam/setup/status");
    return go(st.ok && st.json.needs_setup ? "setup" : "pair");
  }
  const r = await api("GET", "/api/chedam/devices/me");
  if (r.status === 0) {
    // Hub not answering: keep showing what we had (offline shell); the connectivity bar says why.
    // Nobody signed in any more (e.g. signed out while the hub is off): back to the name list.
    if (!s.me && load("token")) return loadMe();   // a reload during an outage: same person, from this device
    if (!s.me && s.screen !== "names" && s.screen !== "pin" && s.screen !== "pair") go("names");
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
  if (s.device.type === "customer_display") { forgetSignIn(); return go("display"); }
  // A token from someone else's session on this device is refused by the hub (one person per device).
  if (load("token")) return loadMe();
  return go(s.screen === "pin" && s.picked ? "pin" : "names");
}

// The person in the saved sign-in token (its "id"), to check the remembered details belong to them.
function tokenUser() {
  try { return JSON.parse(atob(String(load("token")).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).id || ""; } catch { return ""; }
}

async function loadMe() {
  const r = await api("GET", "/api/chedam/access/me");
  if (r.status === 0) {
    // Hub unreachable (DL-89): carry on as the person signed in on this device, if their token is still
    // valid on its own clock. Signing in anew (PIN) needs the hub.
    const saved = load("me");
    let exp = 0;
    try { exp = JSON.parse(atob(String(load("token")).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp || 0; } catch { exp = 0; }
    if (!s.me && saved && saved.user && saved.user.id === tokenUser() && exp * 1000 > Date.now()) { s.me = saved; applyPrefs(s.me.user); }
    if (!s.me) return go("names");
    const want = location.hash === "#sell" || s.screen === "sell" ? "sell" : s.screen && s.screen !== "boot" && s.screen !== "names" ? s.screen : "home";
    return go(want);
  }
  if (!r.ok) {
    forgetSignIn();
    if (r.status === 401) notify("You were signed out on this device.");
    return go(load("device") ? "names" : "pair");
  }
  s.me = r.json;
  save("me", r.json);
  applyPrefs(s.me.user);
  if (s.me.user.pin_must_change) return go("newpin");
  await loadAutoLock();
  const FROM_HASH = { "#devices": "devices", "#setup": "wizard", "#backups": "backups", "#health": "health", "#updates": "updates",
    "#products": "products", "#categories": "categories", "#tax": "tax",
    "#stock": "stock", "#receive": "receive", "#counts": "counts", "#approvals": "approvals", "#shrink": "shrink",
    "#sell": "sell", "#till": "till", "#sales": "sales", "#printers": "printers", "#returns": "returns", "#labels": "labels", "#data": "data", "#reports": "reports", "#promotions": "promotions", "#customers": "customers", "#dashboard": "dashboard", "#team": "team", "#team-checklists": "team", "#messages": "messages", "#pings": "pings", "#inbox": "inbox" };
  // "" = any signed-in person may open it (the hub still decides what they can change)
  const NEEDS = { devices: "devices.view", wizard: "setup.run", backups: "backups.view", health: "health.view", updates: "updates.view",
    products: "", product: "", categories: "catalogue.edit", tax: "",
    stock: "", stockitem: "", receive: "stock.receive", counts: "stock.count", approvals: "stock.approve", shrink: "costs.view",
    sell: "sales.sell", till: "sales.sell", sales: "sales.sell", printers: "settings.manage", returns: "sales.return", labels: "labels.manage", data: "catalogue.edit", reports: "", promotions: "", customers: "customers.view", dashboard: "", team: "tasks.view", messages: "", pings: "", inbox: "" };
  // An address typed or linked (#tax) wins over the screen already open.
  const fromHash = FROM_HASH[location.hash];
  const want = fromHash && HASH[s.screen] !== location.hash ? fromHash : s.screen in NEEDS ? s.screen : fromHash;
  if (want && (NEEDS[want] === "" || can(NEEDS[want]))) return go(want);
  return go("home");
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

// After POST /api/chedam/setup/start: this device is paired, the owner is signed in; show the recovery code.
export async function setupStarted(auth) {
  save("device", { id: auth.meta.device_id, key: auth.meta.key });
  save("token", auth.token);
  s.recoveryCode = auth.meta.recovery_code;
  s.me = null;
  history.replaceState(null, "", location.pathname);
  await refresh();
  go("recovery");
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

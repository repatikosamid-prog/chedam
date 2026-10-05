// Connectivity bar data (FR-12.01): can this device reach the hub, and does the hub have internet
// (offline / router / hotspot)? Also compares clocks: times are stored in UTC (BR-30), so a device
// clock far from the hub's is worth a warning.
// Checks every 30 s while the hub answers, every 5 s while it does not (so recovery shows quickly).
// Any request that gets no answer marks the hub down at once (lib/api.js).
import { api, onHubChange } from "./api.js";

export const net = $state({ hub: "checking", internet: "", skewMin: 0, checkedAt: 0, busy: false });

let timer = null;

export async function checkNow() {
  if (net.busy) return;
  net.busy = true;
  const sent = Date.now();
  const r = await api("GET", "/api/chedam/status", null, { timeout: 4000 });
  net.busy = false;
  if (!r.ok) {
    net.hub = "down";
    net.internet = "";
  } else {
    net.hub = "ok";
    net.internet = r.json.internet;
    const hub = new Date(r.json.hub_time).getTime();
    const mid = (sent + Date.now()) / 2;
    net.skewMin = Math.round((mid - hub) / 60000);
  }
  net.checkedAt = Date.now();
  schedule();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(checkNow, net.hub === "down" ? 5000 : 30000);
}

export function startMonitor() {
  onHubChange((down) => {
    if (down) { net.hub = "down"; net.internet = ""; schedule(); }
    else if (net.hub !== "ok") checkNow();
  });
  checkNow();
  window.addEventListener("online", checkNow);
  window.addEventListener("offline", () => { net.hub = "down"; net.internet = ""; schedule(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkNow(); });
}

// Connectivity bar data (FR-12.01): can this device reach the hub, and does the hub have internet
// (offline / router / hotspot)? Also compares clocks: times are stored in UTC (BR-30), so a device
// clock far from the hub's is worth a warning.
import { api } from "./api.js";

export const net = $state({ hub: "checking", internet: "", skewMin: 0, checkedAt: 0 });

let timer = null;

export async function checkNow() {
  const sent = Date.now();
  const r = await api("GET", "/api/chedam/status", null, { timeout: 5000 });
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
}

export function startMonitor(intervalMs = 30000) {
  checkNow();
  clearInterval(timer);
  timer = setInterval(checkNow, intervalMs);
  window.addEventListener("online", checkNow);
  window.addEventListener("offline", () => { net.hub = "down"; net.internet = ""; });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkNow(); });
}

// Backup helpers shared by the wizard step and the Backups screen.
import { api } from "./api.js";

export async function backupStatus() {
  return api("GET", "/api/chedam/backups/status");
}

// Starts a backup and waits until the hub has the helper's result (verified or failed).
export async function backupNow(first = false, onTick = () => {}) {
  const r = await api("POST", "/api/chedam/backups/run", { first });
  if (!r.ok) return r;
  for (let i = 0; i < 240; i++) {               // up to 4 minutes on a slow drive
    await new Promise((res) => setTimeout(res, 1000));
    onTick(i + 1);
    const s = await backupStatus();
    if (s.ok && s.json.latest && s.json.latest.id === r.json.id && s.json.latest.status !== "running") {
      return { ok: s.json.latest.status === "verified", status: 200, json: s.json.latest, message: s.json.latest.error };
    }
  }
  return { ok: false, status: 0, json: null, message: "The backup is taking long. Check the Backups screen in a few minutes." };
}

export function size(n) {
  if (!n) return "0";
  return n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";
}

export function when(s) {
  return s ? new Date(s.replace(" ", "T")).toLocaleString() : "never";
}

// Offline selling on the till (P1 step 4; FR-3.16, Section 8.2; DL-86..89).
// - The offline pack (products, prices, tax, settings) is kept in IndexedDB (Dexie) and refreshed
//   whenever the hub answers.
// - Sales made while the hub is unreachable wait in a queue on this device and upload in order when it
//   is back. Each keeps its sale id, so a repeat upload is answered with the first result (BR-10).
// - A sale the hub refuses (its figures do not add up) stays in the queue marked as a problem for a
//   manager; the others carry on.
import Dexie from "dexie";
import { api, load } from "./api.js";
import { indexPack } from "./offline_price.js";

const db = new Dexie("chedam");
db.version(1).stores({ kv: "key", queue: "id, created" });

export const off = $state({ pending: 0, problems: 0, syncing: false, packAt: "", lastSync: "", lastError: "" });

let packIx = null;

export async function getPack() {
  if (packIx) return packIx;
  try { const row = await db.kv.get("pack"); if (row) { packIx = indexPack(row.value); off.packAt = row.value.at; } } catch { /* storage refused */ }
  return packIx;
}

// Downloads the pack when the hub answers; keeps the old one otherwise.
export async function refreshPack() {
  const r = await api("GET", "/api/chedam/sales/offline-pack", null, { timeout: 15000 });
  if (!r.ok) return packIx;
  try { await db.kv.put({ key: "pack", value: r.json }); } catch { /* storage refused: keep it in memory */ }
  packIx = indexPack(r.json);
  off.packAt = r.json.at;
  return packIx;
}

// Receipt number printed while offline: OFF-<device>-<n>, unique on this device.
export function nextOfflineRef() {
  const dev = (load("device") || { id: "xxxx" }).id.substring(0, 4).toUpperCase();
  let n = 1;
  try { n = Number(localStorage.getItem("chedam.offline_seq") || "1"); localStorage.setItem("chedam.offline_seq", String(n + 1)); } catch { n = Date.now() % 100000; }
  return "OFF-" + dev + "-" + String(n).padStart(4, "0");
}

export async function enqueue(payload, receipt) {
  // Plain copies: IndexedDB cannot store Svelte's reactive proxies (DataCloneError).
  const plain = (v) => JSON.parse(JSON.stringify(v));
  await db.queue.put({ id: payload.id, created: Date.now(), payload: plain(payload), receipt: plain(receipt), status: "pending", error: "" });
  await count();
}

export async function queued() { try { return await db.queue.orderBy("created").toArray(); } catch { return []; } }

async function count() {
  const all = await queued();
  off.pending = all.filter((q) => q.status === "pending").length;
  off.problems = all.filter((q) => q.status === "problem").length;
}

// Uploads waiting sales in the order they were made (Section 8.2, step 4). Stops at the first sale
// the hub cannot be reached for; a sale it refuses is set aside as a problem.
export async function syncQueue() {
  if (off.syncing) return;
  off.syncing = true;
  try {
    for (const q of await queued()) {
      if (q.status !== "pending") continue;
      const r = await api("POST", "/api/chedam/sales/offline", q.payload, { timeout: 20000 });
      if (r.status === 0) { off.lastError = "The hub is not answering."; break; }
      if (r.ok) { await db.queue.delete(q.id); off.lastSync = new Date().toISOString(); off.lastError = ""; continue; }
      if (r.status === 401 || r.status === 423) { off.lastError = "Sign in again to upload the offline sales."; break; }
      await db.queue.update(q.id, { status: "problem", error: r.message });
    }
  } finally {
    off.syncing = false;
    await count();
  }
}

// Sets a problem sale back to "pending" (after a manager has looked at it) or removes it.
export async function retry(id) { await db.queue.update(id, { status: "pending", error: "" }); await count(); return syncQueue(); }
export async function discard(id) { await db.queue.delete(id); await count(); }

let started = false;
// Every 10 s: upload waiting sales if the hub answers; refresh the pack every 5 minutes.
export function startOffline(isSignedIn, hubUp) {
  if (started) return;
  started = true;
  count();
  let lastPack = 0;
  setInterval(async () => {
    if (!isSignedIn() || !hubUp()) return;
    if (off.pending) syncQueue();
    if (Date.now() - lastPack > 5 * 60000) { lastPack = Date.now(); refreshPack(); }
  }, 10000);
}

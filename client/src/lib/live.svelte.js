// Live updates (P2-e): one PocketBase realtime connection per signed-in device. The connection itself
// (EventSource) cannot carry headers; subscribing does, with the person's token and the device headers
// (conventions), so the hub sends each person only what the collection rules allow them to see.
// listeners: on(topic, fn) for "messages" and "announcements"; badge counts in live.unread / live.toAck.
// When the connection drops it reconnects; the badge is also refreshed every 2 minutes.
import { api, load } from "./api.js";

export const live = $state({ unread: 0, mentioned: false, toAck: 0, connected: false });
const subs = { messages: new Set(), announcements: new Set() };
let es = null, timer = null, poll = null, wantOn = false;

export function on(topic, fn) { subs[topic].add(fn); return () => subs[topic].delete(fn); }

export async function refreshBadge() {
  const r = await api("GET", "/api/chedam/messages/unread", null, { quiet: true });
  if (r.ok) { live.unread = r.json.unread; live.mentioned = r.json.mentioned; live.toAck = r.json.to_ack; }
}

async function subscribe(clientId) {
  const h = { "Content-Type": "application/json" };
  const dev = load("device"), tok = load("token");
  if (dev) { h["X-Chedam-Device"] = dev.id; h["X-Chedam-Device-Key"] = dev.key; }
  if (tok) h.Authorization = tok;
  const r = await fetch("/api/realtime", { method: "POST", headers: h, body: JSON.stringify({ clientId, subscriptions: Object.keys(subs) }) }).catch(() => null);
  live.connected = !!r && r.status === 204;
}

export function startLive() {
  wantOn = true;
  if (es) return;
  try { es = new EventSource("/api/realtime"); } catch { es = null; return; }
  es.addEventListener("PB_CONNECT", (e) => { try { subscribe(JSON.parse(e.data).clientId); } catch { /* bad event */ } });
  Object.keys(subs).forEach((topic) => es.addEventListener(topic, (e) => {
    let d = null;
    try { d = JSON.parse(e.data); } catch { return; }
    subs[topic].forEach((fn) => { try { fn(d); } catch { /* a screen's problem */ } });
    refreshBadge();
  }));
  es.onerror = () => {
    live.connected = false;
    if (es) es.close();
    es = null;
    clearTimeout(timer);
    if (wantOn) timer = setTimeout(startLive, 5000);
  };
  refreshBadge();
  clearInterval(poll);
  poll = setInterval(refreshBadge, 120000);
}

export function stopLive() {
  wantOn = false;
  clearTimeout(timer); clearInterval(poll);
  if (es) es.close();
  es = null; live.connected = false; live.unread = 0; live.toAck = 0;
}

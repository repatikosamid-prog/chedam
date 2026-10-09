// Chedam service worker (generated at build time from client/src/sw-template.js).
// Offline shell: the app's own files are cached at install, so the app opens with no hub.
// The API is never cached here; offline data and the sales queue come with later phases (Dexie).
const BUILD = "__BUILD__";
const FILES = __FILES__;
const CACHE = "chedam-shell-" + BUILD;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

// The build before this one is kept until the next update: a page that is still open on it can load its
// on-demand parts (PDF maker, spreadsheet reader) from the cache; the hub no longer has them.
const META = "chedam-meta";
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const meta = await caches.open(META);
    const hit = await meta.match("./__current");
    const before = hit ? await hit.text() : "";
    const keep = [CACHE, before];
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("chedam-shell-") && !keep.includes(k)).map((k) => caches.delete(k)));
    if (before !== CACHE) await meta.put("./__current", new Response(CACHE));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // Hub API, admin UI, certificate guide and CA download always go to the network.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_/") || url.pathname === "/device-setup.html" || url.pathname === "/ca.crt") return;

  if (req.mode === "navigate") {
    // Page loads: newest from the hub when it answers within 3 s, else the cached shell. The time limit
    // matters: with the hub switched off, a phone's request does not fail, it just waits.
    event.respondWith(withTimeout(fetch(req), 3000).catch(() => caches.match("./", { ignoreSearch: true, ignoreVary: true })));
    return;
  }
  // App files are content-hashed: the cache is always right for them. ignoreVary: the hub answers with
  // "Vary: Origin" and module scripts are requested with an Origin header, the cached copies without one.
  // caches.match looks in every cache, so the build before this one is found too.
  event.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req)));
});

self.addEventListener("message", (event) => {
  if (event.data === "version") event.source.postMessage({ build: BUILD });
});

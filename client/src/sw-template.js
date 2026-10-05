// Chedam service worker (generated at build time from client/src/sw-template.js).
// Offline shell: the app's own files are cached at install, so the app opens with no hub.
// The API is never cached here; offline data and the sales queue come with later phases (Dexie).
const BUILD = "__BUILD__";
const FILES = __FILES__;
const CACHE = "chedam-shell-" + BUILD;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("chedam-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // Hub API, admin UI, certificate guide and CA download always go to the network.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_/") || url.pathname === "/device-setup.html" || url.pathname === "/ca.crt") return;

  if (req.mode === "navigate") {
    // Page loads: newest from the hub when it answers, else the cached shell.
    event.respondWith(
      fetch(req).catch(() => caches.match("./", { ignoreSearch: true, ignoreVary: true })),
    );
    return;
  }
  // App files are content-hashed: the cache is always right for them. ignoreVary: the hub answers with
  // "Vary: Origin" and module scripts are requested with an Origin header, the cached copies without one.
  event.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req)));
});

self.addEventListener("message", (event) => {
  if (event.data === "version") event.source.postMessage({ build: BUILD });
});

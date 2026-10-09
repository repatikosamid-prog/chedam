import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { net } from "./lib/connectivity.svelte.js";

mount(App, { target: document.getElementById("app") });

// A part of the app loaded on demand (PDF maker, spreadsheet reader, camera scanner) belongs to the
// build that is open. When the hub got a newer build meanwhile, the old file is gone and the hub answers
// with its start page instead ("'text/html' is not a valid JavaScript MIME type"). Reload once to open
// the new build; a second failure within a minute is shown as an error instead of reloading again.
window.addEventListener("vite:preloadError", (event) => {
  let last = 0;
  try { last = Number(sessionStorage.getItem("chedam.reloaded") || 0); } catch { /* blocked */ }
  if (Date.now() - last < 60000) return;
  event.preventDefault();
  try { sessionStorage.setItem("chedam.reloaded", String(Date.now())); } catch { /* blocked */ }
  location.reload();
});

// Offline shell: the service worker caches the app (HTTPS or localhost only). Chrome refuses it with a
// certificate error when the person tapped through "Your connection is not private": say so.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch((err) => {
    if (/SSL|certificate/i.test(String(err && err.message))) net.untrusted = true;
  });
} else if (location.protocol === "https:" && !window.isSecureContext) {
  net.untrusted = true;
}

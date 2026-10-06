import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { net } from "./lib/connectivity.svelte.js";

mount(App, { target: document.getElementById("app") });

// Offline shell: the service worker caches the app (HTTPS or localhost only). Chrome refuses it with a
// certificate error when the person tapped through "Your connection is not private": say so.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch((err) => {
    if (/SSL|certificate/i.test(String(err && err.message))) net.untrusted = true;
  });
} else if (location.protocol === "https:" && !window.isSecureContext) {
  net.untrusted = true;
}

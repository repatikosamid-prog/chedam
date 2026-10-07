import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Writes sw.js with the exact list of built files, so the whole app shell is cached when the service
// worker installs (offline shell, Section 13 step 5). The build id changes with the content, so devices
// pick up a new version on their next visit.
function serviceWorker() {
  return {
    name: "chedam-sw",
    apply: "build",
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const statics = ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];
      const list = ["./", ...files.map((f) => "./" + f), ...statics.map((f) => "./" + f)];
      const build = createHash("sha256").update(JSON.stringify(list) + Object.values(bundle)
        .map((b) => (b.type === "chunk" ? b.code : String(b.source && b.source.length))).join("")).digest("hex").substring(0, 12);
      const template = readFileSync(new URL("./src/sw-template.js", import.meta.url), "utf8");
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: template.replace("__BUILD__", pkg.version + "-" + build).replace("__FILES__", JSON.stringify(list)),
      });
    },
  };
}

// The till prices offline sales with the hub's own arithmetic (hub/pb_hooks/lib/pricing_core.js, a
// CommonJS file for the hub's JS engine): served to the app as `virtual:pricing-core` (DL-86).
function pricingCore() {
  const file = fileURLToPath(new URL("../hub/pb_hooks/lib/pricing_core.js", import.meta.url));
  const ID = "\0virtual:pricing-core";
  return {
    name: "chedam-pricing-core",
    resolveId(id) { return id === "virtual:pricing-core" ? ID : null; },
    load(id) {
      if (id !== ID) return null;
      this.addWatchFile(file);
      return "const module = { exports: {} };\n" + readFileSync(file, "utf8") + "\nexport default module.exports;\n";
    },
  };
}

export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [pricingCore(), svelte(), tailwindcss(), serviceWorker()],
  build: {
    outDir: "../hub/pb_public",
    emptyOutDir: true,
    target: ["chrome110", "safari16", "firefox115", "edge110"],   // Android 9's last Chrome (138) and iOS 26 are newer
  },
  server: {
    // npm run dev: the UI on :5173 talks to a local dev hub on :8095 (see docs)
    proxy: { "/api": "http://127.0.0.1:8095" },
  },
});

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
      // Bill reading (OCR, PDF) loads only when used: not cached on every device
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map") && !f.startsWith("ocr/") && !/pdf\.worker/.test(f));
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

// Reading bill photos in the browser (P3 step 5, P3-d): Tesseract's worker, its LSTM engine (with and without
// SIMD) and the English model, copied from node_modules into ocr/ (served by the hub, so it works offline).
function ocrAssets() {
  const files = { "ocr/worker.min.js": "tesseract.js/dist/worker.min.js", "ocr/tesseract-core-lstm.wasm.js": "tesseract.js-core/tesseract-core-lstm.wasm.js",
    "ocr/tesseract-core-simd-lstm.wasm.js": "tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "ocr/eng.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz" };
  return {
    name: "chedam-ocr-assets",
    apply: "build",
    generateBundle() {
      Object.keys(files).forEach((name) => this.emitFile({ type: "asset", fileName: name, source: readFileSync(fileURLToPath(new URL("./node_modules/" + files[name], import.meta.url))) }));
    },
  };
}

// The hub's own pure libraries (CommonJS files for the hub's JS engine) served to the app, so both use the
// same code: `virtual:pricing-core` (the till prices offline sales, DL-86) and `virtual:receipt-layout`
// (a receipt saved as PDF is what the receipt printer prints, DL-116).
const HUB_LIBS = { "virtual:pricing-core": "pricing_core.js", "virtual:receipt-layout": "receipt_layout.js", "virtual:promotions-core": "promotions_core.js" };
function pricingCore() {
  return {
    name: "chedam-hub-libs",
    resolveId(id) { return HUB_LIBS[id] ? "\0" + id : null; },
    load(id) {
      const lib = id.startsWith("\0") && HUB_LIBS[id.slice(1)];
      if (!lib) return null;
      const file = fileURLToPath(new URL("../hub/pb_hooks/lib/" + lib, import.meta.url));
      this.addWatchFile(file);
      return "const module = { exports: {} };\n" + readFileSync(file, "utf8") + "\nexport default module.exports;\n";
    },
  };
}

export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [pricingCore(), svelte(), tailwindcss(), ocrAssets(), serviceWorker()],
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

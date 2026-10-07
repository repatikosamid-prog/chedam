// Camera barcode reading (FR-3.02, FR-6.02; spec Section 12: BarcodeDetector + ZXing).
// The browser's own BarcodeDetector is used when it reads retail barcodes (Chrome on Android); else
// ZXing (Safari on iPhone, desktop browsers), loaded only when needed. The camera needs trusted HTTPS
// (risk R5): cameraProblem() explains why it is refused.

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

export async function makeReader() {
  if ("BarcodeDetector" in window) {
    try {
      const have = await window.BarcodeDetector.getSupportedFormats();
      const want = FORMATS.filter((f) => have.includes(f));
      if (want.includes("ean_13")) {
        const det = new window.BarcodeDetector({ formats: want });
        return { kind: "BarcodeDetector", read: async (video) => { const r = await det.detect(video); return r.length ? r[0].rawValue : ""; } };
      }
    } catch { /* fall back to ZXing */ }
  }
  const z = await import("@zxing/library");
  const hints = new Map();
  hints.set(z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.EAN_13, z.BarcodeFormat.EAN_8, z.BarcodeFormat.UPC_A,
    z.BarcodeFormat.UPC_E, z.BarcodeFormat.CODE_128, z.BarcodeFormat.CODE_39, z.BarcodeFormat.ITF]);
  hints.set(z.DecodeHintType.TRY_HARDER, true);
  // The 1D reader directly: MultiFormatReader logs a line for every frame without a barcode.
  const reader = new z.MultiFormatOneDReader(hints);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return {
    kind: "ZXing",
    read: async (video) => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return "";
      // The middle band of the picture, scaled to at most 960 px wide: enough for a barcode, fast on a phone.
      const sw = Math.min(w, 960), scale = sw / w, bandH = Math.round(h * 0.6);
      canvas.width = sw; canvas.height = Math.round(bandH * scale);
      ctx.drawImage(video, 0, Math.round(h * 0.2), w, bandH, 0, 0, canvas.width, canvas.height);
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const lum = new Uint8ClampedArray(canvas.width * canvas.height);
      for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
      try {
        const bmp = new z.BinaryBitmap(new z.HybridBinarizer(new z.RGBLuminanceSource(lum, canvas.width, canvas.height)));
        return reader.decode(bmp, hints).getText();
      } catch {
        return "";
      } finally {
        reader.reset();
      }
    },
  };
}

// Plain words for why the camera did not start.
export function cameraProblem(err) {
  if (!window.isSecureContext) return "This device does not trust the hub's certificate yet, so the browser blocks the camera. Install the certificate (Device setup page), or type the code.";
  const n = err && err.name;
  if (n === "NotAllowedError") return "Camera permission was refused. Allow the camera for this site in the browser settings, or type the code.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "No camera found on this device. Type the code or use a USB scanner.";
  if (n === "NotReadableError") return "The camera is in use by another app. Close it and try again.";
  return "The camera could not start" + (err && err.message ? " (" + err.message + ")" : "") + ". Type the code instead.";
}

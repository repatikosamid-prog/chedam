// A short message that pops up at the bottom of the screen (e.g. "Saved ✓") and goes away by itself.
// api.js shows "Saved ✓" after every change the hub accepted (savedToast), so each screen confirms a save
// the same way; screens can show their own text with toast().

export const t = $state({ text: "", kind: "ok", n: 0 });
let timer;

export function toast(text, kind = "ok", ms = 2500) {
  t.text = text; t.kind = kind; t.n++;
  clearTimeout(timer);
  timer = setTimeout(() => { t.text = ""; }, ms);
}

// Writes that are not a "save": pricing, holds of stock, sign-in, approvals, printing, checks and the
// selling flow (which has its own screens). Everything else that changes data says "Saved ✓".
const NOT_A_SAVE = [
  /\/sales\/(quote|soft-holds|approvals)$/, /\/returns\/quote$/, /\/auth/, /\/devices\/(request|pair|pairing-code|me\/sign-out)$/,
  /\/printers\/(test|scan)$/, /\/print/, /\/drawer\//, /\/labels\/(layouts\/check|batches)/, /\/imports\/check$/, /\/updates\/check$/,
  /\/setup\//, /\/backups\/(run|test-restore|drives)$/, /\/owner\/recovery-code$/, /\/sales(\/|$)/, /\/returns$/, /\/holds/,
  /\/offline/, /\/tills\/[^/]+\/(close|count)/,
];

export function savedToast(method, path) {
  if (method === "GET") return;
  const p = path.split("?")[0];
  if (NOT_A_SAVE.some((re) => re.test(p))) return;
  toast(method === "DELETE" ? "Removed ✓" : "Saved ✓");
}

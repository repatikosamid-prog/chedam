// A scale connected to this till (T3, 2026-10-11; optional, setting scale.enabled): products sold by weight read
// the weight from it instead of typing it. Web Serial (Chrome or Edge on a PC or laptop till; phones and iPhones
// can't open serial ports, they type the weight). Each till chooses its own scale once (the browser asks which
// port); what was chosen is kept on this device. The scale must be approved by Measurement Canada for selling by
// weight; Chedam only reads what it shows.
// Protocols: "command" sends W + carriage return and reads the answer (Toledo 8213 / CAS / most POS scales);
// "continuous" reads the line the scale keeps sending.
const KEY = "chedam.scale";

export const supported = () => typeof navigator !== "undefined" && "serial" in navigator;
export function config() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
export function saveConfig(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ } }
export function forget() { try { localStorage.removeItem(KEY); } catch { /* private mode */ } }

// "  1.234kg", "0.500 LB", "ST,GS,+001.25kg" -> {value, unit}; null when unstable or unreadable
export function parse(text) {
  const t = String(text || "");
  if (/\bUS\b|\?/.test(t)) return null;                              // unstable reading
  const m = t.replace(",", ".").match(/([+-]?\d+(?:\.\d+)?)\s*(kg|lb|g|oz)\b/i);
  if (!m) return null;
  return { value: Number(m[1]), unit: m[2].toLowerCase() };
}
// To the product's base unit (kg or lb)
export function toBase(r, base) {
  if (!r) return null;
  const g = { kg: 1000, lb: 453.59237, g: 1, oz: 28.349523125 }[r.unit] * r.value;
  return Math.round((g / (base === "lb" ? 453.59237 : 1000)) * 1000) / 1000;
}

// The till chooses the scale's port (needs a tap: the browser shows the list)
export async function choose(c) {
  if (!supported()) throw new Error("This browser can't talk to a scale: use Chrome or Edge on the till PC, or type the weight.");
  const port = await navigator.serial.requestPort();
  const info = port.getInfo ? port.getInfo() : {};
  saveConfig({ protocol: c.protocol || "command", baud: Number(c.baud) || 9600, vendor: info.usbVendorId || 0, product: info.usbProductId || 0 });
  return config();
}

async function port() {
  const c = config();
  if (!c || !supported()) return null;
  const ports = await navigator.serial.getPorts();
  return ports.find((p) => { const i = p.getInfo ? p.getInfo() : {}; return (i.usbVendorId || 0) === c.vendor && (i.usbProductId || 0) === c.product; }) || ports[0] || null;
}

// One reading, in the product's base unit; throws with a message for the cashier
export async function read(base, timeoutMs = 3000) {
  const c = config();
  const p = await port();
  if (!p) throw new Error("No scale connected on this till (Receipt printer → Scale).");
  await p.open({ baudRate: c.baud || 9600 });
  try {
    if (c.protocol !== "continuous") { const w = p.writable.getWriter(); await w.write(new TextEncoder().encode("W\r")); w.releaseLock(); }
    const reader = p.readable.getReader();
    let buf = "", got = null;
    const timer = setTimeout(() => reader.cancel().catch(() => {}), timeoutMs);
    try {
      while (!got) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        const lines = buf.split(/[\r\n\x03]+/);
        for (const l of lines) { const r = parse(l); if (r) { got = r; break; } }
        if (buf.length > 400) buf = buf.slice(-200);
      }
    } finally { clearTimeout(timer); reader.releaseLock(); }
    if (!got) throw new Error("The scale did not give a steady weight: wait until it settles and try again.");
    if (got.value <= 0) throw new Error("The scale shows 0: put the item on it.");
    return toBase(got, base);
  } finally { await p.close().catch(() => {}); }
}

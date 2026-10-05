// Brand colours from the logo (FR-1.02): the most common clearly coloured pixels, grouped. Near-white,
// near-black and grey pixels are ignored (background and outlines). The accent is the primary colour
// darkened until white text on it is readable (WCAG AA, 4.5:1), for buttons and the receipt heading.

export async function coloursFromImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const size = 64;
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);
    const px = ctx.getImageData(0, 0, size, size).data;
    const buckets = new Map();
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      if (a < 128) continue;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max > 235 && min > 235) continue;           // white
      if (max < 30) continue;                          // black
      if (max - min < 25) continue;                    // grey
      const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
      const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      buckets.set(key, e);
    }
    const ranked = [...buckets.values()].sort((a, b) => b.n - a.n)
      .map((e) => [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)]);
    if (!ranked.length) return null;
    const primary = ranked[0];
    const secondary = ranked.find((c) => dist(c, primary) > 90) || lighten(primary, 0.55);
    return { primary: hex(primary), secondary: hex(secondary), accent: hex(readableOnWhite(primary)), from_logo: true };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function lighten(c, t) { return c.map((v) => Math.round(v + (255 - v) * t)); }
export function hex(c) { return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join(""); }
export function rgb(h) { return [1, 3, 5].map((i) => parseInt(h.substring(i, i + 2), 16)); }

function lum(c) {
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function readableOnWhite(c) {
  let d = c.slice();
  for (let i = 0; i < 20 && contrast(d, [255, 255, 255]) < 4.5; i++) d = d.map((v) => Math.round(v * 0.88));
  return d;
}

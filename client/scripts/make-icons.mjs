// Draws the app icons (PNG) with no image library: a green tile with a white "C" ring.
// Usage: node client/scripts/make-icons.mjs   (writes client/public/icons/*.png; run again if the design changes)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const BG = [0x1f, 0x6f, 0x5c], FG = [0xff, 0xff, 0xff];

// Coverage (0..1) of the white "C" at a point in unit coordinates (0..1), for a given safe-zone scale.
function ink(x, y, scale) {
  const cx = 0.5, cy = 0.5;
  const dx = (x - cx) / scale, dy = (y - cy) / scale;
  const r = Math.hypot(dx, dy);
  if (r < 0.2 || r > 0.34) return 0;
  const ang = Math.atan2(dy, dx);                 // gap on the right side: -40°..40°
  return Math.abs(ang) < (40 * Math.PI) / 180 ? 0 : 1;
}

// maskable: full-bleed square (Android crops it); otherwise rounded corners.
function draw(size, { maskable = false } = {}) {
  const ss = 4, rad = maskable ? 0 : 0.22, scale = maskable ? 0.8 : 1;
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const x = (px + (sx + 0.5) / ss) / size, y = (py + (sy + 0.5) / ss) / size;
        const qx = Math.max(rad - x, 0, x - (1 - rad)), qy = Math.max(rad - y, 0, y - (1 - rad));
        if (rad && Math.hypot(qx, qy) > rad) continue;   // outside the rounded tile
        bg++;
        fg += ink(x, y, scale);
      }
      const n = ss * ss, a = bg / n, f = bg ? fg / bg : 0;
      const o = 1 + px * 4;
      for (let c = 0; c < 3; c++) row[o + c] = Math.round(BG[c] * (1 - f) + FG[c] * f);
      row[o + 3] = Math.round(a * 255);
    }
    rows.push(row);
  }
  return png(size, Buffer.concat(rows));
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon-192.png"), draw(192));
writeFileSync(join(OUT, "icon-512.png"), draw(512));
writeFileSync(join(OUT, "maskable-512.png"), draw(512, { maskable: true }));
writeFileSync(join(OUT, "apple-touch-icon.png"), draw(180, { maskable: true }));   // iOS rounds it itself
console.log("icons written to " + OUT);

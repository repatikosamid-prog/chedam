// Dev only: a pretend network receipt printer. Listens like a real one (raw TCP) and prints what it
// receives as text, marking the drawer kick, cuts and barcodes. Every job is also appended to
// .devhub/printer-out.txt.
// Usage: node tools/devhub/fake-printer.mjs [port=9100] [host=127.0.0.1]
// Then add a printer with that address on the Receipt printer screen of the local dev hub.
import { createServer } from "node:net";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] || 9100), host = process.argv[3] || "127.0.0.1";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".devhub", "printer-out.txt");
mkdirSync(dirname(OUT), { recursive: true });

function decode(b) {
  let out = "", i = 0;
  while (i < b.length) {
    const c = b[i];
    if (c === 27) {                                         // ESC
      const n = b[i + 1];
      if (n === 64) i += 2;                                 // initialise
      else if (n === 112) { out += "[DRAWER OPENS]\n"; i += 5; }
      else if (n === 100) { out += "\n".repeat(Math.max(0, b[i + 2] - 1)); i += 3; }
      else i += 3;                                          // align, bold, code page
    } else if (c === 29) {                                  // GS
      const n = b[i + 1];
      if (n === 86) { out += "------------------ [CUT] ------------------\n"; i += 4; }
      else if (n === 107) { const len = b[i + 3]; out += "[BARCODE " + b.subarray(i + 4, i + 4 + len).toString("latin1").replace(/^\{B/, "") + "]"; i += 4 + len; }
      else i += 3;                                          // size, barcode height/width/text
    } else { out += String.fromCharCode(c); i++; }
  }
  return out;
}

createServer((s) => {
  const parts = [];
  s.on("data", (d) => parts.push(d));
  s.on("close", () => {
    const b = Buffer.concat(parts);
    if (!b.length) return;                                  // the hub's network scan knocking
    const text = "==== job " + new Date().toLocaleTimeString() + " (" + b.length + " bytes) ====\n" + decode(b) + "\n";
    process.stdout.write(text);
    appendFileSync(OUT, text);
  });
}).listen(port, host, () => console.log(`Fake receipt printer on ${host}:${port}; jobs also in ${OUT}`));

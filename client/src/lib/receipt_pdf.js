// A receipt or return slip as a PDF (DL-116): saved on the device or printed on any printer, like any
// PDF. It is exactly what the receipt printer prints: the same layout code as the hub
// (hub/pb_hooks/lib/receipt_layout.js via `virtual:receipt-layout`), on 80 mm paper, with the receipt
// number as a real CODE128 barcode for returns. Loaded only when asked for (jsPDF).
//   receiptPdf(record, {kind: "sale"|"return", copy})  -> jsPDF document
import RL from "virtual:receipt-layout";
import { encode } from "./labels/barcode.js";

const W = 80, M = 4, CHARS = 42;                    // 80 mm roll, 4 mm margins, 42 characters a line
const CW = (W - 2 * M) / CHARS;                     // mm per character (Courier is 0.6 em wide)
const SIZE = (CW / 0.6) * 2.8346;                   // font size in points
const LH = CW / 0.6 * 1.25;                         // line height, mm

export async function receiptPdf(rec, { kind = "sale", copy = 0 } = {}) {
  const L = kind === "return" ? RL.returnReceipt(rec, { chars: CHARS, copy, till_number: rec.till_number })
    : RL.receipt(rec, { chars: CHARS, copy, till_number: rec.till_number });
  const rows = RL.lines(L, CHARS);
  const h = M * 2 + rows.reduce((a, r) => a + (r.x.t === "barcode" ? 14 : r.x.big ? LH * 2 : LH), 0);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: [W, Math.max(h, 60)], orientation: "portrait", compress: true });
  let y = M;
  rows.forEach((r) => {
    if (r.x.t === "barcode") {
      const e = encode(r.x.s);
      if (e) {
        const mod = Math.min(0.33, (W - 2 * M) / (e.modules.length + 20));
        const x0 = (W - e.modules.length * mod) / 2;
        doc.setFillColor(0, 0, 0);
        for (let i = 0; i < e.modules.length; i++) if (e.modules[i] === "1") doc.rect(x0 + i * mod, y + 1, mod, 9, "F");
        doc.setFont("courier", "normal"); doc.setFontSize(SIZE);
        doc.text(r.x.s, W / 2, y + 13, { align: "center" });
      }
      y += 14;
      return;
    }
    const big = !!r.x.big;
    doc.setFont("courier", r.x.bold ? "bold" : "normal");
    doc.setFontSize(big ? SIZE * 2 : SIZE);
    y += big ? LH * 2 : LH;
    if (r.s.trim()) doc.text(r.s, M, y - (big ? LH * 0.5 : LH * 0.25));
  });
  doc.setProperties({ title: (kind === "return" ? "Return " : "Receipt ") + (rec.number || ""), creator: "Chedam" });
  return doc;
}

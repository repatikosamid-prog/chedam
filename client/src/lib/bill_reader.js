// Reading a vendor's bill in the browser (P3 step 5, FR-6.11, P3-d): a photo is read with Tesseract (served by
// the hub from ./ocr/, so it works offline); a PDF with its own text (pdf.js), or read like a photo when it is
// a scan. Then the text is turned into lines: code, description, quantity, unit price, line total; and the
// bill's number, date, subtotal, GST/HST, PST and total. The hub matches the lines to products.
//   readBill(file, onProgress) -> { text, lines, ref, date, totals: {subtotal_cents, gst_cents, pst_cents, total_cents} }
//   parseBill(text) is pure (tested in Node).

const AMOUNT = /-?\$?\s?\d{1,3}(?:[,\s]\d{3})*\.\d{2}(?!\d)/g;
const NOT_ITEM = /\b(sub-?total|total|gst|hst|pst|qst|tax|balance|amount\s+due|deposit|payment|paid|change|discount\s+total|freight|shipping|delivery\s+charge|invoice|page\s+\d)\b/i;
const cents = (s) => Math.round(Number(String(s).replace(/[$,\s]/g, "")) * 100);

export function parseBill(text) {
  const rows = String(text || "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const totals = { subtotal_cents: null, gst_cents: null, pst_cents: null, total_cents: null, freight_cents: null };
  const lines = [];
  let ref = "", date = "";
  rows.forEach((row) => {
    if (!ref) { const m = row.match(/\b(?:invoice|inv|bill)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i); if (m && /\d/.test(m[1])) ref = m[1]; }
    if (!date) {
      const m = row.match(/\b(\d{4}-\d{2}-\d{2})\b/) || row.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/) || row.match(/\b([A-Z][a-z]{2,8})\.?\s(\d{1,2}),?\s(\d{4})\b/);
      if (m) {
        if (m.length === 2) date = m[1];
        else if (/^\d+$/.test(m[1])) date = m[3] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0");     // day/month/year (Canada)
        else { const d = new Date(m[1] + " " + m[2] + ", " + m[3]); if (!isNaN(d)) date = d.toISOString().substring(0, 10); }
      }
    }
    const amounts = row.match(AMOUNT) || [];
    if (!amounts.length) return;
    const last = cents(amounts[amounts.length - 1]);
    if (/\bsub-?total\b/i.test(row)) { totals.subtotal_cents = last; return; }
    if (/\b(gst|hst)\b/i.test(row)) { totals.gst_cents = last; return; }
    if (/\b(pst|qst)\b/i.test(row)) { totals.pst_cents = last; return; }
    if (/\b(freight|shipping|delivery charge)\b/i.test(row)) { totals.freight_cents = last; return; }
    if (/\b(total|amount\s+due|balance\s+due)\b/i.test(row)) { totals.total_cents = last; return; }
    if (NOT_ITEM.test(row) || !/[A-Za-z]{2,}/.test(row)) return;
    // An item: [code] [qty] description [unit] total
    let rest = row;
    amounts.forEach((a) => { rest = rest.replace(a, " "); });
    const tokens = rest.trim().split(" ").filter(Boolean);
    let code = "", qty = null;
    if (tokens.length && /^[A-Z0-9-]{3,14}$/i.test(tokens[0]) && /\d/.test(tokens[0]) && !/^\d{1,3}$/.test(tokens[0])) code = tokens.shift();
    if (tokens.length && /^\d+(\.\d+)?$/.test(tokens[0])) qty = Number(tokens.shift());
    else if (tokens.length && /^\d+(\.\d+)?$/.test(tokens[tokens.length - 1])) qty = Number(tokens.pop());
    const mx = rest.match(/\b(\d+(?:\.\d+)?)\s?[x×@]\s/i);
    if (qty === null && mx) qty = Number(mx[1]);
    if (!code && tokens.length && /^\d{8,14}$/.test(tokens[tokens.length - 1])) code = tokens.pop();
    const description = tokens.join(" ").replace(/^[-–:]+|[-–:]+$/g, "").trim();
    const unit = amounts.length >= 2 ? cents(amounts[amounts.length - 2]) : null;
    if (qty === null) qty = unit && last ? Math.max(1, Math.round((last / unit) * 1000) / 1000) : 1;
    lines.push({ raw: row, code, description, qty, unit_cents: unit !== null ? unit : Math.round(last / (qty || 1)), total_cents: last });
  });
  const sum = lines.reduce((a, l) => a + l.total_cents, 0);
  const checks = [];
  if (totals.subtotal_cents !== null && Math.abs(totals.subtotal_cents - sum) > 2) checks.push("The lines add up to " + (sum / 100).toFixed(2) + ", the bill's subtotal is " + (totals.subtotal_cents / 100).toFixed(2) + ".");
  const base = totals.subtotal_cents !== null ? totals.subtotal_cents : sum;
  if (totals.gst_cents !== null && base && Math.abs(totals.gst_cents - Math.round(base * 0.05)) > Math.max(3, base * 0.002) && Math.abs(totals.gst_cents - Math.round(base * 0.13)) > 3 && Math.abs(totals.gst_cents - Math.round(base * 0.15)) > 3)
    checks.push("GST/HST of " + (totals.gst_cents / 100).toFixed(2) + " is not 5%, 13% or 15% of " + (base / 100).toFixed(2) + " (some items may be zero-rated).");
  if (totals.total_cents !== null) {
    const t = base + (totals.gst_cents || 0) + (totals.pst_cents || 0) + (totals.freight_cents || 0);
    if (Math.abs(t - totals.total_cents) > 2) checks.push("Subtotal + taxes + freight = " + (t / 100).toFixed(2) + ", the bill's total is " + (totals.total_cents / 100).toFixed(2) + ".");
  }
  return { lines, ref, date, totals, checks };
}

async function ocrImage(source, onProgress) {
  const { createWorker } = await import("tesseract.js");
  const w = await createWorker("eng", 1, { workerPath: "./ocr/worker.min.js", corePath: "./ocr/", langPath: "./ocr/", gzip: true,
    logger: (m) => { if (onProgress && m.status) onProgress(m.status + (m.progress ? " " + Math.round(m.progress * 100) + "%" : "")); } });
  try { const r = await w.recognize(source); return r.data.text; } finally { await w.terminate(); }
}

async function pdfText(file, onProgress) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let text = "";
  for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // Rebuild lines from positions (same y = same line)
    const rows = {};
    tc.items.forEach((it) => { const y = Math.round(it.transform[5]); (rows[y] || (rows[y] = [])).push({ x: it.transform[4], s: it.str }); });
    const lines = Object.keys(rows).map(Number).sort((a, b) => b - a).map((y) => rows[y].sort((a, b) => a.x - b.x).map((x) => x.s).join(" "));
    let pageText = lines.join("\n");
    if (pageText.replace(/\s/g, "").length < 20) {
      // A scanned PDF: draw it and read it like a photo
      if (onProgress) onProgress("Reading page " + i + " as a picture");
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      pageText = await ocrImage(canvas, onProgress);
    }
    text += pageText + "\n";
  }
  return text;
}

export async function readBill(file, onProgress) {
  const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
  if (onProgress) onProgress(isPdf ? "Reading the PDF" : "Reading the photo (the first time takes a little longer)");
  const text = isPdf ? await pdfText(file, onProgress) : await ocrImage(file, onProgress);
  return { text, ...parseBill(text) };
}

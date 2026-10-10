// Business documents as a Letter PDF (P3): purchase orders, bills, invoices, statements, quotes. A header
// with the store and the other party, a title and number, a table of lines and totals. jsPDF, loaded on use.
//   docPdf({ title, number, date, store: {name, address, tax}, party: {name, address, contact}, meta: [[label, value]],
//            columns: [{label, w, align}], rows: [[...]], totals: [[label, value]], notes }) -> jsPDF document
export async function docPdf(d) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter", compress: true });
  const W = 215.9, M = 15;
  let y = M;
  doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text(d.store.name || "", M, y + 4);
  doc.setFontSize(20); doc.text(d.title, W - M, y + 4, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  y += 10;
  (d.store.address || []).concat(d.store.tax ? [d.store.tax] : []).forEach((l) => { doc.text(String(l), M, y); y += 4; });
  let ry = M + 10;
  [["No.", d.number], ["Date", d.date]].concat(d.meta || []).forEach(([k, v]) => { if (!v) return; doc.text(k + ": " + v, W - M, ry, { align: "right" }); ry += 4.5; });
  y = Math.max(y, ry) + 4;
  doc.setFont("helvetica", "bold"); doc.text(d.partyLabel || "To", M, y); doc.setFont("helvetica", "normal"); y += 4.5;
  [d.party.name].concat(d.party.address || [], d.party.contact ? [d.party.contact] : []).filter(Boolean).forEach((l) => { doc.text(String(l), M, y); y += 4.5; });
  y += 4;
  // Table
  const cols = d.columns;
  const total = cols.reduce((a, c) => a + c.w, 0);
  const scale = (W - 2 * M) / total;
  const xs = [];
  let x = M;
  cols.forEach((c) => { xs.push(x); x += c.w * scale; });
  const head = () => {
    doc.setFillColor(235, 240, 237); doc.rect(M, y - 4, W - 2 * M, 6, "F");
    doc.setFont("helvetica", "bold");
    cols.forEach((c, i) => doc.text(c.label, c.align === "right" ? xs[i] + c.w * scale - 1 : xs[i] + 1, y, { align: c.align === "right" ? "right" : "left" }));
    doc.setFont("helvetica", "normal"); y += 6;
  };
  head();
  d.rows.forEach((r) => {
    const wrapped = r.map((v, i) => doc.splitTextToSize(String(v ?? ""), cols[i].w * scale - 2));
    const h = Math.max(...wrapped.map((w) => w.length)) * 4.2;
    if (y + h > 279.4 - M - 30) { doc.addPage(); y = M + 4; head(); }
    wrapped.forEach((w, i) => doc.text(w, cols[i].align === "right" ? xs[i] + cols[i].w * scale - 1 : xs[i] + 1, y, { align: cols[i].align === "right" ? "right" : "left" }));
    y += h; doc.setDrawColor(220); doc.line(M, y - 3, W - M, y - 3);
  });
  y += 3;
  (d.totals || []).forEach(([k, v], i, a) => {
    doc.setFont("helvetica", i === a.length - 1 ? "bold" : "normal");
    doc.text(k, W - M - 40, y, { align: "right" }); doc.text(String(v), W - M, y, { align: "right" }); y += 5;
  });
  if (d.notes) { y += 4; doc.setFont("helvetica", "normal"); doc.text(doc.splitTextToSize(d.notes, W - 2 * M), M, y); }
  doc.setFontSize(7); doc.setTextColor(120); doc.text("Made with Chedam", M, 279.4 - 8);
  return doc;
}

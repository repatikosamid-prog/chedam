// Label layout geometry (FR-5.15, 5.16). Pure, in millimetres. Tested in Node.
//   cells(layout, count, start) -> pages: [[{x, y, w, h, slot}]] for `count` labels, the first one at
//   position `start` (1 = top left, row by row) on the first page (a partly used sheet).
//   offset_x_mm / offset_y_mm move everything to correct a printer that prints a little off.

export function perPage(l) { return l.cols * l.rows; }

export function slotBox(l, slot) {
  const r = Math.floor(slot / l.cols), c = slot % l.cols;
  return {
    x: (l.margin_left_mm || 0) + (l.offset_x_mm || 0) + c * (l.label_w_mm + (l.gap_x_mm || 0)),
    y: (l.margin_top_mm || 0) + (l.offset_y_mm || 0) + r * (l.label_h_mm + (l.gap_y_mm || 0)),
    w: l.label_w_mm, h: l.label_h_mm, slot: slot + 1,
  };
}

export function cells(l, count, start = 1) {
  const n = perPage(l);
  const s = Math.min(Math.max(1, Math.floor(start)), n) - 1;
  const pages = [];
  for (let i = 0; i < count; i++) {
    const k = s + i;
    const p = Math.floor(k / n);
    (pages[p] || (pages[p] = [])).push(slotBox(l, k % n));
  }
  return pages;
}

// Does the layout fit its page? Returns "" or what is wrong.
export function fits(l) {
  const w = (l.margin_left_mm || 0) + l.cols * l.label_w_mm + (l.cols - 1) * (l.gap_x_mm || 0);
  const h = (l.margin_top_mm || 0) + l.rows * l.label_h_mm + (l.rows - 1) * (l.gap_y_mm || 0);
  if (w > l.page_w_mm + 0.5) return "Too wide: the labels need " + w.toFixed(1) + " mm of " + l.page_w_mm + " mm.";
  if (h > l.page_h_mm + 0.5) return "Too tall: the labels need " + h.toFixed(1) + " mm of " + l.page_h_mm + " mm.";
  return "";
}

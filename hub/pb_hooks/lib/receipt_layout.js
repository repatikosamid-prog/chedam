// Receipt and till report layout (P1 step 5; FR-3.13, NFR-14). Pure: no hub calls, so it can be tested
// in Node. A layout is a list of operations; escpos() turns it into printer bytes and text() into the
// same lines as plain text (preview on screen, tests).
//   {t:"text", s, align, bold, big}   {t:"pair", l, r, bold, big}   {t:"rule"}   {t:"barcode", s}
//   {t:"feed", n}   {t:"cut"}   {t:"kick"}
// Receipt printers print plain ASCII safely (code page 437), so other letters are simplified (é -> e).

const METHOD = { cash: "Cash", card: "Card", usd_cash: "US cash", store_credit: "Store credit", exchange: "Exchange credit", platform: "Platform", other: "Other" };

function ascii(s) {
  let v = String(s === undefined || s === null ? "" : s);
  try { v = v.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (_) { /* no normalize: keep */ }
  return v.replace(/[¢]/g, "c").replace(/[×]/g, "x").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e\n]/g, "?");
}

function money(c) {
  const n = Number(c) || 0;
  const v = (Math.abs(n) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-$" : "$") + v;
}

// An amount taken off: "-$1.00", but "$0.00" when nothing was.
const less = (c) => (c ? "-" + money(c) : money(0));

function when(s) {
  if (!s) return "";
  const d = new Date(String(s).replace(" ", "T"));
  if (isNaN(d.getTime())) return String(s);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

// Splits text into lines of at most `w` characters, at spaces where possible. Leading spaces (an
// indent) are kept on every line.
function wrap(s, w) {
  const out = [];
  String(s).split("\n").forEach((para) => {
    const indent = para.match(/^ */)[0];
    if (indent && indent.length < w && para.trim()) { wrap(para.substring(indent.length), w - indent.length).forEach((x) => out.push(indent + x)); return; }
    let line = "";
    para.split(" ").forEach((word) => {
      while (word.length > w) { if (line) { out.push(line); line = ""; } out.push(word.substring(0, w)); word = word.substring(w); }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= w) line += " " + word;
      else { out.push(line); line = word; }
    });
    out.push(line);
  });
  return out;
}

const qtyText = (q) => (Number(q) === Math.floor(Number(q)) ? String(q) : Number(q).toFixed(3));

// opts: {chars (48 on 80 mm paper, 32 on 58 mm), copy (reprint number), buyer, till_number, kick, full_receipt_cents}
function receipt(sale, opts) {
  const o = opts || {};
  const b = sale.business || {};
  const L = [];
  const add = (x) => L.push(x);
  if (o.kick) add({ t: "kick" });
  if (sale.training) add({ t: "text", s: "*** TRAINING - NOT A SALE ***", align: "center", bold: true });
  if (o.copy) add({ t: "text", s: "*** COPY (reprint " + o.copy + ") ***", align: "center", bold: true });
  if (sale.status === "voided") add({ t: "text", s: "*** VOIDED" + (sale.void_reason ? ": " + sale.void_reason : "") + " ***", align: "center", bold: true });
  add({ t: "text", s: b.name || "", align: "center", bold: true, big: true });
  if (b.header) add({ t: "text", s: b.header, align: "center" });
  else if (b.address && b.address.line1) add({ t: "text", s: b.address.line1 + (b.address.city ? ", " + b.address.city : ""), align: "center" });
  if (b.phone) add({ t: "text", s: b.phone, align: "center" });
  if (b.gst_number) add({ t: "text", s: "GST/HST Reg. No. " + b.gst_number, align: "center" });
  if (b.pst_number) add({ t: "text", s: "PST No. " + b.pst_number, align: "center" });
  add({ t: "feed", n: 1 });
  add({ t: "pair", l: sale.number || "", r: when(sale.completed_at) });
  if (sale.offline_ref && sale.offline_ref !== sale.number) add({ t: "text", s: "Offline receipt " + sale.offline_ref });
  if (o.till_number) add({ t: "text", s: "Till " + o.till_number + (sale.cashier ? " - served by " + sale.cashier : "") });
  else if (sale.cashier) add({ t: "text", s: "Served by " + sale.cashier });
  add({ t: "rule" });

  const lines = (sale.lines || []).filter((l) => !l.voided);
  lines.forEach((l) => {
    add({ t: "pair", l: l.name, r: money(l.gross_cents) });
    if (Number(l.qty) !== 1 || l.price_cents !== l.regular_price_cents) {
      add({ t: "text", s: "  " + qtyText(l.qty) + " x " + money(l.price_cents) + (l.price_cents !== l.regular_price_cents ? " (was " + money(l.regular_price_cents) + ")" : "") });
    }
    if (l.line_discount_cents) add({ t: "pair", l: "  Discount" + (l.discount_label ? " " + l.discount_label : ""), r: "-" + money(l.line_discount_cents) });
    if (l.deposit_cents) add({ t: "pair", l: "  Deposit/fee", r: money(l.deposit_cents) });
  });
  add({ t: "rule" });
  add({ t: "pair", l: "Subtotal", r: money(sale.subtotal_cents) });
  const cartDisc = (sale.discount_cents || 0) - lines.reduce((a, l) => a + (l.line_discount_cents || 0), 0);
  if (cartDisc > 0) add({ t: "pair", l: "Sale discount" + (sale.cart_discount_label ? " " + sale.cart_discount_label : ""), r: "-" + money(cartDisc) });
  if (sale.deposit_cents) add({ t: "pair", l: "Deposits and fees", r: money(sale.deposit_cents) });
  (sale.taxes || []).forEach((x) => add({ t: "pair", l: x.label + " " + x.rate + "%" + (sale.tax_mode === "tax_included" ? " (incl.)" : ""), r: money(x.tax_cents) }));
  if (sale.exempt) add({ t: "text", s: "Tax exempt: " + (sale.exempt.label || sale.exempt.reason || "") + (sale.exempt.reference ? " - " + sale.exempt.reference : "") });
  add({ t: "pair", l: "TOTAL", r: money(sale.total_cents), bold: true, big: true });
  // Cash rounding (BR-16) after the total, then what the customer paid in cash.
  if (sale.rounding_cents) {
    add({ t: "pair", l: "Cash rounding", r: (sale.rounding_cents > 0 ? "+" : "") + money(sale.rounding_cents) });
    add({ t: "pair", l: "Total in cash", r: money(sale.total_cents + sale.rounding_cents), bold: true });
  }
  add({ t: "rule" });
  (sale.payments || []).forEach((p) => {
    const label = (METHOD[p.method] || p.method) + (p.last4 ? " ****" + p.last4 : "") + (p.currency === "USD" ? " (US " + money(p.tendered_cents) + ")" : "") + (p.status !== "approved" ? " - " + p.status : "");
    add({ t: "pair", l: label, r: p.status === "approved" ? money(p.method === "cash" ? p.tendered_cents || p.amount_cents : p.amount_cents) : "" });
  });
  if (sale.change_cents) add({ t: "pair", l: "Change", r: money(sale.change_cents), bold: true });
  if (sale.savings_cents > 0) { add({ t: "feed", n: 1 }); add({ t: "text", s: "You saved " + money(sale.savings_cents), align: "center", bold: true }); }
  // Full GST/HST receipt (NFR-14): from the store's threshold ($150 by default) the buyer's name and the
  // terms of payment are printed when the customer gives a name.
  if (o.buyer) {
    add({ t: "feed", n: 1 });
    add({ t: "text", s: "Sold to: " + o.buyer });
    add({ t: "text", s: "Terms: paid in full" });
  }
  if (b.footer) { add({ t: "feed", n: 1 }); add({ t: "text", s: b.footer, align: "center" }); }
  if (sale.number && !sale.training) { add({ t: "feed", n: 1 }); add({ t: "barcode", s: sale.number }); }
  add({ t: "feed", n: 3 });
  add({ t: "cut" });
  return L;
}

// Return slip (P1 step 6): what came back, tax refunded by type, how it was refunded, and any store
// credit code with its barcode (spent at the till by scanning it).
function returnReceipt(r, opts) {
  const o = opts || {};
  const b = r.business || {};
  const L = [];
  const add = (x) => L.push(x);
  if (o.kick) add({ t: "kick" });
  if (o.copy) add({ t: "text", s: "*** COPY (reprint " + o.copy + ") ***", align: "center", bold: true });
  add({ t: "text", s: b.name || "", align: "center", bold: true, big: true });
  if (b.header) add({ t: "text", s: b.header, align: "center" });
  else if (b.address && b.address.line1) add({ t: "text", s: b.address.line1 + (b.address.city ? ", " + b.address.city : ""), align: "center" });
  if (b.phone) add({ t: "text", s: b.phone, align: "center" });
  if (b.gst_number) add({ t: "text", s: "GST/HST Reg. No. " + b.gst_number, align: "center" });
  if (b.pst_number) add({ t: "text", s: "PST No. " + b.pst_number, align: "center" });
  add({ t: "feed", n: 1 });
  add({ t: "text", s: r.exchange_number ? "EXCHANGE" : "RETURN", align: "center", bold: true, big: true });
  add({ t: "pair", l: r.number || "", r: when(r.completed_at) });
  add({ t: "text", s: r.sale_number ? "Original sale " + r.sale_number : "No receipt" });
  if (o.till_number) add({ t: "text", s: "Till " + o.till_number + (r.cashier ? " - served by " + r.cashier : "") });
  else if (r.cashier) add({ t: "text", s: "Served by " + r.cashier });
  add({ t: "rule" });
  (r.lines || []).forEach((l) => {
    add({ t: "pair", l: l.name, r: less(l.net_cents) });
    if (Number(l.qty) !== 1) add({ t: "text", s: "  " + qtyText(l.qty) + " returned" });
    if (l.deposit_cents) add({ t: "pair", l: "  Deposit/fee", r: less(l.deposit_cents) });
  });
  add({ t: "rule" });
  add({ t: "pair", l: "Goods returned", r: less(r.net_cents) });
  if (r.deposit_cents) add({ t: "pair", l: "Deposits and fees", r: less(r.deposit_cents) });
  (r.taxes || []).forEach((x) => add({ t: "pair", l: x.label + " " + x.rate + "%" + (r.tax_mode === "tax_included" ? " (incl.)" : ""), r: less(x.tax_cents) }));
  if (r.fee_cents) add({ t: "pair", l: "Restocking fee", r: money(r.fee_cents) });
  add({ t: "pair", l: "REFUND", r: money(r.refund_cents), bold: true, big: true });
  add({ t: "rule" });
  (r.refunds || []).forEach((x) => {
    if (x.method === "exchange") add({ t: "pair", l: "Exchange credit (" + x.reference + ")", r: money(x.amount_cents) });
    else if (x.method === "store_credit") add({ t: "pair", l: "Store credit " + x.reference, r: money(x.amount_cents) });
    else add({ t: "pair", l: (METHOD[x.method] || x.method) + (x.last4 ? " ****" + x.last4 : "") + " refunded", r: money(x.amount_cents) });
  });
  if (r.rounding_cents) add({ t: "pair", l: "Cash rounding", r: (r.rounding_cents > 0 ? "+" : "") + money(r.rounding_cents) });
  (r.refunds || []).filter((x) => x.method === "store_credit").forEach((x) => {
    add({ t: "feed", n: 1 });
    add({ t: "text", s: "STORE CREDIT " + money(x.amount_cents), align: "center", bold: true, big: true });
    add({ t: "barcode", s: x.reference });
    add({ t: "text", s: "Keep this slip: scan it to pay at the till.", align: "center" });
  });
  if (r.reason) { add({ t: "feed", n: 1 }); add({ t: "text", s: "Reason: " + r.reason }); }
  if ((r.refunds || []).some((x) => x.method === "cash" || x.method === "card")) {
    add({ t: "feed", n: 2 });
    add({ t: "text", s: "Customer signature: ______________________" });
  }
  if (b.footer) { add({ t: "feed", n: 1 }); add({ t: "text", s: b.footer, align: "center" }); }
  add({ t: "feed", n: 1 });
  add({ t: "barcode", s: r.number });
  add({ t: "feed", n: 3 });
  add({ t: "cut" });
  return L;
}

// Z report (closed till) or X report (open till's running figures): same fields from tills.summary().
function tillReport(z, business, opts) {
  const o = opts || {};
  const L = [];
  const add = (x) => L.push(x);
  const p = (l, r, bold) => add({ t: "pair", l, r, bold: !!bold });
  add({ t: "text", s: (business && business.name) || "", align: "center", bold: true });
  add({ t: "text", s: (z.closed_at ? "Z REPORT" : "X REPORT (till still open)") + " - TILL " + z.till + (z.shift ? " - Z " + z.shift : ""), align: "center", bold: true, big: !!z.closed_at });
  add({ t: "text", s: "Opened " + when(z.opened_at), align: "center" });
  if (z.closed_at) add({ t: "text", s: "Closed " + when(z.closed_at), align: "center" });
  if (o.copy) add({ t: "text", s: "*** COPY ***", align: "center" });
  add({ t: "rule" });
  p("Sales", z.sales_count + " (" + qtyText(Math.round((z.items || 0) * 1000) / 1000) + " items)");
  p("Gross", money(z.gross_cents));
  p("Discounts", less(z.discount_cents));
  (z.taxes || []).forEach((x) => p(x.label + " " + x.rate + "% on " + money(x.base_cents), money(x.tax_cents)));
  p("Deposits and fees", money(z.deposit_cents));
  p("Total", money((z.total_cents || 0) + (z.rounding_cents || 0)), true);
  if (z.rounding_cents) p("  incl. cash rounding", money(z.rounding_cents));
  add({ t: "rule" });
  (z.payments || []).forEach((x) => p((METHOD[x.method] || x.method) + " (" + x.count + ")", money(x.amount_cents)));
  p("Declined cards", String(z.declined_cards || 0));
  p("Voided sales", (z.voided_sales || 0) + " (" + money(z.voided_sales_cents || 0) + ")");
  p("Removed lines / no-sales", (z.voided_lines || 0) + " / " + (z.no_sales || 0));
  p("Exempt / training sales", (z.exempt_sales || 0) + " / " + (z.training_sales || 0));
  if (z.returns_count) {
    add({ t: "rule" });
    p("Returns", z.returns_count + " (" + money(z.returns_cents) + ")", true);
    (z.refund_taxes || []).forEach((x) => p("  " + x.label + " " + x.rate + "% refunded", less(x.tax_cents)));
    (z.refunds || []).forEach((x) => p("  Refunded: " + (METHOD[x.method] || x.method) + " (" + x.count + ")", money(x.amount_cents)));
  }
  add({ t: "rule" });
  p("Float", money(z.float_cents));
  p("Cash taken", money(z.cash_in_cents));
  if (z.usd_change_cents) p("Change given for US cash", less(z.usd_change_cents));
  p("Cash drops", less(z.drops_cents));
  p("Pay-outs", less(z.payouts_cents));
  p("Float added", money(z.float_added_cents));
  if (z.cash_refunds_cents) p("Cash refunds", less(z.cash_refunds_cents));
  p("Expected cash", money(z.expected_cash_cents), true);
  if (z.counted_cents !== undefined) {
    p("Counted", money(z.counted_cents), true);
    p(z.variance_cents < 0 ? "SHORT" : z.variance_cents > 0 ? "OVER" : "Balanced", money(Math.abs(z.variance_cents)), true);
  }
  if (z.usd_tendered_cents) p("US cash expected / counted", money(z.usd_tendered_cents) + " / " + money(z.counted_usd_cents || 0));
  add({ t: "feed", n: 3 });
  add({ t: "cut" });
  return L;
}

// A short page to check a printer: width, letters, bold, large, barcode, and the drawer if asked.
function testPage(business, printer, opts) {
  const w = printer.chars || 48;
  const L = [];
  if (opts && opts.kick) L.push({ t: "kick" });
  L.push({ t: "text", s: "Chedam test print", align: "center", bold: true, big: true });
  L.push({ t: "text", s: (business && business.name) || "", align: "center" });
  L.push({ t: "text", s: "Printer: " + (printer.name || "") + " (" + printer.host + ":" + printer.port + ")" });
  L.push({ t: "text", s: "Paper: " + w + " characters a line" });
  L.push({ t: "text", s: "1234567890".repeat(Math.ceil(w / 10)).substring(0, w) });
  L.push({ t: "pair", l: "Left", r: "Right" });
  L.push({ t: "pair", l: "TOTAL", r: "$12.34", bold: true, big: true });
  L.push({ t: "barcode", s: "S-000000" });
  L.push({ t: "text", s: "If you can read every line, the printer is set up.", align: "center" });
  L.push({ t: "feed", n: 3 });
  L.push({ t: "cut" });
  return L;
}

// Lines the layout prints, as text. Large text takes two columns a character.
function lines(L, chars) {
  const w = chars || 48;
  const out = [];
  L.forEach((x) => {
    const cw = x.big ? Math.floor(w / 2) : w;
    if (x.t === "text") wrap(ascii(x.s), cw).forEach((s) => out.push({ s: x.align === "center" ? " ".repeat(Math.max(0, Math.floor((cw - s.length) / 2))) + s : x.align === "right" ? s.padStart(cw) : s, x }));
    else if (x.t === "pair") {
      const r = ascii(x.r);
      const parts = wrap(ascii(x.l), Math.max(1, cw - r.length - 1));
      parts.forEach((s, i) => out.push({ s: i === parts.length - 1 ? s + " ".repeat(Math.max(1, cw - s.length - r.length)) + r : s, x }));
    } else if (x.t === "rule") out.push({ s: "-".repeat(w), x });
    else if (x.t === "feed") for (let i = 0; i < (x.n || 1); i++) out.push({ s: "", x: { t: "feed" } });
    else if (x.t === "barcode") out.push({ s: " ".repeat(Math.max(0, Math.floor((w - x.s.length - 8) / 2))) + "||| " + ascii(x.s) + " |||", x });
  });
  return out;
}

function text(L, chars) { return lines(L, chars).map((l) => l.s.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "") + "\n"; }

// ESC/POS bytes (numbers 0-255), understood by Epson-compatible receipt printers.
function escpos(L, chars) {
  const w = chars || 48;
  const out = [27, 64, 27, 116, 0];                   // initialise; code page 437
  const push = (s) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0x7f); };
  L.forEach((x) => {
    if (x.t === "kick") { out.push(27, 112, 0, 25, 120); return; }   // pulse drawer pin 2: 50 ms on, 240 ms off
    if (x.t === "cut") { out.push(29, 86, 66, 0); return; }          // feed and partial cut
    if (x.t === "feed") { out.push(27, 100, Math.min(10, x.n || 1)); return; }
    if (x.t === "barcode") {
      const d = "{B" + ascii(x.s);
      out.push(27, 97, 1, 29, 104, 60, 29, 119, 2, 29, 72, 2, 29, 107, 73, d.length);   // centred, height, width, number below, CODE128
      push(d);
      out.push(10, 27, 97, 0);
      return;
    }
    out.push(27, 97, x.t === "text" && x.align === "center" ? 1 : x.t === "text" && x.align === "right" ? 2 : 0);
    out.push(27, 69, x.bold ? 1 : 0, 29, 33, x.big ? 0x11 : 0);
    lines([Object.assign({}, x, { align: "left" })], w).forEach((l) => { push(l.s.replace(/\s+$/, "")); out.push(10); });
    out.push(27, 69, 0, 29, 33, 0, 27, 97, 0);
  });
  return out;
}

module.exports = { receipt, returnReceipt, tillReport, testPage, text, lines, escpos, ascii, money, wrap };

// Receipt printers and the cash drawer (P1 step 5; FR-1.11, FR-3.13, FR-3.11). The hub prints for the
// tills: it lays out the receipt (lib/receipt_layout.js) and sends ESC/POS bytes to the network printer
// with bin/printer.sh. Printing happens after the sale is saved and never undoes it: a printer that does
// not answer gives {printed:false, error}, and the till offers its own (browser) print instead.
// The drawer opens only with something recorded: a cash sale (once) or a no-sale with its reason.

const layout = () => require(`${__hooks}/lib/receipt_layout.js`);
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, ctx) { require(`${__hooks}/lib/stock.js`).stamp(r, ctx); }

const HOST = /^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,62})$/;

function bash() { return $os.getenv("CHEDAM_BASH") || "bash"; }

// {id, name, host, port, chars, drawer}: checked, with defaults.
function clean(p) {
  const host = String((p && p.host) || "").trim();
  if (!HOST.test(host)) bad("Enter the printer's address, e.g. 192.168.1.50.");
  const port = Number(p.port || 9100);
  if (!(port >= 1 && port <= 65535) || port !== Math.floor(port)) bad("The port is a number from 1 to 65535 (usually 9100).");
  const chars = Number(p.chars || 48);
  if ([32, 42, 48].indexOf(chars) < 0) bad("Paper width: 48 (80 mm), 42 or 32 (58 mm) characters.");
  return { id: String(p.id || "").substring(0, 20), name: String(p.name || "Receipt printer").trim().substring(0, 60), host, port, chars, drawer: p.drawer !== false };
}

function printers(app) { const v = setting(app, "printing.printers", []); return Array.isArray(v) ? v : []; }
function options(app) { return Object.assign({ auto_print: true, full_receipt_cents: 15000 }, setting(app, "printing.receipt", {}) || {}); }

// The printer of a device: the one assigned to it, or the store's only printer.
function forDevice(app, deviceId) {
  const list = printers(app);
  let want = "";
  if (deviceId) { try { want = app.findRecordById("devices", deviceId).getString("assigned_printer"); } catch (_) { want = ""; } }
  if (want === "none") return null;
  const p = list.find((x) => x.id === want) || (list.length === 1 ? list[0] : null);
  return p || null;
}

// Sends bytes to a printer. {printed, error}
function send(app, printer, bytes) {
  let p;
  try { p = clean(printer); } catch (err) { return { printed: false, error: String(err.message || err) }; }
  const dir = app.dataDir() + "/print";
  try { $os.mkdirAll(dir, 448); } catch (_) { /* exists */ }                    // 448 = 0700
  const file = dir + "/job-" + $security.randomStringWithAlphabet(12, "abcdefghijklmnopqrstuvwxyz0123456789") + ".bin";
  try {
    $os.writeFile(file, bytes, 384);                                            // 384 = 0600
    const cmd = $os.cmd(bash(), `${__hooks}/bin/printer.sh`, "send", p.host, String(p.port), file);
    try { cmd.combinedOutput(); } catch (_) { return { printed: false, error: "The printer " + p.name + " (" + p.host + ") did not answer. Check that it is on, has paper and is on the store network." }; }
    return { printed: true, error: "" };
  } finally {
    try { $os.remove(file); } catch (_) { /* gone */ }
  }
}

// Hosts on the store network that take print jobs on the port (usually 9100).
function scan(app, port) {
  let out = "";
  try { out = toString($os.cmd(bash(), `${__hooks}/bin/printer.sh`, "scan", String(port || 9100)).output()); } catch (_) { out = ""; }
  const known = printers(app);
  return out.split(/\s+/).filter((h) => HOST.test(h)).sort().map((h) => {
    const k = known.find((x) => x.host === h);
    return { host: h, port: Number(port || 9100), known: k ? k.name : "" };
  });
}

function tillNumber(app, id) { try { return app.findRecordById("tills", id).getInt("number"); } catch (_) { return 0; } }

// Prints a sale's receipt on the device's printer. opts: {reprint, buyer, kick}
// kick: the drawer opens for a cash sale this device took in the last 10 minutes, once.
function printSale(app, id, opts, ctx) {
  const sales = require(`${__hooks}/lib/sales.js`);
  let s;
  try { s = app.findRecordById("sales", id); } catch (_) { bad("Unknown sale."); }
  const printer = forDevice(app, ctx.device);
  if (!printer) return { printed: false, error: "No receipt printer is set up for this device.", no_printer: true };
  const view = sales.saleView(app, id, false);
  let copy = 0, kick = false;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById("sales", id);
    if (opts.reprint) {
      copy = r.getInt("reprints") + 1;
      r.set("reprints", copy);
    }
    if (opts.kick && !r.getBool("drawer_opened")) {
      const tillDevice = (() => { try { return tx.findRecordById("tills", r.getString("till")).getString("device"); } catch (_) { return ""; } })();
      const recent = Date.now() - new Date(r.getString("completed_at").replace(" ", "T")).getTime() < 10 * 60000;
      const cash = view.payments.some((p) => (p.method === "cash" || p.method === "usd_cash") && p.status === "approved");
      if (cash && recent && tillDevice && tillDevice === ctx.device && printer.drawer !== false) { kick = true; r.set("drawer_opened", true); }
    }
    if (copy || kick) { stamp(r, ctx); tx.save(r); }
  });
  const full = options(app).full_receipt_cents;
  const buyer = opts.buyer && view.total_cents >= full ? String(opts.buyer).trim().substring(0, 80) : "";
  const L = layout().receipt(view, { chars: printer.chars, copy, buyer, kick, till_number: tillNumber(app, s.getString("till")) });
  const res = send(app, printer, layout().escpos(L, printer.chars));
  return Object.assign(res, { printer: printer.name, copy, drawer: kick && res.printed });
}

// Prints a return slip. kick: the drawer opens for a cash refund this device gave in the last 10 minutes, once.
function printReturn(app, id, opts, ctx) {
  const returns = require(`${__hooks}/lib/returns.js`);
  try { app.findRecordById("returns", id); } catch (_) { bad("Unknown return."); }
  const printer = forDevice(app, ctx.device);
  if (!printer) return { printed: false, error: "No receipt printer is set up for this device.", no_printer: true };
  const v = returns.view(app, id, false);
  let copy = 0, kick = false;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById("returns", id);
    if (opts.reprint) { copy = r.getInt("reprints") + 1; r.set("reprints", copy); }
    if (opts.kick && !r.getBool("drawer_opened") && printer.drawer !== false) {
      const tillDevice = (() => { try { return tx.findRecordById("tills", r.getString("till")).getString("device"); } catch (_) { return ""; } })();
      const recent = Date.now() - new Date(r.getString("completed_at").replace(" ", "T")).getTime() < 10 * 60000;
      if (v.refunds.some((x) => x.method === "cash") && recent && tillDevice === ctx.device) { kick = true; r.set("drawer_opened", true); }
    }
    if (copy || kick) { stamp(r, ctx); tx.save(r); }
  });
  const L = layout().returnReceipt(v, { copy, kick, till_number: tillNumber(app, v.till) });
  return Object.assign(send(app, printer, layout().escpos(L, printer.chars)), { printer: printer.name, copy, drawer: kick });
}

// Receipt as the printer would print it, for the screen.
function saleText(app, id, chars, ctx) {
  const sales = require(`${__hooks}/lib/sales.js`);
  try { app.findRecordById("sales", id); } catch (_) { bad("Unknown sale."); }
  const view = sales.saleView(app, id, false);
  const printer = forDevice(app, ctx.device);
  const w = Number(chars) || (printer ? printer.chars : 48);
  const L = layout().receipt(view, { chars: w, till_number: (() => { try { return app.findRecordById("tills", view.till).getInt("number"); } catch (_) { return 0; } })() });
  return { text: layout().text(L, w), chars: w, printer: printer ? printer.name : "" };
}

// Z report of a closed till, or X report (running figures) of an open one.
function printTill(app, id, ctx) {
  const tills = require(`${__hooks}/lib/tills.js`);
  const t = tills.till(app, id);
  tills.mayUse(app, t, ctx);
  const printer = forDevice(app, ctx.device);
  if (!printer) return { printed: false, error: "No receipt printer is set up for this device.", no_printer: true };
  const v = tills.view(app, t);
  const z = v.z_report || Object.assign({}, v.summary);
  const L = layout().tillReport(z, require(`${__hooks}/lib/sales.js`).business(app), {});
  return Object.assign(send(app, printer, layout().escpos(L, printer.chars)), { printer: printer.name });
}

// Opens the drawer for a no-sale just recorded on this device (FR-3.11), once.
function kickNoSale(app, movementId, ctx) {
  const printer = forDevice(app, ctx.device);
  if (!printer) return { opened: false, error: "No receipt printer (and drawer) is set up for this device." };
  if (printer.drawer === false) return { opened: false, error: "This printer has no cash drawer." };
  let ok = false;
  app.runInTransaction((tx) => {
    let m;
    try { m = tx.findRecordById("cash_movements", String(movementId || "")); } catch (_) { bad("Unknown no-sale."); }
    if (m.getString("type") !== "no_sale") bad("The drawer opens for a recorded no-sale.");
    if (m.getBool("drawer_opened")) bad("The drawer was already opened for this no-sale.");
    const t = tx.findRecordById("tills", m.getString("till"));
    if (t.getString("device") !== ctx.device) bad("This no-sale was recorded on another device.");
    if (Date.now() - new Date(m.getString("created_at").replace(" ", "T")).getTime() > 2 * 60000) bad("Record the no-sale again.");
    m.set("drawer_opened", true);
    stamp(m, ctx);
    tx.save(m);
    ok = true;
  });
  if (!ok) return { opened: false };
  const res = send(app, printer, layout().escpos([{ t: "kick" }], printer.chars));
  return { opened: res.printed, error: res.error };
}

function test(app, body, ctx) {
  const p = clean(Object.assign({ name: "Test" }, body));
  const L = layout().testPage(require(`${__hooks}/lib/sales.js`).business(app), p, { kick: !!body.kick && p.drawer });
  return Object.assign(send(app, p, layout().escpos(L, p.chars)), { printer: p.name });
}

// Saves the store's printers (settings.manage). Each gets an id that devices refer to.
function savePrinters(app, list, ctx) {
  if (!Array.isArray(list) || list.length > 20) bad("Up to 20 printers.");
  const seen = {};
  const out = list.map((p) => {
    const c = clean(p);
    if (!c.id) c.id = $security.randomStringWithAlphabet(8, "abcdefghijklmnopqrstuvwxyz0123456789");
    if (seen[c.id]) bad("Two printers have the same id.");
    seen[c.id] = true;
    return c;
  });
  const r = app.findFirstRecordByData("settings", "key", "printing.printers");
  r.set("value", out);
  stamp(r, ctx);
  app.save(r);
  return out;
}

module.exports = { clean, printers, options, forDevice, send, scan, printSale, printReturn, saleText, printTill, kickNoSale, test, savePrinters };

// P1 step 5: receipt printers and the cash drawer. Receipt layout (lib/receipt_layout.js) in Node; then a
// fake network printer (TCP, like port 9100) receives what the hub sends: printers saved and checked,
// network scan, test page, receipt with drawer kick once per cash sale, reprints marked and counted,
// reprints need a manager (2026-10-09), buyer's name above the full-receipt threshold, printer off (sale unaffected), no-sale drawer, X report,
// device without a printer.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step15-printing.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8108 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const RL = createRequire(import.meta.url)(join(HUB, "pb_hooks", "lib", "receipt_layout.js"));

// Fake printer: every connection's bytes, in order.
const jobs = [];
const printer = createServer((s) => { const parts = []; s.on("data", (d) => parts.push(d)); s.on("close", () => { const b = Buffer.concat(parts); if (b.length) jobs.push(b); }); });
// (an empty connection is the network scan knocking, not a print job)
await new Promise((r) => printer.listen(0, "127.0.0.1", r));
const PORT = printer.address().port;
const lastJob = async (n = 1) => { for (let i = 0; i < 50 && jobs.length < n; i++) await new Promise((r) => setTimeout(r, 100)); return jobs[n - 1] || Buffer.alloc(0); };
const has = (buf, seq) => buf.indexOf(Buffer.from(seq)) >= 0;
const KICK = [27, 112, 0, 25, 120], CUT = [29, 86, 66, 0];

let err = null;
try {
  console.log("Layout (Node)");
  const sale = { number: "S-000042", completed_at: "2026-10-07 10:02:59.000Z", cashier: "Cal Cashier", status: "completed", tax_mode: "tax_added",
    business: { name: "Demo Grocery", header: "100 Sample St, Vancouver", phone: "604-555-0100", gst_number: "123456789RT0001", pst_number: "PST-1234-5678", footer: "Thank you!" },
    lines: [{ name: "Crème brûlée, extra large size with a very long name", qty: 2, price_cents: 450, regular_price_cents: 500, gross_cents: 900, line_discount_cents: 50, deposit_cents: 0 },
      { name: "Cola 355 mL can", qty: 1, price_cents: 149, regular_price_cents: 149, gross_cents: 149, line_discount_cents: 0, deposit_cents: 10 }],
    subtotal_cents: 1049, discount_cents: 50, deposit_cents: 10, taxes: [{ code: "GST", label: "GST", rate: 5, tax_cents: 50 }, { code: "PST", label: "PST", rate: 7, tax_cents: 63 }],
    total_cents: 1122, rounding_cents: -2, change_cents: 878, payments: [{ method: "cash", status: "approved", amount_cents: 1120, tendered_cents: 2000 }], savings_cents: 150 };
  const txt = RL.text(RL.receipt(sale, { chars: 48, till_number: 3 }), 48);
  check("GST/HST and PST numbers, till, cashier", /GST\/HST Reg\. No\. 123456789RT0001/.test(txt) && /PST No\. PST-1234-5678/.test(txt) && /Till 3 - served by Cal Cashier/.test(txt), txt);
  check("total, then cash rounding, then total in cash", /TOTAL\s+\$11\.22[\s\S]*Cash rounding\s+-\$0\.02\n\s*Total in cash\s+\$11\.20/.test(txt), txt);
  check("savings, change, return barcode", /You saved \$1\.50/.test(txt) && /Change\s+\$8\.78/.test(txt) && /\|\|\| S-000042 \|\|\|/.test(txt));
  check("detail lines indented under their item", /\n  2 x \$4\.50 \(was \$5\.00\)/.test(txt) && /\n  Deposit\/fee\s+\$0\.10/.test(txt), txt);
  check("accents simplified for the printer", /Creme brulee/.test(txt) && !/[^\x00-\x7e]/.test(txt));
  const narrow = RL.text(RL.receipt(sale, { chars: 32 }), 32);
  check("58 mm paper: no line over 32 characters", narrow.split("\n").every((l) => l.length <= 32), narrow);
  check("big text fits half the width", RL.text(RL.receipt(sale, { chars: 32 }), 32).split("\n").filter((l) => /TOTAL/.test(l)).every((l) => l.length <= 16));
  const bytes = RL.escpos(RL.receipt(sale, { chars: 48, kick: true }), 48);
  const B = Buffer.from(bytes);
  check("ESC/POS: initialise, kick, CODE128 barcode, cut", B[0] === 27 && B[1] === 64 && has(B, KICK) && has(B, [29, 107, 73]) && has(B, CUT) && bytes.every((x) => x >= 0 && x < 256));
  check("no kick unless asked", !has(Buffer.from(RL.escpos(RL.receipt(sale, { chars: 48 }), 48)), KICK));
  check("training receipt says so, no barcode", /TRAINING - NOT A SALE/.test(RL.text(RL.receipt({ ...sale, training: true }, {}), 48)) && !/\|\|\|/.test(RL.text(RL.receipt({ ...sale, training: true }, {}), 48)));

  const bashExe = process.platform === "win32" ? "C:\\Program Files\\Git\\usr\\bin\\bash.exe" : "bash";
  await t.start({ CHEDAM_BASH: bashExe, CHEDAM_SCAN_HOSTS: "127.0.0.1" });
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const devs = {};
  const login = async (n, dev) => {
    devs[n] = dev || await t.pair("Till of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: devs[n] })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }), put: (p, b) => t.api("PUT", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager);

  console.log("Printers");
  check("a cashier cannot change printers", (await C.put("/api/chedam/printers", { printers: [] })).status === 403);
  check("bad address refused", (await M.put("/api/chedam/printers", { printers: [{ name: "X", host: "printer;reboot", port: 9100 }] })).status === 400);
  check("bad paper width refused", (await M.put("/api/chedam/printers", { printers: [{ name: "X", host: "127.0.0.1", chars: 80 }] })).status === 400);
  const sv = await M.put("/api/chedam/printers", { printers: [{ name: "Front printer", host: "127.0.0.1", port: PORT, chars: 48, drawer: true }] });
  check("saved with an id", sv.status === 200 && sv.json.printers[0].id.length === 8, JSON.stringify(sv.json));
  const mine = (await C.get("/api/chedam/printers")).json;
  check("the store's only printer is every till's printer", mine.mine && mine.mine.name === "Front printer" && mine.options.auto_print === true, JSON.stringify(mine));
  const sc = await M.post("/api/chedam/printers/scan", { port: PORT });
  check("network scan finds it", sc.status === 200 && sc.json.found.some((f) => f.host === "127.0.0.1" && f.known === "Front printer"), JSON.stringify(sc.json));
  check("a cashier cannot scan", (await C.post("/api/chedam/printers/scan", {})).status === 403);

  const tp = await M.post("/api/chedam/printers/test", { name: "Front printer", host: "127.0.0.1", port: PORT, chars: 48, kick: true });
  const j1 = await lastJob(1);
  check("test page printed with drawer kick", tp.json.printed === true && j1.toString("latin1").includes("Chedam test print") && has(j1, KICK) && has(j1, CUT), JSON.stringify(tp.json));

  console.log("Receipts");
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const cola = await find("2000000000022"), chips = await find("2000000000060");
  const L = (m, extra = {}) => ({ key: "k" + Math.random().toString(36).slice(2, 8), product: m.product.id, selling_unit: m.unit.id, qty: 1, ...extra });
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const s1 = await C.post("/api/chedam/sales", { id: sid(), lines: [L(cola, { qty: 2 }), L(chips)], payments: [{ method: "cash", amount_cents: 2000 }] });
  const id1 = s1.json.sale.id, num1 = s1.json.sale.number;
  const p1 = await C.post(`/api/chedam/sales/${id1}/print`, { kick: true });
  const j2 = await lastJob(2);
  check("cash sale: receipt printed and drawer opened", p1.json.printed && p1.json.drawer === true && has(j2, KICK) && j2.toString("latin1").includes(num1), JSON.stringify(p1.json));
  const noAppr = await C.post(`/api/chedam/sales/${id1}/print`, { kick: true, reprint: true });
  check("a cashier's reprint needs a manager", noAppr.status === 403 && /approval/.test(noAppr.json.message) && jobs.length === 2, JSON.stringify(noAppr.json));
  const appr = (await C.post("/api/chedam/sales/approvals", { user: people["Mira Manager"], pin: PIN["Mira Manager"] })).json.approval;
  const p1b = await C.post(`/api/chedam/sales/${id1}/print`, { kick: true, reprint: true, approval: appr });
  const j3 = await lastJob(3);
  check("reprint with the manager's approval: marked COPY 1, drawer not opened again", p1b.json.copy === 1 && p1b.json.drawer === false && !has(j3, KICK) && j3.toString("latin1").includes("COPY (reprint 1)"), JSON.stringify(p1b.json));
  const s1v = (await t.list("sales", `id='${id1}'`)).items[0];
  check("reprints counted on the sale, with who allowed it", s1v.reprints === 1 && s1v.approvals.some((a) => a.what === "Reprint (copy 1)" && a.name === "Mira Manager"), JSON.stringify(s1v.approvals));
  check("an approval is used once", (await C.post(`/api/chedam/sales/${id1}/print`, { reprint: true, approval: appr })).status === 403);
  check("a browser reprint needs a manager too", (await C.post(`/api/chedam/sales/${id1}/reprint`, {})).status === 403);
  const lr = await M.post(`/api/chedam/sales/${id1}/reprint`, {});
  check("a manager reprints without asking; counted", lr.status === 200 && lr.json.copy === 2 && (await t.list("sales", `id='${id1}'`)).items[0].reprints === 2, JSON.stringify(lr.json));
  const q2 = (await C.post("/api/chedam/sales/quote", { lines: [L(chips)] })).json;
  const s2 = await C.post("/api/chedam/sales", { id: sid(), lines: q2.lines.map((l) => ({ key: l.key, product: l.product, selling_unit: l.selling_unit, qty: l.qty })), payments: [{ method: "card", amount_cents: q2.total_cents }] });
  const p2 = await C.post(`/api/chedam/sales/${s2.json.sale.id}/print`, { kick: true, buyer: "Jane Buyer" });
  const j4 = await lastJob(4);
  check("card sale: no drawer; small sale: no buyer line", p2.json.printed && !p2.json.drawer && !has(j4, KICK) && !j4.toString("latin1").includes("Sold to"), JSON.stringify(p2.json));
  const rc = (await t.list("settings", "key='printing.receipt'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${rc.id}`, { value: { auto_print: true, full_receipt_cents: 100 } });
  await M.post(`/api/chedam/sales/${s2.json.sale.id}/print`, { reprint: true, buyer: "Jane Buyer" });
  const j5 = await lastJob(5);
  check("above the threshold: buyer's name and terms (full GST/HST receipt)", j5.toString("latin1").includes("Sold to: Jane Buyer") && j5.toString("latin1").includes("Terms: paid in full"));
  const rt = await C.get(`/api/chedam/sales/${id1}/receipt-text?chars=32`);
  check("receipt as text for the screen", rt.status === 200 && rt.json.text.includes(num1) && rt.json.text.split("\n").every((l) => l.length <= 32), JSON.stringify(rt.json).slice(0, 200));

  console.log("Printer off");
  await new Promise((r) => printer.close(r));
  const before = jobs.length;
  const s3 = await C.post("/api/chedam/sales", { id: sid(), lines: [L(cola)], payments: [{ method: "cash", amount_cents: 500 }] });
  const p3 = await C.post(`/api/chedam/sales/${s3.json.sale.id}/print`, { kick: true });
  check("printer off: not printed, a clear message, the sale stands", s3.status === 200 && p3.status === 200 && p3.json.printed === false && /did not answer/.test(p3.json.error) && jobs.length === before, JSON.stringify(p3.json));
  await new Promise((r) => printer.listen(PORT, "127.0.0.1", r));

  console.log("No-sale drawer, X report");
  const till = (await C.get("/api/chedam/tills/current")).json.till;
  const ns = await C.post(`/api/chedam/tills/${till.id}/cash`, { type: "no_sale", reason: "Change for a customer" });
  const k = await C.post("/api/chedam/drawer/no-sale", { movement: ns.json.id });
  const j6 = await lastJob(before + 1);
  check("no-sale opens the drawer (kick only)", k.json.opened === true && has(j6, KICK) && j6.length < 20, JSON.stringify(k.json));
  check("once per no-sale", (await C.post("/api/chedam/drawer/no-sale", { movement: ns.json.id })).status === 400);
  const drop = await C.post(`/api/chedam/tills/${till.id}/cash`, { type: "drop", amount_cents: 1000 });
  check("a cash drop does not open the drawer this way", (await C.post("/api/chedam/drawer/no-sale", { movement: drop.json.id })).status === 400);
  check("another device cannot open this till's drawer", (await M.post("/api/chedam/drawer/no-sale", { movement: ns.json.id })).status === 400);
  const xr = await C.post(`/api/chedam/tills/${till.id}/print`, {});
  const j7 = await lastJob(before + 2);
  check("X report of the open till", xr.json.printed && j7.toString("latin1").includes("X REPORT") && j7.toString("latin1").includes("Expected cash"), JSON.stringify(xr.json));

  console.log("Device without a printer");
  const dev = (await t.list("devices", `id='${devs["Cal Cashier"].id}'`)).items[0];
  await t.su_("PATCH", `/api/collections/devices/records/${dev.id}`, { assigned_printer: "none" });
  const np = await C.post(`/api/chedam/sales/${id1}/print`, {});
  check("'none': no printer, the till prints on its own", np.json.printed === false && np.json.no_printer === true, JSON.stringify(np.json));
} catch (e) {
  err = e;
}
printer.close();
await t.finish(err);

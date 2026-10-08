// Sales load test for the hub (P1 gate, step 10): NFR-05 (payment to receipt < 1 s), NFR-07 (5 devices on the
// pilot hub), NFR-08 (memory, sampled by pi-loadtest.sh), NFR-02 (no lost or duplicated sales).
// N tills sell at the same time on a THROWAWAY hub with the sample store: scans (lookups), quote, sale (cash
// or card), now and then a return, a void, a discount, manager reports, the audit log; half-way, every till
// uploads a burst of offline sales at the same moment (as after an outage), each sent twice.
// Afterwards it checks the data: every confirmed sale exactly once, unique receipt numbers, stock on hand =
// the sum of its stock movements, each till's Z figures = its sales, an audit entry for every sale.
// Usage: node tools/loadtest/sales-load.mjs <base-url> <superuser-token-file> [tills=5] [minutes=5] [report.json] [seconds between sales=1.5]
// (1.5 s between a till's sales is a stress test; a busy real till is nearer 30 s.)
// Run against a throwaway hub (tools/loadtest/pi-loadtest.sh start), never a store.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const [base, tokenFile, nTills = "5", minutes = "5", reportFile = "", pauseArg = "1.5"] = process.argv.slice(2);
const PAUSE_MS = Number(pauseArg) * 1000;
const SU = readFileSync(tokenFile, "utf8").trim();
const TILLS = Number(nTills), END = Date.now() + Number(minutes) * 60000, HALF = Date.now() + (Number(minutes) * 60000) / 2;
const seed = readFileSync(new URL("../../hub/pb_migrations_dev/1791200101_dev_sample_pins.js", import.meta.url), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const stats = { ok: 0, err: 0, byStatus: {}, lat: {}, fails: {} };
async function call(method, path, body, { token = "", dev = null, kind = "" } = {}) {
  const h = { "Content-Type": "application/json" };
  if (dev && dev.ip) h["X-Forwarded-For"] = dev.ip;
  if (token) h.Authorization = token;
  if (dev) { h["X-Chedam-Device"] = dev.id; h["X-Chedam-Device-Key"] = dev.key; }
  const t0 = performance.now();
  try {
    const r = await fetch(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const json = await r.json().catch(() => null);
    const k = kind || method + " " + path.replace(/[a-z0-9]{15}/g, ":id").replace(/\?.*/, "");
    (stats.lat[k] || (stats.lat[k] = [])).push(performance.now() - t0);
    stats.byStatus[r.status] = (stats.byStatus[r.status] || 0) + 1;
    if (r.ok) stats.ok++;
    else { stats.err++; const f = `${r.status} ${k} - ${(json && json.message) || ""}`.substring(0, 160); stats.fails[f] = (stats.fails[f] || 0) + 1; }
    return { status: r.status, ok: r.ok, json };
  } catch (e) {
    stats.err++; stats.byStatus.network = (stats.byStatus.network || 0) + 1;
    return { status: 0, ok: false, json: null };
  }
}
const su = (m, p, b) => call(m, p, b, { token: SU });
async function all(col, filter = "") {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await su("GET", `/api/collections/${col}/records?perPage=200&page=${page}${filter ? "&filter=" + encodeURIComponent(filter) : ""}`);
    out.push(...r.json.items);
    if (page >= r.json.totalPages) break;
  }
  return out;
}

// ---- Setup: tills paired and signed in (cashiers and managers), stock received, tills opened
const people = (await su("GET", "/api/collections/users/records?perPage=50")).json.items;
const sellers = ["Mira Manager", "Cal Cashier", "Demo Owner"].filter((n) => PIN[n]);
const tills = [];
for (let i = 0; i < TILLS; i++) {
  const code = (await su("POST", "/api/chedam/devices/pairing-code", { name: "Load till " + (i + 1), type: "till" })).json.code;
  const p = (await call("POST", "/api/chedam/devices/pair", { code })).json;
  const dev = { id: p.device_id, key: p.key, ip: "192.168.50." + (150 + i) };
  const name = sellers[i % sellers.length];
  const user = people.find((x) => x.name === name);
  const tok = (await call("POST", "/api/chedam/auth/pin", { user: user.id, pin: PIN[name] }, { dev })).json.token;
  tills.push({ i, dev, tok, name, user, sales: [], offline: [], returns: 0, voids: 0, manager: name !== "Cal Cashier" });
}
const mgr = tills.find((t) => t.manager);
const o = (t) => ({ token: t.tok, dev: t.dev });
const pack = (await call("GET", "/api/chedam/sales/offline-pack", null, o(tills[0]))).json;
const sellable = pack.units.filter((u) => u.price_cents > 0 && (u.barcodes || []).length).map((u) => ({ u, p: pack.products.find((x) => x.id === u.product) })).filter((x) => x.p);
// Stock for every unit sold (packs and cases arrive sealed), with an expiry a month away for perishables
const expiry = new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10);
for (const x of sellable) {
  const qty = x.u.kind === "weight" ? 300 : x.u.kind === "single" ? 400 : 60;
  await call("POST", "/api/chedam/stock/receive", { op_id: "op" + sid(), lines: [{ product: x.p.id, selling_unit: x.u.id, qty, expiry_date: expiry }] }, o(mgr));
}
for (const t of tills) t.till = (await call("POST", "/api/chedam/tills/open", { float_cents: 20000 }, o(t))).json;
console.log(`setup: ${tills.length} tills open (${tills.map((t) => t.name).join(", ")}); ${sellable.length} products to sell; stock received`);

function cartLines() {
  return Array.from({ length: 1 + Math.floor(Math.random() * 5) }, () => {
    const x = pick(sellable);
    const l = { key: "k" + sid().substring(0, 8), product: x.p.id, selling_unit: x.u.id, qty: 1 + Math.floor(Math.random() * 2), age_checked: true };
    if (x.u.kind === "weight") { delete l.qty; l.weight = Math.round((0.2 + Math.random() * 1.5) * 1000) / 1000; }
    return l;
  });
}

async function sellOnce(t, n) {
  const lines = cartLines();
  for (const l of lines) { const u = sellable.find((x) => x.u.id === l.selling_unit).u; await call("GET", "/api/chedam/catalogue/lookup?code=" + u.barcodes[0], null, o(t)); }
  const extra = n % 9 === 0 ? { cart_discount: { type: "pct", value: 5 } } : {};
  const q = await call("POST", "/api/chedam/sales/quote", { lines, ...extra }, o(t));
  if (!q.ok || q.json.problems.length) return;
  const card = Math.random() < 0.5;
  const id = sid();
  const r = await call("POST", "/api/chedam/sales", { id, lines, ...extra, expected_total_cents: q.json.total_cents,
    payments: [card ? { method: "card", amount_cents: q.json.total_cents, last4: "4242" } : { method: "cash", amount_cents: Math.ceil(q.json.total_cents / 2000) * 2000 + 2000 }] },
    { ...o(t), kind: "SALE (payment to receipt)" });
  if (!r.ok) return;
  t.sales.push({ id, number: r.json.sale.number, total: r.json.sale.total_cents });
  // now and then: a return of one line, a void (managers), reports
  if (n % 8 === 0) {
    const ra = await call("GET", "/api/chedam/returns/sale/" + id, null, o(t));
    const line = ra.json && ra.json.lines.find((l) => l.returnable_qty > 0 && !l.weighed);
    if (line) {
      const body = { sale: id, lines: [{ sale_line: line.id, qty: 1, disposition: "restock" }] };
      const rq = await call("POST", "/api/chedam/returns/quote", body, o(t));
      if (rq.ok && !rq.json.needs_approval.length) {
        const rr = await call("POST", "/api/chedam/returns", { id: sid(), ...body, refunds: [{ method: card ? "card" : "cash", amount_cents: rq.json.refund_cents, last4: "4242" }] }, o(t));
        if (rr.ok) t.returns++;
      }
    }
  }
  if (t.manager && n % 13 === 0) {
    const v = await call("POST", `/api/chedam/sales/${id}/void`, { reason: "Load test" }, o(t));
    if (v.ok) { t.voids++; t.sales.find((s) => s.id === id).voided = true; }
  }
  if (t.manager && n % 10 === 0) {
    await call("GET", "/api/chedam/reports/tills", null, o(t));
    await call("GET", "/api/chedam/audit?table=sales", null, o(t));
    await call("GET", "/api/chedam/tills/current", null, o(t));
  }
}

// Offline sales: priced as the till would (the hub's quote), uploaded twice, all tills at once
async function offlineBurst(t, k) {
  const ups = [];
  for (let j = 0; j < k; j++) {
    const lines = cartLines().filter((l) => !l.weight);
    if (!lines.length) continue;
    const q = (await call("POST", "/api/chedam/sales/quote", { lines }, o(t))).json;
    if (!q || q.problems.length) continue;
    const ratesOf = (l) => (l.taxes || []).map((x) => ({ code: x.code, rate: x.rate }));
    ups.push({ id: sid(), offline: true, offline_ref: `OFF-LOAD${t.i}-${j}`, device_time: new Date().toISOString(), cashier: t.user.id, till: t.till.id, tax_mode: q.tax_mode,
      lines: q.lines.map((l) => ({ key: l.key, product: l.product, selling_unit: l.selling_unit, qty: l.qty, gross_cents: l.gross_cents, line_discount_cents: 0,
        regular_price_cents: l.regular_price_cents, price_cents: l.price_cents, deposit_cents: l.deposit_cents, rates: ratesOf(l), deposit_rates: [] })),
      cart_discount_cents: 0, totals: { total_cents: q.total_cents, tax_cents: q.tax_cents }, payments: [{ method: "card", amount_cents: q.total_cents }] });
  }
  await sleep(Math.max(0, HALF - Date.now()));                     // the "hub is back" moment, all tills together
  for (const p of ups) {
    const r1 = await call("POST", "/api/chedam/sales/offline", p, { ...o(t), kind: "OFFLINE upload" });
    const r2 = await call("POST", "/api/chedam/sales/offline", p, { ...o(t), kind: "OFFLINE repeat" });
    if (r1.ok) t.offline.push({ id: p.id, number: r1.json.sale.number, dup: r2.ok && r2.json.duplicate === true, total: r1.json.sale.total_cents });
  }
}

async function run(t) {
  let n = 0;
  const off = offlineBurst(t, 6);
  while (Date.now() < END) {
    n++;
    await sellOnce(t, n);
    await sleep(PAUSE_MS * (0.5 + Math.random()));                // a cashier needs a moment between sales
  }
  await off;
}

const t0 = Date.now();
await Promise.all(tills.map(run));
for (const t of tills) {
  const z = (await call("GET", "/api/chedam/tills/current", null, o(t))).json.till.summary;
  t.close = (await call("POST", `/api/chedam/tills/${t.till.id}/close`, { counted_cents: z.expected_cash_cents }, o(t))).json;
}
const seconds = Math.round((Date.now() - t0) / 1000);

// ---- Checks (NFR-02 and the data)
// This run's sales: the ones on this run's tills (the hub may hold earlier runs)
const runTills = new Set(tills.map((t) => t.till.id));
const sales = (await all("sales", "training = false")).filter((x) => runTills.has(x.till));
const byId = new Map(sales.map((s) => [s.id, s]));
const confirmed = tills.flatMap((t) => t.sales.concat(t.offline));
const missing = confirmed.filter((s) => !byId.has(s.id));
const numbers = sales.map((s) => s.number);
const dupNumbers = numbers.length - new Set(numbers).size;
const notRepeatSafe = tills.flatMap((t) => t.offline).filter((s) => !s.dup).length;
const moves = await all("stock_movements");
const levels = Object.fromEntries((await all("stock_levels")).map((l) => [l.product, l.on_hand]));
const sumMoves = {};
moves.forEach((m) => { if (m.status === "posted") sumMoves[m.product] = Math.round(((sumMoves[m.product] || 0) + m.qty_base) * 1000) / 1000; });
const stockOff = Object.keys(levels).filter((p) => Math.abs((levels[p] || 0) - (sumMoves[p] || 0)) > 0.0005);
const zOff = [];
for (const t of tills) {
  const z = t.close.z_report || {};
  const own = sales.filter((s) => s.till === t.till.id && s.status === "completed");
  const sum = own.reduce((a, s) => a + s.total_cents, 0);
  if (z.sales_count !== own.length || z.total_cents !== sum) zOff.push({ till: t.till.number, z: [z.sales_count, z.total_cents], sales: [own.length, sum] });
}
const created = new Set((await all("events", "table_name='sales' && action='create'")).map((e) => e.record_id));
const saleEvents = sales.filter((x) => created.has(x.id)).length;
const q = (k, p) => { const a = (stats.lat[k] || []).slice().sort((x, y) => x - y); return a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(a.length * p))]) : null; };
const pay = { p50: q("SALE (payment to receipt)", 0.5), p95: q("SALE (payment to receipt)", 0.95), max: q("SALE (payment to receipt)", 1) };
const report = {
  at: new Date().toISOString(), seconds, tills: TILLS, seconds_between_sales: PAUSE_MS / 1000, people: tills.map((t) => t.name),
  sales_online: tills.reduce((a, t) => a + t.sales.length, 0), sales_offline: tills.reduce((a, t) => a + t.offline.length, 0),
  returns: tills.reduce((a, t) => a + t.returns, 0), voids: tills.reduce((a, t) => a + t.voids, 0),
  requests: stats.ok + stats.err, errors: stats.err, by_status: stats.byStatus, failures: stats.fails,
  payment_to_receipt_ms: pay, latency_p95_ms: Object.fromEntries(Object.keys(stats.lat).map((k) => [k, q(k, 0.95)])),
  checks: {
    confirmed_sales_missing: missing.length, duplicate_receipt_numbers: dupNumbers, offline_repeats_not_answered_with_first: notRepeatSafe,
    sales_in_hub: sales.length, confirmed_sales: confirmed.length, stock_not_matching_movements: stockOff.length,
    z_reports_not_matching_sales: zOff, sale_audit_entries: saleEvents,
  },
};
report.pass = {
  "NFR-02 no lost or duplicated sales": missing.length === 0 && dupNumbers === 0 && notRepeatSafe === 0 && sales.length === confirmed.length,
  "stock = sum of movements": stockOff.length === 0,
  "Z reports = sales": zOff.length === 0,
  "every sale in the audit log": saleEvents === sales.length,
  "NFR-05 payment to receipt < 1 s (p95)": pay.p95 !== null && pay.p95 < 1000,
  "no server errors (5xx)": !Object.keys(stats.byStatus).some((s) => s >= 500 || s === "network"),
};
console.log(JSON.stringify(report, null, 2));
if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 2));

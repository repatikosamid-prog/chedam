// Power pull mid-SALE (P1 gate, step 10: NFR-09 "survives power pull mid-sale without corruption", NFR-02
// "no lost or duplicated sales"). Runs on the laptop against the power-test hub on the Pi (pi-powertest.sh:
// a throwaway copy of the store with the sample data, on the same SD card, restarted at boot).
// A till rings up sales without pause; the power goes (someone pulls the plug, or --auto hard-resets the Pi
// with sysrq "b": reboot at once, no sync). After each return it checks:
//   - every sale the hub CONFIRMED is there exactly once, with all its lines and payments (= its total),
//     its stock movements and its audit entry (all written in one transaction)
//   - no half sale: no sale without lines, no lines or payments without their sale
//   - stock on hand = the sum of its movements, for every product
//   - both databases pass PRAGMA integrity_check; the store's own hub came back by itself
// Usage: node tools/powertest/sale-writer.mjs <superuser-token-file> [cycles=10] [report.json] [--auto]
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const AUTO = process.argv.includes("--auto");
const [tokenFile, cyclesArg = "10", reportFile = "sale-powertest.json"] = args;
const SU = readFileSync(tokenFile, "utf8").trim();
const CYCLES = Number(cyclesArg);
const PORT = 18199, BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().substring(11, 19);
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const seed = readFileSync(new URL("../../hub/pb_migrations_dev/1791200101_dev_sample_pins.js", import.meta.url), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let tunnel = null;
function openTunnel() {
  if (tunnel && tunnel.exitCode === null) return;
  tunnel = spawn("ssh", ["-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=2", "-o", "ServerAliveCountMax=2",
    "-o", "ConnectTimeout=5", "-L", `${PORT}:127.0.0.1:8199`, "chedam"], { stdio: "ignore" });
}

let dev = null, tok = "";
async function req(method, path, body, ms = 4000, su = false) {
  const h = { "Content-Type": "application/json" };
  if (su) h.Authorization = SU;
  else if (tok) { h.Authorization = tok; h["X-Chedam-Device"] = dev.id; h["X-Chedam-Device-Key"] = dev.key; }
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  return { status: r.status, ok: r.ok, json: await r.json().catch(() => null) };
}
async function all(col, filter = "") {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await req("GET", `/api/collections/${col}/records?perPage=200&page=${page}${filter ? "&filter=" + encodeURIComponent(filter) : ""}`, null, 60000, true);
    out.push(...r.json.items);
    if (page >= r.json.totalPages) break;
  }
  return out;
}
function piCheck() {
  try {
    return JSON.parse(execFileSync("ssh", ["-o", "ConnectTimeout=5", "chedam", "bash -s check"],
      { input: readFileSync(new URL("./pi-powertest.sh", import.meta.url)), encoding: "utf8", timeout: 60000 }));
  } catch (e) { return { error: String(e.message).substring(0, 200) }; }
}

// ---- Setup: a paired till, a cashier signed in, stock, an open till
openTunnel();
for (let i = 0; i < 30; i++) { try { if ((await req("GET", "/api/health")).ok) break; } catch { /* tunnel starting */ } await sleep(1000); }
const people = (await req("GET", "/api/collections/users/records?perPage=50", null, 10000, true)).json.items;
const code = (await req("POST", "/api/chedam/devices/pairing-code", { name: "Power test till", type: "till" }, 10000, true)).json.code;
const p = (await req("POST", "/api/chedam/devices/pair", { code }, 10000)).json;
dev = { id: p.device_id, key: p.key };
const cal = people.find((x) => x.name === "Cal Cashier");
const login = await fetch(BASE + "/api/chedam/auth/pin", { method: "POST", headers: { "Content-Type": "application/json", "X-Chedam-Device": dev.id, "X-Chedam-Device-Key": dev.key },
  body: JSON.stringify({ user: cal.id, pin: PIN["Cal Cashier"] }) }).then((r) => r.json());
tok = login.token;
const pack = (await req("GET", "/api/chedam/sales/offline-pack", null, 15000)).json;
const items = pack.units.filter((u) => u.kind === "single" && u.price_cents > 0).map((u) => ({ u, p: pack.products.find((x) => x.id === u.product) }))
  .filter((x) => x.p && !x.p.age_restricted);
const expiry = new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10);
const mira = people.find((x) => x.name === "Mira Manager");
const mtok = (await fetch(BASE + "/api/chedam/auth/pin", { method: "POST", headers: { "Content-Type": "application/json", "X-Chedam-Device": dev.id, "X-Chedam-Device-Key": dev.key },
  body: JSON.stringify({ user: mira.id, pin: PIN["Mira Manager"] }) }).then((r) => r.json())).token;
for (const x of items) {
  await fetch(BASE + "/api/chedam/stock/receive", { method: "POST", headers: { "Content-Type": "application/json", Authorization: mtok, "X-Chedam-Device": dev.id, "X-Chedam-Device-Key": dev.key },
    body: JSON.stringify({ op_id: "op" + sid(), lines: [{ product: x.p.id, selling_unit: x.u.id, qty: 3000, expiry_date: expiry }] }) });
}
tok = (await fetch(BASE + "/api/chedam/auth/pin", { method: "POST", headers: { "Content-Type": "application/json", "X-Chedam-Device": dev.id, "X-Chedam-Device-Key": dev.key },
  body: JSON.stringify({ user: cal.id, pin: PIN["Cal Cashier"] }) }).then((r) => r.json())).token;
const cur = (await req("GET", "/api/chedam/tills/current", null, 10000)).json;
if (!cur.till) await req("POST", "/api/chedam/tills/open", { float_cents: 20000 }, 10000);

// ---- Writer
const acked = new Map();       // sale id -> {lines, total}
const ACKED = reportFile + ".acked";
writeFileSync(ACKED, "");
let up = true, cutAt = null, outages = [], seq = 0;
const report = { started: new Date().toISOString(), auto: AUTO, cycles: [] };

async function writer() {
  while (outages.length < CYCLES) {
    if (!up) { await sleep(200); continue; }
    const lines = Array.from({ length: 1 + (seq++ % 3) }, () => { const x = items[Math.floor(Math.random() * items.length)]; return { key: "k" + sid().substring(0, 6), product: x.p.id, selling_unit: x.u.id, qty: 1 }; });
    const id = sid();
    try {
      const q = await req("POST", "/api/chedam/sales/quote", { lines });
      if (!q.ok) continue;
      const r = await req("POST", "/api/chedam/sales", { id, lines, payments: [{ method: "card", amount_cents: q.json.total_cents, last4: "4242" }] });
      if (r.ok && r.json.sale && r.json.sale.id === id) {
        acked.set(id, { lines: lines.length, total: r.json.sale.total_cents });
        appendFileSync(ACKED, id + " " + lines.length + " " + r.json.sale.total_cents + "\n");
      }
    } catch { /* power went mid-request: not confirmed, so not counted */ }
  }
}

async function verify(cycle, downAt, upAt) {
  let data = null, lastErr = "";
  for (let attempt = 1; attempt <= 3 && !data; attempt++) {
    try {
      data = { sales: await all("sales", "training = false"), lines: await all("sale_lines"), pays: await all("payments"), moves: await all("stock_movements"),
        levels: await all("stock_levels"), events: await all("events", "table_name='sales' && action='create'") };
    } catch (e) { lastErr = String(e.message || e); await sleep(10000); }
  }
  if (!data) { report.cycles.push({ cycle, pass: false, error: "check failed: " + lastErr }); writeFileSync(reportFile, JSON.stringify(report, null, 2)); console.log(`[${now()}] cycle ${cycle}: CHECK FAILED ${lastErr}`); return; }
  const sales = new Map(data.sales.map((s) => [s.id, s]));
  const linesBy = {}, payBy = {}, movesBy = {};
  data.lines.forEach((l) => { (linesBy[l.sale] || (linesBy[l.sale] = [])).push(l); });
  data.pays.forEach((x) => { (payBy[x.sale] || (payBy[x.sale] = [])).push(x); });
  data.moves.forEach((m) => { if (m.ref_collection === "sales") movesBy[m.ref_id] = (movesBy[m.ref_id] || 0) + 1; });
  const evs = new Set(data.events.map((e) => e.record_id));
  const lost = [...acked.keys()].filter((id) => !sales.has(id));
  const incomplete = [...acked.entries()].filter(([id, a]) => sales.has(id) && ((linesBy[id] || []).length !== a.lines
    || (payBy[id] || []).reduce((s, x) => s + x.amount_cents, 0) !== a.total || (movesBy[id] || 0) !== a.lines || !evs.has(id))).map(([id]) => id);
  const orphans = Object.keys(linesBy).concat(Object.keys(payBy)).filter((id) => !sales.has(id)).length;
  const halfSales = data.sales.filter((s) => !(linesBy[s.id] || []).length).length;
  const numbers = data.sales.map((s) => s.number);
  const sum = {};
  data.moves.forEach((m) => { if (m.status === "posted") sum[m.product] = Math.round(((sum[m.product] || 0) + m.qty_base) * 1000) / 1000; });
  const stockOff = data.levels.filter((l) => Math.abs(l.on_hand - (sum[l.product] || 0)) > 0.0005).length;
  const pi = piCheck();
  const res = { cycle, power_cut_at: downAt, back_at: upAt, outage_s: Math.round((Date.parse(upAt) - Date.parse(downAt)) / 1000),
    confirmed_sales: acked.size, sales_in_hub: data.sales.length, lost_confirmed: lost.length, incomplete_confirmed: incomplete.length,
    orphan_lines_or_payments: orphans, sales_without_lines: halfSales, duplicate_numbers: numbers.length - new Set(numbers).size, stock_not_matching: stockOff,
    unconfirmed_but_saved: data.sales.length - [...acked.keys()].filter((id) => sales.has(id)).length,
    real_hub: pi.real_hub, real_integrity: pi.real_integrity, test_integrity: pi.test_integrity, throttled: pi.throttled, new_boot: pi.boot_id };
  res.pass = !lost.length && !incomplete.length && !orphans && !halfSales && res.duplicate_numbers === 0 && !stockOff
    && res.real_hub === "active" && res.real_integrity === "ok" && res.test_integrity === "ok";
  report.cycles.push(res);
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`[${now()}] cycle ${cycle}: ${res.pass ? "PASS" : "FAIL"}  confirmed ${res.confirmed_sales}, lost ${res.lost_confirmed}, incomplete ${res.incomplete_confirmed}, `
    + `half sales ${halfSales}, orphans ${orphans}, stock off ${stockOff}, integrity real ${res.real_integrity} / test ${res.test_integrity}, outage ${res.outage_s}s`);
}

async function watcher() {
  let lastBoot = piCheck().boot_id;
  console.log(`[${now()}] ready. Selling now. ${AUTO ? "Hard-resetting the Pi every ~40 s" : "Pull the Pi's power plug, wait 5 s, plug it back in"}. ${CYCLES} times.`);
  let writingSince = Date.now();
  while (outages.length < CYCLES) {
    openTunnel();
    if (AUTO && up && Date.now() - writingSince > 40000 && !cutAt) {
      // The connection dies with the reboot: that is the point, not an error
      try { execFileSync("ssh", ["-o", "ConnectTimeout=5", "chedam", 'sudo sh -c "echo b > /proc/sysrq-trigger"'], { stdio: "ignore", timeout: 8000 }); } catch { /* gone */ }
      writingSince = Infinity;
    }
    let ok = false;
    try { ok = (await req("GET", "/api/health")).status === 200; } catch { ok = false; }
    if (up && !ok) { up = false; cutAt = new Date().toISOString(); console.log(`[${now()}] hub gone after ${acked.size} confirmed sales. Waiting…`); }
    else if (!up && ok) {
      const boot = piCheck().boot_id;
      if (cutAt && boot && boot !== lastBoot) {
        lastBoot = boot;
        console.log(`[${now()}] back after a reboot. Checking…`);
        await verify(outages.length + 1, cutAt, new Date().toISOString());
        outages.push(cutAt); cutAt = null; writingSince = Date.now();
        if (outages.length < CYCLES) console.log(`[${now()}] selling again (${outages.length}/${CYCLES} done).`);
      } else if (cutAt) { console.log(`[${now()}] connection lost but no reboot (Wi-Fi blip?). Not counted.`); cutAt = null; }
      up = true;
    }
    await sleep(ok ? 500 : 2000);
  }
  up = true;
}

await Promise.all([writer(), watcher()]);
const pass = report.cycles.length === CYCLES && report.cycles.every((c) => c.pass);
report.result = pass ? "PASS" : "FAIL";
writeFileSync(reportFile, JSON.stringify(report, null, 2));
console.log(`RESULT: ${report.result} (${report.cycles.filter((c) => c.pass).length}/${CYCLES} cycles passed, ${acked.size} confirmed sales)`);
if (tunnel) tunnel.kill();
process.exit(0);

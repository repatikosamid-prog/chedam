// Power-pull test writer (P0 gate: NFR-09 "survives power pull mid-sale without corruption", NFR-02
// "no lost or duplicated sales"). Runs on the laptop and keeps writing to the power-test hub on the Pi
// (through an SSH tunnel it restarts by itself). Someone pulls the Pi's power plug while it writes.
// After each power cut and reboot it checks:
//   - every write the hub CONFIRMED (HTTP 200) is still there (no lost write)
//   - no record exists twice (no duplicate)
//   - every record has its audit-log entry (same transaction)
//   - both databases pass PRAGMA integrity_check; the store's real hub restarted by itself
// Usage: node tools/powertest/power-writer.mjs <token-file> [cycles=10] [report-file]
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const [tokenFile, cyclesArg = "10", reportFile = "powertest-report.json"] = process.argv.slice(2);
const TOKEN = readFileSync(tokenFile, "utf8").trim();
const CYCLES = Number(cyclesArg);
const PORT = 18199, BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().substring(11, 19);

// ---- Tunnel that comes back after the Pi reboots -------------------------------------------------
let tunnel = null;
function openTunnel() {
  if (tunnel && tunnel.exitCode === null) return;
  tunnel = spawn("ssh", ["-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=2", "-o", "ServerAliveCountMax=2",
    "-o", "ConnectTimeout=5", "-L", `${PORT}:127.0.0.1:8199`, "chedam"], { stdio: "ignore" });
}

// Writes give up after 4 s (the power may be gone); checks after a reboot get 60 s (a Pi Zero that has
// just booted needs several seconds to list ~20,000 records)
async function req(method, path, body, ms = 4000) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Authorization: TOKEN },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}

// ---- State ----------------------------------------------------------------------------------------
const run = Date.now().toString(36);
let seq = 0;
const acked = new Set();          // names the hub confirmed
// Every confirmed write is also appended to a file at once, so the proof survives a crash of this script
const ACKED_FILE = reportFile + ".acked";
writeFileSync(ACKED_FILE, "");
let up = false, cutAt = null, outages = [];
const report = { run, started: new Date().toISOString(), cycles: [] };

async function writer(id) {
  while (outages.length < CYCLES || !up) {
    if (!up) { await sleep(200); continue; }
    const name = `P${run}-${++seq}`;
    try {
      const r = await req("POST", "/api/collections/storage_areas/records", { name, kind: "shelf", active: true, temp_min_c: seq % 7, temp_max_c: 20 });
      if (r.status === 200 && r.json && r.json.name === name) { acked.add(name); appendFileSync(ACKED_FILE, name + "\n"); }
    } catch { /* hub went away mid-request: not confirmed, so not counted */ }
    await sleep(60 + id * 10);
    if (outages.length >= CYCLES && up) return;
  }
}

async function allNames() {
  const names = [];
  for (let page = 1; ; page++) {
    const r = await req("GET", `/api/collections/storage_areas/records?perPage=500&page=${page}&fields=name&filter=${encodeURIComponent(`name~'P${run}-'`)}`, null, 60000);
    names.push(...r.json.items.map((x) => x.name));
    if (page >= r.json.totalPages) break;
  }
  return names;
}

function piCheck() {
  try {
    const out = execFileSync("ssh", ["-o", "ConnectTimeout=5", "chedam", "bash -s check"],
      { input: readFileSync(new URL("./pi-powertest.sh", import.meta.url)), encoding: "utf8", timeout: 60000 });
    return JSON.parse(out);
  } catch (e) { return { error: String(e.message).substring(0, 200) }; }
}

async function verify(cycle, downAt, upAt) {
  let names = null, lastErr = "";
  for (let attempt = 1; attempt <= 3 && !names; attempt++) {
    try { names = await allNames(); } catch (e) { lastErr = String(e.message || e); await sleep(10000); }
  }
  if (!names) {
    const res = { cycle, power_cut_at: downAt, back_at: upAt, pass: false, error: "check failed: " + lastErr };
    report.cycles.push(res);
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`[${now()}] cycle ${cycle}: CHECK FAILED (${lastErr}). The confirmed writes are kept in ${ACKED_FILE}.`);
    return;
  }
  const present = new Set(names);
  const lost = [...acked].filter((n) => !present.has(n));
  const dupes = names.length - present.size;
  const pi = piCheck();
  const res = {
    cycle, power_cut_at: downAt, back_at: upAt, outage_s: Math.round((Date.parse(upAt) - Date.parse(downAt)) / 1000),
    confirmed_writes_so_far: acked.size, records: present.size, lost_confirmed: lost.length, lost_examples: lost.slice(0, 5),
    duplicates: dupes, unconfirmed_but_saved: [...present].filter((n) => !acked.has(n)).length,
    audit_entries: pi.test_create_events, audit_matches_records: pi.test_create_events === pi.test_records,
    real_hub: pi.real_hub, real_integrity: pi.real_integrity, test_integrity: pi.test_integrity, throttled: pi.throttled,
    new_boot: pi.boot_id, fsck_note: pi.fsck_note || "",
  };
  res.pass = res.lost_confirmed === 0 && res.duplicates === 0 && res.audit_matches_records && res.real_hub === "active"
    && res.real_integrity === "ok" && res.test_integrity === "ok";
  report.cycles.push(res);
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`[${now()}] cycle ${cycle}: ${res.pass ? "PASS" : "FAIL"}  confirmed ${res.confirmed_writes_so_far}, lost ${res.lost_confirmed}, `
    + `duplicates ${res.duplicates}, audit ${res.audit_matches_records ? "ok" : "MISMATCH"}, integrity real ${res.real_integrity} / test ${res.test_integrity}, `
    + `real hub ${res.real_hub}, outage ${res.outage_s}s`);
}

// ---- Watcher: notices the cut and the return -------------------------------------------------------
async function watcher() {
  let lastBoot = piCheck().boot_id;
  console.log(`[${now()}] ready. Writing now. Pull the Pi's power plug, wait 5 s, plug it back in. ${CYCLES} times.`);
  while (outages.length < CYCLES) {
    openTunnel();
    let ok = false;
    try { ok = (await req("GET", "/api/health")).status === 200; } catch { ok = false; }
    if (up && !ok) {
      up = false; cutAt = new Date().toISOString();
      console.log(`[${now()}] hub gone (power cut?) after ${acked.size} confirmed writes. Waiting for it to come back…`);
    } else if (!up && ok) {
      const boot = piCheck().boot_id;
      if (cutAt && boot && boot !== lastBoot) {
        lastBoot = boot;
        const back = new Date().toISOString();
        console.log(`[${now()}] back after a reboot. Checking…`);
        await verify(outages.length + 1, cutAt, back);
        outages.push(cutAt);
        cutAt = null;
        if (outages.length < CYCLES) console.log(`[${now()}] writing again. Next pull when you are ready (${outages.length}/${CYCLES} done).`);
      } else if (cutAt) {
        console.log(`[${now()}] connection was lost but the Pi did not reboot (Wi-Fi blip?). Not counted.`);
        cutAt = null;
      }
      up = true;
    }
    await sleep(ok ? 500 : 2000);
  }
  up = true;
}

openTunnel();
await sleep(3000);
await Promise.all([watcher(), writer(0), writer(1), writer(2)]);
report.finished = new Date().toISOString();
report.pass = report.cycles.length === CYCLES && report.cycles.every((c) => c.pass);
writeFileSync(reportFile, JSON.stringify(report, null, 2));
console.log(`\nRESULT: ${report.pass ? "PASS" : "FAIL"}  (${report.cycles.filter((c) => c.pass).length}/${CYCLES} cycles passed, ${acked.size} confirmed writes)`);
tunnel && tunnel.kill();
process.exit(report.pass ? 0 : 1);

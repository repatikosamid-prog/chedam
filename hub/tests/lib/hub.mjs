// Shared test harness: a throwaway PocketBase hub on 127.0.0.1 with this repo's migrations and hooks.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export const HUB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PB = process.env.PB_BIN || "pocketbase";

export function rid(n = 6) { return randomBytes(n).toString("hex"); }

export class TestHub {
  constructor({ port = 8091, sample = true } = {}) {
    this.port = port;
    this.base = `http://127.0.0.1:${port}`;
    this.work = mkdtempSync(join(tmpdir(), "chedam-test-"));
    this.dataDir = join(this.work, "pb_data");
    this.migDir = join(this.work, "pb_migrations");
    mkdirSync(this.migDir);
    cpSync(join(HUB, "pb_migrations"), this.migDir, { recursive: true });
    if (sample) cpSync(join(HUB, "pb_migrations_dev"), this.migDir, { recursive: true });
    this.server = null;
    this.passed = 0;
    this.failed = 0;
  }

  args(extra) {
    return [...extra, `--dir=${this.dataDir}`, `--migrationsDir=${this.migDir}`, `--hooksDir=${join(HUB, "pb_hooks")}`];
  }

  cli(extra, input) {
    return spawnSync(PB, this.args(extra), { encoding: "utf8", input });
  }

  async start(env = {}) {
    if (!this.suPass) {
      this.suEmail = "test@chedam.test";
      this.suPass = randomBytes(18).toString("base64url");
      const up = this.cli(["superuser", "upsert", this.suEmail, this.suPass]);
      if (up.status !== 0) throw new Error("superuser upsert failed: " + up.stderr + up.stdout);
    }
    const p = spawn(PB, this.args(["serve", "--dev", `--http=127.0.0.1:${this.port}`]), {
      env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
    p.log = "";
    p.stdout.on("data", (d) => (p.log += d));
    p.stderr.on("data", (d) => (p.log += d));
    this.server = p;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${this.base}/api/health`)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 150));
      if (i === 99) throw new Error("PocketBase did not start:\n" + p.log);
    }
    const a = await this.api("POST", "/api/collections/_superusers/auth-with-password",
      { identity: this.suEmail, password: this.suPass });
    this.su = a.json.token;
    this.suId = a.json.record.id;
  }

  async stop() {
    const p = this.server;
    this.server = null;
    if (!p || p.exitCode !== null || p.signalCode !== null) return;
    p.kill();
    await new Promise((r) => p.on("exit", r));
  }

  async api(method, path, body, { token = "", headers = {} } = {}) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* empty */ }
    return { status: res.status, json };
  }

  // Superuser shortcut
  su_(method, path, body, headers = {}) { return this.api(method, path, body, { token: this.su, headers }); }

  async list(col, filter = "", token = this.su) {
    const r = await this.api("GET", `/api/collections/${col}/records?perPage=500&filter=${encodeURIComponent(filter)}`, null, { token });
    return r.json;
  }

  check(name, ok, detail = "") {
    if (ok) { this.passed++; console.log(`  ok   ${name}`); }
    else { this.failed++; console.log(`  FAIL ${name} ${detail}`); }
  }

  async finish(err) {
    if (err) { this.failed++; console.log("  FAIL unexpected error:", err.stack || err.message); }
    if (this.failed && this.server && this.server.log) {
      // Error lines plus the line under each (PocketBase prints the cause on the next line)
      const lines = this.server.log.split("\n");
      const errs = lines.filter((l, i) => /ERROR/.test(l) || /ERROR/.test(lines[i - 1] || ""));
      console.log("\n--- PocketBase errors (last 40 lines) ---\n" + errs.slice(-40).join("\n"));
    }
    await this.stop();
    rmSync(this.work, { recursive: true, force: true });
    console.log(`\n${this.passed} passed, ${this.failed} failed`);
    process.exit(this.failed ? 1 : 0);
  }
}

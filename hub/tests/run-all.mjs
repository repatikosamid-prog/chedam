// Runs every hub test suite in order; exits non-zero if any fails.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/run-all.mjs
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();
let bad = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [join(dir, s)], { encoding: "utf8", env: process.env });
  const summary = (r.stdout.match(/\d+ passed, \d+ failed/) || ["no summary"])[0];
  console.log(`${r.status === 0 ? "PASS" : "FAIL"}  ${s}  (${summary})`);
  if (r.status !== 0) { bad++; console.log(r.stdout.split("\n").filter((l) => /FAIL|ERROR|└/.test(l)).join("\n")); }
}
process.exit(bad ? 1 : 0);

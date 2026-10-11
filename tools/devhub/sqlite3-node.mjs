// Dev and test only: stands in for the sqlite3 command on the PC (it is on the Pi), for the hub's reference data
// (lib/reference.js). Understands only what the hub uses: sqlite3 -readonly -json <file> "<one SELECT>".
// The hub uses it when CHEDAM_SQLITE='["node","<this file>"]'.
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2).filter((a) => a !== "-readonly" && a !== "-json");
const [file, sql] = args;
try {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare(sql).all();
  process.stdout.write(rows.length ? JSON.stringify(rows) : "");
  db.close();
} catch (err) {
  process.stderr.write(String(err.message || err));
  process.exit(1);
}

#!/usr/bin/env python3
"""Phase gate check (Section 13): "every write appears in the event log".

Runs on the hub, read-only: for every Chedam table, each record must have a 'create' event, and each record
changed since it was created (updated_at after created_at) must have at least one 'update' event.
Prints a JSON report; exit 1 when something is missing.
Usage (from the laptop): ssh chedam 'sudo -u chedam-hub python3 - /opt/chedam/pb_data/data.db' < tools/gate/event-coverage.py
"""
import json
import sqlite3
import sys

db = sys.argv[1] if len(sys.argv) > 1 else "/opt/chedam/pb_data/data.db"
con = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
tables = [r[0] for r in con.execute(
    "SELECT name FROM _collections WHERE system = 0 AND name NOT LIKE '\\_%' ESCAPE '\\' AND type IN ('base', 'auth') ORDER BY name")]
created = {}
for t, rid in con.execute("SELECT table_name, record_id FROM events WHERE action = 'create'"):
    created.setdefault(t, set()).add(rid)
updated = {}
for t, rid in con.execute("SELECT table_name, record_id FROM events WHERE action = 'update'"):
    updated.setdefault(t, set()).add(rid)

out = {"tables": [], "missing_create": 0, "missing_update": 0}
for t in tables:
    if t == "events":
        continue
    cols = [r[1] for r in con.execute('PRAGMA table_info("%s")' % t)]
    has_times = "created_at" in cols and "updated_at" in cols
    rows = con.execute('SELECT id%s FROM "%s"' % (", created_at, updated_at" if has_times else "", t)).fetchall()
    no_create = [r[0] for r in rows if r[0] not in created.get(t, set())]
    no_update = [r[0] for r in rows if has_times and r[2] and r[1] and r[2] > r[1] and r[0] not in updated.get(t, set())
                 and r[0] in created.get(t, set())]
    out["tables"].append({"table": t, "records": len(rows), "missing_create": len(no_create), "missing_update": len(no_update),
                          "examples": (no_create + no_update)[:3]})
    out["missing_create"] += len(no_create)
    out["missing_update"] += len(no_update)
out["records"] = sum(x["records"] for x in out["tables"])
out["pass"] = out["missing_create"] == 0 and out["missing_update"] == 0
out["integrity"] = con.execute("PRAGMA integrity_check").fetchone()[0]
print(json.dumps(out, indent=1))
sys.exit(0 if out["pass"] else 1)

#!/usr/bin/env bash
# Starts or stops a THROWAWAY hub on the Pi for load tests (never the store's hub):
# same PocketBase binary, hooks, migrations and memory settings as chedam-hub.service, its own data folder,
# 127.0.0.1:8099 only, plus a memory sampler (every 2 s, VmRSS/VmHWM of the test hub).
#   ssh chedam 'bash -s start' < tools/loadtest/pi-loadtest.sh     -> prints a superuser token file path
#   ssh chedam 'POOL=6 bash -s start' < ...                         -> with 6 JS engines instead of PocketBase's 15
#   ssh chedam 'bash -s report' < tools/loadtest/pi-loadtest.sh    -> memory summary
#   ssh chedam 'bash -s stop'  < tools/loadtest/pi-loadtest.sh     -> stops and deletes everything
set -euo pipefail
W=/var/tmp/chedam-loadtest
case "${1:-}" in
start)
  sudo systemctl stop chedam-loadtest chedam-loadtest-sampler 2>/dev/null || true
  sudo rm -rf $W && sudo install -d -o chedam-hub -g chedam-hub $W $W/pb_migrations
  sudo cp /opt/chedam/pb_migrations/*.js $W/pb_migrations/            # includes the dev sample store
  sudo chown -R chedam-hub:chedam-hub $W
  # Same limits as the service: GOMEMLIMIT=100MiB, MemoryHigh=150M, MemoryMax=220M
  sudo systemd-run --quiet --unit=chedam-loadtest -p User=chedam-hub -p MemoryHigh=150M -p MemoryMax=220M \
    -E GOMEMLIMIT=100MiB /opt/chedam/bin/pocketbase serve --http=127.0.0.1:8099 --dir=$W/pb_data \
    --hooksDir=/opt/chedam/pb_hooks --migrationsDir=$W/pb_migrations --publicDir=/opt/chedam/pb_public --hooksPool=${POOL:-15}
  for i in $(seq 1 60); do curl -sf http://127.0.0.1:8099/api/health >/dev/null && break; sleep 1; done
  PW=$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 24)
  sudo -u chedam-hub /opt/chedam/bin/pocketbase superuser upsert loadtest@chedam.test "Pw$PW" --dir=$W/pb_data >/dev/null
  curl -s -X POST http://127.0.0.1:8099/api/collections/_superusers/auth-with-password -H 'Content-Type: application/json' \
    -d "{\"identity\":\"loadtest@chedam.test\",\"password\":\"Pw$PW\"}" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" > /tmp/chedam-loadtest-token
  chmod 600 /tmp/chedam-loadtest-token
  PID=$(systemctl show -p MainPID --value chedam-loadtest)
  sudo systemd-run --quiet --unit=chedam-loadtest-sampler /bin/bash -c \
    "while kill -0 $PID 2>/dev/null; do echo \"\$(date +%s) \$(grep -E 'VmRSS|VmHWM' /proc/$PID/status | awk '{print \$2}' | paste -sd' ') \$(cut -d' ' -f1 /proc/loadavg) \$(grep MemAvailable /proc/meminfo | awk '{print \$2}')\"; sleep 2; done > $W/memory.log"
  echo "test hub up (pid $PID), token in /tmp/chedam-loadtest-token"
  ;;
report)
  sudo python3 - "$W/memory.log" <<'PY'
import sys
rows = [l.split() for l in open(sys.argv[1]) if len(l.split()) == 5]
if not rows: sys.exit("no samples")
rss = [int(r[2]) / 1024 for r in rows]; hwm = max(int(r[1]) for r in rows) / 1024
load = [float(r[3]) for r in rows]; avail = [int(r[4]) / 1024 for r in rows]
print("samples %d over %ds" % (len(rows), int(rows[-1][0]) - int(rows[0][0])))
print("hub app memory (RSS): start %.0f MB, average %.0f MB, peak %.0f MB, end %.0f MB (kernel peak VmHWM %.0f MB)" % (rss[0], sum(rss)/len(rss), max(rss), rss[-1], hwm))
print("Pi free memory: lowest %.0f MB; load average: highest %.2f" % (min(avail), max(load)))
print("NFR-08 (< 150 MB):", "PASS" if hwm < 150 else "FAIL")
PY
  ;;
stop)
  sudo systemctl stop chedam-loadtest-sampler chedam-loadtest 2>/dev/null || true
  sudo rm -rf $W /tmp/chedam-loadtest-token
  echo "test hub stopped and deleted"
  ;;
*) echo "start | report | stop"; exit 2 ;;
esac

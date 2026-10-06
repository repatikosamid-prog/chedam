#!/usr/bin/env bash
# Power-pull test hub (P0 gate: NFR-09, survives a power pull mid-write; ×10). A THROWAWAY hub that,
# unlike the load-test one, survives reboots: a real systemd service (same binary, hooks, migrations
# and memory limits as chedam-hub), data on the same SD card in /var/lib/chedam-powertest, 127.0.0.1:8199.
#   ssh chedam 'bash -s install' < tools/powertest/pi-powertest.sh   -> token in /tmp/chedam-powertest-token
#   ssh chedam 'bash -s check'   < tools/powertest/pi-powertest.sh   -> integrity of both databases, services
#   ssh chedam 'bash -s remove'  < tools/powertest/pi-powertest.sh   -> stop, disable, delete everything
set -euo pipefail
W=/var/lib/chedam-powertest
UNIT=/etc/systemd/system/chedam-powertest.service
case "${1:-}" in
install)
  sudo systemctl disable --now chedam-powertest 2>/dev/null || true
  sudo rm -rf $W && sudo install -d -o chedam-hub -g chedam-hub $W $W/pb_migrations
  sudo cp /opt/chedam/pb_migrations/*.js $W/pb_migrations/
  sudo chown -R chedam-hub:chedam-hub $W
  sudo tee $UNIT >/dev/null <<EOF
[Unit]
Description=Chedam power-pull TEST hub (throwaway; remove with pi-powertest.sh remove)
After=network-online.target
[Service]
User=chedam-hub
Group=chedam-hub
ExecStart=/opt/chedam/bin/pocketbase serve --http=127.0.0.1:8199 --dir=$W/pb_data --hooksDir=/opt/chedam/pb_hooks --migrationsDir=$W/pb_migrations --publicDir=/opt/chedam/pb_public
Restart=always
RestartSec=2
Environment=GOMEMLIMIT=100MiB
MemoryHigh=150M
MemoryMax=220M
[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload && sudo systemctl enable --now chedam-powertest >/dev/null
  for i in $(seq 1 60); do curl -sf http://127.0.0.1:8199/api/health >/dev/null && break; sleep 1; done
  PW="Pw$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 24)"
  sudo -u chedam-hub /opt/chedam/bin/pocketbase superuser upsert powertest@chedam.test "$PW" --dir=$W/pb_data >/dev/null
  curl -s -X POST http://127.0.0.1:8199/api/collections/_superusers/auth-with-password -H 'Content-Type: application/json' \
    -d "{\"identity\":\"powertest@chedam.test\",\"password\":\"$PW\"}" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" > /tmp/chedam-powertest-token
  chmod 600 /tmp/chedam-powertest-token
  echo "power test hub installed and enabled at boot"
  ;;
check)
  q() { sudo -u chedam-hub sqlite3 "$1" "$2" 2>&1 | head -3 | paste -sd' '; }
  echo "{\"boot_id\": \"$(cat /proc/sys/kernel/random/boot_id)\", \"uptime_s\": $(cut -d. -f1 /proc/uptime),"
  echo " \"real_hub\": \"$(systemctl is-active chedam-hub)\", \"real_integrity\": \"$(q /opt/chedam/pb_data/data.db 'pragma integrity_check')\","
  echo " \"test_hub\": \"$(systemctl is-active chedam-powertest)\", \"test_integrity\": \"$(q $W/pb_data/data.db 'pragma integrity_check')\","
  echo " \"test_records\": $(q $W/pb_data/data.db "select count(*) from storage_areas where name like 'P%'"),"
  echo " \"test_create_events\": $(q $W/pb_data/data.db "select count(*) from events where table_name='storage_areas' and action='create' and json_extract(after,'$.name') like 'P%'"),"
  echo " \"throttled\": \"$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)\", \"fsck_note\": \"$(sudo journalctl -b -o cat --no-pager 2>/dev/null | grep -m1 -iE 'recovering journal|orphan' | tr -d '"' | cut -c1-80)\"}"
  ;;
remove)
  sudo systemctl disable --now chedam-powertest 2>/dev/null || true
  sudo rm -f $UNIT && sudo systemctl daemon-reload
  sudo rm -rf $W /tmp/chedam-powertest-token
  echo "power test hub removed"
  ;;
*) echo "install | check | remove"; exit 2 ;;
esac

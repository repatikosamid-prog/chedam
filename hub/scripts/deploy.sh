#!/usr/bin/env bash
# Deploy hub code (pb_hooks, pb_migrations) and the client app (built into pb_public) to a hub over SSH.
# Run from the PC (Git Bash):  bash hub/scripts/deploy.sh [--sample-data] [ssh-host]
#   --sample-data  also deploy hub/pb_migrations_dev (dev sample store). Development hubs only.
#   ssh-host       default "chedam" (alias in ~/.ssh/config)
# Steps: copy files -> consistent DB backup -> sync into /opt/chedam -> Caddy config if changed -> restart
# -> health + migration check.
# Migrations run automatically when PocketBase starts.
set -euo pipefail

SAMPLE=0
HOST=chedam
for a in "$@"; do
  case "$a" in
    --sample-data) SAMPLE=1 ;;
    *) HOST="$a" ;;
  esac
done

HUB="$(cd "$(dirname "$0")/.." && pwd)"
STAGE=deploy-stage
TS=$(date -u +%Y%m%dT%H%M%SZ)

echo "== Build the client app (client/ -> hub/pb_public)"
ROOT_DIR="$(cd "$HUB/.." && pwd)"
[ -d "$ROOT_DIR/client/node_modules" ] || (cd "$ROOT_DIR/client" && npm ci --no-audit --no-fund)
(cd "$ROOT_DIR/client" && npm run build --silent)
[ -f "$HUB/pb_public/index.html" ] && [ -f "$HUB/pb_public/sw.js" ] || { echo "client build missing"; exit 1; }

echo "== Copy to $HOST:~/$STAGE"
ssh "$HOST" "rm -rf ~/$STAGE && mkdir -p ~/$STAGE/pb_migrations"
scp -q -r "$HUB/pb_hooks" "$HOST:$STAGE/"
scp -q -r "$HUB/pb_public" "$HOST:$STAGE/"
scp -q "$HUB"/pb_migrations/*.js "$HOST:$STAGE/pb_migrations/"
scp -q "$HUB/system/Caddyfile" "$HUB/system/chedam-console.path" "$HUB/system/chedam-console.service"   "$HUB/system/chedam-backup" "$HUB/system/chedam-backup.path" "$HUB/system/chedam-backup.service"   "$HUB/system/chedam-update" "$HUB/system/chedam-update.path" "$HUB/system/chedam-update.service"   "$HUB/system/update-signing.pub" "$HOST:$STAGE/"
echo "dev-$(git -C "$HUB" rev-parse --short HEAD)" > /tmp/chedam-version && scp -q /tmp/chedam-version "$HOST:$STAGE/VERSION"
if [ "$SAMPLE" -eq 1 ]; then
  scp -q "$HUB"/pb_migrations_dev/*.js "$HOST:$STAGE/pb_migrations/"
fi

ssh "$HOST" "SAMPLE=$SAMPLE TS=$TS STAGE=$STAGE bash -s" <<'REMOTE'
set -euo pipefail
ROOT=/opt/chedam
DB=$ROOT/pb_data/data.db
sudo install -d -m 750 -o chedam-hub -g chedam-hub $ROOT/backups

echo "== Backup before deploy"
if sudo test -f "$DB"; then
  # SQLite online backup: consistent even while PocketBase is running (WAL mode)
  sudo -u chedam-hub sqlite3 "$DB" ".backup '$ROOT/backups/pre-deploy-$TS.db'"
  sudo -u chedam-hub sqlite3 "$ROOT/backups/pre-deploy-$TS.db" "PRAGMA integrity_check;" | sed 's/^/integrity: /'
  # keep the 10 newest pre-deploy backups
  sudo bash -c "ls -1t $ROOT/backups/pre-deploy-*.db | tail -n +11 | xargs -r rm -f"
else
  echo "no database yet (first deploy)"
fi

echo "== Sync code"
EXCL=()
# Without --sample-data, keep any dev migrations already applied on this hub (never delete them)
[ "$SAMPLE" -eq 1 ] || EXCL=(--exclude '*_dev_*')
sudo rsync -a --delete --chown=chedam:chedam ~/"$STAGE"/pb_hooks/ $ROOT/pb_hooks/
sudo rsync -a --delete "${EXCL[@]}" --chown=chedam:chedam ~/"$STAGE"/pb_migrations/ $ROOT/pb_migrations/
if [ -d ~/"$STAGE"/pb_public ]; then
  sudo rsync -a --delete --chown=chedam:chedam ~/"$STAGE"/pb_public/ $ROOT/pb_public/
fi

echo "== Caddy config"
# Same IP as the running config (setup-hub.sh may have been given one); otherwise the first LAN address
HUB_IP=$(grep -oP '^chedam\.local, \K[0-9.]+' /etc/caddy/Caddyfile || hostname -I | awk '{print $1}')
sed "s/__HUB_IP__/$HUB_IP/g" ~/"$STAGE"/Caddyfile > ~/"$STAGE"/Caddyfile.rendered
if sudo cmp -s ~/"$STAGE"/Caddyfile.rendered /etc/caddy/Caddyfile; then
  echo "unchanged"
else
  caddy validate --config ~/"$STAGE"/Caddyfile.rendered --adapter caddyfile >/dev/null
  sudo cp /etc/caddy/Caddyfile "$ROOT/backups/Caddyfile.pre-deploy-$TS"
  sudo install -m 644 ~/"$STAGE"/Caddyfile.rendered /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  echo "updated for $HUB_IP and reloaded (previous copy in backups/)"
fi

echo "== Monitor message units"
changed=0
for u in chedam-console.path chedam-console.service; do
  sudo cmp -s ~/"$STAGE/$u" /etc/systemd/system/$u || { sudo install -m 644 ~/"$STAGE/$u" /etc/systemd/system/$u; changed=1; }
done
[ "$(readlink /etc/issue.d/chedam.issue)" = "$ROOT/pb_data/console.issue" ] || { sudo ln -sfn "$ROOT/pb_data/console.issue" /etc/issue.d/chedam.issue; changed=1; }
if [ "$changed" -eq 1 ]; then sudo systemctl daemon-reload; sudo systemctl enable --now chedam-console.path >/dev/null; echo "installed"; else echo "unchanged"; fi

echo "== Backup helper"
command -v age >/dev/null || { sudo apt-get install -y age >/dev/null && echo "installed age"; }
sudo install -d -m 750 -o chedam-hub -g chedam-hub $ROOT/pb_data/backup
changed=0
sudo cmp -s ~/"$STAGE/chedam-backup" $ROOT/bin/chedam-backup || { sudo install -m 755 -o root -g root ~/"$STAGE/chedam-backup" $ROOT/bin/chedam-backup; changed=1; }
for u in chedam-backup.path chedam-backup.service; do
  sudo cmp -s ~/"$STAGE/$u" /etc/systemd/system/$u || { sudo install -m 644 ~/"$STAGE/$u" /etc/systemd/system/$u; changed=1; }
done
if [ "$changed" -eq 1 ]; then sudo systemctl daemon-reload; sudo systemctl enable --now chedam-backup.path >/dev/null; echo "installed"; else echo "unchanged"; fi

echo "== Update helper and signing key"
sudo install -d -m 750 -o chedam-hub -g chedam-hub $ROOT/pb_data/update
sudo install -d -m 755 $ROOT/updates $ROOT/updates/inbox
sudo install -d -m 700 $ROOT/keys   # also holds the private backup key: root only
changed=0
sudo cmp -s ~/"$STAGE/chedam-update" $ROOT/bin/chedam-update || { sudo install -m 755 -o root -g root ~/"$STAGE/chedam-update" $ROOT/bin/chedam-update; changed=1; }
sudo cmp -s ~/"$STAGE/update-signing.pub" $ROOT/keys/update-signing.pub || { sudo install -m 644 -o root -g root ~/"$STAGE/update-signing.pub" $ROOT/keys/update-signing.pub; changed=1; }
for u in chedam-update.path chedam-update.service; do
  sudo cmp -s ~/"$STAGE/$u" /etc/systemd/system/$u || { sudo install -m 644 ~/"$STAGE/$u" /etc/systemd/system/$u; changed=1; }
done
if [ "$changed" -eq 1 ]; then sudo systemctl daemon-reload; sudo systemctl enable --now chedam-update.path >/dev/null; echo "installed"; else echo "unchanged"; fi
# A developer deploy is "dev-<commit>": any signed release counts as newer
sudo install -m 644 ~/"$STAGE/VERSION" $ROOT/VERSION
echo "version $(cat $ROOT/VERSION)"

echo "== Restart"
sudo systemctl restart chedam-hub
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:8090/api/health >/dev/null && break
  sleep 1
done
systemctl is-active chedam-hub
curl -s http://127.0.0.1:8090/api/health; echo

echo "== Applied migrations (newest 5)"
sudo -u chedam-hub sqlite3 "$DB" "SELECT file FROM _migrations ORDER BY applied DESC LIMIT 5;"
if sudo test -f "$ROOT/pb_data/setup-code"; then echo "== New hub: setup code $(sudo cat "$ROOT/pb_data/setup-code")"; fi
echo "== Recent errors"
sudo journalctl -u chedam-hub --since "-2min" --no-pager | grep -iE "error|fail|panic" || echo "none"
rm -rf ~/"$STAGE"
REMOTE

#!/usr/bin/env bash
# Chedam hub base setup (P0). Idempotent: safe to re-run after an IP change or on a fresh card.
# Usage (on the Pi, as a sudo user):  sudo bash setup-hub.sh [hub-ip] [--keep-display]
#   hub-ip          optional; default is the Pi's first address (hostname -I)
#   --keep-display  keep HDMI output working (skips the headless display/GPU tweaks below).
#                   Use it while a monitor is attached for debugging. Without it the hub runs
#                   headless (decision DL-24) and the HDMI screen goes dark after the next reboot.
# Expects in the same folder as this script: pocketbase (linux arm64 binary), ../system/*
# Tested on: Pi Zero 2 W, Raspberry Pi OS Lite 64-bit (Debian 13 trixie), 2026-10-03.
set -euo pipefail

KEEP_DISPLAY=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --keep-display) KEEP_DISPLAY=1 ;;
    *) ARGS+=("$a") ;;
  esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

HERE="$(cd "$(dirname "$0")" && pwd)"
SYS="$HERE/../system"
ROOT=/opt/chedam
SVC_USER=chedam-hub
DEV_USER="${SUDO_USER:-chedam}"
HUB_IP="${1:-$(hostname -I | awk '{print $1}')}"

log() { printf '\n== %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

log "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get -y install chrony sqlite3 ufw caddy avahi-daemon >/dev/null

log "Service user and folders ($ROOT)"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin "$SVC_USER"
install -d -m 755 -o root -g root "$ROOT" "$ROOT/bin"
install -d -m 750 -o "$SVC_USER" -g "$SVC_USER" "$ROOT/pb_data"
# Code folders: written by the dev user (later: by the update installer), read by the service
for d in pb_hooks pb_migrations pb_public; do
  install -d -m 755 -o "$DEV_USER" -g "$DEV_USER" "$ROOT/$d"
done
if [ -f "$HERE/pocketbase" ]; then
  install -m 755 -o root -g root "$HERE/pocketbase" "$ROOT/bin/pocketbase"
fi
[ -x "$ROOT/bin/pocketbase" ] || { echo "missing $ROOT/bin/pocketbase"; exit 1; }
[ -f "$ROOT/pb_public/index.html" ] || install -m 644 -o "$DEV_USER" -g "$DEV_USER" "$SYS/index.html" "$ROOT/pb_public/index.html"

log "PocketBase service"
install -m 644 "$SYS/chedam-hub.service" /etc/systemd/system/chedam-hub.service

log "Monitor message (setup code on a new hub, DL-44)"
install -m 644 "$SYS/chedam-console.path" "$SYS/chedam-console.service" /etc/systemd/system/
ln -sfn "$ROOT/pb_data/console.issue" /etc/issue.d/chedam.issue

log "HTTPS: Caddy with a per-store local CA (hostname chedam.local + IP $HUB_IP)"
sed "s/__HUB_IP__/$HUB_IP/g" "$SYS/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

log "Hardware watchdog, journald size, Wi-Fi power save off"
install -d /etc/systemd/system.conf.d /etc/systemd/journald.conf.d /etc/NetworkManager/conf.d
install -m 644 "$SYS/watchdog.conf" /etc/systemd/system.conf.d/chedam-watchdog.conf
install -m 644 "$SYS/journald.conf" /etc/systemd/journald.conf.d/chedam.conf
install -m 644 "$SYS/wifi-powersave-off.conf" /etc/NetworkManager/conf.d/chedam-wifi-powersave-off.conf

log "Boot config (display mode, audio, camera, Bluetooth)"
CFG=/boot/firmware/config.txt
cp -n "$CFG" "$CFG.chedam-orig" || true
# Always: audio, camera detection and Bluetooth off
sed -i -e 's/^dtparam=audio=on/dtparam=audio=off/' \
       -e 's/^camera_auto_detect=1/camera_auto_detect=0/' "$CFG"
# Re-running switches modes in both directions: drop any earlier chedam block, then write the current one.
sed -i -e '/^# chedam-begin$/,/^# chedam-end$/d' -e '/^# chedam$/d' -e '/^gpu_mem=16$/d' -e '/^dtoverlay=disable-bt$/d' "$CFG"
if [ "$KEEP_DISPLAY" -eq 1 ]; then
  # Monitor attached: display driver (vc4-kms-v3d) and display detection on. Costs ~50 MB RAM on the Zero 2 W.
  # A blank screen on the Zero 2 W ("vc4-drm: Cannot find any crtc or sizes" in dmesg) is fixed by
  # forcing the output in /boot/firmware/cmdline.txt (single line): video=HDMI-A-1:1280x720@60D
  echo "--keep-display: HDMI output on"
  sed -i -e 's/^display_auto_detect=0/display_auto_detect=1/' \
         -e 's/^#dtoverlay=vc4-kms-v3d  # chedam: headless/dtoverlay=vc4-kms-v3d/' "$CFG"
  printf '# chedam-begin\n[all]\ndtoverlay=disable-bt\n# chedam-end\n' >> "$CFG"
else
  # Headless (DL-24): display driver and detection off, minimum GPU memory. HDMI goes dark.
  sed -i -e 's/^display_auto_detect=1/display_auto_detect=0/' \
         -e 's/^dtoverlay=vc4-kms-v3d$/#dtoverlay=vc4-kms-v3d  # chedam: headless/' "$CFG"
  printf '# chedam-begin\n[all]\ngpu_mem=16\ndtoverlay=disable-bt\n# chedam-end\n' >> "$CFG"
fi
systemctl disable --now hciuart.service bluetooth.service 2>/dev/null || true

log "Firewall: SSH, HTTP (cert download + redirect), HTTPS, mDNS"
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 5353/udp >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null

log "Start services"
systemctl daemon-reload
systemctl enable --now chrony avahi-daemon >/dev/null
systemctl enable chedam-hub caddy >/dev/null
systemctl enable --now chedam-console.path >/dev/null
systemctl restart chedam-hub caddy
systemctl restart systemd-journald

log "Status"
systemctl is-active chedam-hub caddy chrony avahi-daemon | paste -sd' '
echo "Hub:   https://chedam.local   https://$HUB_IP"
echo "CA:    http://chedam.local/ca.crt   (install on each device)"
echo "Reboot needed once for boot-config and watchdog changes."
[ "$KEEP_DISPLAY" -eq 1 ] || echo "Headless mode: HDMI output stops after the reboot (re-run with --keep-display to keep it)."
# A new hub (no owner yet) has a one-time setup code for the first device (DL-44)
for i in $(seq 1 30); do [ -f "$ROOT/pb_data/setup-code" ] && break; curl -sf http://127.0.0.1:8090/api/chedam/setup/status >/dev/null; sleep 1; done
if [ -f "$ROOT/pb_data/setup-code" ]; then
  echo "Setup code for the first device: $(cat "$ROOT/pb_data/setup-code")   (open https://$HUB_IP)"
fi

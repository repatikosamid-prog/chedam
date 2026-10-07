#!/usr/bin/env bash
# Network receipt printers (P1 step 5, FR-1.11), run by the hub (lib/printing.js) with plain arguments.
# Receipt printers take ESC/POS bytes on raw TCP port 9100.
#   printer.sh send HOST PORT FILE   send the bytes in FILE; exit 1 if the printer does not take them in 6 s
#   printer.sh scan [PORT]           the hosts on the hub's network (/24) with PORT (9100) open, one a line
# CHEDAM_SCAN_HOSTS (tests): scan these hosts instead of the hub's network.
set -u
case "${1:-}" in
  send)
    timeout 6 bash -c 'exec 3<>"/dev/tcp/$1/$2" && cat "$3" >&3' _ "$2" "$3" "$4" 2>/dev/null \
      || { echo "The printer at $2:$3 did not answer." >&2; exit 1; }
    ;;
  scan)
    port="${2:-9100}"
    if [ -n "${CHEDAM_SCAN_HOSTS:-}" ]; then
      hosts="$CHEDAM_SCAN_HOSTS"
    else
      me=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | head -1)   # e.g. 192.168.50.101/24
      [ -n "$me" ] || exit 0
      net=${me%/*}; net=${net%.*}
      hosts=$(seq -f "$net.%g" 1 254)
    fi
    # 32 at a time: the Pi Zero has little memory.
    n=0
    for h in $hosts; do
      ( timeout 1 bash -c 'exec 3<>"/dev/tcp/$1/$2"' _ "$h" "$port" 2>/dev/null && echo "$h" ) &
      n=$((n + 1))
      [ $((n % 32)) -eq 0 ] && wait
    done
    wait
    ;;
  *)
    echo "usage: printer.sh send HOST PORT FILE | scan [PORT]" >&2
    exit 2
    ;;
esac

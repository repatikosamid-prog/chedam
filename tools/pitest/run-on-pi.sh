#!/usr/bin/env bash
# Runs hub test suites on the Pi itself (2026-10-09): for each suite a FRESH throwaway hub is started on the
# Pi with tools/loadtest/pi-loadtest.sh (the Pi's PocketBase, the deployed hooks and migrations, the sample
# store, its own data folder on 127.0.0.1:8099; never the store's hub), reached through an SSH tunnel on
# 127.0.0.1:18099, and the suite runs from this PC in remote mode (hub/tests/lib/hub.mjs). Deploy first.
# Suites that need a hub started their own way stay on the PC: step2 (CLI), step6 (no sample data),
# step7 (backup helper), step9 (updates), step10 (rate limits: tunnel traffic is local), step12 (no sample
# stock), step15 (fake printer).
#   bash tools/pitest/run-on-pi.sh [suite ...]      (default: the list below)
set -uo pipefail
cd "$(dirname "$0")/../.."
SUITES=("$@")
[ ${#SUITES[@]} -eq 0 ] && SUITES=(step3-access step3b-temp-pin step4-devices step5-status step8-health step11-catalogue step13-sales step13a-pricing
  step14-offline step16-returns step17-labels step18-import-export step19-reports step20-feedback step21-promotions step22-markdowns-staff
  step23-customers-loyalty)

SOCK="${TMPDIR:-/tmp}/chedam-pitest-$$"
ssh -f -N -M -S "$SOCK" -o ExitOnForwardFailure=yes -L 18099:127.0.0.1:8099 chedam || { echo "tunnel failed"; exit 1; }
trap 'ssh -S "$SOCK" -O exit chedam 2>/dev/null; ssh chedam "bash -s stop" < tools/loadtest/pi-loadtest.sh >/dev/null' EXIT

bad=0
for s in "${SUITES[@]}"; do
  ssh chedam 'bash -s start' < tools/loadtest/pi-loadtest.sh >/dev/null || { echo "FAIL  $s  (test hub did not start)"; bad=$((bad+1)); continue; }
  TOKEN=$(ssh chedam 'cat /tmp/chedam-loadtest-token')
  out=$(CHEDAM_TEST_REMOTE=http://127.0.0.1:18099 CHEDAM_TEST_SU_TOKEN="$TOKEN" node "hub/tests/$s.test.mjs" 2>&1)
  sum=$(echo "$out" | grep -oE "[0-9]+ passed, [0-9]+ failed" | tail -1)
  if echo "$sum" | grep -q " 0 failed"; then echo "PASS  $s  ($sum)"; else echo "FAIL  $s  (${sum:-no summary})"; echo "$out" | grep -E "FAIL|ERROR|└" | head -15; bad=$((bad+1)); fi
done
echo "Pi memory of the last test hub:"; ssh chedam 'bash -s report' < tools/loadtest/pi-loadtest.sh 2>/dev/null | head -3
exit $bad

#!/usr/bin/env bash
# Local development hub on http://127.0.0.1:8095 with the sample store (dev migrations included),
# serving the built app from hub/pb_public. Data lives in .devhub/ (gitignored); --fresh starts over.
# Used by the browser preview (.claude/launch.json "devhub"). Never for a store.
#   bash tools/devhub/dev-hub.sh [--fresh]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PB="${PB_BIN:-/c/Tools/pocketbase.exe}"
DEV="$ROOT/.devhub"
[ "${1:-}" = "--fresh" ] && rm -rf "$DEV"
mkdir -p "$DEV/pb_migrations"
rm -f "$DEV"/pb_migrations/*.js
cp "$ROOT"/hub/pb_migrations/*.js "$ROOT"/hub/pb_migrations_dev/*.js "$DEV/pb_migrations/"
[ -f "$ROOT/hub/pb_public/index.html" ] || (cd "$ROOT/client" && npm run build --silent)
ARGS=(--dir="$DEV/pb_data" --migrationsDir="$DEV/pb_migrations" --hooksDir="$ROOT/hub/pb_hooks")
# A dev superuser (random password in .devhub/superuser.txt) to make pairing codes for test browsers.
if [ ! -f "$DEV/superuser.txt" ]; then
  "$PB" migrate up "${ARGS[@]}" >/dev/null
  PW="Dev$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
  "$PB" superuser upsert dev@chedam.test "$PW" "${ARGS[@]}" >/dev/null
  printf '%s\n%s\n' dev@chedam.test "$PW" > "$DEV/superuser.txt"
fi
exec "$PB" serve --dev=false --http=127.0.0.1:8095 "${ARGS[@]}" --publicDir="$ROOT/hub/pb_public"

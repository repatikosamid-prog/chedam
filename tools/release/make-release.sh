#!/usr/bin/env bash
# Build and sign a Chedam app update package (P0 step 9, FR-12.02, DL-55..58).
#   bash tools/release/make-release.sh [--notes "text"] [--publish]
# Output: releases/<version>/ (git-ignored): chedam-app-<version>.tar.gz + .sig, and an updated, signed
# channel file in the local clone of the public repo (../chedam-releases next to this project).
# --publish also commits and pushes that clone (public!). Without it nothing leaves this PC.
#
# Package = manifest.json + pb_hooks/ + pb_migrations/ (never the dev sample data) + pb_public/ (built app).
# Signature = Ed25519 (OpenSSL) over the whole file, key outside the repo: ~/.chedam/update-signing.key.
# The hub checks it with hub/system/update-signing.pub before installing anything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KEY="${CHEDAM_SIGNING_KEY:-$HOME/.chedam/update-signing.key}"
PUB="$ROOT/hub/system/update-signing.pub"
CHANNEL_REPO="${CHEDAM_RELEASES_REPO:-$ROOT/../chedam-releases}"
NOTES=""
PUBLISH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --notes) NOTES="$2"; shift 2 ;;
    --publish) PUBLISH=1; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done

[ -f "$KEY" ] || { echo "Signing key not found: $KEY"; exit 1; }
# (relative path: on Windows, Node cannot resolve Git Bash paths written inside a script)
VER=$(cd "$ROOT/client" && node -p "require('./package.json').version")
NAME="chedam-app-$VER.tar.gz"
OUT="$ROOT/releases/$VER"
STAGE="$OUT/stage"
echo "== Chedam app $VER"

echo "== Build the app"
(cd "$ROOT/client" && npm run build --silent)

echo "== Stage"
rm -rf "$OUT" && mkdir -p "$STAGE/pb_migrations"
cp -r "$ROOT/hub/pb_hooks" "$ROOT/hub/pb_public" "$STAGE/"
cp "$ROOT"/hub/pb_migrations/*.js "$STAGE/pb_migrations/"
if ls "$STAGE"/pb_migrations/*_dev_* >/dev/null 2>&1; then echo "dev migration in package"; exit 1; fi
MIGRATIONS=$(cd "$STAGE/pb_migrations" && ls *.js | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8").trim().split("\n")))')
COMMIT=$(git -C "$ROOT" rev-parse --short HEAD)
DIRTY=$(git -C "$ROOT" status --porcelain | grep -v '^?? releases/' | head -1 || true)
[ -z "$DIRTY" ] || echo "note: the working tree has uncommitted changes; the package is built from them"
node -e '
const [ver, notes, commit, migs] = process.argv.slice(1);
const m = { format: 1, kind: "app", version: ver, created_at: new Date().toISOString(), commit,
  notes: notes || "", migrations: JSON.parse(migs), contents: ["pb_hooks", "pb_migrations", "pb_public"] };
require("fs").writeFileSync(process.argv[5], JSON.stringify(m, null, 2) + "\n");
' "$VER" "$NOTES" "$COMMIT" "$MIGRATIONS" "$STAGE/manifest.json"

echo "== Pack and sign"
tar -czf "$OUT/$NAME" -C "$STAGE" manifest.json pb_hooks pb_migrations pb_public
openssl pkeyutl -sign -rawin -inkey "$KEY" -in "$OUT/$NAME" -out "$OUT/$NAME.sig"
openssl pkeyutl -verify -pubin -inkey "$PUB" -rawin -in "$OUT/$NAME" -sigfile "$OUT/$NAME.sig" >/dev/null \
  || { echo "signature check against the repo's public key FAILED"; exit 1; }
SHA=$(sha256sum "$OUT/$NAME" | cut -d" " -f1)
SIZE=$(stat -c %s "$OUT/$NAME")
rm -rf "$STAGE"
echo "   $NAME  $SIZE bytes  sha256 $SHA  signature ok"

echo "== Channel file"
mkdir -p "$CHANNEL_REPO/stable" "$CHANNEL_REPO/packages"
# Signed files must reach GitHub byte for byte: no line-ending conversion in the channel repo
grep -qx '\* -text' "$CHANNEL_REPO/.gitattributes" 2>/dev/null || { echo "missing '* -text' in $CHANNEL_REPO/.gitattributes"; exit 1; }
cp "$OUT/$NAME" "$OUT/$NAME.sig" "$CHANNEL_REPO/packages/"
node -e '
const fs = require("fs");
const [file, ver, name, sha, size, notes] = process.argv.slice(1);
let ch = { channel: "stable", updated_at: "", app: null, history: [] };
try { ch = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { /* first release */ }
const entry = { version: ver, file: "packages/" + name, sha256: sha, size: Number(size), notes: notes || "", published_at: new Date().toISOString() };
ch.history = [entry].concat((ch.history || []).filter((h) => h.version !== ver)).slice(0, 20);
ch.app = entry;
ch.updated_at = entry.published_at;
fs.writeFileSync(file, JSON.stringify(ch, null, 2) + "\n");
' "$CHANNEL_REPO/stable/channel.json" "$VER" "$NAME" "$SHA" "$SIZE" "$NOTES"
openssl pkeyutl -sign -rawin -inkey "$KEY" -in "$CHANNEL_REPO/stable/channel.json" -out "$CHANNEL_REPO/stable/channel.json.sig"
echo "   $CHANNEL_REPO/stable/channel.json (signed)"

if [ "$PUBLISH" -eq 1 ]; then
  echo "== Publish (public repo)"
  git -C "$CHANNEL_REPO" add stable packages
  git -C "$CHANNEL_REPO" commit -q -m "Chedam app $VER"
  git -C "$CHANNEL_REPO" push -q origin HEAD:main
  echo "   pushed"
else
  echo "== Not published (add --publish to push $CHANNEL_REPO)"
fi

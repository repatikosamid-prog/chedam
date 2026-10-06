# Updates (P0 step 9)

FR-12.02 (signed packages, install outside trading hours with backup and rollback), FR-12.04 (USB update package), NFR-20 (automatic rollback).

## Pieces

| Piece | Where | Role |
| --- | --- | --- |
| Signing key | `~/.chedam/update-signing.key` on Sreya's PC, **outside the repo**, readable only by her Windows account | Signs packages and the channel file (Ed25519, OpenSSL) |
| Public key | `hub/system/update-signing.pub` → `/opt/chedam/keys/update-signing.pub` | The hub accepts only packages this key verifies |
| Release script | `tools/release/make-release.sh` | Builds the app, packs `manifest.json` + `pb_hooks` + `pb_migrations` (never the dev sample data) + `pb_public`, signs, updates `stable/channel.json` (signed) in the local clone `../chedam-releases` |
| Update channel | public repo `repatikosamid-prog/chedam-releases` (DL-54): `stable/channel.json(.sig)`, `packages/chedam-app-<version>.tar.gz(.sig)` | Hubs download from `raw.githubusercontent.com` |
| Installer | `/opt/chedam/bin/chedam-update` (root), asked by the hub through `pb_data/update/request.json` | Check, USB scan, install, automatic rollback |
| Hub | `lib/updates.js`, `updates.pb.js` | Records, schedule, results, tasks; daily check when online |
| App | Updates screen (owner installs; managers can look) | Check online / USB, install now or tonight |

## Make a release

1. Raise the version in `client/package.json` (for example `0.9.1`). Commit.
2. Build and sign (stays on the PC):
   ```
   bash tools/release/make-release.sh --notes "What changed, in plain words"
   ```
3. Publish to the public repo (hubs see it at their next daily check, or with "Check online"):
   ```
   bash tools/release/make-release.sh --notes "..." --publish
   ```
   Packages are public. Never put secrets in hooks, migrations or the app (dev sample data is excluded automatically).

## How a hub installs

1. **Find:** the hub checks once a day when online (or "Check online"). The channel file and package must both carry valid signatures, and the package must match the channel's checksum. Only then is it kept in `/opt/chedam/updates/packages`. From a USB stick, the package and its `.sig` go in a folder named `chedam-update/` ("Check USB stick"). A technician can also copy them into `/opt/chedam/updates/inbox`.
2. **Install:** "Install now" (owner), or "Install tonight", which runs inside `updates.install_window` (02:00–05:00).
3. **Steps:**
   1. Check the signature again.
   2. Take a database snapshot (`/opt/chedam/backups/pre-update-<version>-<time>.db`, integrity-checked) and copy the current code.
   3. Stop the hub, put the new code in place (dev sample migrations already applied are kept), write `/opt/chedam/VERSION`, start the hub.
4. **Healthy?** Health answers 200, no "failed to apply migration", panic or crash in the hub's log (read from a journal cursor, so only new lines count), and every migration the package lists has been applied.
5. **Not healthy: automatic rollback.** The old code and the database snapshot are put back and the hub starts again. The update is marked "rolled back" and an urgent task appears. If even the rollback does not start, the task says "restore from backup" (`docs/P0-backup-restore.md`).

## Measured on the dev hub (Pi Zero 2 W, 2026-10-05)

| Test | Result |
| --- | --- |
| Install 0.9.0 (118 KB) from the inbox | 1.7 s install (3 s end to end); data unchanged; app build 0.9.0 served |
| Broken 0.9.1 (signed, migration fails on purpose) | Rolled back in **4 s**; version 0.9.0; data and integrity unchanged; broken migration never applied |
| Tampered package (1 byte added) | Refused: signature does not match; nothing changed |

## Not in P0

- Packages for tax tables, datasets and the OS (FR-12.03) are refused as "not supported yet". Tax tables arrive with selling (P1); their packages will carry `effective_at`.
- No manual rollback to an older version once an update has run for a while: rolling back the database would lose sales. A bad version is fixed by a newer release, or as a last resort by a restore.
- PocketBase, Caddy and system packages are updated by the setup and deploy scripts, not by app packages.

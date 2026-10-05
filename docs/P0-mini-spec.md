# P0 Foundation: mini-spec

Baseline: Master Specification v1.0. Status: draft, 2026-10-02.

## Goal

A hub that stays up, can be reached safely by any device, is backed up, and can be updated and rolled back, plus the setup wizard that turns it into "a store".

**Done when** (Section 13): 3 devices log in (Windows PC, Android 9, iPhone 13 Pro / iOS 26), the hub survives a power pull, an update installs and rolls back. Phase gate items also apply.

## Build order

| Step | Delivers | Requirements |
| --- | --- | --- |
| 1. Hub base ✅ 2026-10-05 | OS hardening, PocketBase service, HTTPS (per-store CA), mDNS, chrony, watchdog, firewall, auto-restart | NFR-08, 09, 11, 19; hub plumbing |
| 2. Schema v1 + event log ✅ 2026-10-05 | `business`, `location`, `settings`, `modules`, `users`, `roles`, `permissions`, `permission_overrides`, `devices`, `storage_areas`, `tasks` (minimal, for skipped steps), `events`, `backups`, `updates`. Common fields on every table; a hook writes an `events` row on every create/update/delete | Section 10, NFR-20 |
| 3. Access ✅ 2026-10-05 | Role templates (Owner, Manager, Cashier, Staff, Accountant), per-person overrides with end date, "Who can do this?", PIN login + lockout after 5 tries, auto-lock, manager-can't-exceed-own-rights (BR-33) | FR-1.03, 1.04, 1.09, 1.10, NFR-11 |
| 4. Devices 🔶 built, tested, deployed 2026-10-05 (real phone pairing pending) | Pairing by code/QR; certificate install guide (iOS trust toggle, Android user CA, IP fallback for Android 9); device manager (status, user, version, lock, log out, rename, revoke, approve) | FR-1.07, 1.08 |
| 5. Client shell 🔶 built, tested, deployed 2026-10-05 (phone install pending) | Svelte PWA: install, offline shell, connectivity bar, login, owner on any device | FR-1.09, 12.01, NFR-16/17 |
| 6. Setup wizard | Language, hub time check, business profile, branding (logo, colours from logo, receipt header/footer preview), owner account + printed recovery code, people, storage areas, shop-type preset + module switches, optional external references, backup; resumable, skipped steps become tasks | FR-1.01-1.06, 1.13, 1.15 |
| 7. Backups | USB backup (SQLite online backup, verify, retention 14/8/12), schedule, first backup in wizard, restore procedure to spare card; encrypted cloud copy (Google Drive or OneDrive) once client IDs are provided | FR-1.14, 12.08, NFR-03, 04 |
| 8. Health page | Uptime, temperature, RAM, disk, last backup, clock source, devices online, queue backlog, versions, pending updates | FR-12.09 |
| 9. Updates | Signed packages (minisign), published to the public `chedam-updates` repo; download when online or from USB; install outside trading hours with backup first and automatic rollback; tax-table packages switch on at effective date | FR-12.01-12.04, NFR-20 |
| 10. Gate tests | 3-device login, power pull mid-write (x10), update + rollback, backup + restore to spare card, memory < 150 MB under load (R6), iOS/Android camera over HTTPS (R5) | Section 13 gate |

## Decisions made in P0 (to add to the Decision log)

| ID | Decision |
| --- | --- |
| DL-21 | HTTPS via Caddy with its internal CA generated **on each hub** (one CA per store, never shared). mkcert stays a developer-PC tool only. Certificate covers `chedam.local` and the hub IP |
| DL-22 | Source repo stays private; signed update packages are published to a separate public repo `chedam-updates` (GitHub Releases) |
| DL-23 | RTC (DS3231) deferred to the pilot build; dev hub uses network time via chrony. Health page reports clock source |
| DL-24 | Display is a switch, not a fixed choice: `setup-hub.sh --keep-display` keeps HDMI on (the dev/pilot default, so the hub can be operated with a monitor and keyboard); without the flag the hub runs headless and saves about 50 MB of RAM. Re-running the script switches either way. Audio, camera detection and Bluetooth are always off. Pi 4 production hubs plan to use the display for direct operation |
| DL-25 | PocketBase extended with JavaScript hooks (`pb_hooks`), no Go build, so one binary serves Pi and mini PC (NFR-19) |
| DL-26 | Event log written in the same transaction as each change (rolls back together); append-only even for superusers; actor and device stamped by the hub from the request, never trusted from the client |
| DL-27 | Dev sample data lives in `hub/pb_migrations_dev/` and is deployed only with `deploy.sh --sample-data` |
| DL-28 | Sign-in = pick your name, then PIN (4-6 digits; repeated digits and straight runs refused). PINs need not be unique. PINs and the owner recovery code are bcrypt password fields (hidden). Sign-in takes about 0.5 s on the Pi Zero |
| DL-29 | Lockout (NFR-11) counts wrong PINs, passwords and recovery codes together: 5 tries, then 15 minutes (owner settings). Someone with users.manage who is above the locked person can unlock them early |
| DL-30 | Permission checks run in one hook library (`lib/access.js`). The API rules only require an active Chedam user. Tables not listed in the access map are refused. Owner = every permission, including ones added by later phases |
| DL-31 | BR-33 applies to people, roles and overrides: non-owners act only on people and roles below their level, never on themselves, and never grant permissions they lack. Owner-only permissions are granted only by the owner |
| DL-32 | Auth tokens last 12 h. Suspending or removing someone signs them out everywhere. Idle auto-lock is done in the client (step 5). The PIN name list is open on the LAN until step 4 limits it to paired devices |
| DL-33 | A device proves itself on every request with `X-Chedam-Device` + `X-Chedam-Device-Key`. The key (48 random characters) is given once at pairing and stored as SHA-256 (a long random secret needs no bcrypt, and every request stays fast on the Pi). A wrong key or a removed device gets 401; the event log stamps only verified devices |
| DL-34 | Pairing: a manager (devices.manage) makes a one-time code `XXXX-XXXX`, valid 10 minutes, also shown as a QR code that opens the certificate guide over HTTP with the hub IP (Android 9). Using the code approves the device. A device without a code may ask to join and waits for approval (at most 10 open requests). 20 wrong codes in 10 minutes pause pairing |
| DL-35 | Only the owner signs in on any device (FR-1.09). Everyone else, and the PIN name list, need an approved device. A device assigned to a person lists only that person and the owner |
| DL-36 | One person per device: signing in on a device replaces whoever was signed in there, and their token stops working on that device. Tokens cannot move between devices. Device "sign out" uses this |
| DL-37 | Device manager actions: approve, lock (refuses everything except its own status check), unlock, sign out, rename/type/assign (generic API, BR-33 on the assigned person), remove (revoke: key erased, must pair again). Nobody can lock or remove the device they are using |
| DL-38 | "Online" = reached the hub in the last 2 minutes, kept in memory; `last_seen_at` is written at most every 30 minutes (or when the app version or browser changes), so the event log is not flooded |
| DL-39 | **Forgot PIN** (Sreya): a manager (users.manage, above the person) sets a **temporary PIN**. It works for 24 h (`security.temp_pin_hours`) and only to sign in: the hub refuses everything else until the person chooses their own new PIN, which must differ from the temporary one. The owner can still use password or recovery code |
| DL-40 | Client = Svelte 5 + Tailwind 4 + Vite, a plain single-page app (no SvelteKit) built into `hub/pb_public` by `deploy.sh`. Build output is not committed. Exact versions pinned in `client/package-lock.json` |
| DL-41 | Offline shell: a hand-written service worker (generated at build with the exact file list) caches the app files at install; the API is never cached by it. Offline data and the sales queue come with Dexie in later phases. Cache look-ups ignore `Vary` (the hub sends `Vary: Origin`) |
| DL-42 | Connectivity (FR-12.01): the hub checks `network.check_url` (Cloudflare's 204 check, nothing personal sent) once a minute. Online (hotspot) = the hub's current Wi-Fi name is in `network.hotspot_ssids`; otherwise Online (router). The bar also shows "Hub not reachable" and warns when the device clock is 2+ minutes off the hub's |
| DL-43 | Idle auto-lock: after `security.auto_lock_minutes` without a tap or key, the person is signed out on that device and the name list returns. Large text and high contrast are per-person settings (NFR-16/17); touch targets are at least 48 px |

## Open items to discuss

- None open. (Forgot PIN was decided on 2026-10-05, DL-39.)

## Notes and risks found during setup

- **Android 9 cannot resolve `.local` names**, so it must reach the hub by IP. The hub needs a fixed IP (router DHCP reservation), and the pairing QR code must carry the IP. The TELUS modem doesn't allow reservations, so the dev hub sits behind our own LAN-cabled router (2026-10-03, see `P0-restart-new-network.md`).
- Android 9's Chrome no longer receives updates (I believe 138 was the last version). Treat that phone as the worst-case browser test.
- Caddy's hub certificates last 12 hours and renew automatically, so they depend on a correct clock. Without an RTC, a hub that boots offline after a power cut starts with a stale clock. Certificate validity and the BR-30 time rules both depend on the clock, which makes the RTC a hard requirement for the pilot (DL-23).
- If the hub IP changes, re-run `setup-hub.sh` so the certificate covers the new IP.
- Windows `curl` (Schannel) fails revocation checks on the private CA. Use `--ssl-no-revoke` for command-line tests; browsers are unaffected.
- Windows mDNS lookup is unreliable from some tools. Developer SSH uses the `chedam` alias pointing at the IP.

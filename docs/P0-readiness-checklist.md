# P0 Foundation: readiness checklist

Source: Chedam Master Specification v1.0, Sections 7, 11, 12, 13. Versions checked 2026-10-02.

## 1. What P0 must deliver

| ID | Requirement |
| --- | --- |
| FR-1.01 | First-start wizard: language, hub date/time check, business profile |
| FR-1.02 | Branding: logo, colours from logo, receipt header/footer, preview |
| FR-1.03 | Owner account: password, PIN, printed recovery code |
| FR-1.04 | Managers and staff: role, PIN, contact, optional pay details |
| FR-1.05 | Storage areas with temperature ranges |
| FR-1.06 | Shop-type presets; modules on/off (hide, never delete) |
| FR-1.07 | Device pairing by code/QR, trusted-certificate install guide for phones |
| FR-1.08 | Device manager: status, user, version; lock, log out, rename, revoke, approve |
| FR-1.09 | Owner logs in on any device |
| FR-1.10 | Role templates + per-person overrides with end date; "Who can do this?" |
| FR-1.13 | Optional external references (bank, merchant ID, CRA, CBSA, accountant) |
| FR-1.14 | Backup setup: USB drive, schedule, first backup; optional cloud copy |
| FR-1.15 | Wizard resumable; skipped steps become tasks; re-runnable, never wipes |
| FR-12.01 | Connectivity status: Offline / Online (router) / Online (hotspot) |
| FR-12.02 | Update channel: signed packages, install off-hours, backup + rollback |
| FR-12.03 | Tax table updates switch on at effective date |
| FR-12.04 | USB update package |
| FR-12.08 | Encrypted off-site backup to owner's cloud drive |
| FR-12.09 | Health page: uptime, temp, RAM, disk, backup, clock, devices, versions |

Hub plumbing: PocketBase + SQLite (WAL), HTTPS with local CA, `chedam.local` via mDNS, chrony + RTC, systemd restart, hardware watchdog, event log on every write.

**Done when:** 3 devices log in, the hub survives a power pull, an update installs and rolls back.
Also from the phase gate and risks: hub memory < 150 MB (NFR-08), load test on the Pi Zero (R6), camera/HTTPS tested on iOS and Android (R5), backup **and restore** verified (NFR-03).

## 2. Hardware

| # | Item | Needed for | Status |
| --- | --- | --- | --- |
| H1 | Raspberry Pi Zero 2 W | Hub | Owned |
| H2 | microSD card, 32-64 GB, ideally high-endurance (SanDisk High Endurance / Samsung PRO Endurance) | Hub OS + data | Owned (check size/brand) |
| H3 | Second microSD card (any 16 GB+) | Restore test (NFR-03), rollback testing | To get |
| H4 | microSD card reader for the PC (USB or built-in slot) | Flashing the OS | Check |
| H5 | Power supply 5 V 2.5 A micro-USB (official Pi supply recommended) | Stable hub; power-pull test | Owned cable; a weak phone charger causes brown-outs |
| H6 | USB OTG adapter (micro-USB male to USB-A female) | Plugging a USB drive into the Pi | To get |
| H7 | USB flash drive, 16-32 GB | FR-1.14 USB backups, FR-12.04 USB update package | To get / spare |
| H8 | DS3231 RTC module + 2x20 GPIO header (soldered, or buy the Pi Zero 2 **WH** with header) | Clock without internet (NFR-10). Optional in dev, see question Q1 | Decide |
| H9 | Mini-HDMI to HDMI cable + USB keyboard | Only if headless SSH setup fails. Note: Zero 2 W is **mini**-HDMI, not micro-HDMI as the spec says | Owned, working (needed the `video=` fix, see `P0-restart-new-network.md`) |
| H10 | Own router (LAN-cabled to the bedroom port) with a **2.4 GHz** network and admin access for DHCP reservations. TELUS modem has no admin access, see `P0-restart-new-network.md` | Pi Zero 2 W has no 5 GHz; fixed hub IP | Owned |
| H11 | 3 test devices: Windows PC + one Android phone + one iPhone | "3 devices log in"; R5 certificate/camera test | Check |

Not needed in P0: printer, scanner, cash drawer, scale, card terminal, UPS (pilot only).

## 3. Software on the Windows PC

Already installed: Git 2.52, VS Code 1.135, Python 3.13, Windows OpenSSH. Missing items below.

Make one folder for standalone tools, `C:\Tools`, and add it to your user PATH
(Start → "Edit environment variables for your account" → Path → Edit → New → `C:\Tools`).

| # | Software | Version | Download | Install notes |
| --- | --- | --- | --- | --- |
| S1 | Node.js | **24 LTS (Krypton)**, latest 24.x | https://nodejs.org/en/download | Windows Installer (.msi), x64. Keep "Add to PATH" ticked. **Untick** "Automatically install the necessary tools" (Chocolatey, not needed). Check: `node -v`, `npm -v` |
| S2 | PocketBase (Windows) | **v0.40.4** | https://github.com/pocketbase/pocketbase/releases/tag/v0.40.4 → `pocketbase_0.40.4_windows_amd64.zip` | Unzip `pocketbase.exe` into `C:\Tools`. Check: `pocketbase --version`. The Pi build (`linux_arm64`) I will download on the Pi. |
| S3 | mkcert | **v1.4.4** | https://github.com/FiloSottile/mkcert/releases/tag/v1.4.4 → `mkcert-v1.4.4-windows-amd64.exe` | Rename to `mkcert.exe`, put in `C:\Tools`. Then run `mkcert -install` yourself and click **Yes** on the Windows security prompt (adds a local dev CA to your trust store). |
| S4 | Raspberry Pi Imager | **v2.0.11.1** | https://www.raspberrypi.com/software/ | Default install. Steps for flashing in section 4. |
| S5 | DB Browser for SQLite | **3.13.1** | https://sqlitebrowser.org/dl/ → `DB.Browser.for.SQLite-v3.13.1-win64.msi` | Default install; tick a Start-menu shortcut. |
| S6 | DuckDB CLI | **1.5.6** | https://duckdb.org/install → Windows CLI zip (`duckdb_cli-windows-amd64.zip`) | Unzip `duckdb.exe` into `C:\Tools`. Only used from P1, fine to install now. |
| S7 | GitHub CLI (optional) | latest | https://cli.github.com | Default install, then `gh auth login`. Lets me open releases/PRs for the update channel. |
| S8 | VS Code extensions | latest | Extensions panel | Svelte for VS Code, Tailwind CSS IntelliSense, ESLint, Prettier, Remote - SSH (optional, edit files on the Pi). |

Not needed: Go (we extend PocketBase with JavaScript hooks in `pb_hooks`, no Go build). Svelte, Vite, Tailwind, Dexie, ECharts are npm packages; I install them in the project.

## 4. Preparing the Pi (headless)

1. Create an SSH key on the PC (PowerShell): `ssh-keygen -t ed25519 -C "chedam-dev"` → press Enter for the default path, set a passphrase or leave empty.
2. Put the microSD in the reader, open Raspberry Pi Imager.
3. **Device:** Raspberry Pi Zero 2 W. **OS:** Raspberry Pi OS (other) → **Raspberry Pi OS Lite (64-bit)**. **Storage:** the SD card (double-check it is not your USB drive).
4. Customisation:
   - Hostname: `chedam`
   - Username: `chedam`, password of your choice (keep it to yourself; I will use the SSH key)
   - Wi-Fi: the **new router's 2.4 GHz** SSID and password (not TELUS), Wireless LAN country **CA**
   - Locale: time zone `America/Vancouver`, keyboard `us`
   - Services: enable SSH → "Allow public-key authentication only" → paste the contents of `C:\Users\Venkata\.ssh\id_ed25519.pub`
   - Raspberry Pi Connect: leave off
5. Write, wait for verify, eject, insert into the Pi, power on. First boot takes 3-5 minutes.
6. Test from PowerShell: `ping chedam.local` then `ssh chedam@chedam.local`. If `chedam.local` does not resolve, find the Pi's IP in the new router's device list and give it a DHCP reservation (see `P0-restart-new-network.md`).

Once SSH works, tell me; I take it from there (updates, PocketBase, chrony, watchdog, systemd, HTTPS).

**Status 2026-10-03:** done on the new network (Pi at `192.168.50.101`, key-only SSH, OS updated). Details: `P0-pi-setup-log-2026-10-03.pdf`. Next is hub setup: `sudo bash setup-hub.sh` (add `--keep-display` while a monitor is attached).

## 5. Accounts

| Account | Needed for | Notes |
| --- | --- | --- |
| GitHub (have: `repatikosamid-prog/chedam`) | Code + update channel (GitHub Releases) | Repo visibility matters, see Q3 |
| Google account **or** Microsoft account (dev/test, not personal data) | FR-12.08 encrypted cloud backup | Needs an API app registration (Google Cloud Console or Azure app registration). I will guide that step when we reach it. |

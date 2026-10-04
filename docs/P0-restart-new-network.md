# P0 restart on the new network

Date: 2026-10-03. Why: the TELUS modem gives us no admin access (no DHCP reservations), so the dev hub now runs behind our **own router**, plugged by LAN cable into the bedroom wall port. Every address changed, so we start P0 again from a clean SD card.

**Status (2026-10-03): steps 1-4 done.** The Pi is on the new router at `192.168.50.101`, key-only SSH works, and the OS is updated. What actually happened, including every failed attempt and its fix, is in `P0-pi-setup-log-2026-10-03.pdf`. Next: hub setup (`setup-hub.sh`).

## What changes and what stays

| Item | Status |
| --- | --- |
| Repo files (`hub/`, `docs/`, spec PDFs) | **Stay.** Nothing in the repo has a hard-coded IP; `setup-hub.sh` detects the hub IP itself |
| Pi SD card (OS, `chedam` user, PocketBase data, Caddy CA) | **Wiped and re-flashed** |
| Hub IP address | **New**: fixed by a DHCP reservation on the new router |
| Pi password | **New**: choose one at flashing time |
| PC SSH key (`id_ed25519`) | **Keep** (it's not tied to an IP). Only the old host fingerprints get removed |
| `chedam` SSH alias, known_hosts entries | **Remove / update** (step 3) |
| "Chedam Store CA" certificate on PC and phones | **Remove**: the new hub creates a new CA (step 3) |
| mkcert dev CA on the PC | Keep (PC-only, not tied to an IP) |
| Local Windows PocketBase test data | Done: renamed to `pb_data.old-2026-10-03` (fresh start; delete the old folder when you're sure) |

## Step 1. Set up the new router (one time)

Log in to the new router's admin page (address is on its label, often `192.168.0.1` or `192.168.50.1`).

1. **Change the admin password** from the default.
2. **LAN subnet must differ from TELUS.** TELUS usually uses `192.168.1.x`. If the new router also uses `192.168.1.x`, change its LAN IP to e.g. `192.168.50.1` (subnet `192.168.50.0/24`).
3. **Wi-Fi:** make sure a **2.4 GHz** network is on (the Pi Zero 2 W cannot see 5 GHz). Give it its own SSID if the router splits bands, e.g. `Chedam-2G`. WPA2-Personal (or WPA2/WPA3 mixed).
4. Keep the router in **router mode** (not access-point/bridge mode). Bridge mode would hand out TELUS addresses again, and we'd lose control of DHCP.
5. Write down: router admin IP, subnet, 2.4 GHz SSID. (Passwords go in your password manager, not in this repo.)

**Important:** the PC and all test phones must join the **new router's Wi-Fi** (or be cabled to it). Devices still on TELUS Wi-Fi cannot reach the Pi.

## Step 2. Flash the SD card

Raspberry Pi Imager formats the card while writing, so you don't need to format it separately.

1. Imager → **Device:** Raspberry Pi Zero 2 W → **OS:** Raspberry Pi OS (other) → **Raspberry Pi OS Lite (64-bit)** → **Storage:** the SD card.
2. Customisation:
   - Hostname: `chedam`
   - Username: `chedam`, **new password**
   - Wi-Fi: **new router's 2.4 GHz SSID** + password, country **CA**
   - Time zone `America/Vancouver`, keyboard `us`
   - SSH: on, **public-key only**, paste `C:\Users\Venkata\.ssh\id_ed25519.pub`
   - Raspberry Pi Connect: off
3. Write → verify → eject → into the Pi → power on → wait 3-5 minutes.

## Step 3. Clean the PC of the old hub (PowerShell)

```powershell
# Forget old host fingerprints (otherwise SSH shows "REMOTE HOST IDENTIFICATION HAS CHANGED")
ssh-keygen -R chedam.local
ssh-keygen -R chedam
ssh-keygen -R <OLD_PI_IP>        # the IP the Pi had on TELUS, if you remember it

# Check for an old SSH alias
notepad $env:USERPROFILE\.ssh\config
```

In `config`, update (or add) the alias once you know the new IP (step 4):

```
Host chedam
    HostName <NEW_PI_IP>
    User chedam
    IdentityFile ~/.ssh/id_ed25519
```

Remove the old hub certificate, if it was installed:
- **Windows:** Win+R → `certmgr.msc` → Trusted Root Certification Authorities → Certificates → delete **Chedam Store CA** (only that one; leave `mkcert ...` alone).
- **iPhone:** Settings → General → VPN & Device Management → remove the Chedam profile.
- **Android:** Settings → Security → Encryption & credentials → User credentials → remove Chedam Store CA.

## Step 4. Find the Pi and fix its IP

1. Router admin page → connected devices / DHCP clients → find `chedam` and note its IP and MAC.
2. Create a **DHCP reservation** (Address Reservation / Static Lease) for that MAC, e.g. `192.168.50.10`. (Done: kept the address the router first gave, `192.168.50.101`.) On the TP-Link the entry is saved as *Disabled*: tick it and click **Enable Selected**. Leave **IP & MAC Binding / ARP Binding** off; it is not a reservation.
3. Reboot the Pi (unplug/replug) so it picks up the reserved address.
4. Test from PowerShell:
   ```powershell
   ping <NEW_PI_IP>
   ssh chedam@<NEW_PI_IP>
   ssh chedam          # via the alias
   ```
5. Record the result in the table below, then tell Claude "SSH works". Claude then re-runs hub setup (updates, PocketBase arm64, `setup-hub.sh`, reboot), which issues a new certificate for `chedam.local` + the new IP.

## Network record (fill in, no passwords)

| Item | Value |
| --- | --- |
| TELUS modem subnet | 192.168.1.0/24, gateway 192.168.1.254 |
| New router model | TP-Link 300Mbps Wireless N USB VDSL/ADSL modem router (in router mode) |
| New router admin IP / subnet | 192.168.50.1 / 192.168.50.0/24 |
| 2.4 GHz SSID | `TP-LINK_2CBE` |
| Pi MAC (wlan0) | 88:A2:9E:5C:17:65 |
| Pi reserved IP | 192.168.50.101 |
| Dev PC | DESKTOP-AHG4TD7, 192.168.50.100 |
| Pi re-flashed, SSH working | 2026-10-03 |
| Date hub re-setup completed | |

## If something goes wrong

| Symptom | Likely cause |
| --- | --- |
| Pi never shows in the router's device list | Wrong SSID/password at flashing, or 5 GHz-only SSID. Re-flash |
| `ping` fails but the Pi is listed | PC is on TELUS Wi-Fi, not the new router |
| "REMOTE HOST IDENTIFICATION HAS CHANGED" | Old fingerprint: run the `ssh-keygen -R` lines |
| `Permission denied (publickey)` | Wrong public key pasted at flashing; check `id_ed25519.pub`. Imager **remembers keys from earlier sessions**: on the SSH page the key must end like `type C:\Users\Venkata\.ssh\id_ed25519.pub` (`... chedam-dev`). Use BROWSE and pick the `.pub` file; never paste a command into the key box |
| `Permission denied` as `venkata@...` | No user given, so SSH used the Windows name. Use `ssh chedam@<ip>` or the `chedam` alias |
| `ssh chedam@chedam` times out | Windows cannot resolve the bare name. Use the IP, `chedam.local`, or the alias in `~/.ssh/config` |
| `cd C:\Users\...` fails in Git Bash | Git Bash needs forward slashes: `cd ~/Desktop/Projects/Chedam` |
| HDMI screen blank | Lite has no desktop (text login only, by design). Zero 2 W needs a **mini**-HDMI cable, screen connected before power-on, PWR port with 5 V 2.5 A. If `dmesg` shows `Cannot find any crtc or sizes`, append ` video=HDMI-A-1:1280x720@60D` to the single line in `/boot/firmware/cmdline.txt` and reboot. `setup-hub.sh` turns HDMI off again unless run with `--keep-display` |
| `sudo` asks for a password and eats pasted lines | Paste multi-line blocks one command at a time when `sudo` may prompt |
| Internet works on TELUS but not on the new router | New router WAN set wrong, or both use `192.168.1.x` (step 1.2) |

# Backups and restore (P0 step 7)

FR-1.14, NFR-03 (restore within 15 minutes with a spare card), NFR-04 (nightly, verified, 14/8/12), NFR-12 (backups encrypted).

## How backups work

- **Every night** at `backup.schedule` (default 02:30, store time), the hub backs up its database to the USB drive chosen in setup. If that fails, it tries again after an hour (up to 3 times that day) and puts an urgent task on the dashboard. The next good backup closes the task.
- **One backup** is:
  1. a consistent SQLite snapshot (taken while the store keeps running);
  2. an integrity check;
  3. gzip, then [age](https://age-encryption.org) encryption with the store's backup key;
  4. writing to `Chedam-Backups/<store id>/chedam-YYYYMMDD-HHMMSS-<kind>.db.gz.age`, plus a `.sha256` file.
- **Verified** means the file was read back from the drive, decrypted and checked again.
- **Kept:** the newest backup of each of the last 14 days, 8 weeks and 12 months, plus the 3 newest. Only Chedam's own files are ever deleted. The drive is never formatted.
- **The backup key** is made once, in setup. The owner prints it and keeps it with the recovery code. Without it, the backups cannot be read on a new hub. The owner can show it again under Backups → Backup key.
- **Restore test** (owner, Backups screen): rebuilds the newest backup into a temporary copy and compares it with the live data. The live data is not touched.
- **Who does the work:** the hub has no root rights. It asks the root helper `/opt/chedam/bin/chedam-backup` by writing `pb_data/backup/request.json`; `chedam-backup.path` runs the helper, which answers in `result.json`.

## Restore a failed hub onto a spare card (technician)

Target: under 15 minutes, plus the time it takes to flash the card.

1. Flash the spare card exactly as in `docs/P0-readiness-checklist.md` section 4: Raspberry Pi OS Lite 64-bit, hostname `chedam`, user `chedam`, the store's Wi-Fi, SSH key.
2. On the PC, copy the hub files and run setup (keep the same IP reservation in the router):
   ```
   scp -r hub/scripts hub/system chedam:hub/
   ssh chedam 'sudo bash ~/hub/scripts/setup-hub.sh --keep-display'
   bash hub/scripts/deploy.sh                # no --sample-data on a store hub
   ```
3. On the hub, put the owner's printed backup key into a file. It is one line starting with `AGE-SECRET-KEY-`:
   ```
   sudo install -d -m 700 /opt/chedam/keys
   sudo nano /opt/chedam/keys/backup-key.txt     # type the key, save
   sudo chmod 600 /opt/chedam/keys/backup-key.txt
   ```
4. Plug in the backup drive and restore the newest backup:
   ```
   lsblk -o NAME,FSTYPE,LABEL,SIZE                        # find the drive, e.g. sda1
   sudo mount -o ro /dev/sda1 /mnt/chedam-backup
   ls /mnt/chedam-backup/Chedam-Backups/*/                 # newest file is last
   sudo /opt/chedam/bin/chedam-backup restore /mnt/chedam-backup/Chedam-Backups/<store>/<newest>.db.gz.age --key /opt/chedam/keys/backup-key.txt
   sudo umount /mnt/chedam-backup
   ```
   The helper checks the backup, asks for `YES`, stops the hub, keeps the old database in `/opt/chedam/backups/pre-restore-<time>.db`, puts the backup in place and starts the hub.
5. Check: `https://<hub IP>` opens and the owner signs in. Devices paired before the backup keep working, because their keys are in the database. In the app, Backups → **Back up now** confirms that backups run again.

Measured on the dev hub (2026-10-05), restore step 4 only: **2 seconds** (database 0.45 MB). The whole spare-card restore is timed in the gate tests (step 10).

## Development notes

- Test the helper on the Pi without a USB drive by using a disk image: `CHEDAM_BACKUP_ALLOW_LOOP=1 sudo -E chedam-backup drives|run|test-restore <uuid> <store>`. Manual runs never print the key.
- **Testing phase drive:** Sreya's 1.5 TB Seagate (ST31500341AS, NTFS "SCRAPP") showed read errors and USB resets near the start of the disk (2026-10-05). Nothing was written to it. Use a healthy USB stick or drive. For production: OTG adapter plus a spare SD card or USB SSD (decided 2026-10-05).

# Chedam hub conventions

These rules apply to every phase. They come from Master Spec Section 10 and NFR-20, plus decisions made while building P0.

## Data

- **Common fields on every table:**
  - `id`: 15 characters `[a-z0-9]`. A device may create it offline, and PocketBase accepts a client-supplied id.
  - `created_at`, `updated_at`: autodate, UTC.
  - `created_by`, `updated_by`: `"<collection>:<id>"`, `"system"` or `"system:<tag>"`.
  - `device_id`: the device that created the record.
  - `deleted_at`: soft delete.
- **Who and which device are stamped by the hub**, never trusted from the client: `lib/event_log.js` `stamp()` overwrites `created_by` / `updated_by` / `device_id` on API requests.
- **Hub code that saves records without a request** (rules, jobs) must set `updated_by` to `"system"` or `"system:<job>"`.
- **Soft delete first:** set `deleted_at`. Hard deletes are superuser-only (API rules) and are still logged.
- **Money** is integer cents (BR-01). **Times** are UTC and shown in the store time zone (BR-30).
- **Secrets** (PIN hash, recovery hash, device key) are `hidden` fields. Hidden fields never appear in API output or in the event log.
- **Settings** use dotted lowercase keys (`security.pin_max_attempts`), and values are JSON. Read a JSON field in hooks with `JSON.parse(record.getString("value"))`.

## Event log

- `pb_hooks/event_log.pb.js` writes one `events` row for every create, update or delete on any non-system collection, **in the same transaction**. If the event fails, the change rolls back.
- Each event has `table_name`, `record_id`, `action`, `actor`, `device_id`, `before`, `after` and `changed` (the field names changed by an update).
- Events are append-only. Edits and deletes are refused, even for superusers.
- The device comes from the `X-Chedam-Device` header. P0 step 4 will verify it against `devices`.

## Migrations

- Location: `hub/pb_migrations/<unix-ts>_<phase>_<what>.js`. Every migration has a `down` that removes exactly what `up` added (NFR-20).
- Reference data (modules, permissions, roles, default settings) goes in migrations. Each later phase adds its own permissions and settings in its own migration.
- Dev-only sample data goes in `hub/pb_migrations_dev/` (`*_dev_*` file names). It is deployed only with `deploy.sh --sample-data` and never to a store.

## Workflow

1. Write or change migrations and hooks in the repo.
2. Run the tests on the PC:
   ```
   PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step2-schema-eventlog.test.mjs
   ```
   They use a throwaway PocketBase on 127.0.0.1:8091.
3. Deploy:
   ```
   bash hub/scripts/deploy.sh --sample-data
   ```
   It backs up the database (SQLite online backup + integrity check; the 10 newest are kept in `/opt/chedam/backups`), syncs the code, restarts, and shows the health check, applied migrations and errors.
4. Verify on the Pi with `sqlite3` as `chedam-hub`.
5. Write the day's work log entry and build the PDF: `python tools/worklog/build_worklog.py`.

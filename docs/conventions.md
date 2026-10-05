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
- The device is the one verified by `lib/devices.js` (its id + key headers); a bare `X-Chedam-Device` header counts for nothing.

## Access

- **A new table is refused until it is added to `TABLES` in `hub/pb_hooks/lib/access.js`.** For each action, give a permission code, `any`, `self`, `assignee` or `null` (never via the API).
- **API rules on Chedam tables** are only "active, not-deleted Chedam user" (or `null`). The hook decides everything else.
- **Fields only endpoints may set** go in `PROTECTED`. Fields a person may change on their own record (or on a task assigned to them) go in `FIELD_LIMITS`.
- **Each phase adds its permission codes in a migration** and gives them to the role templates there.
- **Endpoints** live under `/api/chedam/...`. Check `access.isActive(e.auth)` and `access.can(...)`, and use `checkTargetUser` when acting on another person (BR-33).

## Devices

- **Every client request carries** `X-Chedam-Device` and `X-Chedam-Device-Key` (from pairing) and `X-Chedam-Version`. The middleware in `pb_hooks/devices.pb.js` checks them before anything else.
- **Inside hooks, use** `devices.current(e)` / `devices.currentId(e)` for the device. Never read the header yourself.
- **Non-owners need an approved device**; one person is signed in per device. A 401 tells the client to sign in again, or to pair again when it comes from `GET /api/chedam/devices/me`.
- **Realtime:** the SSE connect has no headers; the subscribe request (fetch) must carry the device headers like any other.
- **Device fields** that track status, keys and sign-in are `PROTECTED`. They change only through `/api/chedam/devices/...`.

## Migrations

- Location: `hub/pb_migrations/<unix-ts>_<phase>_<what>.js`. Every migration has a `down` that removes exactly what `up` added (NFR-20).
- Reference data (modules, permissions, roles, default settings) goes in migrations. Each later phase adds its own permissions and settings in its own migration.
- Dev-only sample data goes in `hub/pb_migrations_dev/` (`*_dev_*` file names). It is deployed only with `deploy.sh --sample-data` and never to a store.

## Workflow

1. Write or change migrations and hooks in the repo.
2. Run all tests on the PC:
   ```
   PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/run-all.mjs
   ```
   Each suite uses a throwaway PocketBase on 127.0.0.1 (shared harness: `hub/tests/lib/hub.mjs`).
3. Deploy:
   ```
   bash hub/scripts/deploy.sh --sample-data
   ```
   It backs up the database (SQLite online backup + integrity check; the 10 newest are kept in `/opt/chedam/backups`), syncs the code, restarts, and shows the health check, applied migrations and errors.
4. Verify on the Pi with `sqlite3` as `chedam-hub`.
5. Write the day's work log entry and build the PDF: `python tools/worklog/build_worklog.py`.

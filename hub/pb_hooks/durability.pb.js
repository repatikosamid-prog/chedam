/// <reference path="../pb_data/types.d.ts" />
// Durability (NFR-02 "no lost or duplicated sales", NFR-09 power pull). PocketBase opens SQLite with
// synchronous=NORMAL: in WAL mode a write is confirmed before it is forced onto the SD card, so a power
// cut can lose the last confirmed writes. The P0 power-pull test (2026-10-06) lost 23 of 1,646 confirmed
// writes that way. All writes go through PocketBase's single non-concurrent connection, so it is switched
// to synchronous=FULL (each commit is on the card before the answer). PocketBase may reopen that
// connection, so the setting is applied before every request, at start-up and every minute.

routerUse((e) => {
  e.app.nonconcurrentDB().newQuery("PRAGMA synchronous = FULL").execute();
  return e.next();
});

onBootstrap((e) => {
  e.next();
  try { e.app.nonconcurrentDB().newQuery("PRAGMA synchronous = FULL").execute(); } catch (_) { /* not ready yet */ }
});

cronAdd("chedam_durability", "* * * * *", () => {
  $app.nonconcurrentDB().newQuery("PRAGMA synchronous = FULL").execute();
});

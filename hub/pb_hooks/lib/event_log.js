// Event log (Master Spec Section 10): every create, update and delete on a Chedam table writes one
// row to "events", inside the same database transaction as the change. If the event cannot be
// written, the change is rolled back too, so the log can never miss a write.
//
// Who and which device: request hooks stamp the record with transient custom data
// ("@actor", "@device"); saves made by hub code without a request are logged as "system".
// Hidden fields (PIN hash, recovery hash, device key) are never copied into the log.

// PocketBase system collections start with "_"; "events" must not log itself.
function isLogged(name) {
  return name !== "events" && name.charAt(0) !== "_";
}

function plain(record) {
  return record ? JSON.parse(JSON.stringify(record.publicExport())) : null;
}

const IGNORED_IN_DIFF = { updated_at: true, updated: true };

function changedFields(before, after) {
  const out = [];
  const keys = {};
  Object.keys(before || {}).forEach((k) => (keys[k] = true));
  Object.keys(after || {}).forEach((k) => (keys[k] = true));
  Object.keys(keys).sort().forEach((k) => {
    if (IGNORED_IN_DIFF[k]) return;
    if (JSON.stringify((before || {})[k]) !== JSON.stringify((after || {})[k])) out.push(k);
  });
  return out;
}

// Hidden fields (PIN, password, recovery code, keys) never go into the log, but that one of them
// changed does: their names are added to "changed" (e.g. a PIN set from the admin UI).
function secretValue(rec, f) {
  const v = rec.getRaw(f);
  if (v && v.hash !== undefined) return String(v.hash);
  return v === null || v === undefined ? "" : String(v);
}

function hiddenChanged(oldRec, record) {
  if (!oldRec) return [];
  return record.collection().fields.filter((f) => f.hidden).map((f) => f.name)
    .filter((n) => secretValue(oldRec, n) !== secretValue(record, n));
}

function write(txApp, record, action, stored, oldRec) {
  const before = action === "create" ? null : (stored || plain(record.original()));
  const after = action === "delete" ? null : plain(record);

  const ev = new Record(txApp.findCollectionByNameOrId("events"));
  ev.set("table_name", record.collection().name);
  ev.set("record_id", record.id);
  ev.set("action", action);
  ev.set("actor", record.get("@actor") || "system");
  ev.set("device_id", record.get("@device") || "");
  ev.set("before", before);
  ev.set("after", after);
  ev.set("changed", action === "update" ? changedFields(before, after).concat(hiddenChanged(oldRec, record)).sort() : null);

  // Test hook for the atomicity test only (hub/tests): simulate a failed event write.
  if ($os.getenv("CHEDAM_TEST_FAIL_EVENTS") === "1") {
    throw new Error("simulated event-log failure (CHEDAM_TEST_FAIL_EVENTS)");
  }
  txApp.save(ev);
}

// Table rules that run inside the change's transaction: beforeWrite() checks (one writer at a time,
// so e.g. two tills cannot take the same barcode), afterWrite() writes that commit or roll back
// with the change (e.g. price history, FR-5.05).
const SIDE_EFFECTS = { products: "catalogue.js", selling_units: "catalogue.js", tax_rates: "tax.js", tax_classes: "tax.js" };

function sideEffects(txApp, record, action, when) {
  const lib = SIDE_EFFECTS[record.collection().name];
  if (!lib) return;
  const m = require(`${__hooks}/lib/${lib}`);
  if (when === "before") m.beforeWrite(txApp, record, action);
  else m.afterWrite(txApp, record, action);
}

// Wraps a *Execute hook: the change and its event commit or roll back together.
function wrap(e, action) {
  if (!isLogged(e.record.collection().name)) {
    e.next();
    return;
  }
  // Put the original app back afterwards: hooks that run after this one (e.g. PocketBase's own
  // clean-up after a password change) must not use the finished transaction.
  const outer = e.app;
  try {
    outer.runInTransaction((txApp) => {
      e.app = txApp;
      sideEffects(txApp, e.record, action, "before");
      // "before" is read from the database: record.original() is stale when one record object is
      // saved twice (e.g. created, then activated in the same request).
      let stored = null, oldRec = null;
      if (action !== "create") {
        try { oldRec = txApp.findRecordById(e.record.collection().name, e.record.id); stored = plain(oldRec); } catch (_) { stored = null; }
      }
      e.next();
      write(txApp, e.record, action, stored, oldRec);
      sideEffects(txApp, e.record, action, "after");
    });
  } finally {
    e.app = outer;
  }
}

// Request hooks: stamp who and which device. Clients can never set these fields themselves.
function stamp(e, action) {
  const rec = e.record;
  if (!isLogged(rec.collection().name)) return;
  const actor = e.auth ? e.auth.collection().name + ":" + e.auth.id : "guest";
  // Only a device whose key was checked (lib/devices.js verify) is stamped; a bare header counts for nothing.
  const device = require(`${__hooks}/lib/devices.js`).currentId(e);
  rec.set("@actor", actor);
  rec.set("@device", device);
  if (action === "create") {
    rec.set("created_by", actor);
    rec.set("updated_by", actor);
    rec.set("device_id", device);
  } else {
    const orig = rec.original();
    rec.set("created_by", orig.getString("created_by"));
    rec.set("device_id", orig.getString("device_id"));
    rec.set("updated_by", actor);
  }
}

module.exports = { wrap, stamp, isLogged, changedFields };

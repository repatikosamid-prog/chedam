/// <reference path="../pb_data/types.d.ts" />
// Event log hooks. The logic lives in lib/event_log.js (each hook runs in its own JS VM,
// so the library is loaded inside every handler).

onRecordCreateExecute((e) => { require(`${__hooks}/lib/event_log.js`).wrap(e, "create"); });
onRecordUpdateExecute((e) => { require(`${__hooks}/lib/event_log.js`).wrap(e, "update"); });
onRecordDeleteExecute((e) => { require(`${__hooks}/lib/event_log.js`).wrap(e, "delete"); });

onRecordCreateRequest((e) => { require(`${__hooks}/lib/event_log.js`).stamp(e, "create"); e.next(); });
onRecordUpdateRequest((e) => { require(`${__hooks}/lib/event_log.js`).stamp(e, "update"); e.next(); });
onRecordDeleteRequest((e) => { require(`${__hooks}/lib/event_log.js`).stamp(e, "delete"); e.next(); });

// The log is append-only, even for superusers and hub code.
onRecordUpdate((e) => { throw new BadRequestError("The event log cannot be changed."); }, "events");
onRecordDelete((e) => { throw new BadRequestError("The event log cannot be deleted."); }, "events");

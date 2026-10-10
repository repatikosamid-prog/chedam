/// <reference path="../../pb_data/types.d.ts" />
// P2 step 10: inbox, end-of-day report, email fallback (FR-2.08-2.10, 12.07, BR-40, 41). Each person has an
// in-app inbox: the end-of-day report, alerts (urgent problems Chedam found) and reports. Each kind has a
// deadline; an item still unread at its deadline would be emailed once, only while the hub is online and the
// owner has connected Gmail or Outlook (P2-f: waits for the client IDs; until then it is marked so).
// inbox_subs: what each person receives, in the app and by email. Down drops exactly what up adds.

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
const MINE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && user = @request.auth.id';
const SETTINGS = [
  ["reports.eod", { enabled: true, time: "23:30", recipients: [], email_by: "08:00" },
    "End-of-day report (FR-2.09): made at this store time for the owner and the people listed; emailed if still unread by email_by the next morning (Q5)"],
  ["inbox.deadlines", { eod_report: "next 08:00", alert: 60, report: 1440 },
    "When an unread inbox item is emailed (BR-40): 'next HH:MM' or minutes after it arrived"],
  ["email.connection", { provider: "", account: "", connected: false },
    "The owner's Gmail or Outlook for email fallback (FR-12.07, P2-f); not connected until the client IDs are set up"],
];

migrate((app) => {
  const mk = (name, fields, indexes, rule) => app.save(new Collection({ type: "base", name: name, listRule: rule, viewRule: rule, createRule: null, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [] }));
  mk("inbox_items", [
    { name: "user", type: "text", required: true, max: 15 },
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["eod_report", "alert", "report"] },
    { name: "ref", type: "text", max: 80 },                          // e.g. the day of an end-of-day report, a task id
    { name: "title", type: "text", required: true, max: 200 },
    { name: "body", type: "text", max: 20000 },
    { name: "data", type: "json", maxSize: 200000 },
    { name: "link", type: "text", max: 40 },                         // a screen of the app
    { name: "read_at", type: "date" },
    { name: "deadline_at", type: "date" },
    { name: "email_status", type: "select", maxSelect: 1, values: ["none", "waiting", "sent", "not_connected", "offline", "off"] },
    { name: "emailed_at", type: "date" },
  ], ["CREATE UNIQUE INDEX idx_inbox_ref ON inbox_items (user, kind, ref) WHERE ref != ''", "CREATE INDEX idx_inbox_user ON inbox_items (user, created_at)"], MINE);
  mk("inbox_subs", [
    { name: "user", type: "text", required: true, max: 15 },
    { name: "kind", type: "text", required: true, max: 20 },
    { name: "in_app", type: "bool" },
    { name: "email", type: "bool" },
  ], ["CREATE UNIQUE INDEX idx_inbox_subs ON inbox_subs (user, kind)"], MINE);
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  ["inbox_subs", "inbox_items"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

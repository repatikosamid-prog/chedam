/// <reference path="../../pb_data/types.d.ts" />
// P2 step 8: messages and announcements (FR-2.04, 2.05). Channels: the Everyone channel (made here), groups
// and one-to-one conversations. Messages follow the person (not the device). The app gets new messages and
// announcements live through PocketBase realtime (P2-e); the collection rules decide who receives what, so a
// message reaches only its channel's members. Everything is written through /api/chedam/messages... and
// /api/chedam/announcements. Down drops exactly what up adds.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';
const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
function base(app, name, fields, indexes, rule) {
  const r = rule || ACTIVE;
  const c = new Collection({ type: "base", name: name, listRule: r, viewRule: r, createRule: null, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [] });
  app.save(c);
  return c;
}

const PERMS = [["announcements.manage", "team", "Post announcements and see who has read them", false, false]];
const GRANTS = { manager: ["announcements.manage"] };
// A member: the Everyone channel, or the person's id in the channel's member list
const MEMBER = ACTIVE + ' && (channel.kind = "everyone" || channel.members ~ @request.auth.id)';

migrate((app) => {
  const channels = base(app, "channels", [
    { name: "kind", type: "select", required: true, maxSelect: 1, values: ["everyone", "group", "direct"] },
    { name: "name", type: "text", max: 80 },
    { name: "members", type: "json", maxSize: 20000 },              // [user id]; empty for Everyone
    { name: "direct_key", type: "text", max: 40 },                  // "<id>:<id>" sorted, one-to-one only
    { name: "last_message_at", type: "date" },
    { name: "archived", type: "bool" },
  ], ["CREATE UNIQUE INDEX idx_channels_direct ON channels (direct_key) WHERE direct_key != ''"],
    ACTIVE + ' && (kind = "everyone" || members ~ @request.auth.id)');
  base(app, "messages", [
    { name: "channel", type: "relation", required: true, collectionId: channels.id, maxSelect: 1, cascadeDelete: false },
    { name: "author", type: "text", max: 64 },
    { name: "author_name", type: "text", max: 80 },
    { name: "text", type: "text", max: 4000 },
    { name: "mentions", type: "json", maxSize: 4000 },              // [user id]
    { name: "link_collection", type: "text", max: 60 },
    { name: "link_id", type: "text", max: 64 },
    { name: "link_label", type: "text", max: 200 },
    { name: "attachment", type: "file", maxSelect: 1, maxSize: 10485760, mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"], thumbs: ["320x320"], protected: true },
    { name: "reactions", type: "json", maxSize: 8000 },             // {emoji: [user id]}
    { name: "edited_at", type: "date" },
    { name: "removed", type: "bool" },
  ], ["CREATE INDEX idx_messages_channel ON messages (channel, created_at)"], MEMBER);
  base(app, "channel_reads", [
    { name: "channel", type: "relation", required: true, collectionId: channels.id, maxSelect: 1, cascadeDelete: false },
    { name: "user", type: "text", required: true, max: 15 },
    { name: "last_read_at", type: "date" },
  ], ["CREATE UNIQUE INDEX idx_channel_reads ON channel_reads (channel, user)"], MEMBER);
  const ann = base(app, "announcements", [
    { name: "title", type: "text", required: true, max: 120 },
    { name: "text", type: "text", max: 4000 },
    { name: "author", type: "text", max: 64 },
    { name: "author_name", type: "text", max: 80 },
    { name: "needs_ack", type: "bool" },
    { name: "pinned", type: "bool" },
    { name: "ends_at", type: "date" },                             // empty: until ended
    { name: "ended", type: "bool" },
  ]);
  base(app, "announcement_acks", [
    { name: "announcement", type: "relation", required: true, collectionId: ann.id, maxSelect: 1, cascadeDelete: false },
    { name: "user", type: "text", required: true, max: 15 },
    { name: "user_name", type: "text", max: 80 },
    { name: "at", type: "date" },
  ], ["CREATE UNIQUE INDEX idx_announcement_acks ON announcement_acks (announcement, user)"]);

  const everyone = new Record(channels);
  everyone.load({ kind: "everyone", name: "Everyone", members: [], direct_key: "" });
  everyone.set("created_by", "system"); everyone.set("updated_by", "system");
  app.save(everyone);

  const ids = {};
  PERMS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    const p = new Record(app.findCollectionByNameOrId("permissions"));
    p.load({ code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive });
    p.set("created_by", "system"); p.set("updated_by", "system");
    app.save(p);
    ids[code] = p.id;
  });
  Object.keys(GRANTS).forEach((role) => {
    let r;
    try { r = app.findFirstRecordByData("roles", "code", role); } catch (_) { return; }
    r.set("permissions", r.get("permissions").concat(GRANTS[role].map((c) => ids[c])));
    r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  const ids = PERMS.map(([code]) => { try { return app.findFirstRecordByData("permissions", "code", code).id; } catch (_) { return ""; } }).filter(Boolean);
  Object.keys(GRANTS).forEach((role) => {
    let r;
    try { r = app.findFirstRecordByData("roles", "code", role); } catch (_) { return; }
    r.set("permissions", r.get("permissions").filter((x) => ids.indexOf(x) < 0));
    r.set("updated_by", "system");
    app.save(r);
  });
  ids.forEach((id) => app.delete(app.findRecordById("permissions", id)));
  ["announcement_acks", "announcements", "channel_reads", "messages", "channels"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

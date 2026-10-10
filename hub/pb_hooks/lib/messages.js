// Messages and announcements (P2 step 8; FR-2.04, 2.05).
// Channels: Everyone (all active people), groups (a name and members; whoever made it or a manager changes
// the members) and one-to-one conversations (one per pair). Messages: text, @mentions of members, a link to
// a record, one attachment (photo or PDF), reactions, read receipts (each member's last read time); removed
// by their author or a manager (the text goes, the fact stays). New messages reach members live through
// PocketBase realtime (collection rules, migration 1791400006).
// Announcements: posted by managers, pinned on Home until ended; those that need acknowledging stay until
// each person presses "I have read this"; managers see who has and who has not.

function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
function me(c) { if (!c.user) bad("Sign in as a person to use messages."); return c.user.id; }
function people(app) {
  const o = {};
  app.findRecordsByFilter("users", "status = 'active' && deleted_at = ''", "name", 0, 0).forEach((u) => { o[u.id] = u.getString("name"); });
  return o;
}

const LINKS = { products: "name", customers: "first_name", sales: "number", returns: "number", stock_counts: "name", promotions: "name", tasks: "title", documents: "name" };
const EMOJI = ["👍", "❤️", "😂", "😮", "✅", "👀"];

function isMember(ch, uid) { return ch.getString("kind") === "everyone" || j(ch, "members", []).indexOf(uid) >= 0; }
function channel(app, id, uid) {
  let ch = null;
  try { ch = app.findRecordById("channels", id); } catch (_) { ch = null; }
  if (!ch || ch.getString("deleted_at") || !isMember(ch, uid)) throw new NotFoundError("Unknown conversation.");
  return ch;
}
function membersOf(app, ch, all) { return ch.getString("kind") === "everyone" ? Object.keys(all || people(app)) : j(ch, "members", []); }

function readOf(app, chId, uid) {
  const r = app.findRecordsByFilter("channel_reads", "channel = {:c} && user = {:u}", "", 1, 0, { c: chId, u: uid });
  return r.length ? r[0] : null;
}

function title(ch, uid, all) {
  if (ch.getString("kind") !== "direct") return ch.getString("name");
  const other = j(ch, "members", []).filter((x) => x !== uid)[0];
  return all[other] || "(someone who left)";
}

// ---- Channels ---------------------------------------------------------------------------------------------

function channels(app, c) {
  const uid = me(c), all = people(app);
  const list = app.findRecordsByFilter("channels", "deleted_at = '' && archived = false && (kind = 'everyone' || members ~ {:u})", "-last_message_at", 200, 0, { u: uid });
  return { me: uid, people: Object.keys(all).map((id) => ({ id: id, name: all[id] })), channels: list.map((ch) => {
    const rd = readOf(app, ch.id, uid);
    const since = rd ? rd.getString("last_read_at") : "";
    const unread = app.countRecords("messages", $dbx.exp("channel = {:c} AND removed = false AND author != {:a}" + (since ? " AND created_at > {:s}" : ""), { c: ch.id, a: "users:" + uid, s: since }));
    const mentioned = unread ? app.findRecordsByFilter("messages", "channel = {:c} && removed = false && mentions ~ {:u}" + (since ? " && created_at > {:s}" : ""), "", 1, 0, { c: ch.id, u: uid, s: since }).length > 0 : false;
    const last = app.findRecordsByFilter("messages", "channel = {:c}", "-created_at", 1, 0, { c: ch.id })[0];
    return { id: ch.id, kind: ch.getString("kind"), name: title(ch, uid, all), members: membersOf(app, ch, all).map((id) => ({ id: id, name: all[id] || "" })),
      can_edit: ch.getString("kind") === "group" && (ch.getString("created_by") === "users:" + uid || c.can("users.manage")),
      unread: unread, mentioned: mentioned, last: last ? { text: last.getBool("removed") ? "(removed)" : last.getString("text") || (last.getString("attachment") ? "📎 attachment" : ""), author: last.getString("author_name"), at: last.getString("created_at") } : null };
  }) };
}

function createChannel(app, c, b) {
  const uid = me(c), all = people(app);
  const kind = b.kind === "direct" ? "direct" : "group";
  const want = (Array.isArray(b.members) ? b.members : []).map(String).filter((id) => all[id]);
  if (kind === "direct") {
    const other = want.filter((x) => x !== uid)[0];
    if (!other) bad("Choose who to talk to.");
    const key = [uid, other].sort().join(":");
    const have = app.findRecordsByFilter("channels", "direct_key = {:k}", "", 1, 0, { k: key });
    if (have.length) return { id: have[0].id };
    const ch = new Record(app.findCollectionByNameOrId("channels"));
    ch.load({ kind: "direct", name: "", members: [uid, other], direct_key: key, archived: false });
    stamp(ch, c); app.save(ch);
    return { id: ch.id };
  }
  const name = String(b.name || "").trim();
  if (!name) bad("Give the group a name, for example 'Morning shift'.");
  const members = [uid].concat(want.filter((x) => x !== uid));
  if (members.length < 2) bad("Add at least one other person.");
  const ch = new Record(app.findCollectionByNameOrId("channels"));
  ch.load({ kind: "group", name: name.substring(0, 80), members: members, direct_key: "", archived: false });
  stamp(ch, c); app.save(ch);
  return { id: ch.id };
}

function editChannel(app, c, id, b) {
  const uid = me(c), all = people(app);
  const ch = channel(app, id, uid);
  if (ch.getString("kind") !== "group") bad("Only a group's members can be changed.");
  if (ch.getString("created_by") !== "users:" + uid && !c.can("users.manage")) throw new ForbiddenError("Only whoever made the group, or a manager, can change it.");
  if (b.name !== undefined) { const n = String(b.name || "").trim(); if (!n) bad("Give the group a name."); ch.set("name", n.substring(0, 80)); }
  if (Array.isArray(b.members)) {
    const m = b.members.map(String).filter((x) => all[x]);
    if (m.length < 2) bad("A group needs at least two people.");
    ch.set("members", m);
  }
  if (b.archived !== undefined) ch.set("archived", !!b.archived);
  stamp(ch, c); app.save(ch);
  return { id: ch.id };
}

// ---- Messages ----------------------------------------------------------------------------------------------

function view(app, m, uid, all) {
  const removed = m.getBool("removed");
  return { id: m.id, channel: m.getString("channel"), author: m.getString("author").replace(/^users:/, ""), author_name: m.getString("author_name"), mine: m.getString("author") === "users:" + uid,
    text: removed ? "" : m.getString("text"), removed: removed, mentions: j(m, "mentions", []), mentions_me: j(m, "mentions", []).indexOf(uid) >= 0,
    link: !removed && m.getString("link_collection") ? { collection: m.getString("link_collection"), id: m.getString("link_id"), label: m.getString("link_label") } : null,
    attachment: !removed && m.getString("attachment") ? { name: m.getString("attachment"), url: "/api/files/" + m.collection().id + "/" + m.id + "/" + m.getString("attachment"), image: !/\.pdf$/i.test(m.getString("attachment")) } : null,
    reactions: removed ? {} : Object.fromEntries(Object.entries(j(m, "reactions", {})).map(([k, v]) => [k, { count: v.length, mine: v.indexOf(uid) >= 0, who: v.map((x) => all[x] || "").filter(Boolean) }])),
    created_at: m.getString("created_at"), edited_at: m.getString("edited_at") };
}

// ?before=<created_at> pages back 50 at a time. Read receipts: each member's last read time.
function list(app, c, id, before) {
  const uid = me(c), all = people(app);
  const ch = channel(app, id, uid);
  const ms = app.findRecordsByFilter("messages", "channel = {:c}" + (before ? " && created_at < {:b}" : ""), "-created_at", 50, 0, { c: ch.id, b: before || "" }).reverse();
  const reads = app.findRecordsByFilter("channel_reads", "channel = {:c}", "", 0, 0, { c: ch.id }).map((r) => ({ user: r.getString("user"), name: all[r.getString("user")] || "", at: r.getString("last_read_at") }));
  return { channel: { id: ch.id, kind: ch.getString("kind"), name: title(ch, uid, all), members: membersOf(app, ch, all).map((x) => ({ id: x, name: all[x] || "" })) },
    messages: ms.map((m) => view(app, m, uid, all)), reads: reads.filter((r) => r.user !== uid && r.name), more: ms.length === 50 };
}

function send(app, c, b, files) {
  const uid = me(c), all = people(app);
  const ch = channel(app, String(b.channel || ""), uid);
  const text = String(b.text || "").trim();
  if (!text && !(files && files.length)) bad("Write a message or attach a file.");
  if (text.length > 4000) bad("A message is at most 4000 characters.");
  const members = membersOf(app, ch, all);
  // @mentions: the ids the app sends, kept only for members of this conversation
  let mentions = [];
  try { mentions = (Array.isArray(b.mentions) ? b.mentions : JSON.parse(b.mentions || "[]")).map(String); } catch (_) { mentions = []; }
  mentions = mentions.filter((x, i, a) => members.indexOf(x) >= 0 && a.indexOf(x) === i && x !== uid);
  const m = new Record(app.findCollectionByNameOrId("messages"));
  m.load({ channel: ch.id, author: "users:" + uid, author_name: all[uid] || "", text: text, mentions: mentions, reactions: {}, removed: false });
  const lc = String(b.link_collection || "");
  if (lc) {
    if (!LINKS[lc]) bad("A message can link to a product, customer, sale, return, count, promotion, task or document.");
    let r = null;
    try { r = app.findRecordById(lc, String(b.link_id || "")); } catch (_) { r = null; }
    if (!r) bad("The linked record was not found.");
    m.set("link_collection", lc); m.set("link_id", r.id); m.set("link_label", String(r.get(LINKS[lc])).substring(0, 200));
  }
  if (files && files.length) m.set("attachment", files[0]);
  stamp(m, c); app.save(m);
  ch.set("last_message_at", m.getString("created_at") || new DateTime()); stamp(ch, c); app.save(ch);
  markRead(app, c, ch.id);
  return view(app, m, uid, all);
}

function react(app, c, id, emoji) {
  const uid = me(c), all = people(app);
  const m = app.findRecordById("messages", id);
  channel(app, m.getString("channel"), uid);
  if (EMOJI.indexOf(emoji) < 0) bad("Unknown reaction.");
  if (m.getBool("removed")) bad("This message was removed.");
  const r = j(m, "reactions", {});
  const who = r[emoji] || [];
  r[emoji] = who.indexOf(uid) >= 0 ? who.filter((x) => x !== uid) : who.concat([uid]);
  if (!r[emoji].length) delete r[emoji];
  m.set("reactions", r); stamp(m, c); app.save(m);
  return view(app, m, uid, all);
}

function remove(app, c, id) {
  const uid = me(c), all = people(app);
  const m = app.findRecordById("messages", id);
  channel(app, m.getString("channel"), uid);
  if (m.getString("author") !== "users:" + uid && !c.can("users.manage")) throw new ForbiddenError("Only who wrote it, or a manager, can remove a message.");
  m.set("removed", true); m.set("text", ""); m.set("attachment", null); m.set("reactions", {}); m.set("link_collection", ""); m.set("link_id", ""); m.set("link_label", "");
  stamp(m, c); app.save(m);
  return view(app, m, uid, all);
}

function markRead(app, c, chId) {
  const uid = me(c);
  channel(app, chId, uid);
  let r = readOf(app, chId, uid);
  if (!r) { r = new Record(app.findCollectionByNameOrId("channel_reads")); r.load({ channel: chId, user: uid }); }
  r.set("last_read_at", new DateTime());
  stamp(r, c); app.save(r);
  return { ok: true };
}

// Everything unread for this person (the app's badge and the dashboard)
function unread(app, c) {
  const x = channels(app, c).channels;
  return { unread: x.reduce((a, ch) => a + ch.unread, 0), mentioned: x.some((ch) => ch.mentioned), channels: x.filter((ch) => ch.unread).length };
}

// ---- Announcements (FR-2.05) -------------------------------------------------------------------------------

function activeAnn(app) {
  const now = new Date().toISOString().replace("T", " ");
  return app.findRecordsByFilter("announcements", "ended = false && deleted_at = '' && (ends_at = '' || ends_at > {:n})", "-created_at", 50, 0, { n: now });
}

function announcements(app, c, includeEnded) {
  const uid = me(c), all = people(app), manage = c.can("announcements.manage");
  const list = includeEnded && manage ? app.findRecordsByFilter("announcements", "deleted_at = ''", "-created_at", 100, 0) : activeAnn(app);
  return { can_manage: manage, announcements: list.map((a) => {
    const acks = app.findRecordsByFilter("announcement_acks", "announcement = {:a}", "at", 0, 0, { a: a.id });
    const mine = acks.some((k) => k.getString("user") === uid);
    const o = { id: a.id, title: a.getString("title"), text: a.getString("text"), author: a.getString("author_name"), needs_ack: a.getBool("needs_ack"), pinned: a.getBool("pinned"),
      created_at: a.getString("created_at"), ends_at: a.getString("ends_at"), ended: a.getBool("ended"), acked: mine };
    if (manage) {
      const done = {};
      acks.forEach((k) => { done[k.getString("user")] = k.getString("at"); });
      o.acks = acks.map((k) => ({ name: all[k.getString("user")] || k.getString("user_name"), at: k.getString("at") }));
      o.waiting = Object.keys(all).filter((id) => !done[id]).map((id) => all[id]);
    }
    return o;
  }) };
}

function postAnn(app, c, b) {
  const t = String(b.title || "").trim();
  if (!t) bad("Give the announcement a title.");
  const a = new Record(app.findCollectionByNameOrId("announcements"));
  a.load({ title: t.substring(0, 120), text: String(b.text || "").substring(0, 4000), author: c.actor, author_name: c.user ? c.user.getString("name") : "Chedam",
    needs_ack: !!b.needs_ack, pinned: b.pinned !== false, ended: false });
  if (b.ends_at) { const d = new Date(b.ends_at); if (isNaN(d.getTime())) bad("The end date is not a date."); a.set("ends_at", d.toISOString().replace("T", " ")); }
  stamp(a, c); app.save(a);
  return { id: a.id };
}

function ack(app, c, id) {
  const uid = me(c);
  const a = app.findRecordById("announcements", id);
  if (app.findRecordsByFilter("announcement_acks", "announcement = {:a} && user = {:u}", "", 1, 0, { a: a.id, u: uid }).length) return { ok: true };
  const k = new Record(app.findCollectionByNameOrId("announcement_acks"));
  k.load({ announcement: a.id, user: uid, user_name: c.user.getString("name"), at: new DateTime() });
  stamp(k, c); app.save(k);
  return { ok: true };
}

function endAnn(app, c, id) {
  const a = app.findRecordById("announcements", id);
  a.set("ended", true); a.set("pinned", false); stamp(a, c); app.save(a);
  return { ok: true };
}

// Waiting for this person: announcements to acknowledge
function toAck(app, c) {
  const uid = me(c);
  return activeAnn(app).filter((a) => a.getBool("needs_ack") && !app.findRecordsByFilter("announcement_acks", "announcement = {:a} && user = {:u}", "", 1, 0, { a: a.id, u: uid }).length).length;
}

module.exports = { channels, createChannel, editChannel, list, send, react, remove, markRead, unread, announcements, postAnn, ack, endAnn, toAck, EMOJI };

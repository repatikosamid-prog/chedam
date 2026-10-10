// Pings (P2 step 9; FR-2.06, 2.07, BR-42): a short message from a person on one device to devices: one
// device, all tills, all phones and tablets, all back-office PCs, or everyone (never customer displays).
// Ready-made texts (setting pings.templates) or your own. A normal ping shows as a banner on each recipient
// until that device closes it; an urgent one fills the screen and sounds until anyone confirms it (then it is
// closed for all). Recipients can reply in place ("On my way"). An urgent ping nobody confirmed within
// pings.escalate_minutes (5) also goes to the devices where a manager or the owner is signed in, and a task
// is opened. Pings are never emailed. The app shows a device only its own pings (recipients); pings are
// store-floor messages and every signed-in person may read the table.

function bad(msg) { throw new BadRequestError(msg); }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const j = (r, f, d) => { try { return JSON.parse(r.getString(f) || "null") || d; } catch (_) { return d; } };
const GROUPS = { till: ["till"], phone: ["phone", "tablet"], back_office: ["back_office_pc"], everyone: ["till", "phone", "tablet", "back_office_pc", "kiosk"] };
const LABEL = { till: "All tills", phone: "All phones and tablets", back_office: "All back-office PCs", everyone: "Everyone" };
const SINCE_MS = 12 * 3600000;

function devicesOf(app, types) {
  return app.findRecordsByFilter("devices", "status = 'approved' && deleted_at = ''", "name", 0, 0).filter((d) => types.indexOf(d.getString("type")) >= 0);
}

function targets(app, c) {
  const D = require(`${__hooks}/lib/devices.js`);
  const all = devicesOf(app, GROUPS.everyone);
  return { this_device: c.device, templates: setting(app, "pings.templates", []) || [],
    groups: Object.keys(LABEL).map((k) => ({ target: k, label: LABEL[k], count: all.filter((d) => GROUPS[k].indexOf(d.getString("type")) >= 0 && d.id !== c.device).length })),
    devices: all.filter((d) => d.id !== c.device).map((d) => { const v = D.view(app, d); return { target: "device:" + d.id, label: v.name, type: v.type, online: v.online, who: v.current_user ? v.current_user.name : "" }; }) };
}

function view(app, p, c) {
  const acks = j(p, "acks", []);
  return { id: p.id, from: p.getString("from_name"), from_device: p.getString("from_device_name"), mine: p.getString("from_user") === c.actor, to: p.getString("target_label"),
    text: p.getString("text"), urgent: p.getBool("urgent"), closed: p.getBool("closed"), escalated: !!p.getString("escalated_at"), created_at: p.getString("created_at"),
    acks: acks, acked_here: acks.some((a) => a.device === c.device), for_me: j(p, "recipients", []).indexOf(c.device) >= 0 };
}

function send(app, c, b) {
  const target = String(b.target || "");
  let recipients = [], label = "";
  if (target.indexOf("device:") === 0) {
    let d = null;
    try { d = app.findRecordById("devices", target.substring(7)); } catch (_) { d = null; }
    if (!d || d.getString("status") !== "approved" || d.getString("deleted_at") || d.getString("type") === "customer_display") bad("Choose a device of the store.");
    recipients = [d.id]; label = d.getString("name");
  } else if (GROUPS[target]) {
    recipients = devicesOf(app, GROUPS[target]).map((d) => d.id); label = LABEL[target];
  } else bad("Choose who to ping.");
  recipients = recipients.filter((id) => id !== c.device);
  if (!recipients.length) bad("There is no other device to ping there.");
  const text = String(b.text || "").trim();
  if (!text) bad("Choose a ready-made text or write one.");
  const p = new Record(app.findCollectionByNameOrId("pings"));
  let devName = "";
  if (c.device) { try { devName = app.findRecordById("devices", c.device).getString("name"); } catch (_) { devName = ""; } }
  p.load({ from_user: c.actor, from_name: c.user ? c.user.getString("name") : "Chedam", from_device: c.device || "", from_device_name: devName, target: target, target_label: label,
    recipients: recipients, text: text.substring(0, 300), urgent: !!b.urgent, acks: [], closed: false });
  stamp(p, c); app.save(p);
  return view(app, p, c);
}

// This device's pings of the last 12 hours: to show (open for it) and the ones it sent (with replies).
function mine(app, c) {
  const since = new Date(Date.now() - SINCE_MS).toISOString().replace("T", " ");
  const list = app.findRecordsByFilter("pings", "created_at >= {:s} && deleted_at = ''", "-created_at", 200, 0, { s: since }).map((p) => view(app, p, c));
  return { open: c.device ? list.filter((p) => p.for_me && !p.closed && !(p.acked_here && !p.urgent)) : [], sent: list.filter((p) => p.mine).slice(0, 30), recent: list.filter((p) => p.for_me).slice(0, 30) };
}

// ack {reply}: a recipient confirms (urgent: closed for everyone) or closes its banner (normal).
function ack(app, c, id, reply) {
  const p = app.findRecordById("pings", id);
  if (!c.device || j(p, "recipients", []).indexOf(c.device) < 0) throw new ForbiddenError("This ping was not sent to this device.");
  const acks = j(p, "acks", []);
  if (!acks.some((a) => a.device === c.device && !reply)) {
    let devName = "";
    try { devName = app.findRecordById("devices", c.device).getString("name"); } catch (_) { devName = ""; }
    acks.push({ device: c.device, device_name: devName, user: c.actor, name: c.user ? c.user.getString("name") : "", at: new Date().toISOString(), reply: String(reply || "").trim().substring(0, 120) });
  }
  p.set("acks", acks);
  if (p.getBool("urgent")) p.set("closed", true);
  stamp(p, c); app.save(p);
  if (p.getBool("urgent")) require(`${__hooks}/lib/tasks.js`).syncRuleTask(app, "ping:" + p.id, 0, "", null, c.actor);
  return view(app, p, c);
}

function withdraw(app, c, id) {
  const p = app.findRecordById("pings", id);
  if (p.getString("from_user") !== c.actor && !c.can("users.manage")) throw new ForbiddenError("Only who sent it can take it back.");
  p.set("closed", true); stamp(p, c); app.save(p);
  require(`${__hooks}/lib/tasks.js`).syncRuleTask(app, "ping:" + p.id, 0, "", null, c.actor);
  return view(app, p, c);
}

// Minute job (BR-42): urgent pings not confirmed in time also go to managers' devices, and become a task.
function escalate(app) {
  const mins = Number(setting(app, "pings.escalate_minutes", 5)) || 5;
  const before = new Date(Date.now() - mins * 60000).toISOString().replace("T", " ");
  const since = new Date(Date.now() - SINCE_MS).toISOString().replace("T", " ");
  const late = app.findRecordsByFilter("pings", "urgent = true && closed = false && escalated_at = '' && created_at < {:b} && created_at >= {:s}", "", 0, 0, { b: before, s: since });
  if (!late.length) return { escalated: 0 };
  const access = require(`${__hooks}/lib/access.js`);
  const managers = app.findRecordsByFilter("devices", "status = 'approved' && deleted_at = '' && current_user != ''", "", 0, 0).filter((d) => {
    if (d.getString("type") === "customer_display") return false;
    try {
      const u = app.findRecordById("users", d.getString("current_user"));
      return access.isOwner(app, u) || access.can(app, u, "users.manage");
    } catch (_) { return false; }
  }).map((d) => d.id);
  late.forEach((p) => {
    const r = j(p, "recipients", []);
    p.set("recipients", r.concat(managers.filter((id) => r.indexOf(id) < 0)));
    p.set("escalated_at", new DateTime());
    p.set("updated_by", "system:pings"); p.set("@actor", "system:pings");
    app.save(p);
    require(`${__hooks}/lib/tasks.js`).syncRuleTask(app, "ping:" + p.id, 1, "Urgent ping not answered: " + p.getString("text") + " (from " + p.getString("from_name") + (p.getString("from_device_name") ? " on " + p.getString("from_device_name") : "") + ")",
      { kind: "ping_unanswered", priority: "urgent" }, "system:pings");
  });
  return { escalated: late.length };
}

module.exports = { targets, send, mine, ack, withdraw, escalate };

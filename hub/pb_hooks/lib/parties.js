// Parties: vendors and clients (P3 step 1; FR-8.01, 8.07, 8.08).
// check():   a party saved through the generic API (parties.manage): name, kind, currency, code tidied.
// addLog():  the communication log: a call, email, visit, meeting, note or order with who and when; a follow-up
//            date makes a task for the writer, due then, linked to the party (FR-8.07).
// view():    a party with its contacts and log.
// rateOn():  the exchange rate of a currency on a day (CAD for one unit; the latest entered on or before it).

function bad(msg) { throw new BadRequestError(msg); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const KINDS = ["vendor", "client", "both"];

function check(rec) {
  const name = String(rec.getString("name") || "").replace(/\s+/g, " ").trim();
  if (!name) bad("Give the vendor or client a name.");
  rec.set("name", name);
  if (KINDS.indexOf(rec.getString("kind")) < 0) bad("Vendor, client or both.");
  const cur = String(rec.getString("currency") || "CAD").toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(cur)) bad("Currency as a 3-letter code, for example CAD or USD.");
  rec.set("currency", cur);
  rec.set("code", String(rec.getString("code") || "").toUpperCase().replace(/\s+/g, "").substring(0, 20));
  const email = rec.getString("email").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad("That email address does not look right.");
  rec.set("email", email);
  if (!rec.getString("country")) rec.set("country", "CA");
  rec.set("country", rec.getString("country").toUpperCase().substring(0, 2));
  if (rec.isNew()) rec.set("active", true);                 // new ones are in use; switch off later
}

function checkContact(rec) {
  if (!String(rec.getString("name") || "").trim()) bad("Give the contact a name.");
  const email = rec.getString("email").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad("That email address does not look right.");
}

function addLog(app, c, partyId, b) {
  const p = app.findRecordById("parties", partyId);
  const text = String(b.text || "").trim();
  if (!text) bad("Write what was said or done.");
  const kind = ["call", "email", "visit", "meeting", "note", "order"].indexOf(b.kind) >= 0 ? b.kind : "note";
  const l = new Record(app.findCollectionByNameOrId("party_logs"));
  l.load({ party: p.id, kind: kind, text: text.substring(0, 4000), contact: String(b.contact || "").substring(0, 100), by: c.actor, by_name: c.user ? c.user.getString("name") : "" });
  if (b.follow_up_at) {
    const d = new Date(b.follow_up_at);
    if (isNaN(d.getTime())) bad("The follow-up date is not a date.");
    l.set("follow_up_at", d.toISOString().replace("T", " "));
    const t = new Record(app.findCollectionByNameOrId("tasks"));
    t.load({ title: ("Follow up with " + p.getString("name") + ": " + text).substring(0, 200), kind: "follow_up", source: "manual", status: "open", priority: "normal",
      owner: c.user ? c.user.id : "", due_at: d.toISOString().replace("T", " "), link_collection: "parties", link_id: p.id, note: text.substring(0, 2000) });
    stamp(t, c); app.save(t);
    l.set("follow_up_task", t.id);
  }
  stamp(l, c); app.save(l);
  return logView(app, l);
}

function logView(app, l) {
  let task = null;
  if (l.getString("follow_up_task")) { try { const t = app.findRecordById("tasks", l.getString("follow_up_task")); task = { id: t.id, status: t.getString("status") }; } catch (_) { task = null; } }
  return { id: l.id, kind: l.getString("kind"), text: l.getString("text"), contact: l.getString("contact"), by: l.getString("by_name"), at: l.getString("created_at"),
    follow_up_at: l.getString("follow_up_at"), follow_up: task };
}

function view(app, id) {
  const p = app.findRecordById("parties", id);
  return { party: p.publicExport(), contacts: app.findRecordsByFilter("party_contacts", "party = {:p} && deleted_at = ''", "-primary,name", 0, 0, { p: id }).map((x) => x.publicExport()),
    log: app.findRecordsByFilter("party_logs", "party = {:p} && deleted_at = ''", "-created_at", 200, 0, { p: id }).map((l) => logView(app, l)) };
}

// CAD for one unit of the currency on the day (YYYY-MM-DD); null when none is entered.
function rateOn(app, currency, day) {
  const cur = String(currency || "CAD").toUpperCase();
  if (cur === "CAD") return { currency: "CAD", rate: 1, day: day, source: "" };
  const r = app.findRecordsByFilter("fx_rates", "currency = {:c} && day <= {:d} && deleted_at = ''", "-day", 1, 0, { c: cur, d: day || "9999-12-31" })[0];
  return r ? { currency: cur, rate: r.getFloat("rate"), day: r.getString("day"), source: r.getString("source") } : null;
}

function checkRate(rec) {
  const cur = String(rec.getString("currency") || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur) || cur === "CAD") bad("Currency as a 3-letter code other than CAD.");
  rec.set("currency", cur);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.getString("day"))) bad("Day as YYYY-MM-DD.");
  if (!(rec.getFloat("rate") > 0)) bad("The rate is CAD for one " + cur + ", more than 0.");
}

module.exports = { check, checkContact, addLog, view, rateOn, checkRate };

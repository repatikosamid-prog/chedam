// Audit log viewer (P1 step 9; FR-10.13): who changed what, when, on which device, from the event log
// (every create, update and delete, written in the same transaction as the change). Read only.
// search(q): filters from, to (YYYY-MM-DD), actor ("users:<id>" or "system"), device, table, action, record
// (a record id, or text found in the record), page. Costs are taken out for people without costs.view
// (DL-72); secret fields were never written to the log (named only).

function bad(msg) { throw new BadRequestError(msg); }
const SKIP = { created_at: 1, updated_at: 1, created_by: 1, updated_by: 1, device_id: 1, collectionId: 1, collectionName: 1 };
const LABEL = ["name", "number", "key", "code", "title", "file_name", "lot_code"];
// Fields that hold a person: shown with their name
const PERSON = { cashier: 1, user: 1, opened_by: 1, closed_by: 1, reconciled_by: 1, voided_by: 1, by: 1, assigned_user: 1, current_user: 1, printed_by: 1, approved_by: 1 };

function plainJson(r, f) { try { return JSON.parse(r.getString(f) || "null"); } catch (_) { return null; } }

function strip(table, obj, showCost) {
  if (!obj || showCost) return obj;
  const cost = require(`${__hooks}/lib/access.js`).COST_FIELDS[table] || [];
  if (table === "price_history" && obj.field !== "cost") return obj;
  const out = {};
  Object.keys(obj).forEach((k) => { if (cost.indexOf(k) < 0 && !(table === "price_history" && (k === "old_cents" || k === "new_cents"))) out[k] = obj[k]; });
  return out;
}

function who(app, actor, cache) {
  if (cache[actor] !== undefined) return cache[actor];
  let n = actor || "";
  const m = /^users:([a-z0-9]{15})/.exec(actor || "");
  if (m) { try { n = app.findRecordById("users", m[1]).getString("name"); } catch (_) { n = "(removed person)"; } }
  else if (/^system/.test(actor || "")) n = "Chedam (" + (actor.split(":")[1] || "system") + ")";
  else if (/^devices:/.test(actor || "")) { try { n = "Device " + app.findRecordById("devices", actor.split(":")[1]).getString("name"); } catch (_) { n = actor; } }
  cache[actor] = n;
  return n;
}

function dayStart(ymdText, plusDays) {
  const a = String(ymdText).split("-").map(Number);
  return new Date(a[0], a[1] - 1, a[2] + (plusDays || 0)).toISOString().replace("T", " ");
}

function search(app, q, showCost) {
  const parts = [], params = {};
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (q.from) { if (!ymd.test(q.from)) bad("Dates are YYYY-MM-DD."); parts.push("at >= {:f}"); params.f = dayStart(q.from); }
  if (q.to) { if (!ymd.test(q.to)) bad("Dates are YYYY-MM-DD."); parts.push("at < {:t}"); params.t = dayStart(q.to, 1); }
  if (q.actor) { parts.push("actor ~ {:a}"); params.a = String(q.actor).substring(0, 100); }
  if (q.device) { parts.push("device_id = {:d}"); params.d = String(q.device); }
  if (q.table) { parts.push("table_name = {:tb}"); params.tb = String(q.table); }
  if (q.action) { if (["create", "update", "delete"].indexOf(q.action) < 0) bad("Action is create, update or delete."); parts.push("action = {:ac}"); params.ac = q.action; }
  if (q.record) {
    const s = String(q.record).trim().substring(0, 80);
    parts.push(/^[a-z0-9]{15}$/.test(s) ? "record_id = {:r}" : "(record_id = {:r} || after ~ {:r} || before ~ {:r})");
    params.r = s;
  }
  const per = 50;
  const page = Math.max(1, Number(q.page) || 1);
  const rows = app.findRecordsByFilter("events", parts.length ? parts.join(" && ") : "id != ''", "-at", per + 1, (page - 1) * per, params);
  const cache = {}, devices = {};
  const dev = (id) => { if (!id) return ""; if (devices[id] === undefined) { try { devices[id] = app.findRecordById("devices", id).getString("name"); } catch (_) { devices[id] = id; } } return devices[id]; };
  const person = (k, v) => {
    if (!PERSON[k] || typeof v !== "string" || !v) return v;
    const id = v.replace(/^users:/, "");
    return /^[a-z0-9]{15}$/.test(id) ? who(app, "users:" + id, cache) : v;
  };
  const items = rows.slice(0, per).map((e) => {
    const table = e.getString("table_name");
    const before = strip(table, plainJson(e, "before"), showCost), after = strip(table, plainJson(e, "after"), showCost);
    const action = e.getString("action");
    let changed = plainJson(e, "changed") || [];
    const any = after || before || {};
    const label = LABEL.map((k) => any[k]).find((v) => v !== undefined && v !== null && v !== "") || "";
    let fields = [];
    if (action === "update") {
      const costs = showCost ? [] : (require(`${__hooks}/lib/access.js`).COST_FIELDS[table] || []);
      changed = changed.filter((k) => costs.indexOf(k) < 0 && !SKIP[k]);
      fields = changed.map((k) => ({ field: k, before: before && k in before ? person(k, before[k]) : "(hidden)", after: after && k in after ? person(k, after[k]) : "(hidden)" }));
    } else {
      const src = (action === "create" ? after : before) || {};
      fields = Object.keys(src).filter((k) => !SKIP[k] && src[k] !== "" && src[k] !== null && src[k] !== false && !(Array.isArray(src[k]) && !src[k].length))
        .map((k) => ({ field: k, value: person(k, src[k]) }));
    }
    return { id: e.id, at: e.getString("at"), table: table, record_id: e.getString("record_id"), action: action, label: String(label).substring(0, 120),
      actor: e.getString("actor"), who: who(app, e.getString("actor"), cache), device_id: e.getString("device_id"), device: dev(e.getString("device_id")), fields: fields };
  });
  return { page: page, more: rows.length > per, items: items };
}

// What the filters can choose from.
function options(app) {
  const res = arrayOf(new DynamicModel({ t: "" }));
  app.db().newQuery("SELECT DISTINCT table_name AS t FROM events ORDER BY t").all(res);
  const tables = res.map((x) => x.t);
  return {
    tables: tables,
    people: app.findRecordsByFilter("users", "id != ''", "name", 0, 0).map((u) => ({ actor: "users:" + u.id, name: u.getString("name") })),
    devices: app.findRecordsByFilter("devices", "id != ''", "name", 0, 0).map((d) => ({ id: d.id, name: d.getString("name") })),
  };
}

module.exports = { search, options };

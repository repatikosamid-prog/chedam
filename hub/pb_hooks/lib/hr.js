// Employees and leave (P4 step 1; FR-9.09, 9.10, P4-a, P4-b).
// An employee record belongs to a person (user) of the store. Managers (hr.view) see the record without pay,
// SIN and bank details; the owner (hr.manage, owner only) sees and changes everything; each person sees their
// own record and leave balances (not their SIN in full). SIN (checked with the Luhn rule) and bank details
// are encrypted with the hub's key (pb_data/chedam-hr.key, made on first use, in the backups) and never logged.
// Leave: hours in a ledger per kind (vacation, sick, unpaid): monthly accruals (vacation days a year / 12),
// a yearly sick grant (BC: 5 paid days after 90 days of work; unused days do not carry over), time taken and
// adjustments with a note. Payroll (step 5) adds vacation earned from pay.

const st = () => require(`${__hooks}/lib/stock.js`);
function bad(msg) { throw new BadRequestError(msg); }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) r.set("created_by", c.actor); }
const r2 = (x) => Math.round(x * 100) / 100;
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

function key(app) {
  const path = app.dataDir() + "/chedam-hr.key";
  let k = "";
  try { k = String(toString($os.readFile(path))).trim(); } catch (_) { k = ""; }
  if (k.length !== 32) { k = $security.randomString(32); $os.writeFile(path, k, 0o600); }
  return k;
}
const enc = (app, text) => (text ? $security.encrypt(text, key(app)) : "");
const dec = (app, text) => { if (!text) return ""; try { return $security.decrypt(text, key(app)); } catch (_) { return ""; } };

function sinOk(sin) {
  if (!/^\d{9}$/.test(sin)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) { let d = Number(sin[i]) * (i % 2 ? 2 : 1); if (d > 9) d -= 9; sum += d; }
  return sum % 10 === 0;
}

function balances(app, empId) {
  const b = { vacation: 0, sick: 0, unpaid: 0 };
  app.findRecordsByFilter("leave_ledger", "employee = {:e} && deleted_at = ''", "", 0, 0, { e: empId }).forEach((x) => { b[x.getString("kind")] = r2(b[x.getString("kind")] + x.getFloat("hours")); });
  return b;
}

// What a viewer may see: "own" (the person), "view" (managers), "full" (the owner)
function view(app, e, level) {
  let name = "";
  try { name = app.findRecordById("users", e.getString("user")).getString("name"); } catch (_) { name = ""; }
  const o = { id: e.id, user: e.getString("user"), name: name, legal_name: e.getString("legal_name"), job_title: e.getString("job_title"), start_date: e.getString("start_date"),
    end_date: e.getString("end_date"), status: e.getString("status"), emergency_name: e.getString("emergency_name"), emergency_phone: e.getString("emergency_phone"),
    emergency_relation: e.getString("emergency_relation"), pay_type: e.getString("pay_type"), pay_frequency: e.getString("pay_frequency"), hours_per_week: e.getFloat("hours_per_week"),
    overtime_eligible: e.getBool("overtime_eligible"), vacation_days_per_year: e.getFloat("vacation_days_per_year"), sick_days_per_year: e.getFloat("sick_days_per_year"),
    leave: balances(app, e.id), sin_last3: e.getString("sin_last3") ? "•••-•••-" + e.getString("sin_last3") : "" };
  if (level === "own" || level === "full") {
    Object.assign(o, { birth_date: e.getString("birth_date"), street: e.getString("street"), city: e.getString("city"), province: e.getString("province"), postal_code: e.getString("postal_code"),
      personal_email: e.getString("personal_email"), personal_phone: e.getString("personal_phone") });
  }
  if (level === "full") {
    let bank = {};
    try { bank = JSON.parse(dec(app, e.getString("bank_enc")) || "{}"); } catch (_) { bank = {}; }
    Object.assign(o, { pay_rate_cents: e.getInt("pay_rate_cents"), vacation_pct: e.getFloat("vacation_pct"), td1_federal_cents: e.getInt("td1_federal_cents"), td1_provincial_cents: e.getInt("td1_provincial_cents"),
      has_sin: !!e.getString("sin_enc"), bank: { institution: bank.institution || "", transit: bank.transit || "", account: bank.account ? "••••" + String(bank.account).slice(-3) : "" },
      notes: e.getString("notes"), documents: e.get("documents") || [], collectionId: e.collection().id });
  }
  return o;
}

function level(app, c, e) {
  if (c.can("hr.manage")) return "full";
  if (c.user && e.getString("user") === c.user.id) return "own";
  if (c.can("hr.view")) return "view";
  throw new ForbiddenError("You do not have permission for this.");
}

function list(app, c) {
  if (!c.can("hr.view") && !c.can("hr.manage")) throw new ForbiddenError("You do not have permission for this.");
  const lv = c.can("hr.manage") ? "full" : "view";
  const emps = app.findRecordsByFilter("employees", "deleted_at = ''", "legal_name", 0, 0).map((e) => view(app, e, lv));
  // People without a record yet (to add one)
  const have = emps.map((x) => x.user);
  const people = app.findRecordsByFilter("users", "deleted_at = ''", "name", 0, 0).filter((u) => have.indexOf(u.id) < 0).map((u) => ({ id: u.id, name: u.getString("name") }));
  return { employees: emps, without_record: people, full: lv === "full" };
}

function get(app, c, id) { const e = app.findRecordById("employees", id); return view(app, e, level(app, c, e)); }
function mine(app, c) {
  if (!c.user) bad("Sign in as a person.");
  const e = app.findRecordsByFilter("employees", "user = {:u} && deleted_at = ''", "", 1, 0, { u: c.user.id })[0];
  return e ? view(app, e, "own") : null;
}

const BASIC = ["legal_name", "job_title", "start_date", "end_date", "status", "emergency_name", "emergency_phone", "emergency_relation", "birth_date", "street", "city", "province",
  "postal_code", "personal_email", "personal_phone", "pay_type", "pay_frequency", "hours_per_week", "overtime_eligible", "vacation_days_per_year", "sick_days_per_year", "notes"];
const PAY = ["pay_rate_cents", "vacation_pct", "td1_federal_cents", "td1_provincial_cents"];

// body: fields; sin (9 digits); bank {institution, transit, account}. Owner only (hr.manage)
function save(app, c, b, files) {
  let e = null;
  if (b.id) e = app.findRecordById("employees", b.id);
  else {
    let u = null;
    try { u = app.findRecordById("users", String(b.user || "")); } catch (_) { u = null; }
    if (!u) bad("Choose the person.");
    if (app.findRecordsByFilter("employees", "user = {:u} && deleted_at = ''", "", 1, 0, { u: u.id }).length) bad(u.getString("name") + " already has a record.");
    e = new Record(app.findCollectionByNameOrId("employees"));
    const lr = setting(app, "hr.leave", {}) || {};
    e.load({ user: u.id, status: "active", pay_type: "hourly", pay_frequency: "biweekly", overtime_eligible: true, vacation_pct: lr.vacation_pct_first || 4, vacation_days_per_year: 10,
      sick_days_per_year: lr.sick_days_bc || 5, start_date: st().today() });
  }
  BASIC.concat(PAY).forEach((k) => { if (b[k] !== undefined) e.set(k, b[k]); });
  if (!String(e.getString("legal_name")).trim()) bad("The legal name is needed (for pay stubs and the T4).");
  ["start_date", "end_date", "birth_date"].forEach((k) => { if (e.getString(k) && !ymdOk(e.getString(k))) bad("Dates as YYYY-MM-DD."); });
  if (["hourly", "salary"].indexOf(e.getString("pay_type")) < 0) bad("Hourly or salary.");
  if (b.sin !== undefined) {
    const sin = String(b.sin || "").replace(/\D/g, "");
    if (sin && !sinOk(sin)) bad("That SIN is not valid (9 digits; check the number).");
    e.set("sin_enc", enc(app, sin)); e.set("sin_last3", sin ? sin.slice(-3) : "");
  }
  if (b.bank) {
    const x = b.bank;
    if (x.institution && !/^\d{3}$/.test(x.institution)) bad("Bank institution number: 3 digits.");
    if (x.transit && !/^\d{5}$/.test(x.transit)) bad("Transit number: 5 digits.");
    if (x.account && !/^\d{5,12}$/.test(x.account)) bad("Account number: 5 to 12 digits.");
    e.set("bank_enc", x.institution || x.transit || x.account ? enc(app, JSON.stringify({ institution: x.institution || "", transit: x.transit || "", account: x.account || "" })) : "");
  }
  if (files && files.length) e.set("documents+", files.slice(0, 5));
  stamp(e, c); app.save(e);
  return e;
}

// The owner reveals a SIN (to file a T4 or an ROE); the reveal itself is logged
function revealSin(app, c, id) {
  const e = app.findRecordById("employees", id);
  const sin = dec(app, e.getString("sin_enc"));
  e.set("sin_viewed_by", c.user ? c.user.getString("name") : c.actor); e.set("sin_viewed_at", new DateTime());
  stamp(e, c); app.save(e);                                                   // in the event log: who looked, when
  return { sin: sin ? sin.substring(0, 3) + "-" + sin.substring(3, 6) + "-" + sin.substring(6) : "" };
}

// {kind, hours (+ / −), day, note, source: taken|adjust}
function leave(app, c, id, b) {
  const e = app.findRecordById("employees", id);
  const kind = ["vacation", "sick", "unpaid"].indexOf(b.kind) >= 0 ? b.kind : "";
  if (!kind) bad("Vacation, sick or unpaid.");
  const h = Number(b.hours);
  if (!h) bad("Enter the hours (taken as a positive number).");
  const source = b.source === "adjust" ? "adjust" : "taken";
  const hours = source === "taken" ? -Math.abs(h) : h;
  if (source === "adjust" && !String(b.note || "").trim()) bad("Say why the balance is adjusted.");
  if (kind !== "unpaid" && source === "taken" && balances(app, e.id)[kind] + hours < -1e-9) bad("Only " + balances(app, e.id)[kind] + " hours of " + kind + " left.");
  const r = new Record(app.findCollectionByNameOrId("leave_ledger"));
  r.load({ employee: e.id, kind: kind, hours: r2(hours), day: ymdOk(b.day) ? b.day : st().today(), source: source, note: String(b.note || "").substring(0, 300), by_name: c.user ? c.user.getString("name") : "" });
  stamp(r, c); app.save(r);
  return view(app, e, level(app, c, e));
}

function history(app, c, id) {
  const e = app.findRecordById("employees", id);
  level(app, c, e);
  return { items: app.findRecordsByFilter("leave_ledger", "employee = {:e} && deleted_at = ''", "-day,-created_at", 300, 0, { e: e.id }).map((x) => ({ kind: x.getString("kind"), hours: x.getFloat("hours"),
    day: x.getString("day"), source: x.getString("source"), note: x.getString("note"), by: x.getString("by_name") })) };
}

// Monthly job: vacation accrual (days a year / 12 × hours a day) and the yearly sick grant
function accrue(app, day) {
  const today = day || st().today();
  const month = today.substring(0, 7);
  const lr = setting(app, "hr.leave", {}) || {};
  let n = 0;
  const add = (e, kind, hours, source, ref, note) => {
    if (app.findRecordsByFilter("leave_ledger", "employee = {:e} && kind = {:k} && ref = {:r}", "", 1, 0, { e: e.id, k: kind, r: ref }).length) return;
    const r = new Record(app.findCollectionByNameOrId("leave_ledger"));
    r.load({ employee: e.id, kind: kind, hours: r2(hours), day: today, source: source, ref: ref, note: note, by_name: "Chedam" });
    r.set("created_by", "system:hr"); r.set("updated_by", "system:hr"); r.set("@actor", "system:hr");
    app.save(r); n++;
  };
  app.findRecordsByFilter("employees", "status != 'ended' && deleted_at = ''", "", 0, 0).forEach((e) => {
    const perDay = (e.getFloat("hours_per_week") || 40) / 5;
    if (e.getFloat("vacation_days_per_year") > 0 && e.getString("pay_type") === "salary") add(e, "vacation", (e.getFloat("vacation_days_per_year") * perDay) / 12, "accrual", "accrual:" + month, "Monthly accrual");
    const start = e.getString("start_date");
    const days = start ? Math.floor((new Date(today) - new Date(start)) / 86400000) : 0;
    if (days >= (lr.sick_after_days || 90) && e.getFloat("sick_days_per_year") > 0) {
      const year = today.substring(0, 4);
      const left = balances(app, e.id).sick;
      if (left > 0 && !app.findRecordsByFilter("leave_ledger", "employee = {:e} && kind = 'sick' && ref = {:r}", "", 1, 0, { e: e.id, r: "grant:" + year }).length) {
        add(e, "sick", -left, "expire", "expire:" + year, "Unused sick days do not carry over");
      }
      add(e, "sick", e.getFloat("sick_days_per_year") * perDay, "grant", "grant:" + year, "Paid sick days for " + year);
    }
  });
  return { added: n };
}

module.exports = { list, get, mine, save, revealSin, leave, history, accrue, balances, sinOk, dec, enc };

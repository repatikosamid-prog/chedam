// Importing every other kind of record (P5 step 6; FR-11.01 "all", 11.05-11.07). Same way as products (lib/imports.js):
// the back-office browser reads and maps the file and sends rows in Chedam's fields; check() says per row what
// would happen (create, update, skip, errors, warnings) without saving; commit() saves the good rows in ONE
// transaction (all or nothing) through the same rules as the screens, and keeps a job record. Targets:
//   customers      loyalty members from the old system: the store confirms they agreed to the program there
//   parties        vendors and clients (with one contact)
//   opening_stock  quantities on hand and their cost, as a receiving ("Opening stock") for products without stock
//   open_bills     what the store still owes vendors (bills) and clients owe it (invoices): one "Opening balance"
//                  line each, no tax (it was counted in the old system)
//   staff          people (no PIN or device yet: they set their PIN when the owner pairs them) with their employee
//                  record (owner only); SIN checked and encrypted like on the People screen, never in the job record
// Row values are strings or numbers in Chedam's field names; money in cents; dates YYYY-MM-DD.

function bad(msg) { throw new BadRequestError(msg); }
const MAX_ROWS = 2000;
const lc = (s) => String(s === undefined || s === null ? "" : s).trim().toLowerCase();
const str = (v, max) => String(v === undefined || v === null ? "" : v).trim().substring(0, max || 200);
const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const bool = (v) => /^(y|yes|true|1|oui|x|✓)$/i.test(String(v === undefined || v === null ? "" : v).trim());
const money = (v) => { const n = num(v); return n === null ? null : n; };
const okMoney = (n) => n === null || (n >= 0 && n === Math.floor(n));

// ---- Targets ---------------------------------------------------------------------------------------------------

const T = {};

T.customers = {
  perm: "customers.manage",
  find(app, r) {
    const phone = require(`${__hooks}/lib/customers.js`).normPhone(r.phone);
    if (phone) { const m = app.findRecordsByFilter("customers", "phone = {:p} && status = 'active'", "", 1, 0, { p: phone }); if (m.length) return m[0]; }
    if (r.card) { const m = app.findRecordsByFilter("customers", "card = {:c} && status = 'active'", "", 1, 0, { c: str(r.card, 40) }); if (m.length) return m[0]; }
    return null;
  },
  check(app, r, o, seen, out) {
    if (!str(r.first_name)) out.errors.push("No first name.");
    const phone = require(`${__hooks}/lib/customers.js`).normPhone(r.phone);
    if (phone && (phone.length < 7 || phone.length > 15)) out.errors.push("The phone number '" + r.phone + "' is not valid.");
    if (!phone && !str(r.card)) out.errors.push("A phone number or a loyalty card number is needed to find the member at the till.");
    if (phone) { if (seen[phone]) out.errors.push("The same phone is on line " + seen[phone] + "."); else seen[phone] = r.line; }
    const pts = num(r.points);
    if (pts !== null && !(pts >= 0 && pts === Math.floor(pts))) out.errors.push("Points must be a whole number, 0 or more.");
    if (!o.consent) out.errors.push("Confirm that these customers agreed to a loyalty program in the old system (option above).");
  },
  save(tx, r, o, ctx) {
    const C = require(`${__hooks}/lib/customers.js`);
    const c = C.join(tx, { first_name: str(r.first_name, 60), phone: r.phone, card: str(r.card, 40), agreed: true }, ctx);
    if (str(r.notes)) { c.set("notes", str(r.notes, 500)); tx.save(c); }
    const pts = num(r.points);
    if (pts) C.adjust(tx, c.id, { points: pts, note: "Balance from the old system (import)" }, ctx);
    return c.id;
  },
};

const PARTY_TEXT = { legal_name: 160, code: 20, tax_id: 40, pst_number: 40, business_number: 40, terms_text: 200, email: 120, phone: 40, website: 200, street: 200, city: 80, province: 40, postal_code: 12, notes: 4000 };
T.parties = {
  perm: "parties.manage",
  find(app, r) {
    if (str(r.code)) { const m = app.findRecordsByFilter("parties", "code = {:c} && deleted_at = ''", "", 1, 0, { c: str(r.code, 20).toUpperCase().replace(/\s+/g, "") }); if (m.length) return m[0]; }
    const m = app.findRecordsByFilter("parties", "name = {:n} && deleted_at = ''", "", 1, 0, { n: str(r.name, 120).replace(/\s+/g, " ") });
    return m.length ? m[0] : null;
  },
  check(app, r, o, seen, out) {
    if (!str(r.name)) out.errors.push("No name.");
    const k = lc(r.kind) || o.kind || "vendor";
    if (["vendor", "client", "both", "supplier", "customer"].indexOf(k) < 0) out.errors.push("Kind '" + r.kind + "': vendor, client or both.");
    if (r.currency && !/^[A-Za-z]{3}$/.test(str(r.currency))) out.errors.push("Currency '" + r.currency + "': a 3-letter code such as CAD or USD.");
    if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(r.email))) out.errors.push("Email '" + r.email + "' does not look right.");
    if (r.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(r.contact_email))) out.errors.push("Contact email '" + r.contact_email + "' does not look right.");
    const t = num(r.payment_terms_days);
    if (t !== null && !(t >= 0 && t <= 365)) out.errors.push("Payment terms: 0 to 365 days.");
    if (!okMoney(money(r.credit_limit_cents))) out.errors.push("The credit limit is not a valid amount.");
    const key = lc(r.name);
    if (key) { if (seen[key]) out.errors.push("The same name is on line " + seen[key] + "."); else seen[key] = r.line; }
    if (str(r.currency).toUpperCase() && str(r.currency).toUpperCase() !== "CAD") out.warnings.push("In " + str(r.currency).toUpperCase() + ": enter its exchange rate before recording bills.");
  },
  save(tx, r, o, ctx, existing) {
    const p = existing ? tx.findRecordById("parties", existing.id) : new Record(tx.findCollectionByNameOrId("parties"));
    const k = lc(r.kind) || o.kind || "vendor";
    if (!existing || r.kind) p.set("kind", k === "supplier" ? "vendor" : k === "customer" ? "client" : k);
    if (!existing) p.set("name", str(r.name, 120));
    Object.keys(PARTY_TEXT).forEach((f) => { if (str(r[f])) p.set(f, str(r[f], PARTY_TEXT[f])); });
    if (str(r.currency)) p.set("currency", str(r.currency).toUpperCase());
    if (!existing && !p.getString("currency")) p.set("currency", "CAD");
    if (str(r.country)) p.set("country", str(r.country).toUpperCase().substring(0, 2));
    if (num(r.payment_terms_days) !== null) p.set("payment_terms_days", num(r.payment_terms_days));
    if (money(r.credit_limit_cents) !== null) p.set("credit_limit_cents", money(r.credit_limit_cents));
    require(`${__hooks}/lib/parties.js`).check(p);
    stamp(p, ctx); tx.save(p);
    if (str(r.contact_name)) {
      const c = new Record(tx.findCollectionByNameOrId("party_contacts"));
      c.load({ party: p.id, name: str(r.contact_name, 100), role: str(r.contact_role, 80), email: str(r.contact_email, 120), phone: str(r.contact_phone, 40), primary: true });
      stamp(c, ctx); tx.save(c);
    }
    return p.id;
  },
};

// A product named in a row: barcode, PLU, then the same name
function productFor(app, r) {
  if (str(r.barcode)) {
    const m = require(`${__hooks}/lib/catalogue.js`).lookup(app, str(r.barcode)).matches.filter((x) => x.via === "barcode");
    if (m.length) return { p: m[0].product.id, u: m[0].unit.id };
  }
  if (str(r.plu)) { const m = app.findRecordsByFilter("products", "plu = {:p} && deleted_at = ''", "", 1, 0, { p: str(r.plu) }); if (m.length) return { p: m[0].id, u: "" }; }
  if (str(r.product)) { const m = app.findRecordsByFilter("products", "name = {:n} && deleted_at = ''", "", 1, 0, { n: str(r.product, 160) }); if (m.length) return { p: m[0].id, u: "" }; }
  return null;
}

T.opening_stock = {
  perm: "stock.receive",
  find(app, r) { return null; },
  check(app, r, o, seen, out) {
    let m = null;
    try { m = productFor(app, r); } catch (_) { m = null; }
    if (!m) { out.errors.push("No product with this barcode, PLU or name: import the products first."); return; }
    out.product = m.p;
    if (seen[m.p]) out.errors.push("The same product is on line " + seen[m.p] + "."); else seen[m.p] = r.line;
    const q = num(r.qty);
    if (!(q > 0)) out.errors.push("The quantity on hand must be more than 0.");
    if (!okMoney(money(r.cost_cents))) out.errors.push("The cost is not a valid amount.");
    if (r.expiry_date && !ymdOk(r.expiry_date)) out.errors.push("Expiry date as YYYY-MM-DD.");
    const pr = app.findRecordById("products", m.p);
    if (pr.getBool("perishable") && !r.expiry_date && !(pr.getInt("shelf_life_days") > 0 && !pr.getBool("expiry_at_receiving"))) out.errors.push("'" + pr.getString("name") + "' needs an expiry date.");
    const lv = app.findRecordsByFilter("stock_levels", "product = {:p}", "", 1, 0, { p: m.p })[0];
    if (lv && lv.getFloat("on_hand") !== 0) { out.action = "skip"; out.warnings.push("Already has " + lv.getFloat("on_hand") + " on hand in Chedam: use a stock count to correct it."); }
    if (money(r.cost_cents) === null) out.warnings.push("No cost: the product's cost is used.");
  },
  save(tx, r, o, ctx, existing, res) {
    require(`${__hooks}/lib/stock.js`).receive(tx, { lines: [{ product: res.product, qty: num(r.qty), cost_cents: money(r.cost_cents) === null ? undefined : money(r.cost_cents),
      expiry_date: str(r.expiry_date, 10), lot_code: str(r.lot_code, 60) || "OPENING", note: "Opening stock (import)" }] }, Object.assign({}, ctx, { op: "" }));
    return res.product;
  },
};

function partyFor(app, r) {
  const n = str(r.party, 120);
  if (!n) return null;
  let m = app.findRecordsByFilter("parties", "code = {:c} && deleted_at = ''", "", 1, 0, { c: n.toUpperCase().replace(/\s+/g, "") });
  if (!m.length) m = app.findRecordsByFilter("parties", "name = {:n} && deleted_at = ''", "", 1, 0, { n: n });
  return m.length ? m[0] : null;
}
T.open_bills = {
  perm: "finance.manage",
  find(app, r) { return null; },
  kind(r, o) { const k = lc(r.kind) || o.kind || "bill"; return /invoice|client|receivable|ar/.test(k) ? "invoice" : "bill"; },
  check(app, r, o, seen, out) {
    const kind = this.kind(r, o);
    const p = partyFor(app, r);
    if (!p) out.errors.push(str(r.party) ? "No vendor or client '" + str(r.party) + "': import them first." : "Whose bill or invoice is it?");
    else {
      const k = p.getString("kind");
      if (kind === "bill" && k === "client") out.errors.push(p.getString("name") + " is a client, not a vendor.");
      if (kind === "invoice" && k === "vendor") out.errors.push(p.getString("name") + " is a vendor, not a client.");
    }
    const amt = money(r.amount_cents);
    if (!(amt > 0) || !okMoney(amt)) out.errors.push("The amount still owed must be more than 0.");
    if (r.doc_date && !ymdOk(r.doc_date)) out.errors.push("Date as YYYY-MM-DD.");
    if (r.due_date && !ymdOk(r.due_date)) out.errors.push("Due date as YYYY-MM-DD.");
    if (p && str(r.party_ref) && kind === "bill" && app.findRecordsByFilter("bills", "party = {:p} && party_ref = {:r} && kind = 'bill' && status != 'void'", "", 1, 0, { p: p.id, r: str(r.party_ref, 60) }).length) {
      out.action = "skip"; out.warnings.push("Bill " + str(r.party_ref) + " from " + p.getString("name") + " is already in Chedam.");
    }
    const key = (p ? p.id : "") + "|" + lc(r.party_ref);
    if (str(r.party_ref)) { if (seen[key]) out.errors.push("The same number is on line " + seen[key] + "."); else seen[key] = r.line; }
  },
  save(tx, r, o, ctx) {
    const p = partyFor(tx, r);
    const b = require(`${__hooks}/lib/bills.js`).create(tx, ctx, { kind: this.kind(r, o), party: p.id, party_ref: str(r.party_ref, 60), doc_date: str(r.doc_date, 10),
      due_date: str(r.due_date, 10), lines: [{ description: "Opening balance" + (str(r.party_ref) ? " (" + str(r.party_ref, 60) + ")" : ""), qty: 1, unit_cents: money(r.amount_cents) }],
      taxes: [], notes: ("Imported from the old system. " + str(r.notes, 1500)).trim() });
    return b.id;
  },
};

const ROLES = ["manager", "cashier", "staff", "accountant"];
T.staff = {
  perm: "hr.manage",
  find(app, r) { const m = app.findRecordsByFilter("users", "name = {:n}", "", 1, 0, { n: str(r.name, 80) }); return m.length ? m[0] : null; },
  check(app, r, o, seen, out) {
    if (!str(r.name)) out.errors.push("No name (the name people pick at sign-in).");
    const role = lc(r.role) || o.role || "staff";
    if (ROLES.indexOf(role) < 0) out.errors.push("Role '" + r.role + "': manager, cashier, staff or accountant (the owner is not imported).");
    if (!str(r.legal_name) && !str(r.name)) out.errors.push("A legal name is needed for pay stubs.");
    if (r.pay_type && ["hourly", "salary"].indexOf(lc(r.pay_type)) < 0) out.errors.push("Pay type: hourly or salary.");
    if (!okMoney(money(r.pay_rate_cents))) out.errors.push("The pay rate is not a valid amount.");
    ["start_date", "birth_date"].forEach((f) => { if (r[f] && !ymdOk(r[f])) out.errors.push(f.replace("_", " ") + " as YYYY-MM-DD."); });
    const sin = String(r.sin || "").replace(/\D/g, "");
    if (sin && !require(`${__hooks}/lib/hr.js`).sinOk(sin)) out.errors.push("The SIN is not valid (check the number).");
    if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(r.email))) out.errors.push("Email '" + r.email + "' does not look right.");
    const key = lc(r.name);
    if (key) { if (seen[key]) out.errors.push("The same name is on line " + seen[key] + "."); else seen[key] = r.line; }
    if (out.match && app.findRecordsByFilter("employees", "user = {:u} && deleted_at = ''", "", 1, 0, { u: out.match }).length) { out.action = "skip"; out.warnings.push("Already in Chedam with an employee record."); }
  },
  save(tx, r, o, ctx, existing) {
    let u = existing;
    if (!u) {
      const role = tx.findFirstRecordByData("roles", "code", lc(r.role) || o.role || "staff");
      u = new Record(tx.findCollectionByNameOrId("users"));
      u.set("name", str(r.name, 80)); u.set("role", role.id); u.set("status", "active");
      if (str(r.email)) u.set("email", str(r.email, 120));
      u.setRandomPassword();
      stamp(u, ctx); tx.save(u);
    }
    const body = { user: u.id, legal_name: str(r.legal_name, 120) || str(r.name, 80) };
    ["job_title", "street", "city", "province", "postal_code", "personal_email", "personal_phone"].forEach((f) => { if (str(r[f])) body[f] = str(r[f], 200); });
    ["start_date", "birth_date"].forEach((f) => { if (ymdOk(r[f])) body[f] = r[f]; });
    if (r.pay_type) body.pay_type = lc(r.pay_type);
    if (money(r.pay_rate_cents) !== null) body.pay_rate_cents = money(r.pay_rate_cents);
    if (num(r.hours_per_week) !== null) body.hours_per_week = num(r.hours_per_week);
    if (String(r.sin || "").replace(/\D/g, "")) body.sin = String(r.sin);
    require(`${__hooks}/lib/hr.js`).save(tx, ctx, body);
    return u.id;
  },
};

function stamp(r, c) { r.set("updated_by", c.actor); r.set("@actor", c.actor); r.set("@device", c.device || ""); if (r.isNew()) { r.set("created_by", c.actor); if (c.device) r.set("device_id", c.device); } }

function target(name) { return T[name] || bad("Unknown import '" + name + "'."); }

function check(app, name, input) {
  const t = target(name);
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) bad("The file has no rows to import.");
  if (rows.length > MAX_ROWS) bad("Up to " + MAX_ROWS + " rows at a time: split the file.");
  const o = input.options || {};
  const seen = {};
  const results = rows.map((r) => {
    const out = { line: r.line, action: "create", errors: [], warnings: [], match: null, label: str(r.name || r.first_name || r.product || r.barcode || r.party || r.party_ref, 80) };
    let m = null;
    try { m = t.find(app, r); } catch (_) { m = null; }
    if (m) { out.match = m.id; out.action = o.on_existing === "update" && name === "parties" ? "update" : "skip"; if (out.action === "skip") out.warnings.push("Already in Chedam: left as it is."); }
    try { t.check(app, r, o, seen, out); } catch (err) { out.errors.push(String(err.message || err)); }
    return out;
  });
  const count = (f) => results.filter(f).length;
  return { target: name, results, summary: { rows: rows.length, create: count((x) => x.action === "create" && !x.errors.length), update: count((x) => x.action === "update" && !x.errors.length),
    skip: count((x) => x.action === "skip" && !x.errors.length), errors: count((x) => x.errors.length > 0), warnings: count((x) => x.warnings.length > 0) } };
}

function commit(app, name, input, ctx) {
  const t = target(name);
  const started = Date.now();
  const o = input.options || {};
  const exclude = {};
  (input.exclude || []).forEach((l) => { exclude[l] = true; });
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const pre = check(app, name, input);
  const results = [];
  const counts = { created: 0, updated: 0, drafts: 0, skipped: 0, excluded: 0, categories_created: 0 };
  let failedAt = null, error = "";
  try {
    app.runInTransaction((tx) => {
      rows.forEach((r, i) => {
        const pr = pre.results[i];
        if (exclude[r.line]) { counts.excluded++; results.push({ line: r.line, action: "excluded" }); return; }
        if (pr.errors.length) { failedAt = r.line; throw new BadRequestError("Line " + r.line + ": " + pr.errors[0] + " Fix it or exclude the line."); }
        if (pr.action === "skip") { counts.skipped++; results.push({ line: r.line, action: "skipped", id: pr.match || "" }); return; }
        failedAt = r.line;
        const existing = pr.match ? (name === "parties" ? tx.findRecordById("parties", pr.match) : tx.findRecordById(name === "staff" ? "users" : "customers", pr.match)) : null;
        const id = t.save.call(t, tx, r, o, ctx, existing, pr);
        failedAt = null;
        if (pr.action === "update") counts.updated++; else counts.created++;
        results.push({ line: r.line, action: pr.action === "update" ? "updated" : "created", id: id });
      });
    });
  } catch (err) {
    error = String((err && err.message) || err);
    if (failedAt && error.indexOf("Line ") !== 0) error = "Line " + failedAt + ": " + error;
  }
  const job = new Record(app.findCollectionByNameOrId("import_jobs"));
  job.load(Object.assign({ kind: name, file_name: str(input.file_name, 200), status: error ? "failed" : "completed", rows: rows.length,
    mapping: { columns: input.mapping || {}, options: o }, result: error ? [] : results, error: error.substring(0, 2000), seconds: Math.round((Date.now() - started) / 100) / 10 },
    error ? { created: 0, updated: 0, drafts: 0, skipped: 0, excluded: 0, categories_created: 0 } : counts));
  stamp(job, ctx);
  app.save(job);
  return require(`${__hooks}/lib/imports.js`).jobView(job);
}

// Saved column mappings (FR-11.08): the store's own, next to the ones built into the app
function templates(app, name) {
  return app.findRecordsByFilter("import_templates", "target = {:t} && deleted_at = ''", "name", 0, 0, { t: name }).map((x) => ({ id: x.id, name: x.getString("name"), target: x.getString("target"),
    columns: JSON.parse(x.getString("columns") || "{}") || {}, by: x.getString("by_name") }));
}
function saveTemplate(app, c, b) {
  const name = str(b.name, 80) || bad("Give the template a name.");
  const tg = ["products"].concat(Object.keys(T)).indexOf(b.target) >= 0 ? b.target : bad("Unknown import.");
  const cols = b.columns && typeof b.columns === "object" ? b.columns : bad("No columns.");
  const clean = {};
  Object.keys(cols).slice(0, 200).forEach((h) => { if (str(cols[h], 40)) clean[str(h, 120)] = str(cols[h], 40); });
  if (!Object.keys(clean).length) bad("No columns are mapped.");
  app.runInTransaction((tx) => {
    let r = tx.findRecordsByFilter("import_templates", "target = {:t} && name = {:n} && deleted_at = ''", "", 1, 0, { t: tg, n: name })[0];
    if (!r) { r = new Record(tx.findCollectionByNameOrId("import_templates")); r.set("target", tg); r.set("name", name); }
    r.set("columns", clean); r.set("by_name", c.user ? c.user.getString("name") : "");
    stamp(r, c); tx.save(r);
  });
  return templates(app, tg);
}
function removeTemplate(app, c, id) {
  let r;
  try { r = app.findRecordById("import_templates", id); } catch (_) { bad("Template not found."); }
  app.runInTransaction((tx) => { const x = tx.findRecordById("import_templates", r.id); x.set("deleted_at", new DateTime()); stamp(x, c); tx.save(x); });
  return templates(app, r.getString("target"));
}

module.exports = { TARGETS: T, check, commit, templates, saveTemplate, removeTemplate, perm: (n) => target(n).perm };

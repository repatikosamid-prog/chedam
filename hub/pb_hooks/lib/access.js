// Access control (FR-1.10, NFR-11, BR-33). One place decides who may do what:
//   effective permissions = role permissions + active "allow" overrides - active "deny" overrides;
//   the owner role holds every permission, including ones added by later phases.
// Every API request on a Chedam table passes guard() (pb_hooks/access.pb.js). Tables missing from
// TABLES are refused, so a new table is closed until someone decides who may use it.

const ANY = "any";

// Per table and action: null = never through the API; otherwise alternatives separated by "|":
// "any" (any active user), a permission code, "self" (the user's own record),
// "assignee" (task assigned to the user). Field-level limits for self/assignee are in FIELD_LIMITS.
const TABLES = {
  business:             { list: ANY, view: ANY, create: "setup.run", update: "business.edit", delete: null },
  locations:            { list: ANY, view: ANY, create: "business.edit", update: "business.edit", delete: null },
  settings:             { list: ANY, view: ANY, create: "settings.manage", update: "settings.manage", delete: null },
  modules:              { list: ANY, view: ANY, create: null, update: "modules.manage", delete: null },
  permissions:          { list: ANY, view: ANY, create: null, update: null, delete: null },
  roles:                { list: ANY, view: ANY, create: "access.manage", update: "access.manage", delete: "access.manage" },
  users:                { list: "users.view", view: "users.view|self", create: "users.manage", update: "users.manage|self", delete: null },
  permission_overrides: { list: "access.manage", view: "access.manage", create: "access.manage", update: "access.manage", delete: "access.manage" },
  devices:              { list: "devices.view", view: "devices.view", create: null, update: "devices.manage", delete: null },
  storage_areas:        { list: ANY, view: ANY, create: "storage.manage", update: "storage.manage", delete: null },
  tasks:                { list: "tasks.view", view: "tasks.view", create: "tasks.manage", update: "tasks.manage|assignee", delete: null },
  events:               { list: "events.view", view: "events.view", create: null, update: null, delete: null },
  backups:              { list: "backups.view", view: "backups.view", create: null, update: null, delete: null },
  updates:              { list: "updates.view", view: "updates.view", create: null, update: null, delete: null },
  // P1 catalogue and tax (prices of active products also need prices.edit: SPECIAL below)
  categories:           { list: ANY, view: ANY, create: "catalogue.edit", update: "catalogue.edit", delete: null },
  products:             { list: ANY, view: ANY, create: "catalogue.edit", update: "catalogue.edit", delete: null },
  selling_units:        { list: ANY, view: ANY, create: "catalogue.edit", update: "catalogue.edit", delete: null },
  price_history:        { list: ANY, view: ANY, create: null, update: null, delete: null },   // cost rows: hideCosts()
  tax_types:            { list: ANY, view: ANY, create: "tax.manage", update: "tax.manage", delete: null },
  tax_rates:            { list: ANY, view: ANY, create: "tax.manage", update: "tax.manage", delete: null },
  tax_classes:          { list: ANY, view: ANY, create: "tax.manage", update: "tax.manage", delete: null },
  deposits_fees:        { list: ANY, view: ANY, create: "tax.manage", update: "tax.manage", delete: null },
  // P1 stock: read by anyone (costs hidden, DL-72); changed only through /api/chedam/stock/... (BR-10)
  stock_levels:         { list: ANY, view: ANY, create: null, update: null, delete: null },
  stock_lots:           { list: ANY, view: ANY, create: null, update: null, delete: null },
  stock_movements:      { list: ANY, view: ANY, create: null, update: null, delete: null },
  stock_counts:         { list: ANY, view: ANY, create: null, update: null, delete: null },
  stock_count_lines:    { list: ANY, view: ANY, create: null, update: null, delete: null },
  // P1 selling: read by sellers and report readers; changed only through /api/chedam/sales and /tills (BR-10)
  tills:                { list: "sales.sell|sales.view|till.manage", view: "sales.sell|sales.view|till.manage", create: null, update: null, delete: null },
  cash_movements:       { list: "sales.view|till.manage", view: "sales.view|till.manage", create: null, update: null, delete: null },
  sales:                { list: "sales.sell|sales.view", view: "sales.sell|sales.view", create: null, update: null, delete: null },
  sale_lines:           { list: "sales.sell|sales.view", view: "sales.sell|sales.view", create: null, update: null, delete: null },
  payments:             { list: "sales.sell|sales.view", view: "sales.sell|sales.view", create: null, update: null, delete: null },
  tax_exemptions:       { list: "sales.view", view: "sales.view", create: null, update: null, delete: null },
  holds:                { list: "sales.sell", view: "sales.sell", create: null, update: null, delete: null },
  soft_holds:           { list: "sales.sell", view: "sales.sell", create: null, update: null, delete: null },
  // P1 returns (step 6): changed only through /api/chedam/returns. Store credit codes are money: the till
  // checks one code at a time through the hub; only managers and report readers list them.
  returns:              { list: "sales.sell|sales.view", view: "sales.sell|sales.view", create: null, update: null, delete: null },
  return_lines:         { list: "sales.sell|sales.view", view: "sales.sell|sales.view", create: null, update: null, delete: null },
  refunds:              { list: "sales.sell|sales.view", view: "sales.sell|sales.view", create: null, update: null, delete: null },
  store_credits:        { list: "sales.view|till.manage", view: "sales.view|till.manage", create: null, update: null, delete: null },
  // P1 labels (step 7): templates and layouts edited in the app; the batch changes through /api/chedam/labels.
  label_layouts:        { list: "labels.manage", view: "labels.manage", create: "labels.manage", update: "labels.manage", delete: null },
  label_templates:      { list: "labels.manage", view: "labels.manage", create: "labels.manage", update: "labels.manage", delete: null },
  label_batches:        { list: "labels.manage", view: "labels.manage", create: null, update: null, delete: null },
  label_batch_items:    { list: "labels.manage", view: "labels.manage", create: null, update: null, delete: null },
  // P1 import (step 8): written only by /api/chedam/imports.
  import_jobs:          { list: "catalogue.edit", view: "catalogue.edit", create: null, update: null, delete: null },
  // P2 promotions (step 1): read by anyone (the till shows deals); changed only through /api/chedam/promotions
  // and /api/chedam/scheduled-prices (checks and labels in one transaction).
  promotions:           { list: ANY, view: ANY, create: null, update: null, delete: null },
  scheduled_prices:     { list: ANY, view: ANY, create: null, update: null, delete: null },
  // P2 customers and loyalty (step 3): personal data, read by people who serve customers; changed only
  // through /api/chedam/customers (and sales/returns for points).
  customers:            { list: "customers.view", view: "customers.view", create: null, update: null, delete: null },
  loyalty_cards:        { list: "customers.manage", view: "customers.manage", create: null, update: null, delete: null },
  loyalty_ledger:       { list: "customers.view", view: "customers.view", create: null, update: null, delete: null },
  // P2 tasks and checklists (step 7): checklists are set up by managers; a day's run, handover notes and
  // tasks change through /api/chedam/checklists, /handover, /tasks. Documents (licences, insurance) are
  // kept by managers, through the generic API (their file is protected).
  checklists:           { list: "tasks.view", view: "tasks.view", create: "checklists.manage", update: "checklists.manage", delete: null },
  checklist_runs:       { list: "tasks.view", view: "tasks.view", create: null, update: null, delete: null },
  handover_notes:       { list: "tasks.view", view: "tasks.view", create: null, update: null, delete: null },
  documents:            { list: "documents.manage", view: "documents.manage", create: "documents.manage", update: "documents.manage", delete: null },
  // P2 messages (step 8): reads through the API and realtime are limited by the collection rules (members
  // only, migration 1791400006); every change goes through /api/chedam/messages and /announcements.
  channels:             { list: ANY, view: ANY, create: null, update: null, delete: null },
  messages:             { list: ANY, view: ANY, create: null, update: null, delete: null },
  channel_reads:        { list: ANY, view: ANY, create: null, update: null, delete: null },
  announcements:        { list: ANY, view: ANY, create: null, update: null, delete: null },
  announcement_acks:    { list: "announcements.manage", view: "announcements.manage", create: null, update: null, delete: null },
  // P2 pings (step 9): store-floor messages between devices; sent and confirmed through /api/chedam/pings.
  pings:                { list: ANY, view: ANY, create: null, update: null, delete: null },
  // P2 inbox (step 10): each person's own items (collection rule), changed through /api/chedam/inbox.
  inbox_items:          { list: ANY, view: ANY, create: null, update: null, delete: null },
  inbox_subs:           { list: ANY, view: ANY, create: null, update: null, delete: null },
  // P2 help (step 11): training videos, added by people who manage settings, watched by everyone.
  help_videos:          { list: ANY, view: ANY, create: "settings.manage", update: "settings.manage", delete: null },
  // P3 parties (step 1): vendors and clients, kept by managers; the log goes through /api/chedam/parties.
  parties:              { list: "parties.view|parties.manage", view: "parties.view|parties.manage", create: "parties.manage", update: "parties.manage", delete: null },
  party_contacts:       { list: "parties.view|parties.manage", view: "parties.view|parties.manage", create: "parties.manage", update: "parties.manage", delete: null },
  party_logs:           { list: "parties.view|parties.manage", view: "parties.view|parties.manage", create: null, update: null, delete: null },
  fx_rates:             { list: ANY, view: ANY, create: "parties.manage|settings.manage", update: "parties.manage|settings.manage", delete: null },
  // P3 purchasing (step 2): what each vendor sells us, at what cost; price lists through /api/chedam/vendors.
  vendor_products:      { list: "purchasing.view|purchasing.manage", view: "purchasing.view|purchasing.manage", create: "purchasing.manage", update: "purchasing.manage", delete: null },
  // P3 purchase orders (step 3): changed only through /api/chedam/purchase-orders.
  purchase_orders:      { list: "purchasing.view|purchasing.manage|stock.receive", view: "purchasing.view|purchasing.manage|stock.receive", create: null, update: null, delete: null },
  po_lines:             { list: "purchasing.view|purchasing.manage|stock.receive", view: "purchasing.view|purchasing.manage|stock.receive", create: null, update: null, delete: null },
  po_receipts:          { list: "purchasing.view|purchasing.manage|stock.receive", view: "purchasing.view|purchasing.manage|stock.receive", create: null, update: null, delete: null },
  // P3 bills and invoices (step 4): money documents, through /api/chedam/bills and /vendor-returns.
  bills:                { list: "finance.manage|purchasing.manage", view: "finance.manage|purchasing.manage", create: null, update: null, delete: null },
  bill_payments:        { list: "finance.manage", view: "finance.manage", create: null, update: null, delete: null },
  scan_matches:         { list: "purchasing.view|purchasing.manage|stock.receive", view: "purchasing.view|purchasing.manage|stock.receive", create: null, update: null, delete: null },
  // P3 expenses (step 6): claims through /api/chedam/expenses (everyone sees their own there), petty cash too.
  expenses:             { list: "expenses.approve", view: "expenses.approve", create: null, update: null, delete: null },
  petty_cash:           { list: "expenses.approve", view: "expenses.approve", create: null, update: null, delete: null },
  vendor_returns:       { list: "purchasing.view|purchasing.manage|finance.manage", view: "purchasing.view|purchasing.manage|finance.manage", create: null, update: null, delete: null },
};

// Fields a user may send when the only thing that matched was "self" / "assignee".
const FIELD_LIMITS = {
  self: ["name", "email", "phone", "language", "large_text", "high_contrast", "password", "passwordConfirm", "oldPassword", "avatar", "emailVisibility"],
  assignee: ["status", "note", "closed_at"],
};

// Never settable through the generic API (dedicated endpoints only), except by a superuser.
const PROTECTED = {
  users: ["pin", "pin_set", "pin_must_change", "pin_temp_expires_at", "pin_failed_count", "pin_locked_until", "recovery_code",
    "recovery_code_created_at", "verified", "tokenKey"],
  permission_overrides: ["granted_by"],
  modules: ["enabled_by", "enabled_at", "module", "kind"],
  business: ["setup_state"],                 // only /api/chedam/setup/step changes it
  // Status, keys and sign-in state change only through /api/chedam/devices/... (pairing, approve, lock, revoke)
  devices: ["status", "key_hash", "pairing_code_hash", "pairing_expires_at", "current_user", "last_seen_at", "app_version",
    "user_agent", "approved_by", "approved_at", "revoked_at", "paired_via", "paired_at", "deleted_at"],
  products: ["draft_reasons"],               // computed by the hub (DL-66)
  selling_units: ["base_qty"],               // computed by the hub (DL-64)
};

// Common fields are stamped by the event-log hook, so clients sending them changes nothing.
const IGNORED_BODY = ["id", "created_at", "updated_at", "created_by", "updated_by", "device_id", "collectionId", "collectionName", "expand"];

function forbid(msg) { throw new ForbiddenError(msg); }

// ---- Effective permissions -----------------------------------------------------------------

function roleOf(app, user) {
  const id = user.getString("role");
  if (!id) return null;
  try { return app.findRecordById("roles", id); } catch (_) { return null; }
}

function levelOf(app, user) {
  const r = roleOf(app, user);
  return r ? r.getInt("level") : 0;
}

function isOwner(app, user) {
  const r = roleOf(app, user);
  return !!r && r.getString("code") === "owner";
}

function permCodes(app, ids) {
  if (!ids || !ids.length) return [];
  return app.findRecordsByIds("permissions", ids).map((p) => p.getString("code"));
}

// Returns { code: { via: "role" | "override", expires_at } } for everything the user holds.
function effective(app, user) {
  const out = {};
  const role = roleOf(app, user);
  if (role && role.getString("code") === "owner") {
    app.findRecordsByFilter("permissions", "id != ''", "code", 0, 0)
      .forEach((p) => { out[p.getString("code")] = { via: "role", expires_at: "" }; });
    return out;
  }
  if (role) permCodes(app, role.get("permissions")).forEach((c) => { out[c] = { via: "role", expires_at: "" }; });

  const overrides = app.findRecordsByFilter("permission_overrides",
    "user = {:u} && deleted_at = '' && (expires_at = '' || expires_at > @now)", "created_at", 0, 0, { u: user.id });
  overrides.forEach((o) => {
    const code = permCodes(app, [o.getString("permission")])[0];
    if (!code) return;
    if (o.getString("effect") === "allow") out[code] = { via: "override", expires_at: o.getString("expires_at") };
  });
  overrides.forEach((o) => {
    const code = permCodes(app, [o.getString("permission")])[0];
    if (code && o.getString("effect") === "deny") delete out[code];
  });
  return out;
}

function can(app, user, code) {
  return !!effective(app, user)[code];
}

function isActive(user) {
  return !!user && user.collection().name === "users"
    && user.getString("status") === "active" && !user.getString("deleted_at");
}

// "Who can do this?" (FR-1.10)
function whoCan(app, code) {
  return app.findRecordsByFilter("users", "status = 'active' && deleted_at = ''", "name", 0, 0)
    .map((u) => ({ user: u, grant: effective(app, u)[code] }))
    .filter((x) => !!x.grant)
    .map((x) => ({ id: x.user.id, name: x.user.getString("name"),
      role: (roleOf(app, x.user) || { getString: () => "" }).getString("name"),
      via: x.grant.via, expires_at: x.grant.expires_at }));
}

// ---- Request guard ---------------------------------------------------------------------------

function bodyKeys(e) {
  const body = e.requestInfo().body || {};
  return Object.keys(body).filter((k) => IGNORED_BODY.indexOf(k) < 0);
}

// Returns which alternative allowed the action ("any", a code, "self", "assignee").
function match(app, spec, user, record) {
  const alts = spec.split("|");
  for (let i = 0; i < alts.length; i++) {
    const a = alts[i];
    if (a === ANY) return a;
    if (a === "self") { if (record && record.id === user.id) return a; continue; }
    if (a === "assignee") { if (record && record.getString("owner") === user.id) return a; continue; }
    if (can(app, user, a)) return a;
  }
  return "";
}

function guard(e, action) {
  if (e.hasSuperuserAuth()) return;
  const name = e.collection.name;
  if (name.charAt(0) === "_") return;          // PocketBase system collections keep their own rules
  const table = TABLES[name];
  if (!table) forbid("This table is not open to the app yet.");
  const spec = table[action];
  if (spec === null || spec === undefined) forbid("This action is not allowed.");
  const user = e.auth;
  if (!isActive(user)) throw new UnauthorizedError("Sign in as an active user.");

  const app = e.app;
  // For update/delete/view the existing record decides self/assignee; for create there is none yet.
  const existing = action === "create" || action === "list" ? null : e.record;
  // Lists of tables with costs: at most 200 a page. Every record runs the cost hook (lib/costs_hook.js),
  // and a page of 500 took the Pi Zero's hub past 200 MB (P1 gate load test, 2026-10-07).
  if (action === "list" && COST_FIELDS[name]) {
    const q = (e.requestInfo().query || {});
    const per = Number(q.perPage || 30);
    if (per > 200) throw new BadRequestError("Ask for at most 200 " + name.replace(/_/g, " ") + " at a time (perPage).");
  }
  const how = match(app, spec, user, existing);
  if (!how) forbid("You do not have permission for this.");

  if (action === "create" || action === "update") {
    const keys = bodyKeys(e);
    const prot = PROTECTED[name] || [];
    keys.forEach((k) => { if (prot.indexOf(k) >= 0) forbid("Field '" + k + "' cannot be changed here."); });
    const limit = FIELD_LIMITS[how];
    if (limit) keys.forEach((k) => { if (limit.indexOf(k) < 0) forbid("You may not change '" + k + "'."); });
  }

  const special = SPECIAL[name] && SPECIAL[name][action];
  if (special) special(e, app, user, how);
}

// ---- Table-specific rules (BR-33 and friends) --------------------------------------------------

function roleLevel(app, roleId) {
  if (!roleId) return 0;
  try { return app.findRecordById("roles", roleId).getInt("level"); } catch (_) { forbid("Unknown role."); }
}

// BR-33: a non-owner may only act on people below their own level and may not hand out a role
// holding permissions they lack.
function checkRoleGrant(app, actor, roleId) {
  if (!roleId || isOwner(app, actor)) return;
  if (roleLevel(app, roleId) >= levelOf(app, actor)) forbid("You can only give roles below your own.");
  const mine = effective(app, actor);
  const role = app.findRecordById("roles", roleId);
  permCodes(app, role.get("permissions")).forEach((c) => {
    if (!mine[c]) forbid("That role holds '" + c + "', which you do not have.");
  });
}

function checkTargetUser(app, actor, target) {
  if (isOwner(app, actor)) return;
  if (target.id === actor.id) return;
  if (levelOf(app, target) >= levelOf(app, actor)) forbid("You can only manage people below your own level.");
}

const SPECIAL = {
  users: {
    create: (e, app, actor) => {
      const keys = bodyKeys(e);
      if (keys.indexOf("role") >= 0 && !can(app, actor, "access.manage") && e.record.getString("role")) {
        forbid("Giving a role needs access.manage.");
      }
      checkRoleGrant(app, actor, e.record.getString("role"));
      if (!e.record.getString("status")) e.record.set("status", "active");
      // Staff without an email still need a password for the auth collection; they sign in by PIN.
      if (keys.indexOf("password") < 0) e.record.setRandomPassword();
    },
    update: (e, app, actor, how) => {
      const keys = bodyKeys(e);
      const orig = e.record.original();
      if (how !== "self") checkTargetUser(app, actor, orig);
      if (keys.indexOf("role") >= 0 && e.record.getString("role") !== orig.getString("role")) {
        if (!can(app, actor, "access.manage")) forbid("Changing a role needs access.manage.");
        if (orig.id === actor.id) forbid("You cannot change your own role.");
        checkRoleGrant(app, actor, e.record.getString("role"));
      }
      if (keys.indexOf("password") >= 0 && how !== "self" && !isOwner(app, actor) && levelOf(app, orig) >= levelOf(app, actor)) {
        forbid("You cannot reset this person's password.");
      }
      // Suspending, removing or deleting someone signs them out everywhere.
      const leaving = (keys.indexOf("status") >= 0 && e.record.getString("status") !== "active")
        || (keys.indexOf("deleted_at") >= 0 && e.record.getString("deleted_at"));
      if (leaving) {
        if (orig.id === actor.id) forbid("You cannot suspend or remove yourself.");
        e.record.refreshTokenKey();
      }
    },
  },
  roles: {
    create: (e, app, actor) => {
      if (!isOwner(app, actor)) {
        if (e.record.getInt("level") >= levelOf(app, actor)) forbid("New roles must be below your own level.");
        const mine = effective(app, actor);
        permCodes(app, e.record.get("permissions")).forEach((c) => { if (!mine[c]) forbid("You do not hold '" + c + "'."); });
      }
      e.record.set("is_template", false);
    },
    update: (e, app, actor) => {
      const orig = e.record.original();
      if (orig.getBool("is_template") && !isOwner(app, actor)) forbid("Only the owner can change role templates.");
      if (orig.getString("code") === "owner" && bodyKeys(e).some((k) => k === "permissions" || k === "level" || k === "code")) {
        forbid("The owner role always holds everything.");
      }
      if (!isOwner(app, actor)) {
        if (orig.getInt("level") >= levelOf(app, actor) || e.record.getInt("level") >= levelOf(app, actor)) {
          forbid("You can only edit roles below your own level.");
        }
        const mine = effective(app, actor);
        permCodes(app, e.record.get("permissions")).forEach((c) => { if (!mine[c]) forbid("You do not hold '" + c + "'."); });
      }
      if (bodyKeys(e).indexOf("is_template") >= 0) e.record.set("is_template", orig.getBool("is_template"));
    },
    delete: (e, app, actor) => {
      if (e.record.getBool("is_template")) forbid("Role templates cannot be deleted.");
      if (!isOwner(app, actor) && e.record.getInt("level") >= levelOf(app, actor)) forbid("You can only delete roles below your own level.");
      const used = app.findRecordsByFilter("users", "role = {:r}", "", 1, 0, { r: e.record.id });
      if (used.length) forbid("This role is still given to someone.");
    },
  },
  permission_overrides: {
    create: (e, app, actor) => overrideCheck(e, app, actor, e.record),
    update: (e, app, actor) => { overrideCheck(e, app, actor, e.record.original()); overrideCheck(e, app, actor, e.record); },
    delete: (e, app, actor) => overrideCheck(e, app, actor, e.record),
  },
  modules: {
    update: (e, app, actor) => {
      const keys = bodyKeys(e);
      keys.forEach((k) => { if (k !== "enabled") forbid("Only 'enabled' can be changed on a module."); });
      const kind = e.record.original().getString("kind");
      if (kind === "core" && !e.record.getBool("enabled")) forbid("Core modules are always on.");
      if (kind === "later" && e.record.getBool("enabled")) forbid("This module is not available yet.");
      e.record.set("enabled_by", "users:" + actor.id);
      e.record.set("enabled_at", e.record.getBool("enabled") ? new DateTime() : "");
    },
  },
  devices: {
    // Rename, change type, assign a person or printer. A personal device is managed only by people
    // above its person, and only people below you can be assigned (BR-33).
    update: (e, app, actor) => {
      const before = e.record.original().getString("assigned_user");
      const after = e.record.getString("assigned_user");
      [before, after].forEach((id) => {
        if (!id || id === actor.id) return;
        let u;
        try { u = app.findRecordById("users", id); } catch (_) { forbid("Unknown person."); }
        checkTargetUser(app, actor, u);
      });
    },
  },
  business: {
    create: (e, app) => {
      if (app.findRecordsByFilter("business", "deleted_at = ''", "", 1, 0).length) forbid("The business profile already exists.");
    },
  },
  settings: {
    create: (e, app, actor) => { if (e.record.getString("key").indexOf("security.") === 0 && !isOwner(app, actor)) forbid("Only the owner can change security settings."); },
    update: (e, app, actor) => {
      if (bodyKeys(e).indexOf("key") >= 0) forbid("A setting's key cannot be renamed.");
      if (e.record.getString("key").indexOf("security.") === 0 && !isOwner(app, actor)) forbid("Only the owner can change security settings.");
    },
  },
};

// DL-67: what a customer pays changes only with prices.edit: activating a product, or a price on an
// active product's selling unit.
function checkPriceChange(app, actor, product, unitPriceChanged) {
  if (can(app, actor, "prices.edit")) return;
  if (unitPriceChanged && product && product.getString("status") === "active") forbid("Changing the price of an active product needs prices.edit.");
}

SPECIAL.products = {
  create: (e, app, actor) => {
    if (e.record.getString("status") === "active" && !can(app, actor, "prices.edit")) forbid("Making a product active needs prices.edit.");
  },
  update: (e, app, actor) => {
    const was = e.record.original().getString("status");
    if (e.record.getString("status") === "active" && was !== "active" && !can(app, actor, "prices.edit")) {
      forbid("Making a product active needs prices.edit.");
    }
  },
};

// Classes added through the app are custom; the standard ones come from migrations.
SPECIAL.tax_classes = {
  create: (e) => { e.record.set("is_custom", true); },
  update: (e) => { e.record.set("is_custom", e.record.original().getBool("is_custom")); },
};

SPECIAL.selling_units = {
  create: (e, app, actor) => {
    let product = null;
    try { product = app.findRecordById("products", e.record.getString("product")); } catch (_) { /* validated later */ }
    checkPriceChange(app, actor, product, true);
  },
  update: (e, app, actor) => {
    const orig = e.record.original();
    let product = null;
    try { product = app.findRecordById("products", orig.getString("product")); } catch (_) { /* validated later */ }
    if (e.record.getString("product") !== orig.getString("product")) forbid("A selling unit cannot move to another product.");
    const priceChanged = e.record.getInt("price_cents") !== orig.getInt("price_cents")
      || (!!e.record.getString("deleted_at") && !orig.getString("deleted_at"));
    checkPriceChange(app, actor, product, priceChanged);
  },
};

function overrideCheck(e, app, actor, rec) {
  const targetId = rec.getString("user");
  if (targetId === actor.id) forbid("You cannot change your own access.");
  let target;
  try { target = app.findRecordById("users", targetId); } catch (_) { forbid("Unknown person."); }
  checkTargetUser(app, actor, target);
  const perm = app.findRecordById("permissions", rec.getString("permission"));
  if (perm.getBool("owner_only") && !isOwner(app, actor)) forbid("Only the owner can grant or remove '" + perm.getString("code") + "'.");
  if (rec.getString("effect") === "allow" && !can(app, actor, perm.getString("code"))) {
    forbid("You cannot grant '" + perm.getString("code") + "' because you do not hold it.");
  }
  if (e.record === rec) e.record.set("granted_by", "users:" + actor.id);
}

// DL-72: costs and margins only for people with costs.view (not cashiers). Applied to every record
// the API returns (lists, views, realtime) through onRecordEnrich.
const COST_FIELDS = { products: ["cost_cents"], price_history: ["old_cents", "new_cents"], stock_lots: ["cost_cents"],
  stock_movements: ["cost_cents", "value_cents", "lots_taken"], sales: ["cost_cents"], sale_lines: ["cost_cents", "lots"],
  returns: ["cost_cents"], return_lines: ["cost_cents"] };

function hideCosts(e) {
  const name = e.record.collection().name;
  const fields = COST_FIELDS[name];
  if (!fields) return;
  if (name === "price_history" && e.record.getString("field") !== "cost") return;
  const info = e.requestInfo;
  const auth = info && info.auth;
  if (info && info.superuserAuth && info.superuserAuth()) return;
  if (auth && auth.collection().name === "_superusers") return;
  if (auth && isActive(auth) && can(e.app, auth, "costs.view")) return;
  fields.forEach((f) => e.record.hide(f));
}

module.exports = { hideCosts, COST_FIELDS, TABLES, effective, can, whoCan, guard, isActive, isOwner, levelOf, roleOf, checkTargetUser, checkPriceChange };

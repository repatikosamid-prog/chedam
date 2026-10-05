/// <reference path="../pb_data/types.d.ts" />
// Setup wizard endpoints (P0 step 6). Logic: lib/setup.js.

// A new hub gets its one-time setup code when it starts (shown on the monitor, printed by setup-hub.sh).
// At startup the tables may not exist yet on a brand-new hub, so a once-a-minute job and the status
// endpoint make sure of it too.
onBootstrap((e) => {
  e.next();
  try { require(`${__hooks}/lib/setup.js`).ensureCode(e.app); } catch (_) { /* tables not ready: the job below does it */ }
});
cronAdd("chedam_setup_code", "* * * * *", () => {
  require(`${__hooks}/lib/setup.js`).ensureCode($app);
});

// Does this hub still need setting up? Open to anyone; the step list only for people with setup.run.
routerAdd("GET", "/api/chedam/setup/status", (e) => {
  const setup = require(`${__hooks}/lib/setup.js`);
  const access = require(`${__hooks}/lib/access.js`);
  const out = { needs_setup: !setup.ownerExists(e.app) };
  if (out.needs_setup && !setup.readCode(e.app)) setup.ensureCode(e.app);
  const mayRun = e.hasSuperuserAuth() || (access.isActive(e.auth) && access.can(e.app, e.auth, "setup.run"));
  if (mayRun) {
    const b = setup.business(e.app);
    const s = b ? setup.state(b) : { steps: {} };
    out.business_id = b ? b.id : "";
    out.steps = setup.STEPS.map((id) => ({ id: id, status: s.steps[id] ? s.steps[id].status : "" }));
    out.completed_at = s.completed_at || "";
  }
  return e.json(200, out);
});

// First device of a new store: setup code + owner details. Creates the business, the primary location,
// the owner (password, PIN, recovery code shown once) and pairs this device, in one transaction.
routerAdd("POST", "/api/chedam/setup/start", (e) => {
  const setup = require(`${__hooks}/lib/setup.js`);
  const devices = require(`${__hooks}/lib/devices.js`);
  const auth = require(`${__hooks}/lib/auth.js`);
  if (setup.ownerExists(e.app)) throw new BadRequestError("This store is already set up. Sign in instead.");
  devices.checkPairingPause(e.app);

  const body = e.requestInfo().body || {};
  const code = devices.normCode(body.code);
  const expected = setup.readCode(e.app);
  if (!code || !expected || !$security.equal(code, expected)) {
    devices.pairingFailed(e.app);
    throw new BadRequestError("Wrong setup code. It is shown on the hub's screen and at the end of the hub setup.");
  }
  const o = body.owner || {};
  const name = String(o.name || "").replace(/\s+/g, " ").trim().substring(0, 120);
  const email = String(o.email || "").trim().toLowerCase();
  const password = String(o.password || "");
  const pin = String(o.pin || "");
  if (!name) throw new BadRequestError("Enter the owner's name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestError("Enter a valid email address for the owner.");
  if (password.length < 10) throw new BadRequestError("The password needs at least 10 characters.");
  const pinProblem = auth.pinProblem(pin);
  if (pinProblem) throw new BadRequestError(pinProblem);
  const devName = devices.cleanName(body.device_name || "Owner's device");
  const devType = devices.checkType(body.device_type || "phone");
  const language = /^[a-z]{2}(-[A-Z]{2})?$/.test(String(body.language || "")) ? String(body.language) : "en";

  const ACT = "system:setup";
  const stamp = (r, dev) => { r.set("created_by", ACT); r.set("updated_by", ACT); r.set("@actor", ACT); r.set("@device", dev || ""); if (dev) r.set("device_id", dev); };
  const key = devices.newKey();
  const recovery = auth.newRecoveryCode();
  let owner, dev;

  e.app.runInTransaction((tx) => {
    dev = new Record(tx.findCollectionByNameOrId("devices"));
    dev.load({ name: devName, type: devType, status: "approved", paired_via: "setup" });
    dev.set("key_hash", devices.hash(key));
    dev.set("approved_by", ACT);
    dev.set("approved_at", new DateTime());
    dev.set("paired_at", new DateTime());
    dev.set("user_agent", String(e.requestInfo().headers["user_agent"] || "").substring(0, 400));
    stamp(dev, "");
    tx.save(dev);
    dev.set("device_id", dev.id);

    let tz = "America/Vancouver", currency = "CAD";
    try { tz = JSON.parse(tx.findFirstRecordByData("settings", "key", "store.time_zone").getString("value")); } catch (_) { /* default */ }
    try { currency = JSON.parse(tx.findFirstRecordByData("settings", "key", "store.currency").getString("value")); } catch (_) { /* default */ }
    let b = setup.business(tx);
    if (!b) {
      b = new Record(tx.findCollectionByNameOrId("business"));
      b.load({ currency: currency, time_zone: tz, fiscal_year_start: "01-01", tax_display_mode: "tax_added" });
    }
    const st = setup.state(b);
    const now = new Date().toISOString();
    ["language", "time", "owner"].forEach((s) => { st.steps[s] = { status: "done", at: now }; });
    st.started_at = st.started_at || now;
    b.set("setup_state", st);
    b.set("language", language);
    stamp(b, dev.id);
    tx.save(b);
    if (!tx.findRecordsByFilter("locations", "deleted_at = ''", "", 1, 0).length) {
      const loc = new Record(tx.findCollectionByNameOrId("locations"));
      loc.load({ name: "Main store", is_primary: true });
      stamp(loc, dev.id);
      tx.save(loc);
    }

    owner = new Record(tx.findCollectionByNameOrId("users"));
    owner.load({ name: name, email: email, emailVisibility: false, verified: true, status: "active", language: language,
      role: tx.findFirstRecordByData("roles", "code", "owner").id });
    owner.setPassword(password);
    owner.set("pin", pin);
    owner.set("pin_set", true);
    owner.set("recovery_code", recovery);
    owner.set("recovery_code_created_at", new DateTime());
    stamp(owner, dev.id);
    tx.save(owner);

    dev.set("current_user", owner.id);
    stamp(dev, dev.id);
    tx.save(dev);
  });

  setup.ensureCode(e.app);       // owner exists now: the code is deleted and the monitor message changes
  return $apis.recordAuthResponse(e, owner, "setup", { device_id: dev.id, key: key, device_name: devName, recovery_code: recovery });
});

// Mark a wizard step done or skipped (skipped steps become tasks; doing them later closes the task).
routerAdd("POST", "/api/chedam/setup/step", (e) => {
  const setup = require(`${__hooks}/lib/setup.js`);
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "setup.run")) throw new ForbiddenError("Only the owner runs the setup wizard.");
  }
  const body = e.requestInfo().body || {};
  const actor = e.auth ? e.auth.collection().name + ":" + e.auth.id : "system";
  const device = require(`${__hooks}/lib/devices.js`).currentId(e);
  const s = setup.mark(e.app, String(body.step || ""), String(body.status || ""), actor, device);
  return e.json(200, { steps: setup.STEPS.map((id) => ({ id: id, status: s.steps[id] ? s.steps[id].status : "" })), completed_at: s.completed_at || "" });
});

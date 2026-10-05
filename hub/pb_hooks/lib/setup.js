// Setup wizard (FR-1.01-1.06, 1.13, 1.15).
// A new hub (no owner yet) makes a one-time SETUP CODE (DL-44, Sreya 2026-10-05). It is kept only in
// pb_data/setup-code, shown on the hub's monitor (pb_data/console.issue, picked up by the login screen)
// and printed by setup-hub.sh. The first device sends it with the owner's details; start() then creates
// the business, the primary location, the owner (password, PIN, recovery code) and pairs that device,
// all in one transaction, and the code is deleted. The other steps run as the signed-in owner.
// Each step is "done" or "skipped"; a skipped step becomes a task (rule_key "setup:<step>") and doing
// it later closes the task. The wizard can be run again to edit; it never deletes anything.

const STEPS = ["language", "time", "owner", "business", "branding", "people", "storage", "modules", "references", "backup"];

const TASKS = {
  business: "Finish setup: business profile",
  branding: "Finish setup: logo and receipt",
  people: "Finish setup: add your team",
  storage: "Finish setup: storage areas",
  modules: "Finish setup: choose features",
  references: "Optional: add bank, accountant and other references",
  backup: "Finish setup: choose a backup USB drive",
};

const CODE_FILE = "setup-code";
const ISSUE_FILE = "console.issue";

function path(app, name) { return app.dataDir() + "/" + name; }

function ownerExists(app) {
  let role;
  try { role = app.findFirstRecordByData("roles", "code", "owner"); } catch (_) { return false; }
  return app.findRecordsByFilter("users", "role = {:r} && status = 'active' && deleted_at = ''", "", 1, 0, { r: role.id }).length > 0;
}

function readCode(app) {
  try { return toString($os.readFile(path(app, CODE_FILE))).trim(); } catch (_) { return ""; }
}

function writeIssue(app, text) {
  try { $os.writeFile(path(app, ISSUE_FILE), text, 420); } catch (_) { /* dev PC: no console */ }   // 420 = 0644
}

// Called when the hub starts: a new hub gets a code (kept across restarts); a set-up hub has none.
// \4 is replaced by the hub's IPv4 address on the login screen (agetty).
function ensureCode(app) {
  if (ownerExists(app)) {
    try { $os.remove(path(app, CODE_FILE)); } catch (_) { /* none */ }
    writeIssue(app, "Chedam hub: https://\\4\n\n");
    return "";
  }
  let code = readCode(app);
  if (!code) {
    code = require(`${__hooks}/lib/devices.js`).newCode();
    $os.writeFile(path(app, CODE_FILE), code + "\n", 416);   // 416 = 0640
  }
  writeIssue(app, "\nChedam is ready for setup.\nOn a phone or computer on this Wi-Fi, open  https://\\4\nSetup code:  " + code + "\n\n");
  return code;
}

function business(app) {
  const list = app.findRecordsByFilter("business", "deleted_at = ''", "created_at", 1, 0);
  return list.length ? list[0] : null;
}

function state(rec) {
  let s = {};
  try { s = JSON.parse(rec.getString("setup_state") || "{}") || {}; } catch (_) { s = {}; }
  if (!s.steps) s.steps = {};
  return s;
}

// Marks a step done or skipped; keeps the "Finish setup" tasks in line. Returns the new state.
function mark(app, step, status, actor, device) {
  if (STEPS.indexOf(step) < 0) throw new BadRequestError("Unknown setup step.");
  if (status !== "done" && status !== "skipped") throw new BadRequestError("A step is done or skipped.");
  const b = business(app);
  if (!b) throw new BadRequestError("Setup has not started.");
  const s = state(b);
  s.steps[step] = { status: status, at: new Date().toISOString() };
  const left = STEPS.filter((x) => !s.steps[x] || s.steps[x].status !== "done");
  s.completed_at = left.length === 0 ? (s.completed_at || new Date().toISOString()) : "";
  b.set("setup_state", s);
  b.set("updated_by", actor); b.set("@actor", actor); b.set("@device", device || "");
  app.save(b);

  if (TASKS[step]) {
    const key = "setup:" + step;
    const open = app.findRecordsByFilter("tasks", "rule_key = {:k} && status = 'open' && deleted_at = ''", "", 0, 0, { k: key });
    if (status === "skipped" && open.length === 0) {
      const t = new Record(app.findCollectionByNameOrId("tasks"));
      t.load({ title: TASKS[step], kind: "setup_incomplete", source: "rule", rule_key: key, status: "open", priority: "normal",
        link_collection: "business", link_id: b.id });
      t.set("created_by", actor); t.set("updated_by", actor); t.set("device_id", device || "");
      t.set("@actor", actor); t.set("@device", device || "");
      app.save(t);
    }
    if (status === "done") {
      open.forEach((t) => {
        t.set("status", "done"); t.set("closed_at", new DateTime());
        t.set("updated_by", actor); t.set("@actor", actor); t.set("@device", device || "");
        app.save(t);
      });
    }
  }
  return s;
}

module.exports = { STEPS, TASKS, ownerExists, readCode, ensureCode, business, state, mark, writeIssue };

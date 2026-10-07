// Rule tasks (FR-2.02 groundwork): one task per rule_key that opens while a condition holds and closes
// when it clears. When the condition returns, the last closed task is reopened (DL-71).

// n > 0: open (or retitle) the task; n = 0: close it.
function syncRuleTask(app, key, n, title, fields, actor) {
  const who = actor || "system:rules";
  const stamp = (t) => { t.set("updated_by", who); t.set("@actor", who); };
  const open = app.findRecordsByFilter("tasks", "rule_key = {:k} && status = 'open' && deleted_at = ''", "", 0, 0, { k: key });
  if (n > 0 && !open.length) {
    const last = app.findRecordsByFilter("tasks", "rule_key = {:k} && status = 'done' && deleted_at = ''", "-updated_at", 1, 0, { k: key });
    const t = last.length ? last[0] : new Record(app.findCollectionByNameOrId("tasks"));
    t.load(Object.assign({ title: title, source: "rule", rule_key: key, status: "open", priority: "normal", closed_at: "" }, fields || {}));
    if (t.isNew()) t.set("created_by", who);
    stamp(t);
    app.save(t);
  } else if (n > 0 && open[0].getString("title") !== title) {
    open[0].set("title", title); stamp(open[0]); app.save(open[0]);
  } else if (n === 0) {
    open.forEach((t) => { t.set("status", "done"); t.set("closed_at", new DateTime()); stamp(t); app.save(t); });
  }
}

module.exports = { syncRuleTask };

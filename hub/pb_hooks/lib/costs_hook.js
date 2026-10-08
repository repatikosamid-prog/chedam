// Hiding costs and margins from people without costs.view (DL-72), on every record a list or view sends.
// Kept small on purpose: it runs once per record (a list of 500 products runs it 500 times). The P1 gate
// load test (2026-10-07) found the old version, which loaded the whole access library and asked the
// database for the person's role and overrides for every record, took the hub from 51 to 416 MB.
// The answer "may this person see costs" is kept in the hub's shared store for 10 seconds.
// The tables and fields are lib/access.js COST_FIELDS (the same list, checked by a test).

const COST = {
  products: ["cost_cents"], price_history: ["old_cents", "new_cents"], stock_lots: ["cost_cents"],
  stock_movements: ["cost_cents", "value_cents", "lots_taken"], sales: ["cost_cents"], sale_lines: ["cost_cents", "lots"],
  returns: ["cost_cents"], return_lines: ["cost_cents"],
};
const TTL_MS = 10000;

function hide(e) {
  const rec = e.record;
  const name = rec.collection().name;
  const fields = COST[name];
  if (!fields) return;
  if (name === "price_history" && rec.getString("field") !== "cost") return;
  const info = e.requestInfo;
  const auth = info && info.auth;
  if (auth && auth.collection().name === "_superusers") return;
  if (auth && auth.collection().name === "users") {
    const key = "chedam.costs." + auth.id;
    const store = e.app.store();
    const c = store.get(key);
    let ok;
    if (c && Date.now() - c.at < TTL_MS) ok = c.ok;
    else {
      const access = require(`${__hooks}/lib/access.js`);
      ok = access.isActive(auth) && access.can(e.app, auth, "costs.view");
      store.set(key, { ok: ok, at: Date.now() });
    }
    if (ok) return;
  }
  fields.forEach((f) => rec.hide(f));
}

module.exports = { hide, COST };

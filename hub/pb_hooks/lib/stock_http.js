// Request helpers for stock.pb.js: who and which device, permission check, idempotent operations.
// Changes carry an op_id made on the device: sending the same op again returns the first result and
// changes nothing (a phone retrying after a dropped answer, BR-10).

function ctx(e, perm) {
  const access = require(`${__hooks}/lib/access.js`);
  const devices = require(`${__hooks}/lib/devices.js`);
  const su = e.hasSuperuserAuth();
  if (!su) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (perm && !perm.split("|").some((p) => access.can(e.app, e.auth, p))) throw new ForbiddenError("You do not have permission for this.");
  }
  const body = e.requestInfo().body || {};
  const op = String(body.op_id || "");
  if (op && !/^[A-Za-z0-9_-]{8,40}$/.test(op)) throw new BadRequestError("Invalid op_id.");
  return {
    actor: su ? "system:superuser" : devices.actorOf(e),
    device: devices.currentId(e),
    op: op,
    body: body,
    can: (p) => su || access.can(e.app, e.auth, p),
  };
}

function moveView(m, showCost) {
  const v = { id: m.id, type: m.getString("type"), status: m.getString("status"), product: m.getString("product"),
    qty_base: m.getFloat("qty_base"), selling_unit: m.getString("selling_unit"), unit_qty: m.getFloat("unit_qty"),
    reason: m.getString("reason"), lot: m.getString("lot") };
  if (showCost) v.value_cents = m.getInt("value_cents");
  return v;
}

// Runs fn(tx) once per op_id; a repeat returns the movements of the first run.
function once(e, ctx, fn) {
  const show = ctx.can("costs.view");
  if (ctx.op) {
    const done = e.app.findRecordsByFilter("stock_movements", "op_id = {:o}", "op_line", 0, 0, { o: ctx.op });
    if (done.length) return e.json(200, { duplicate: true, movements: done.map((m) => moveView(m, show)) });
  }
  let out = [];
  e.app.runInTransaction((tx) => {
    const r = fn(tx);
    out = Array.isArray(r) ? r : [r];
  });
  return e.json(200, { duplicate: false, movements: out.map((m) => moveView(m, show)) });
}

module.exports = { ctx, moveView, once };

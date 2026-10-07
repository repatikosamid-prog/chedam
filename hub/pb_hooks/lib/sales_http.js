// Request helpers for sales.pb.js: who, which device, permission check, one transaction per request.

function ctx(e, perm) {
  const access = require(`${__hooks}/lib/access.js`);
  const devices = require(`${__hooks}/lib/devices.js`);
  const su = e.hasSuperuserAuth();
  if (!su) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (perm && !perm.split("|").some((p) => access.can(e.app, e.auth, p))) throw new ForbiddenError("You do not have permission for this.");
  }
  const can = (p) => su || access.can(e.app, e.auth, p);
  return {
    actor: su ? "system:superuser" : devices.actorOf(e),
    device: devices.currentId(e),
    user: su ? null : e.auth,
    op: "",
    can: can,
    showCost: can("costs.view"),
    body: e.requestInfo().body || {},
  };
}

// Runs fn in one transaction. fn may return {refused: status, message, quote}: nothing is saved and the
// till gets the status, the message and the hub's prices.
function run(e, fn) {
  let out = null, refused = null;
  try {
    e.app.runInTransaction((tx) => {
      out = fn(tx);
      if (out && out.refused) { refused = out; throw new BadRequestError(out.message); }
    });
  } catch (err) {
    if (!refused) throw err;
    return e.json(refused.refused, { status: refused.refused, message: refused.message, data: { quote: refused.quote } });
  }
  return e.json(200, out);
}

module.exports = { ctx, run };

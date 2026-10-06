/// <reference path="../pb_data/types.d.ts" />
// Hub health page (P0 step 8, FR-12.09). Logic: lib/health.js. Needs health.view (owner, manager).

routerAdd("GET", "/api/chedam/health", (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth()) {
    if (!access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
    if (!access.can(e.app, e.auth, "health.view")) throw new ForbiddenError("You do not have permission for this.");
  }
  const fresh = e.request.url.query().get("fresh") === "1";
  return e.json(200, require(`${__hooks}/lib/health.js`).report(e.app, fresh));
});

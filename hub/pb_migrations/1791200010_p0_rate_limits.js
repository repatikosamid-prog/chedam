/// <reference path="../../pb_data/types.d.ts" />
// P0 gate (NFR-08, memory < 150 MB): per-device rate limits, so a misbehaving or buggy device cannot
// flood the hub. Load test 2026-10-05: 10 devices at realistic load peak at 108 MB, but 50 audit-log
// reads at once from one device reached 194 MB. Limits are far above what a till uses (about 3 requests
// per second). Excess requests get 429 ("try again shortly").
// PocketBase runs behind Caddy, so the device's address comes from X-Forwarded-For, which Caddy sets
// itself (it ignores what the device sends). Requests made on the hub itself (127.0.0.1: deploy and
// health scripts, tests) are not limited.

const RULES = [
  { label: "events:list", audience: "", duration: 3, maxRequests: 10 },          // audit log pages: heaviest reads
  { label: "*:list", audience: "", duration: 3, maxRequests: 40 },
  { label: "POST /api/chedam/auth/pin", audience: "", duration: 10, maxRequests: 15 },   // bcrypt: CPU-heavy
  { label: "/api/", audience: "", duration: 3, maxRequests: 150 },
];

migrate((app) => {
  const s = app.settings();
  s.trustedProxy.headers = ["X-Forwarded-For"];
  s.trustedProxy.useLeftmostIP = false;
  s.rateLimits.enabled = true;
  s.rateLimits.excludedIPs = ["127.0.0.1", "::1"];
  s.rateLimits.rules = RULES;
  app.save(s);
}, (app) => {
  const s = app.settings();
  s.rateLimits.enabled = false;
  s.rateLimits.rules = [];
  s.rateLimits.excludedIPs = [];
  s.trustedProxy.headers = [];
  app.save(s);
});

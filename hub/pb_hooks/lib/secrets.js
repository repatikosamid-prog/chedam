// Secrets of connected services (P5-c): the card processor's access token, cloud drive refresh tokens.
// Encrypted with the hub's own key (pb_data/chedam-secrets.key, made on first use; saved with every backup by
// chedam-backup, like chedam-hr.key) and kept in hidden fields, so they never reach the API, the event log,
// exports or the data export. Only hub code reads them back, to call the service.

function key(app) {
  const path = app.dataDir() + "/chedam-secrets.key";
  let k = "";
  try { k = String(toString($os.readFile(path))).trim(); } catch (_) { k = ""; }
  if (k.length !== 32) { k = $security.randomString(32); $os.writeFile(path, k, 0o600); }
  return k;
}

const seal = (app, text) => (text ? $security.encrypt(String(text), key(app)) : "");
const open = (app, text) => { if (!text) return ""; try { return $security.decrypt(text, key(app)); } catch (_) { return ""; } };

// "abcd…wxyz" for screens and logs: never more than the ends of a secret
function hint(text) {
  const s = String(text || "");
  return s.length > 12 ? s.substring(0, 4) + "…" + s.substring(s.length - 4) : (s ? "…" : "");
}

module.exports = { seal, open, hint };

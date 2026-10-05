// Connectivity status (FR-12.01). check() runs once a minute (status.pb.js) and keeps the result in
// memory; status() answers the client's connectivity bar. Later phases read online() to pause and
// resume connected services.

const KEY = "chedam.net";

function setting(app, key, fallback) {
  return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback);
}

// Current Wi-Fi network name ("" when not on Wi-Fi or NetworkManager is missing, e.g. on the dev PC).
function ssid() {
  try {
    const out = toString($os.cmd("nmcli", "-t", "-f", "ACTIVE,SSID", "dev", "wifi", "list", "--rescan", "no").output());
    const line = out.split("\n").find((l) => l.indexOf("yes:") === 0);
    return line ? line.substring(4).replace(/\\:/g, ":").trim() : "";
  } catch (_) {
    return "";
  }
}

function check(app) {
  let ok = false;
  try {
    const res = $http.send({ url: setting(app, "network.check_url", "http://cp.cloudflare.com/generate_204"), method: "GET", timeout: 4 });
    ok = res.statusCode === 204 || res.statusCode === 200;
  } catch (_) {
    ok = false;
  }
  const hotspots = setting(app, "network.hotspot_ssids", []) || [];
  const wifi = ssid();
  const result = {
    internet: !ok ? "offline" : (wifi && hotspots.indexOf(wifi) >= 0 ? "hotspot" : "router"),
    checked_at: new Date().toISOString(),
  };
  app.store().set(KEY, result);
  return result;
}

function status(app) {
  let s = app.store().get(KEY);
  if (!s) s = check(app);          // first call after a restart: check now (at most a few seconds)
  return { internet: s.internet, checked_at: s.checked_at, hub_time: new Date().toISOString() };
}

function online(app) {
  return status(app).internet !== "offline";
}

module.exports = { check, status, online };

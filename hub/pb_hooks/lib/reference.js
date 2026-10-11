// Reference data (P5 step 7; FR-11.10, 11.11). Datasets that ship with the hub's code as read-only SQLite files
// (pb_hooks/reference/<id>.db and its manifest <id>.json; built by tools/datasets/build.mjs), read with the
// sqlite3 command, outside the store's database (backups stay small). Two public services are asked online when
// the hub has internet (outbound, no keys, a few seconds at most, remembered for the day): Open Food Facts for a
// barcode and the Bank of Canada for an exchange rate. Everything here only SUGGESTS: nothing is written to the
// store's data; the screens show a suggestion with its source and the person taps it to use it (FR-11.11).

const DIR = `${__hooks}/reference`;
function bad(msg) { throw new BadRequestError(msg); }
function setting(app, key, fallback) { return require(`${__hooks}/lib/auth.js`).setting(app, key, fallback); }
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const ONLINE = {
  open_food_facts: { name: "Open Food Facts", licence: "Open Database License (ODbL); © Open Food Facts contributors", url: "https://world.openfoodfacts.org" },
  bank_of_canada: { name: "Bank of Canada exchange rates", licence: "Bank of Canada terms of use; source: Bank of Canada", url: "https://www.bankofcanada.ca/rates/exchange/" },
};

function cmd() {
  try { const e = String($os.getenv("CHEDAM_SQLITE") || ""); if (e) return JSON.parse(e); } catch (_) { /* default */ }
  return ["sqlite3"];
}
function has(id) { try { $os.stat(DIR + "/" + id + ".db"); return true; } catch (_) { return false; } }
function query(id, sql) {
  if (!has(id)) return [];
  const c = cmd();
  const out = toString($os.cmd(...c.concat(["-readonly", "-json", DIR + "/" + id + ".db", sql])).output()).trim();
  return out ? JSON.parse(out) : [];
}

function datasets() {
  let names = [];
  try { names = $os.readDir(DIR).map((d) => d.name()).filter((n) => n.endsWith(".json")); } catch (_) { names = []; }
  return names.sort().map((n) => { try { return JSON.parse(toString($os.readFile(DIR + "/" + n))); } catch (_) { return null; } }).filter(Boolean);
}

function online(app, which) {
  const set = setting(app, "reference.online", { open_food_facts: true, bank_of_canada: true }) || {};
  if (set[which] === false) return false;
  if (String($os.getenv("CHEDAM_REFERENCE_BASE") || "")) return true;     // tests: the fake services are always there
  try { return require(`${__hooks}/lib/net.js`).online(app); } catch (_) { return false; }
}
function base(which) {
  const b = String($os.getenv("CHEDAM_REFERENCE_BASE") || "").replace(/\/+$/, "");
  if (b) return b + (which === "off" ? "/off" : "/boc");
  return which === "off" ? "https://world.openfoodfacts.org" : "https://www.bankofcanada.ca/valet";
}
function cached(app, key, fn) {
  const k = "chedam.ref." + key, day = new Date().toISOString().substring(0, 10);
  const c = app.store().get(k);
  if (c && c.day === day) return c.value;
  const v = fn();
  app.store().set(k, { day: day, value: v });
  return v;
}

// ---- Products by barcode ---------------------------------------------------------------------------------------
// {found, source, licence, suggestions: {name, name_fr, brand, size_qty, size_unit, category}}
function product(app, code) {
  const bc = String(code || "").trim();
  if (!/^\d{6,14}$/.test(bc)) bad("A barcode is 6 to 14 digits.");
  const local = has("off_ca") ? query("off_ca", "SELECT * FROM products WHERE barcode = " + lit(bc) + " LIMIT 1") : [];
  if (local.length) return view(local[0], "Open Food Facts (Canada, on the hub)", ONLINE.open_food_facts.licence);
  if (!online(app, "open_food_facts")) return { found: false, offline: true };
  return cached(app, "off." + bc, () => {
    let res;
    try {
      res = $http.send({ url: base("off") + "/api/v2/product/" + bc + ".json?fields=product_name,product_name_en,product_name_fr,brands,quantity,categories_tags", method: "GET", timeout: 6,
        headers: { "User-Agent": "Chedam POS store hub (offline-first retail; one lookup per scanned product)" } });
    } catch (_) { return { found: false, error: "Open Food Facts could not be reached." }; }
    const j = res.json || {};
    if (res.statusCode !== 200 || j.status !== 1 || !j.product) return { found: false, source: ONLINE.open_food_facts.name };
    const p = j.product;
    return view({ name: p.product_name_en || p.product_name || "", name_fr: p.product_name_fr || "", brand: String(p.brands || "").split(",")[0].trim(), quantity: p.quantity || "",
      category: (p.categories_tags || []).filter((t) => t.indexOf("en:") === 0).map((t) => t.substring(3).replace(/-/g, " ")).pop() || "" }, ONLINE.open_food_facts.name, ONLINE.open_food_facts.licence);
  });
}
function view(r, source, licence) {
  const s = { name: String(r.name || "").trim(), name_fr: String(r.name_fr || "").trim(), brand: String(r.brand || "").trim(), category: String(r.category || "").trim(), size_qty: null, size_unit: "" };
  if (s.brand && s.name && s.name.toLowerCase().indexOf(s.brand.toLowerCase()) < 0) s.name = s.brand + " " + s.name;
  const m = String(r.quantity || "").replace(",", ".").match(/(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|cl|l|oz|lb|fl\.? ?oz)\b/i);
  if (m) { s.size_qty = Number(m[1]); s.size_unit = m[2].toLowerCase().replace(/\s|\./g, "") === "cl" ? "ml" : m[2].toLowerCase().replace(/\s|\./g, ""); if (m[2].toLowerCase() === "cl") s.size_qty *= 10; }
  return { found: !!s.name, source: source, licence: licence, suggestions: s };
}

// ---- Shelf life by name or category ----------------------------------------------------------------------------
function shelfLife(app, name) {
  const t = String(name || "").toLowerCase().replace(/[^a-z0-9 %]/g, " ").replace(/\s+/g, " ").trim().substring(0, 120);
  if (!t) return { items: [] };
  const rows = query("shelf_life", "SELECT * FROM shelf WHERE instr(" + lit(" " + t + " ") + ", ' ' || keyword) > 0 ORDER BY length(keyword) DESC LIMIT 3");
  const m = datasets().find((d) => d.id === "shelf_life") || {};
  return { items: rows, source: m.name || "", licence: m.licence || "" };
}

// ---- HS codes ----------------------------------------------------------------------------------------------------
function hs(app, q) {
  const t = String(q || "").trim().substring(0, 60);
  if (!t) return { items: [] };
  const digits = t.replace(/[^0-9]/g, "");
  const words = t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
  const where = digits.length >= 2 && digits === t.replace(/[.\s]/g, "") ? "code LIKE " + lit(digits.substring(0, 2) + "%")
    : words.length ? words.map((w) => "lower(description) LIKE " + lit("%" + w + "%")).join(" AND ") : "0";
  const out = [];
  if (has("cbsa_tariff")) query("cbsa_tariff", "SELECT code, description FROM tariff WHERE " + where.replace(/code LIKE '(\d\d)%'/, "code LIKE '" + digits + "%'") + " LIMIT 15").forEach((r) => out.push(Object.assign(r, { source: "CBSA Customs Tariff" })));
  query("hs_chapters", "SELECT code, description FROM hs WHERE " + where + " LIMIT 10").forEach((r) => out.push(Object.assign(r, { source: "HS chapter" })));
  return { items: out };
}

function taxPresets() { return { items: query("tax_presets", "SELECT * FROM presets ORDER BY province"), source: (datasets().find((d) => d.id === "tax_presets") || {}).source || "" }; }
function units() { return { items: query("units", "SELECT * FROM units ORDER BY kind, factor") }; }

// ---- Exchange rates (Bank of Canada) -----------------------------------------------------------------------------
// CAD for one unit of the currency on the day (or the last business day before)
function fx(app, currency, day) {
  const cur = String(currency || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur) || cur === "CAD") bad("A currency other than CAD, as 3 letters.");
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(day || "")) ? day : new Date().toISOString().substring(0, 10);
  if (!online(app, "bank_of_canada")) return { found: false, offline: true };
  return cached(app, "fx." + cur + "." + d, () => {
    const from = new Date(new Date(d + "T12:00:00Z").getTime() - 10 * 86400000).toISOString().substring(0, 10);
    let res;
    try { res = $http.send({ url: base("boc") + "/observations/FX" + cur + "CAD/json?start_date=" + from + "&end_date=" + d, method: "GET", timeout: 6 }); }
    catch (_) { return { found: false, error: "The Bank of Canada could not be reached." }; }
    const obs = ((res.json || {}).observations || []).filter((o) => o["FX" + cur + "CAD"] && o.d <= d).sort((a, b) => (a.d < b.d ? 1 : -1));
    if (res.statusCode !== 200 || !obs.length) return { found: false, source: ONLINE.bank_of_canada.name };
    return { found: true, currency: cur, day: obs[0].d, rate: Number(obs[0]["FX" + cur + "CAD"].v), source: ONLINE.bank_of_canada.name, licence: ONLINE.bank_of_canada.licence };
  });
}

function about(app) {
  const set = setting(app, "reference.online", { open_food_facts: true, bank_of_canada: true }) || {};
  let version = "";
  try { version = toString($os.readFile(__hooks + "/../VERSION")).trim(); } catch (_) { version = ""; }
  return { version: version, datasets: datasets(), online: Object.keys(ONLINE).map((k) => Object.assign({ id: k, enabled: set[k] !== false }, ONLINE[k])),
    note: "Reference data only suggests: nothing is changed until someone taps a suggestion (FR-11.11)." };
}

// For the routes: anyone signed in; the query
function ctx(e) {
  const access = require(`${__hooks}/lib/access.js`);
  if (!e.hasSuperuserAuth() && !access.isActive(e.auth)) throw new UnauthorizedError("Sign in first.");
  return e.request.url.query();
}

module.exports = { datasets, product, shelfLife, hs, taxPresets, units, fx, about, ctx };

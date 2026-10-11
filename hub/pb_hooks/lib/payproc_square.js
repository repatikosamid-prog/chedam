// Square adapter for the common payment interface (lib/payproc.js; P5-a, DL-114). Square's REST API over
// HTTPS, outbound only (P5-b): merchants and locations, device codes to pair a Square Terminal, Terminal API
// checkouts and refunds, payments (card brand, last 4, processing fee), refunds and payouts.
// conn: {base, token, location_id, currency}. Every call returns plain values or throws Error("Square: ...").
// The tests and the dev hub point CHEDAM_SQUARE_BASE at a fake Square (tools/devhub/fake-square.mjs).

const VERSION = "2025-01-23";

function baseUrl(environment) {
  const env = String($os.getenv("CHEDAM_SQUARE_BASE") || "");
  if (env) return env.replace(/\/+$/, "");
  return environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
}

function send(conn, method, path, body) {
  let res;
  try {
    res = $http.send({ url: conn.base + path, method: method, timeout: 12,
      headers: { "Authorization": "Bearer " + conn.token, "Square-Version": VERSION, "Content-Type": "application/json", "Accept": "application/json" },
      body: body ? JSON.stringify(body) : "" });
  } catch (err) {
    throw new Error("Square: could not be reached (" + String(err && err.message || err).substring(0, 120) + ").");
  }
  let json = res.json;
  if (!json) { try { json = JSON.parse(toString(res.body || res.raw || "")); } catch (_) { json = {}; } }
  if (res.statusCode === 401) throw new Error("Square: the access token was refused (401). Connect again with a valid token.");
  if (res.statusCode >= 300) {
    const e = (json && json.errors && json.errors[0]) || {};
    throw new Error("Square: " + (e.detail || e.code || ("HTTP " + res.statusCode)));
  }
  return json || {};
}

const money = (cents, currency) => ({ amount: Math.round(cents), currency: currency || "CAD" });
const BRANDS = { VISA: "visa", MASTERCARD: "mastercard", AMERICAN_EXPRESS: "amex", INTERAC: "interac", DISCOVER: "discover", DISCOVER_DINERS: "discover" };

// --- Account ---------------------------------------------------------------------------------------------

function verify(conn) {
  const m = send(conn, "GET", "/v2/merchants/me").merchant || {};
  const locs = (send(conn, "GET", "/v2/locations").locations || []).filter((l) => l.status !== "INACTIVE");
  return { merchant_id: m.id || "", account_name: m.business_name || "", currency: m.currency || "CAD", main_location_id: m.main_location_id || "",
    locations: locs.map((l) => ({ id: l.id, name: l.name || l.id, currency: l.currency || "" })) };
}

// --- Terminal pairing (device codes) ---------------------------------------------------------------------

function pairStart(conn, name, key) {
  const d = send(conn, "POST", "/v2/devices/codes", { idempotency_key: key,
    device_code: { product_type: "TERMINAL_API", location_id: conn.location_id, name: String(name).substring(0, 60) } }).device_code || {};
  return { code_id: d.id, code: d.code, pair_by: d.pair_by || "" };
}

function pairStatus(conn, codeId) {
  const d = send(conn, "GET", "/v2/devices/codes/" + encodeURIComponent(codeId)).device_code || {};
  return { status: d.status === "PAIRED" ? "paired" : d.status === "EXPIRED" ? "expired" : "pairing", terminal_id: d.device_id || "" };
}

// --- Checkouts on the terminal ---------------------------------------------------------------------------

const CHECKOUT = { PENDING: "pending", IN_PROGRESS: "in_progress", CANCEL_REQUESTED: "cancel_requested", CANCELED: "cancelled", COMPLETED: "completed" };

function checkoutView(c) {
  return { id: c.id, status: CHECKOUT[c.status] || "pending", payment_ids: c.payment_ids || [], cancel_reason: String(c.cancel_reason || "").toLowerCase() };
}

function checkout(conn, o) {
  const c = send(conn, "POST", "/v2/terminals/checkouts", { idempotency_key: o.key, checkout: {
    amount_money: money(o.amount_cents, conn.currency), reference_id: String(o.reference || "").substring(0, 40), note: String(o.note || "").substring(0, 250),
    device_options: { device_id: o.terminal_id, skip_receipt_screen: true, tip_settings: { allow_tipping: false } } } }).checkout || {};
  return checkoutView(c);
}

function checkoutStatus(conn, id) {
  return checkoutView(send(conn, "GET", "/v2/terminals/checkouts/" + encodeURIComponent(id)).checkout || {});
}

function cancel(conn, id) {
  return checkoutView(send(conn, "POST", "/v2/terminals/checkouts/" + encodeURIComponent(id) + "/cancel", {}).checkout || {});
}

// --- Payments, refunds, payouts --------------------------------------------------------------------------

function paymentView(p) {
  const card = (p.card_details && p.card_details.card) || {};
  const fee = (p.processing_fee || []).reduce((a, f) => a + Number((f.amount_money && f.amount_money.amount) || 0), 0);
  return { id: p.id, status: String(p.status || "").toLowerCase(), amount_cents: Number((p.amount_money && p.amount_money.amount) || 0),
    card_type: BRANDS[card.card_brand] || (card.card_brand ? "other" : ""), last4: card.last_4 || "", fee_cents: fee,
    fee_known: (p.processing_fee || []).length > 0, created_at: p.created_at || "", entry: (p.card_details && p.card_details.entry_method) || "" };
}

function payment(conn, id) {
  return paymentView(send(conn, "GET", "/v2/payments/" + encodeURIComponent(id)).payment || {});
}

// Payments of the location in [from, to) (RFC 3339), all pages
function payments(conn, from, to) {
  const out = [];
  let cursor = "";
  for (let i = 0; i < 50; i++) {
    const q = "?location_id=" + encodeURIComponent(conn.location_id) + "&begin_time=" + encodeURIComponent(from) + "&end_time=" + encodeURIComponent(to) + "&limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    const r = send(conn, "GET", "/v2/payments" + q);
    (r.payments || []).forEach((p) => out.push(paymentView(p)));
    cursor = r.cursor || "";
    if (!cursor) break;
  }
  return out;
}

const REFUND = { PENDING: "pending", COMPLETED: "completed", REJECTED: "rejected", FAILED: "failed", CANCELED: "cancelled", IN_PROGRESS: "pending", CANCEL_REQUESTED: "pending" };

// Interac (debit) refunds need the card on the terminal (Terminal API refund); other cards go back by the
// Refunds API without the card.
function refund(conn, o) {
  if (o.card_present) {
    const r = send(conn, "POST", "/v2/terminals/refunds", { idempotency_key: o.key, refund: { payment_id: o.payment_id,
      amount_money: money(o.amount_cents, conn.currency), reason: String(o.reason || "Return").substring(0, 190), device_id: o.terminal_id } }).refund || {};
    return { id: r.id, status: REFUND[r.status] || "pending", on_terminal: true };
  }
  const r = send(conn, "POST", "/v2/refunds", { idempotency_key: o.key, payment_id: o.payment_id, amount_money: money(o.amount_cents, conn.currency),
    reason: String(o.reason || "Return").substring(0, 190) }).refund || {};
  return { id: r.id, status: REFUND[r.status] || "pending", on_terminal: false };
}

function refundStatus(conn, id, onTerminal) {
  const r = (onTerminal ? send(conn, "GET", "/v2/terminals/refunds/" + encodeURIComponent(id)) : send(conn, "GET", "/v2/refunds/" + encodeURIComponent(id))).refund || {};
  return { id: r.id, status: REFUND[r.status] || "pending" };
}

function payouts(conn, from, to) {
  const q = "?location_id=" + encodeURIComponent(conn.location_id) + "&begin_time=" + encodeURIComponent(from) + "&end_time=" + encodeURIComponent(to) + "&limit=100";
  return (send(conn, "GET", "/v2/payouts" + q).payouts || []).map((p) => ({ id: p.id, status: String(p.status || "").toLowerCase(),
    amount_cents: Number((p.amount_money && p.amount_money.amount) || 0), arrival_date: p.arrival_date || "", created_at: p.created_at || "" }));
}

module.exports = { baseUrl, verify, pairStart, pairStatus, checkout, checkoutStatus, cancel, payment, payments, refund, refundStatus, payouts };

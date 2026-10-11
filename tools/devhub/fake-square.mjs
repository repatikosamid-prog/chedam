// Dev and test only: a pretend Square API (the parts Chedam uses, P5 steps 1-3). Point the hub at it with
// CHEDAM_SQUARE_BASE=http://127.0.0.1:<port>. In memory; nothing leaves the PC.
//   Tests: import { startFakeSquare } and drive it (fake.pair(), fake.complete(), fake.decline(), fake.down = true).
//   Dev hub: node tools/devhub/fake-square.mjs [port=8097] — pairing codes pair after 5 s and checkouts are
//   approved after 6 s (Visa 4242) unless the amount ends in 13 cents (declined) or 66 cents (cancelled).
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const FAKE_TOKEN = "EAAA-fake-square-access-token-0001";
const rid = (p) => p + randomBytes(6).toString("hex").toUpperCase();

export async function startFakeSquare(port = 0, { auto = false } = {}) {
  const st = { token: FAKE_TOKEN, down: false, calls: [], codes: {}, checkouts: {}, payments: {}, refunds: {}, payouts: [], keys: {},
    merchant: { id: "MERCHANT1", business_name: "Sample Store (Square sandbox)", country: "CA", currency: "CAD", main_location_id: "LOC1" },
    locations: [{ id: "LOC1", name: "Main street", status: "ACTIVE", currency: "CAD" }, { id: "LOC2", name: "Warehouse", status: "ACTIVE", currency: "CAD" }] };
  const now = () => new Date().toISOString();
  const fee = (amt, brand) => (brand === "INTERAC" ? 8 : Math.round(amt * 0.0265));

  const fake = {
    st,
    pair(codeId) { const c = st.codes[codeId]; c.status = "PAIRED"; c.device_id = "device:" + rid("T"); return c.device_id; },
    expire(codeId) { st.codes[codeId].status = "EXPIRED"; },
    complete(id, { brand = "VISA", last4 = "4242", entry = "EMV" } = {}) {
      const c = st.checkouts[id];
      const p = { id: rid("PAY"), status: "COMPLETED", amount_money: c.amount_money, location_id: "LOC1", created_at: now(), reference_id: c.reference_id,
        card_details: { card: { card_brand: brand, last_4: last4 }, entry_method: entry }, processing_fee: [{ amount_money: { amount: fee(c.amount_money.amount, brand), currency: "CAD" } }] };
      st.payments[p.id] = p; c.status = "COMPLETED"; c.payment_ids = [p.id];
      return p.id;
    },
    decline(id) { const c = st.checkouts[id]; c.status = "CANCELED"; c.cancel_reason = "SELLER_CANCELED"; },   // Square reports a decline that the buyer abandons as cancelled
    cancel(id, reason = "BUYER_CANCELED") { const c = st.checkouts[id]; c.status = "CANCELED"; c.cancel_reason = reason; },
    lastCheckout() { const ids = Object.keys(st.checkouts); return ids.length ? st.checkouts[ids[ids.length - 1]] : null; },
    finishRefund(id, status = "COMPLETED") { st.refunds[id].status = status; },
    get down() { return st.down; }, set down(v) { st.down = !!v; },
    close: null, url: "",
  };

  function route(m, path, body, q) {
    let x;
    if (m === "GET" && path === "/v2/merchants/me") return [200, { merchant: st.merchant }];
    if (m === "GET" && path === "/v2/locations") return [200, { locations: st.locations }];
    if (m === "POST" && path === "/v2/devices/codes") {
      const c = { id: rid("DC"), code: randomBytes(3).toString("hex").toUpperCase(), name: body.device_code.name, product_type: "TERMINAL_API",
        location_id: body.device_code.location_id, status: "UNPAIRED", pair_by: new Date(Date.now() + 300000).toISOString() };
      st.codes[c.id] = c;
      if (auto) setTimeout(() => fake.pair(c.id), 5000);
      return [200, { device_code: c }];
    }
    if (m === "GET" && (x = path.match(/^\/v2\/devices\/codes\/(.+)$/))) return st.codes[x[1]] ? [200, { device_code: st.codes[x[1]] }] : [404, { errors: [{ code: "NOT_FOUND", detail: "Device code not found" }] }];
    if (m === "POST" && path === "/v2/terminals/checkouts") {
      if (st.keys[body.idempotency_key]) return [200, { checkout: st.checkouts[st.keys[body.idempotency_key]] }];
      const devOk = Object.values(st.codes).some((c) => c.device_id === body.checkout.device_options.device_id);
      if (!devOk) return [400, { errors: [{ code: "NOT_FOUND", detail: "Device not found or not paired" }] }];
      const c = Object.assign({ id: rid("CO"), status: "PENDING", created_at: now(), payment_ids: [] }, body.checkout);
      st.checkouts[c.id] = c; st.keys[body.idempotency_key] = c.id;
      if (auto) setTimeout(() => { if (c.status !== "PENDING") return; const a = c.amount_money.amount % 100; if (a === 13) fake.decline(c.id); else if (a === 66) fake.cancel(c.id); else fake.complete(c.id); }, 6000);
      return [200, { checkout: c }];
    }
    if (m === "GET" && (x = path.match(/^\/v2\/terminals\/checkouts\/([^/]+)$/))) return st.checkouts[x[1]] ? [200, { checkout: st.checkouts[x[1]] }] : [404, { errors: [{ code: "NOT_FOUND", detail: "Checkout not found" }] }];
    if (m === "POST" && (x = path.match(/^\/v2\/terminals\/checkouts\/([^/]+)\/cancel$/))) {
      const c = st.checkouts[x[1]];
      if (!c) return [404, { errors: [{ code: "NOT_FOUND", detail: "Checkout not found" }] }];
      if (c.status === "COMPLETED") return [400, { errors: [{ code: "BAD_REQUEST", detail: "Checkout is already completed" }] }];
      c.status = "CANCELED"; c.cancel_reason = "SELLER_CANCELED";
      return [200, { checkout: c }];
    }
    if (m === "GET" && (x = path.match(/^\/v2\/payments\/([^/]+)$/))) return st.payments[x[1]] ? [200, { payment: st.payments[x[1]] }] : [404, { errors: [{ code: "NOT_FOUND", detail: "Payment not found" }] }];
    if (m === "GET" && path === "/v2/payments") {
      const from = q.get("begin_time") || "", to = q.get("end_time") || "9999";
      return [200, { payments: Object.values(st.payments).filter((p) => p.created_at >= from && p.created_at < to) }];
    }
    if (m === "POST" && (path === "/v2/refunds" || path === "/v2/terminals/refunds")) {
      const term = path === "/v2/terminals/refunds";
      const b = term ? body.refund : body;
      if (st.keys[body.idempotency_key]) return [200, { refund: st.refunds[st.keys[body.idempotency_key]] }];
      const p = st.payments[b.payment_id];
      if (!p) return [400, { errors: [{ code: "NOT_FOUND", detail: "Payment not found" }] }];
      const done = Object.values(st.refunds).filter((r) => r.payment_id === p.id && r.status !== "FAILED" && r.status !== "REJECTED").reduce((a, r) => a + r.amount_money.amount, 0);
      if (done + b.amount_money.amount > p.amount_money.amount) return [400, { errors: [{ code: "REFUND_AMOUNT_INVALID", detail: "The refund is more than the payment" }] }];
      const r = { id: rid(term ? "TR" : "RF"), payment_id: p.id, amount_money: b.amount_money, status: term ? "PENDING" : "COMPLETED", reason: b.reason, created_at: now(), device_id: b.device_id || "" };
      st.refunds[r.id] = r; st.keys[body.idempotency_key] = r.id;
      if (auto && term) setTimeout(() => fake.finishRefund(r.id), 6000);
      return [200, { refund: r }];
    }
    if (m === "GET" && (x = path.match(/^\/v2\/(?:terminals\/)?refunds\/([^/]+)$/))) return st.refunds[x[1]] ? [200, { refund: st.refunds[x[1]] }] : [404, { errors: [{ code: "NOT_FOUND", detail: "Refund not found" }] }];
    if (m === "GET" && path === "/v2/payouts") return [200, { payouts: st.payouts }];
    return [404, { errors: [{ code: "NOT_FOUND", detail: "No such endpoint in the fake: " + m + " " + path }] }];
  }

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      st.calls.push(req.method + " " + u.pathname);
      if (st.down) { res.writeHead(503, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ errors: [{ code: "SERVICE_UNAVAILABLE", detail: "Square is down (fake)" }] })); }
      if (req.headers.authorization !== "Bearer " + st.token) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ errors: [{ code: "UNAUTHORIZED", detail: "The access token is not valid" }] })); }
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* empty */ }
      const [code, out] = route(req.method, u.pathname, body, u.searchParams);
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  fake.url = "http://127.0.0.1:" + server.address().port;
  fake.close = () => new Promise((r) => server.close(r));
  return fake;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const f = await startFakeSquare(Number(process.argv[2] || 8097), { auto: true });
  console.log("Fake Square at " + f.url + " (token " + FAKE_TOKEN + "). Start the dev hub with CHEDAM_SQUARE_BASE=" + f.url);
}

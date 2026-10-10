// P3 step 10: recall trace and customer feedback (FR-6.15, 7.09). Lots of a product: where from, which sales,
// which members; recalling blocks the lots (never sold again) and writes off what is left; feedback from a kiosk
// or a receipt link (valid code, once per sale), a report with the average.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step41-recall-feedback.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8134 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager);
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const choc = await find("2000000000077");
  const level = async (pid) => (await t.list("stock_levels", `product='${pid}'`)).items[0];
  await C.post("/api/chedam/tills/open", { float_cents: 10000 });
  const ana = await C.post("/api/chedam/customers", { first_name: "Ana", phone: "604-555-0190", agreed: true });

  console.log("Recall trace (FR-6.15)");
  await M.post("/api/chedam/stock/receive", { lines: [{ product: choc.product.id, selling_unit: choc.unit.id, qty: 5, cost_cents: 120, lot_code: "LOT-BAD", expiry_date: new Date(Date.now() + 86400000).toISOString().substring(0, 10) }] });
  const bad = (await t.list("stock_lots", `product='${choc.product.id}' && lot_code='LOT-BAD'`)).items[0];
  // The bad lot expires first, so FEFO sells from it: 2 of its 5
  const lines = [{ key: "a", product: choc.product.id, selling_unit: choc.unit.id, qty: 2 }];
  const q = (await C.post("/api/chedam/sales/quote", { lines, customer: ana.json.id })).json;
  const s = await C.post("/api/chedam/sales", { id: sid(), lines, customer: ana.json.id, expected_total_cents: q.total_cents, payments: [{ method: "card", amount_cents: q.total_cents }] });
  check("a sale that took 2 from the bad lot, to Ana", s.status === 200, JSON.stringify(s.json).slice(0, 200));
  check("a cashier cannot trace", (await C.get(`/api/chedam/recalls/trace?product=${choc.product.id}&lot_codes=LOT-BAD`)).status === 403);
  const tr = (await M.get(`/api/chedam/recalls/trace?product=${choc.product.id}&lot_codes=LOT-BAD`)).json;
  const lt = tr.lots[0];
  check("the lot: received, 2 sold on that sale, 3 left", tr.lots.length === 1 && lt.sales.length === 1 && lt.sales[0].sale === s.json.sale.id && lt.sold === 2 * choc.unit.base_qty && lt.left === 3 * choc.unit.base_qty, JSON.stringify(lt));
  check("to which members (first name, last 4 of the phone)", tr.members.length === 1 && /Ana \(…0190\)/.test(tr.members[0].name), JSON.stringify(tr.members));
  check("a reason is needed", (await M.post("/api/chedam/recalls", { product: choc.product.id, lot_codes: "LOT-BAD" })).status === 400);
  const on0 = (await level(choc.product.id)).on_hand;
  const rc = await M.post("/api/chedam/recalls", { product: choc.product.id, lot_codes: "LOT-BAD", reason: "Undeclared peanuts", source: "CFIA 2026-123" });
  check("recalled: the lot blocked, what was left written off ('Recall')", rc.status === 200 && /^RC-/.test(rc.json.recall.number) && rc.json.written_off[0].movement
    && (await level(choc.product.id)).on_hand === on0 - 3 * choc.unit.base_qty && (await t.list("stock_lots", `id='${bad.id}'`)).items[0].recalled === true, JSON.stringify(rc.json).slice(0, 300));
  await M.post("/api/chedam/stock/adjust", { product: choc.product.id, selling_unit: choc.unit.id, qty: 1, type: "adjust", direction: "in", reason: (await t.list("settings", "key='stock.reasons'")).items[0].value.adjust[0] });
  const lots2 = (await t.list("stock_lots", `id='${bad.id}'`)).items[0];
  check("the recalled lot is never taken again", lots2.qty === 0);
  check("the recall is listed", (await M.get("/api/chedam/recalls")).json.items.some((x) => x.id === rc.json.recall.id && x.reason === "Undeclared peanuts"));

  console.log("Feedback (FR-7.09)");
  check("an anonymous browser cannot leave feedback", (await t.api("POST", "/api/chedam/feedback", { rating: 5 })).status === 400);
  const kiosk = await t.pair("Front kiosk", "kiosk");
  const k1 = await t.api("POST", "/api/chedam/feedback", { rating: 4, comment: "Friendly staff" }, { device: kiosk });
  check("from the kiosk (no sign-in)", k1.status === 200);
  check("1 to 5 only", (await t.api("POST", "/api/chedam/feedback", { rating: 9 }, { device: kiosk })).status === 400);
  const set = (await t.list("settings", "key='feedback'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${set.id}`, { value: { receipt_link: true, question: "How was your visit?", base_url: "http://chedam.local" } });
  const sv = (await C.get(`/api/chedam/sales/${s.json.sale.id}`)).json;
  check("the receipt has the feedback link", /^http:\/\/chedam\.local\/#feedback\/[a-z0-9]{15}-[0-9a-f]{8}$/.test(sv.feedback_link || ""), sv.feedback_link);
  const [saleId, code] = sv.feedback_link.split("/#feedback/")[1].split("-");
  check("a made-up code is refused", (await t.api("POST", "/api/chedam/feedback", { rating: 1, sale: saleId, code: "deadbeef" })).status === 400);
  check("the receipt link works without signing in", (await t.api("POST", "/api/chedam/feedback", { rating: 2, comment: "Long line", sale: saleId, code })).status === 200);
  check("once per visit", (await t.api("POST", "/api/chedam/feedback", { rating: 5, sale: saleId, code })).status === 400);
  const today = new Date().toISOString().substring(0, 10);
  const rep = (await M.get(`/api/chedam/feedback/report?from=${today}&to=${today}`)).json;
  check("the report: 2 ratings, average 3, unread", rep.count === 2 && rep.average === 3 && rep.unread === 2 && rep.by_rating[3] === 1, JSON.stringify(rep).slice(0, 200));
  check("a cashier cannot read it", (await C.get(`/api/chedam/feedback/report`)).status === 403);
} catch (e) { err = e; }
await t.finish(err);

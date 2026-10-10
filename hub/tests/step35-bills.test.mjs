// P3 step 4: bills, invoices, payments, statements, vendor returns, vendor performance (FR-8.04-8.06).
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step35-bills.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8128 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), staff = await login("Sam Staff"), acct = await login("Ana Accountant");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), S = as(staff), A = as(acct);
  const party = async (n) => (await t.list("parties", `name='${n}'`)).items[0];
  const coastal = await party("Coastal Beverages Ltd."), maple = await party("Maple Snacks Wholesale"), luna = await party("Cafe Luna");
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const chips = await find("2000000000060");
  const level = async (pid) => (await t.list("stock_levels", `product='${pid}'`)).items[0];

  console.log("Bills (FR-8.04)");
  check("a cashier and staff cannot see bills", (await C.get("/api/chedam/bills")).status === 403 && (await S.get("/api/chedam/bills")).status === 403);
  const b1 = await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, party_ref: "CB-9001", doc_date: "2026-09-01", lines: [{ description: "Drinks", qty: 2, unit_cents: 5000 }],
    taxes: [{ code: "GST", label: "GST 5%", cents: 500 }] });
  check("the accountant records a vendor bill: number, total with tax, due from the vendor's terms (30 days)", b1.status === 200 && /^B-\d{6}$/.test(b1.json.number) && b1.json.total_cents === 10500 && b1.json.due_date === "2026-10-01" && b1.json.status === "open", JSON.stringify(b1.json).slice(0, 300));
  check("the same vendor invoice number twice is refused", (await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, party_ref: "CB-9001", lines: [{ description: "x", unit_cents: 1 }] })).status === 400);
  check("a bill from a client is refused", (await A.post("/api/chedam/bills", { kind: "bill", party: luna.id, lines: [{ description: "x", unit_cents: 1 }] })).status === 400);
  check("overdue days counted", b1.json.overdue_days > 0);
  const p1 = await A.post(`/api/chedam/bills/${b1.json.id}/pay`, { day: "2026-09-20", amount_cents: 5000, method: "cheque", reference: "#1042" });
  check("part payment by cheque: partly paid", p1.json.status === "partial" && p1.json.balance_cents === 5500 && p1.json.payments[0].reference === "#1042");
  check("paying more than is left is refused", (await A.post(`/api/chedam/bills/${b1.json.id}/pay`, { amount_cents: 99999, method: "cash" })).status === 400);
  check("a manager without finance cannot pay? (managers have it)", (await M.post(`/api/chedam/bills/${b1.json.id}/pay`, { amount_cents: 100, method: "cash" })).status === 200);
  const vc = await A.post("/api/chedam/bills", { kind: "vendor_credit", party: coastal.id, party_ref: "CR-77", lines: [{ description: "Damaged cases", unit_cents: 1000 }] });
  const ap = await A.post(`/api/chedam/bills/${b1.json.id}/pay`, { amount_cents: 1000, method: "credit", credit_doc: vc.json.id });
  check("a vendor credit applied to the bill", ap.json.paid_cents === 6100 && (await A.get(`/api/chedam/bills/${vc.json.id}`)).json.status === "paid");
  const fin = await A.post(`/api/chedam/bills/${b1.json.id}/pay`, { amount_cents: 4400, method: "e_transfer", reference: "ET123" });
  check("paid in full", fin.json.status === "paid" && fin.json.balance_cents === 0);
  const vp = fin.json.payments.find((x) => x.method === "credit");
  const un = await A.post(`/api/chedam/bill-payments/${vp.id}/void`, {});
  check("taking a credit payment off gives the credit back", un.json.status === "partial" && (await A.get(`/api/chedam/bills/${vc.json.id}`)).json.status === "open");
  check("a paid document cannot be voided", (await A.post(`/api/chedam/bills/${b1.json.id}/void`, { reason: "x" })).status === 400);

  console.log("Invoices and statements");
  const inv = await A.post("/api/chedam/bills", { kind: "invoice", party: luna.id, doc_date: "2026-10-01", lines: [{ description: "Coffee beans", qty: 3, unit_cents: 2000 }] });
  check("an invoice to a client", inv.status === 200 && /^INV-/.test(inv.json.number) && inv.json.total_cents === 6000);
  check("only finance makes invoices", (await as(manager).post("/api/chedam/bills", { kind: "invoice", party: luna.id, lines: [{ description: "x", unit_cents: 1 }] })).status === 200);
  await A.post(`/api/chedam/bills/${inv.json.id}/pay`, { day: "2026-10-05", amount_cents: 2000, method: "card" });
  const stm = (await A.get(`/api/chedam/parties/${luna.id}/statement?from=2026-09-01&to=2026-10-31`)).json;
  check("the client's statement: invoice, payment, closing balance", stm.rows.length >= 2 && stm.rows[0].what === "invoice" && stm.rows.some((r) => r.what === "payment" && r.amount_cents === -2000)
    && stm.closing_cents === stm.opening_cents + stm.rows.reduce((a, r) => a + r.amount_cents, 0), JSON.stringify(stm).slice(0, 400));
  const ar = (await A.get("/api/chedam/bills?side=receivable&status=open")).json;
  check("receivables with aging", ar.items.some((x) => x.id === inv.json.id) && typeof ar.aging.total === "number");
  const usd = await A.post("/api/chedam/bills", { kind: "bill", party: maple.id, lines: [{ description: "Snacks", unit_cents: 10000 }] });
  check("a USD bill keeps the rate and the CAD total", usd.json.currency === "USD" && usd.json.total_cad_cents === 13700);
  const vd = await A.post(`/api/chedam/bills/${usd.json.id}/void`, { reason: "Entered twice" });
  check("void with a reason", vd.json.status === "void" && vd.json.void_reason === "Entered twice");

  console.log("From a purchase order (three-way)");
  const po = await M.post("/api/chedam/purchase-orders", { vendor: coastal.id, lines: [{ product: chips.product.id, selling_unit: chips.unit.id, qty: 10, cost_cents: 150 }] });
  check("no bill before anything is received", (await A.post(`/api/chedam/bills/from-po/${po.json.id}`, {})).status === 400);
  await M.post(`/api/chedam/purchase-orders/${po.json.id}/send`, {});
  await S.post(`/api/chedam/purchase-orders/${po.json.id}/receive`, { lines: [{ po_line: po.json.lines[0].id, qty: 8 }] });
  const fb = await A.post(`/api/chedam/bills/from-po/${po.json.id}`, { party_ref: "CB-9002" });
  check("the bill from the order has what was received (8 × $1.50)", fb.status === 200 && fb.json.subtotal_cents === 1200 && fb.json.po === po.json.id && !fb.json.match_note, JSON.stringify(fb.json).slice(0, 300));
  const mis = await A.post("/api/chedam/bills", { kind: "bill", party: coastal.id, po: po.json.id, party_ref: "CB-9003", lines: [{ description: "Chips", qty: 10, unit_cents: 150 }] });
  check("a bill for more than was received says so", /above what was received/.test(mis.json.match_note));

  console.log("Vendor returns (FR-8.05) and performance (FR-8.06)");
  const before = (await level(chips.product.id)).on_hand;
  check("staff cannot send goods back", (await S.post("/api/chedam/vendor-returns", { vendor: coastal.id, lines: [{ product: chips.product.id, selling_unit: chips.unit.id, qty: 1 }] })).status === 403);
  const vr = await M.post("/api/chedam/vendor-returns", { vendor: coastal.id, po: po.json.id, rma: "RMA-55", reason: "Damaged in transit", lines: [{ product: chips.product.id, selling_unit: chips.unit.id, qty: 2, reason: "Damaged bags" }] });
  check("a vendor return takes the stock out now, at cost", vr.status === 200 && /^VR-/.test(vr.json.number) && vr.json.status === "shipped" && vr.json.value_cad_cents > 0
    && (await level(chips.product.id)).on_hand === before - 2 * chips.unit.base_qty, JSON.stringify(vr.json).slice(0, 300));
  const mv = (await t.list("stock_movements", `id='${vr.json.lines[0].movement}'`)).items[0];
  check("recorded as 'Returned to vendor'", mv && mv.reason === "Returned to vendor" && /RMA-55/.test(mv.note));
  const cr = await M.post(`/api/chedam/vendor-returns/${vr.json.id}/credit`, { amount_cents: 300, party_ref: "CR-88" });
  check("the vendor's credit recorded and linked", cr.json.status === "credited" && (await A.get(`/api/chedam/bills/${cr.json.credit}`)).json.kind === "vendor_credit");
  await M.post(`/api/chedam/purchase-orders/${po.json.id}/close`, {});
  const perf = (await M.get("/api/chedam/vendors/performance")).json.vendors.find((x) => x.id === coastal.id);
  check("vendor performance: orders, on-time %, short %, damage %", perf && perf.orders >= 1 && perf.short_pct > 0 && perf.damage_pct > 0, JSON.stringify(perf));
} catch (e) { err = e; }
await t.finish(err);

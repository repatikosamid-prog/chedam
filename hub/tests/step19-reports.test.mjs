// P1 step 9: money and audit reports. Till reconciliation (cash, card terminal settlement, sales after
// closing, note when it does not balance); loss prevention per cashier with flags and the events behind
// them; the audit log viewer (filters, what changed, costs hidden without costs.view); 6-year retention
// (hard deletes refused through the API, also for superusers; the minimum cannot be lowered).
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step19-reports.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8112 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const sid = () => Array.from(randomBytes(15), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const today = (() => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); })();

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => { const dev = await t.pair("Till of " + n); return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token; };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), staff = await login("Sam Staff"), acct = await login("Ana Accountant");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager);
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const cola = await find("2000000000022"), chips = await find("2000000000060"), choc = await find("2000000000077");
  const L = (m, extra = {}) => ({ key: "k" + Math.random().toString(36).slice(2, 8), product: m.product.id, selling_unit: m.unit.id, qty: 1, ...extra });
  const approve = async () => (await C.post("/api/chedam/sales/approvals", { user: people["Mira Manager"], pin: PIN["Mira Manager"], permission: "sales.void" })).json.approval;
  const approveS = async () => (await C.post("/api/chedam/sales/approvals", { user: people["Mira Manager"], pin: PIN["Mira Manager"] })).json.approval;

  // ---- A day of trading
  for (const m of [cola, chips, choc]) await M.post("/api/chedam/stock/receive", { op_id: "op" + sid(), lines: [{ product: m.product.id, qty: 60 }] });
  const tc = (await C.post("/api/chedam/tills/open", { float_cents: 10000 })).json;
  const tm = (await M.post("/api/chedam/tills/open", { float_cents: 10000 })).json;
  const sell = async (who, lines, pay, extra = {}) => {
    const q = (await who.post("/api/chedam/sales/quote", { lines, ...extra })).json;
    return (await who.post("/api/chedam/sales", { id: sid(), lines, ...extra, payments: pay(q) })).json.sale;
  };
  const cash = (q) => [{ method: "cash", amount_cents: Math.ceil(q.total_cents / 500) * 500 + 500 }];
  const card = (q) => [{ method: "card", amount_cents: q.total_cents, last4: "4242" }];
  // Cashier: 5 sales: discount, price override, a removed line, cards; 3 voids; 4 no-sales; 2 no-receipt refunds
  const c1 = await sell(C, [L(cola, { qty: 2 }), L(chips, { voided: true })], cash);
  await sell(C, [L(choc, { discount: { type: "pct", value: 5 } })], card);
  await sell(C, [L(chips, { price_cents: 370, override_reason: "Damaged bag" })], cash);
  const cardSale = await sell(C, [L(cola)], card);
  for (let i = 0; i < 3; i++) {
    const v = await sell(C, [L(cola)], cash);
    await C.post(`/api/chedam/sales/${v.id}/void`, { reason: "Wrong item", approval: await approve() });
  }
  for (let i = 0; i < 4; i++) await C.post(`/api/chedam/tills/${tc.id}/cash`, { type: "no_sale", reason: "Change" });
  for (let i = 0; i < 2; i++) {
    await C.post("/api/chedam/returns", { id: sid(), lines: [{ product: choc.product.id, selling_unit: choc.unit.id, qty: 1 }], approval: await approveS(),
      refunds: [{ method: "store_credit", amount_cents: 1 }] }).then(async (r) => {
        if (r.status !== 200) {   // the amount must match the quote: ask, then refund it
          const q = (await C.post("/api/chedam/returns/quote", { lines: [{ product: choc.product.id, selling_unit: choc.unit.id, qty: 1 }] })).json;
          await C.post("/api/chedam/returns", { id: sid(), lines: [{ product: choc.product.id, selling_unit: choc.unit.id, qty: 1 }], approval: await approveS(), refunds: [{ method: "store_credit", amount_cents: q.refund_cents }] });
        }
      });
  }
  // Manager: 10 plain sales
  for (let i = 0; i < 10; i++) await sell(M, [L(cola)], card);

  console.log("Permissions");
  check("a cashier cannot see the reports", (await C.get("/api/chedam/reports/tills")).status === 403 && (await C.get("/api/chedam/reports/loss")).status === 403);
  check("staff cannot see the audit log", (await as(staff).get("/api/chedam/audit")).status === 403);
  check("the accountant can (sales.view, events.view)", (await as(acct).get("/api/chedam/reports/loss")).status === 200 && (await as(acct).get("/api/chedam/audit")).status === 200);

  console.log("Till reconciliation (FR-10.01)");
  const zc = (await C.get("/api/chedam/tills/current")).json.till.summary;
  await C.post(`/api/chedam/tills/${tc.id}/close`, { counted_cents: zc.expected_cash_cents - 800 });                 // $8 short
  const zm = (await M.get("/api/chedam/tills/current")).json.till.summary;
  await M.post(`/api/chedam/tills/${tm.id}/close`, { counted_cents: zm.expected_cash_cents });
  let rec = (await M.get(`/api/chedam/reports/tills?from=${today}&to=${today}`)).json;
  const rc = rec.tills.find((x) => x.id === tc.id), rm = rec.tills.find((x) => x.id === tm.id);
  check("both tills listed with their figures", rc && rm && rc.sales === 4 && rm.sales === 10 && rc.card_cents === zc.payments.find((p) => p.method === "card").amount_cents, JSON.stringify({ rc: [rc.sales, rc.card_cents], rm: rm && rm.sales, z: zc.payments }));
  check("short by $8: flagged; card settlement missing: flagged", rc.cash_variance_cents === -800 && rc.flags.some((f) => /short by \$8\.00/.test(f)) && rc.flags.some((f) => /settlement not entered/.test(f)), JSON.stringify(rc.flags));
  check("only managers reconcile", (await as(acct).post(`/api/chedam/reports/tills/${tc.id}/reconcile`, { card_settlement_cents: rc.card_cents })).status === 403);
  check("not balanced and no note: refused", (await M.post(`/api/chedam/reports/tills/${tc.id}/reconcile`, { card_settlement_cents: rc.card_cents })).status === 400);
  const ok1 = await M.post(`/api/chedam/reports/tills/${tc.id}/reconcile`, { card_settlement_cents: rc.card_cents, settlement_ref: "B-0042", note: "Counted twice; $8 missing, cashier told" });
  check("reconciled with a note; card matches", ok1.status === 200 && ok1.json.card_variance_cents === 0 && ok1.json.reconciled_by === "Mira Manager" && ok1.json.settlement_ref === "B-0042", JSON.stringify(ok1.json).slice(0, 300));
  const ok2 = await M.post(`/api/chedam/reports/tills/${tm.id}/reconcile`, { card_settlement_cents: rm.card_cents - 150 });
  check("terminal $1.50 below the till: needs a note", ok2.status === 400);
  const ok3 = await M.post(`/api/chedam/reports/tills/${tm.id}/reconcile`, { card_settlement_cents: rm.card_cents, settlement_ref: "B-0043" });
  check("balanced: no note needed, no flags", ok3.status === 200 && ok3.json.balanced && ok3.json.flags.length === 0, JSON.stringify(ok3.json.flags));
  // A sale made offline on the manager's till arrives after closing
  const q = (await M.post("/api/chedam/sales/quote", { lines: [L(cola)] })).json;
  const off = await M.post("/api/chedam/sales/offline", { id: sid(), offline: true, offline_ref: "OFF-LATE-1", device_time: new Date().toISOString(), till: tm.id, tax_mode: q.tax_mode,
    lines: q.lines.map((l) => ({ key: l.key, product: l.product, selling_unit: l.selling_unit, qty: l.qty, gross_cents: l.gross_cents, line_discount_cents: 0, regular_price_cents: l.regular_price_cents,
      price_cents: l.price_cents, deposit_cents: l.deposit_cents, rates: (l.taxes || []).map((x) => ({ code: x.code, rate: x.rate })), deposit_rates: [{ code: "GST", rate: 5 }, { code: "PST", rate: 7 }].slice(0, 0) })),
    cart_discount_cents: 0, totals: { total_cents: q.total_cents, tax_cents: q.tax_cents }, payments: [{ method: "card", amount_cents: q.total_cents }] });
  rec = (await M.get(`/api/chedam/reports/tills?from=${today}&to=${today}`)).json;
  const late = rec.tills.find((x) => x.id === tm.id);
  check("a sale that reached the till after closing is shown", off.status === 200 && late.late_sales === 1 && late.flags.some((f) => /after closing/.test(f)), JSON.stringify({ off: off.status, late: late.late_sales, flags: late.flags, msg: off.json && off.json.message }));
  check("totals: tills, unreconciled, flagged", rec.totals.tills === 2 && rec.totals.unreconciled === 0, JSON.stringify(rec.totals));

  console.log("Loss prevention (FR-10.11)");
  const lp = (await M.get(`/api/chedam/reports/loss?from=${today}&to=${today}`)).json;
  const cc = lp.cashiers.find((x) => x.cashier === people["Cal Cashier"]), mm = lp.cashiers.find((x) => x.cashier === people["Mira Manager"]);
  check("per cashier: sales, voids, removed lines, overrides, discounts, no-sales, refunds", cc.sales === 4 && cc.voided_sales === 3 && cc.removed_lines === 1 && cc.overrides === 1
    && cc.discounted_sales === 1 && cc.no_sales === 4 && cc.refunds === 2 && cc.no_receipt_refunds === 2 && cc.short_tills === 1, JSON.stringify(cc));
  check("override amount: $3.99 → $3.70 = 29 cents", cc.override_cents === 29);
  check("flags: voids and no-sales far above the store, refunds without a receipt", cc.flags.some((f) => /Voided sales/.test(f)) && cc.flags.some((f) => /No-sales/.test(f)) && cc.flags.some((f) => /without a receipt/.test(f)), JSON.stringify(cc.flags));
  check("the manager's clean day: no flags", mm && mm.flags.length === 0, JSON.stringify(mm && mm.flags));
  check("store rates for comparison", lp.store.sales >= 14 && lp.store.rates.voids > 0, JSON.stringify(lp.store));
  const det = (await M.get(`/api/chedam/reports/loss?from=${today}&to=${today}&cashier=${people["Cal Cashier"]}`)).json;
  const kinds = det.events.map((x) => x.kind);
  check("the events behind it: voids (approved by), override with reason, no-sales, no-receipt refunds", kinds.filter((k) => k === "Voided sale").length === 3 && kinds.includes("Price override")
    && kinds.filter((k) => k === "No sale").length === 4 && kinds.filter((k) => k === "Refund, no receipt").length === 2 && det.events.some((x) => /approved by Mira Manager/.test(x.note)), JSON.stringify(kinds));

  console.log("Audit log (FR-10.13)");
  await t.su_("PATCH", `/api/collections/products/records/${cola.product.id}`, { cost_cents: 61 });
  await t.su_("PATCH", `/api/collections/selling_units/records/${cola.unit.id}`, { price_cents: 159 });
  const au = (await M.get(`/api/chedam/audit?table=products&action=update&record=${cola.product.id}`)).json;
  check("filter by table, action and record: the cost change, before and after", au.items.length >= 1 && au.items[0].fields.some((f) => f.field === "cost_cents" && f.after === 61) && au.items[0].label === cola.product.name, JSON.stringify(au.items[0]).slice(0, 300));
  const byWho = (await M.get(`/api/chedam/audit?actor=users:${people["Cal Cashier"]}&table=sales`)).json;
  const recEv = (await M.get(`/api/chedam/audit?table=tills&record=${tc.id}&action=update`)).json.items.find((x) => x.fields.some((f) => f.field === "reconciled_by"));
  check("people shown by name in changes (reconciled_by)", recEv && recEv.fields.find((f) => f.field === "reconciled_by").after === "Mira Manager", JSON.stringify(recEv && recEv.fields));
  check("filter by person: the cashier's sales, with who and device", byWho.items.length >= 5 && byWho.items.every((x) => x.who === "Cal Cashier" && x.device === "Till of Cal Cashier"), JSON.stringify(byWho.items[0]).slice(0, 300));
  check("search by text in the record (receipt number)", (await M.get(`/api/chedam/audit?record=${c1.number}`)).json.items.some((x) => x.table === "sales" && x.label === c1.number));
  const opt = (await M.get("/api/chedam/audit/options")).json;
  check("filter choices: tables, people, devices", opt.tables.includes("sales") && opt.people.some((p) => p.name === "Cal Cashier") && opt.devices.length >= 4, JSON.stringify(opt.tables).slice(0, 200));
  const perm = (await t.list("permissions", "code='costs.view'")).items[0];
  await t.su_("POST", "/api/collections/permission_overrides/records", { user: people["Ana Accountant"], permission: perm.id, effect: "deny", granted_by: "test", reason: "test" });
  const hid = (await as(acct).get(`/api/chedam/audit?table=products&action=update&record=${cola.product.id}`)).json;
  check("without costs.view: the cost change is not shown", hid.items.every((x) => !x.fields.some((f) => f.field === "cost_cents")) && JSON.stringify(hid).indexOf('"cost_cents"') < 0, JSON.stringify(hid.items[0]).slice(0, 300));
  check("pages of 50 with 'more'", (await M.get("/api/chedam/audit")).json.items.length === 50 && (await M.get("/api/chedam/audit")).json.more === true);

  console.log("Retention (FR-10.09, BR-34)");
  const del = await t.su_("DELETE", `/api/collections/sales/records/${cardSale.id}`);
  check("even the admin account cannot delete a sale inside 6 years", del.status === 400 && /kept for 6 years/.test(del.json.message), JSON.stringify(del.json));
  check("nor a stock movement or a product", (await t.su_("DELETE", `/api/collections/products/records/${cola.product.id}`)).status === 400
    && (await t.su_("DELETE", `/api/collections/stock_movements/records/${(await t.list("stock_movements")).items[0].id}`)).status === 400);
  const ev = (await t.list("events")).items[0];
  check("the audit log cannot be deleted", (await t.su_("DELETE", `/api/collections/events/records/${ev.id}`)).status === 400);
  const area = await t.su_("POST", "/api/collections/storage_areas/records", { name: "Temp area", kind: "shelf", active: true });
  check("things outside the rules can still be deleted (a storage area)", (await t.su_("DELETE", `/api/collections/storage_areas/records/${area.json.id}`)).status === 204);
  const ry = (await t.list("settings", "key='retention.years'")).items[0];
  await t.su_("PATCH", `/api/collections/settings/records/${ry.id}`, { value: 2 });
  const rules = (await M.get("/api/chedam/retention")).json;
  check("the window cannot go below 6 years", rules.years === 6 && rules.minimum === 6 && rules.tables.some((x) => x.table === "sales" && x.rows > 0), JSON.stringify(rules).slice(0, 200));
} catch (e) {
  err = e;
}
await t.finish(err);

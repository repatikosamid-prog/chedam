// P3 step 5: receiving from a bill photo, landed cost (FR-6.11, 6.12). The bill text parser (browser code, run
// here in Node); matching by vendor code, barcode and name; learning matches; receiving with freight spread by
// value; against an order; the bill recorded from it.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step36-bill-scan.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8129 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const { parseBill } = await import(pathToFileURL(join(HUB, "..", "client", "src", "lib", "bill_reader.js")).href);

let err = null;
try {
  console.log("Reading the bill's text (browser code)");
  const text = [
    "COASTAL BEVERAGES LTD.", "Invoice No: CB-20451", "Date: 2026-10-08",
    "COAST-100 12 Cola 355mL can case 24 18.50 222.00",
    "2000000000060 4 Potato chips 200g 3.10 12.40",
    "Spring water large 6 2.00 12.00",
    "Subtotal 246.40", "GST 5% 12.32", "Freight 15.00", "Total 273.72",
  ].join("\n");
  const pb = parseBill(text);
  check("the invoice number and date", pb.ref === "CB-20451" && pb.date === "2026-10-08", JSON.stringify([pb.ref, pb.date]));
  check("three lines with code, quantity, unit price and total", pb.lines.length === 3 && pb.lines[0].code === "COAST-100" && pb.lines[0].qty === 12 && pb.lines[0].unit_cents === 1850 && pb.lines[0].total_cents === 22200
    && pb.lines[1].code === "2000000000060" && pb.lines[1].qty === 4, JSON.stringify(pb.lines));
  check("subtotal, GST, freight and total; the totals check out", pb.totals.subtotal_cents === 24640 && pb.totals.gst_cents === 1232 && pb.totals.freight_cents === 1500 && pb.totals.total_cents === 27372 && pb.checks.length === 0, JSON.stringify(pb));
  const bad = parseBill("Item A 2 1.00 2.00\nSubtotal 5.00\nGST 1.00\nTotal 6.00");
  check("totals that do not add up are said", bad.checks.length >= 2, JSON.stringify(bad.checks));

  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), staff = await login("Sam Staff");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), S = as(staff);
  const coastal = (await t.list("parties", "name='Coastal Beverages Ltd.'")).items[0];
  const find = async (code) => (await C.get("/api/chedam/catalogue/lookup?code=" + code)).json.matches[0];
  const chips = await find("2000000000060");
  const vps = (await t.list("vendor_products", `vendor='${coastal.id}'`)).items;
  const cola = vps.find((x) => true);
  const colaName = (await t.list("products", `id='${cola.product}'`)).items[0].name;
  const level = async (pid) => (await t.list("stock_levels", `product='${pid}'`)).items[0];

  console.log("Matching (FR-6.11)");
  const lines = [{ raw: "a", code: cola.vendor_sku, description: "something", qty: 2, unit_cents: 1000, total_cents: 2000 },
    { raw: "b", code: "2000000000060", description: "Potato chips 200g", qty: 4, unit_cents: 310, total_cents: 1240 },
    { raw: "c", code: "", description: colaName, qty: 1, unit_cents: 500, total_cents: 500 },
    { raw: "d", code: "", description: "Zzz unknown thing", qty: 1, unit_cents: 100, total_cents: 100 }];
  check("a cashier cannot", (await C.post("/api/chedam/bill-scan/match", { vendor: coastal.id, lines })).status === 403);
  const m = (await S.post("/api/chedam/bill-scan/match", { vendor: coastal.id, lines })).json;
  check("by the vendor's code", m.lines[0].product === cola.product && m.lines[0].via === "vendor_code", JSON.stringify(m.lines[0]));
  check("by barcode", m.lines[1].product === chips.product.id && m.lines[1].via === "barcode");
  check("by name", m.lines[2].product === cola.product && m.lines[2].via === "name" && m.lines[2].candidates.length >= 1, JSON.stringify(m.lines[2]));
  check("nothing close: left for a person, with candidates if any", !m.lines[3].product, JSON.stringify(m.lines[3]));

  console.log("Receiving with freight (FR-6.12)");
  const before = (await level(chips.product.id)).on_hand;
  const cf = await S.post("/api/chedam/bill-scan/confirm", { vendor: coastal.id, op_id: "scan-test-0001",
    lines: [{ product: chips.product.id, selling_unit: chips.unit.id, qty: 4, cost_cents: 300, raw_code: "", raw_description: "Spicy chips special" },
      { product: chips.product.id, selling_unit: chips.unit.id, qty: 4, cost_cents: 100, raw_description: "" }],
    landed: { freight_cents: 400 } });
  check("received into stock without an order", cf.status === 200 && (await level(chips.product.id)).on_hand === before + 8 * chips.unit.base_qty, JSON.stringify(cf.json));
  const lots = (await t.list("stock_lots", `product='${chips.product.id}'`)).items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 2);
  const perBase = (c) => c / chips.unit.base_qty;
  check("freight spread by value: $3 (of $16 value 3/4) on the $3.00 line, $1 on the $1.00 line", lots.some((l) => Math.abs(l.cost_cents - perBase(300 + 75)) < 0.01) && lots.some((l) => Math.abs(l.cost_cents - perBase(100 + 25)) < 0.01), JSON.stringify(lots.map((l) => l.cost_cents)));
  const again = (await S.post("/api/chedam/bill-scan/match", { vendor: coastal.id, lines: [{ raw: "x", code: "", description: "Spicy chips special", qty: 1, unit_cents: 300, total_cents: 300 }] })).json;
  check("the match is learned for this vendor", again.lines[0].product === chips.product.id && again.lines[0].via === "learned");

  console.log("Against an order, with the bill");
  const po = await M.post("/api/chedam/purchase-orders", { vendor: coastal.id, lines: [{ product: chips.product.id, selling_unit: chips.unit.id, qty: 6, cost_cents: 300 }] });
  await M.post(`/api/chedam/purchase-orders/${po.json.id}/send`, {});
  const m2 = (await S.post("/api/chedam/bill-scan/match", { vendor: coastal.id, lines: [{ raw: "y", code: "2000000000060", description: "chips", qty: 6, unit_cents: 300, total_cents: 1800 }] })).json;
  check("the vendor's open order is suggested and checked", m2.orders[0].id === po.json.id && m2.lines[0].po_check === "as ordered", JSON.stringify(m2.lines[0]));
  check("staff cannot record the bill", (await S.post("/api/chedam/bill-scan/confirm", { vendor: coastal.id, po: po.json.id, lines: [{ product: chips.product.id, qty: 6, cost_cents: 300 }], bill: { make: true } })).status === 403);
  const c2 = await M.post("/api/chedam/bill-scan/confirm", { vendor: coastal.id, po: po.json.id, op_id: "scan-test-0002", lines: [{ product: chips.product.id, selling_unit: chips.unit.id, qty: 6, cost_cents: 300, raw_code: "2000000000060" }],
    landed: { freight_cents: 600, duty_cents: 0 }, bill: { make: true, party_ref: "CB-777", doc_date: "2026-10-08", taxes: [{ code: "GST", cents: 90 }] } });
  check("received against the order, the bill recorded", c2.status === 200 && c2.json.po === po.json.id && c2.json.bill && /^B-/.test(c2.json.bill.number), JSON.stringify(c2.json));
  const pov = (await M.get(`/api/chedam/purchase-orders/${po.json.id}`)).json;
  check("the order is received; the receipt has the freight", pov.status === "received" && (await t.list("po_receipts", `po='${po.json.id}'`)).items[0].landed.freight_cents === 600 && (await t.list("po_receipts", `po='${po.json.id}'`)).items[0].source === "bill_scan");
  const bill = (await M.get(`/api/chedam/bills/${c2.json.bill.id}`)).json;
  check("the bill: the line, freight as a line, GST", bill.subtotal_cents === 1800 + 600 && bill.tax_cents === 90 && bill.party_ref === "CB-777", JSON.stringify(bill).slice(0, 300));
} catch (e) { err = e; }
await t.finish(err);

// P5 step 6: imports of every kind of record (FR-11.01) and mapping templates (FR-11.08). In the browser's code
// (client/src/lib/import/targets.js): the template of a Square, Shopify, Loyverse, QuickBooks, Xero export is
// recognised from its columns, values converted (money, dates, terms, countries, names). On the hub: check and
// commit for customers (consent), vendors and clients, opening stock, open bills and invoices, staff (owner,
// SIN); all or nothing; permissions; saved templates.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step57-import-more.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";
import { detect, toRecord, date, suggestFor } from "../../client/src/lib/import/targets.js";

const t = new TestHub({ port: 8150 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  console.log("Templates and values, in the browser's code (FR-11.08, 11.04)");
  const sq = detect(["Token", "Item Name", "Variation Name", "SKU", "Description", "Category", "Price", "GTIN", "Default Unit Cost"], "products");
  check("a Square item export is recognised", sq && sq.template.name === "Square" && sq.mapping[1] === "name" && sq.mapping[6] === "price" && sq.mapping[7] === "barcode", JSON.stringify(sq));
  const sh = detect(["Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Variant SKU", "Variant Price", "Variant Barcode", "Cost per item"], "products");
  check("a Shopify product export", sh && sh.template.name === "Shopify" && sh.mapping[1] === "name" && sh.mapping[9] === "cost");
  const lv = detect(["Handle", "SKU", "Name", "Category", "Cost", "Barcode", "Price [Main Street]", "In stock [Main Street]"], "products");
  check("Loyverse: 'Price [store]' found by its prefix", lv && lv.template.name === "Loyverse" && lv.mapping[6] === "price");
  const qb = detect(["Vendor", "Company name", "Email", "Phone", "Street address", "City", "Province", "Postal code", "Country", "Terms"], "parties");
  check("a QuickBooks vendor list", qb && qb.template.name === "QuickBooks" && qb.mapping[0] === "name" && qb.mapping[9] === "payment_terms_days");
  const xe = detect(["*ContactName", "EmailAddress", "POAddressLine1", "POCity", "PORegion", "POPostalCode", "POCountry", "TaxNumber"], "parties");
  check("Xero contacts", xe && xe.template.name === "Xero" && xe.mapping[7] === "tax_id");
  const own = detect(["Supplier", "Mail", "Tel"], "parties", [{ name: "Our old sheet", columns: { "Supplier": "name", "Mail": "email", "Tel": "phone" } }]);
  check("the store's own saved template", own && own.template.name === "Our old sheet" && own.template.saved && own.mapping[1] === "email");
  check("an unknown layout: no template", detect(["A", "B", "C"], "products") === null);
  const sug = suggestFor([{ index: 0, name: "Customer name", type: "text" }, { index: 1, name: "Mobile", type: "text" }, { index: 2, name: "Points balance", type: "number" }], "customers");
  check("suggestions without a template", sug[0].field === "full_name" && sug[1].field === "phone" && sug[2].field === "points", JSON.stringify(sug));
  check("dates: ISO, month first, day first when it can't be a month, Excel numbers", date("2026-03-04") === "2026-03-04" && date("3/4/2026") === "2026-03-04" && date("3/4/2026", true) === "2026-04-03" && date("25/12/2026") === "2026-12-25" && date("46000") === "2025-12-09");
  const rec = toRecord(["Acme Foods", "Net 30", "$1,250.50", "Canada", "15/01/2026"], { 0: "name", 1: "payment_terms_days", 2: "credit_limit_cents", 3: "country" }, "parties");
  check("values: terms in days, money in cents, country code", rec.payment_terms_days === 30 && rec.credit_limit_cents === 125050 && rec.country === "CA", JSON.stringify(rec));
  check("customers: first name from a full name", toRecord(["Priya Sharma"], { 0: "full_name" }, "customers").first_name === "Priya");

  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const owner = await login("Demo Owner"), manager = await login("Mira Manager"), cashier = await login("Cal Cashier"), acct = await login("Ana Accountant");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const O = as(owner), M = as(manager), C = as(cashier), A = as(acct);

  console.log("Customers (consent)");
  const custRows = [{ line: 2, first_name: "Priya", phone: "604-555-0111", points: 120 }, { line: 3, first_name: "Leo", phone: "604 555 0112" }, { line: 4, first_name: "", phone: "604-555-0113" }, { line: 5, first_name: "Dup", phone: "6045550111" }];
  check("a cashier can't import customers", (await C.post("/api/chedam/imports/customers/check", { rows: custRows })).status === 403);
  const c1 = (await M.post("/api/chedam/imports/customers/check", { rows: custRows, options: {} })).json;
  check("without confirming consent every row is refused", c1.results.every((x) => x.errors.some((e) => /agreed/.test(e))));
  const c2 = (await M.post("/api/chedam/imports/customers/check", { rows: custRows, options: { consent: true } })).json;
  check("no name and the same phone twice are errors", c2.results[2].errors.length && c2.results[3].errors.some((e) => /line 2/.test(e)) && !c2.results[0].errors.length, JSON.stringify(c2.results));
  const bad1 = (await M.post("/api/chedam/imports/customers/commit", { rows: custRows, options: { consent: true }, file_name: "square-customers.csv" })).json;
  check("all or nothing: errors stop the import", bad1.status === "failed" && /Line 4/.test(bad1.error) && !(await t.list("customers", "first_name='Priya'")).items.length);
  const ok1 = (await M.post("/api/chedam/imports/customers/commit", { rows: custRows, options: { consent: true }, exclude: [4, 5], file_name: "square-customers.csv" })).json;
  const priya = (await t.list("customers", "first_name='Priya'")).items[0];
  check("imported: 2 members, 2 excluded, points carried over", ok1.status === "completed" && ok1.created === 2 && ok1.excluded === 2 && priya && priya.points === 120, JSON.stringify(ok1));
  const again = (await M.post("/api/chedam/imports/customers/check", { rows: custRows.slice(0, 1), options: { consent: true } })).json;
  check("importing again: already there, left as it is", again.results[0].action === "skip");

  console.log("Vendors and clients");
  const pRows = [{ line: 2, name: "Acme Foods", kind: "vendor", email: "ap@acme.test", payment_terms_days: 30, contact_name: "Ravi", country: "CA" },
    { line: 3, name: "Cafe Uptown", kind: "customer", credit_limit_cents: 50000 }, { line: 4, name: "Bad Mail", email: "nope" }];
  const p1 = (await M.post("/api/chedam/imports/parties/check", { rows: pRows })).json;
  check("a bad email is an error", p1.results[2].errors.length === 1 && !p1.results[0].errors.length);
  const p2 = (await M.post("/api/chedam/imports/parties/commit", { rows: pRows, exclude: [4] })).json;
  const acme = (await t.list("parties", "name='Acme Foods'")).items[0], uptown = (await t.list("parties", "name='Cafe Uptown'")).items[0];
  check("vendors and clients created, with the contact", p2.created === 2 && acme.kind === "vendor" && acme.payment_terms_days === 30 && uptown.kind === "client" && uptown.credit_limit_cents === 50000
    && (await t.list("party_contacts", `party='${acme.id}'`)).items[0].name === "Ravi", JSON.stringify(p2));
  const p3 = (await M.post("/api/chedam/imports/parties/commit", { rows: [{ line: 2, name: "Acme Foods", phone: "604-555-0199" }], options: { on_existing: "update" } })).json;
  check("update existing from the file", p3.updated === 1 && (await t.list("parties", "name='Acme Foods'")).items[0].phone === "604-555-0199");

  console.log("Opening stock");
  const choc = (await C.get("/api/chedam/catalogue/lookup?code=2000000000077")).json.matches[0];
  const lvl = (await t.list("stock_levels", `product='${choc.product.id}'`)).items[0];
  const newp = await M.post("/api/chedam/imports", { file_name: "tea.csv", rows: [{ line: 2, name: "Imported Tea", base_unit: "each" }], options: { on_existing: "skip" } });
  const teaId = newp.json && newp.json.result && newp.json.result[0] && newp.json.result[0].product;
  const sRows = [{ line: 2, barcode: "2000000000077", qty: 5 }, { line: 3, product: "Imported Tea", qty: 12, cost_cents: 250 }, { line: 4, product: "No Such Thing", qty: 1 }];
  const s1 = (await M.post("/api/chedam/imports/opening_stock/check", { rows: sRows })).json;
  check("a product with stock is skipped; an unknown product is an error", s1.results[0].action === "skip" && /stock count/.test(s1.results[0].warnings.join()) && s1.results[2].errors.length && (lvl ? lvl.on_hand !== 0 : true), JSON.stringify(s1.results));
  const s2 = (await M.post("/api/chedam/imports/opening_stock/commit", { rows: sRows, exclude: [4] })).json;
  const teaLvl = teaId ? (await t.list("stock_levels", `product='${teaId}'`)).items[0] : null;
  check("opening stock received at its cost", s2.status === "completed" && s2.created === 1 && teaLvl && teaLvl.on_hand === 12 && (await t.list("stock_movements", `product='${teaId}' && type='receive'`)).items[0].note === "Opening stock (import)", JSON.stringify(s2) + JSON.stringify(newp.json).slice(0, 200));
  check("a cashier can't import stock", (await C.post("/api/chedam/imports/opening_stock/check", { rows: sRows })).status === 403);

  console.log("Open bills and invoices");
  const bRows = [{ line: 2, party: "Acme Foods", party_ref: "INV-77", doc_date: "2026-09-20", due_date: "2026-10-20", amount_cents: 45000 },
    { line: 3, kind: "invoice", party: "Cafe Uptown", party_ref: "S-1001", doc_date: "2026-09-25", amount_cents: 12000 },
    { line: 4, party: "Cafe Uptown", party_ref: "X-1", amount_cents: 100 }, { line: 5, party: "Nobody Inc", amount_cents: 100 }];
  check("a manager without finance cannot... (managers have finance.manage)", (await M.post("/api/chedam/imports/open_bills/check", { rows: bRows })).status === 200);
  const b1 = (await A.post("/api/chedam/imports/open_bills/check", { rows: bRows })).json;
  check("a client's bill and an unknown party are errors", b1.results[2].errors.some((e) => /client, not a vendor/.test(e)) && b1.results[3].errors.length && !b1.results[0].errors.length && !b1.results[1].errors.length, JSON.stringify(b1.results));
  const b2 = (await A.post("/api/chedam/imports/open_bills/commit", { rows: bRows, exclude: [4, 5] })).json;
  const bills = (await t.list("bills", "notes~'Imported'")).items;
  const bill = bills.find((x) => x.kind === "bill"), inv = bills.find((x) => x.kind === "invoice");
  check("one bill (owed to Acme) and one invoice (Uptown owes), no tax", b2.created === 2 && bill && bill.total_cents === 45000 && bill.tax_cents === 0 && bill.party_ref === "INV-77" && bill.due_date === "2026-10-20" && inv && inv.total_cents === 12000, JSON.stringify(b2));
  check("the same bill again: already in Chedam", (await A.post("/api/chedam/imports/open_bills/check", { rows: bRows.slice(0, 1) })).json.results[0].action === "skip");

  console.log("Staff (owner)");
  const stRows = [{ line: 2, name: "Nina N", legal_name: "Nina Nguyen", role: "cashier", job_title: "Cashier", start_date: "2026-01-05", pay_type: "hourly", pay_rate_cents: 1800, sin: "046 454 286" },
    { line: 3, name: "Omar O", role: "owner" }, { line: 4, name: "Pat P", sin: "123456789" }];
  check("a manager can't import staff", (await M.post("/api/chedam/imports/staff/check", { rows: stRows })).status === 403);
  const st1 = (await O.post("/api/chedam/imports/staff/check", { rows: stRows })).json;
  check("the owner role and a wrong SIN are refused", st1.results[1].errors.length && st1.results[2].errors.some((e) => /SIN/.test(e)) && !st1.results[0].errors.length);
  const st2 = (await O.post("/api/chedam/imports/staff/commit", { rows: stRows, exclude: [3, 4] })).json;
  const nina = (await t.list("users", "name='Nina N'")).items[0];
  const emp = nina ? (await t.list("employees", `user='${nina.id}'`)).items[0] : null;
  check("a person (cashier, no PIN yet) with an employee record; the SIN encrypted", st2.created === 1 && nina && !nina.pin_set && emp && emp.legal_name === "Nina Nguyen" && emp.pay_rate_cents === 1800 && emp.sin_last3 === "286" && !String(emp.sin_enc).includes("046454286"), JSON.stringify(st2));
  const job = (await O.get(`/api/chedam/imports/${st2.id}`)).json;
  check("the job record never has the SIN", !JSON.stringify(job).includes("046") && job.status === "completed");

  console.log("Saved templates (FR-11.08)");
  const tp = await M.post("/api/chedam/import-templates", { target: "parties", name: "Our old sheet", columns: { "Supplier": "name", "Mail": "email" } });
  check("saved for this kind of import", tp.status === 200 && tp.json.items.length === 1 && tp.json.items[0].columns.Mail === "email");
  check("listed for the import, not for others", (await M.get("/api/chedam/import-templates/parties")).json.items.length === 1 && (await M.get("/api/chedam/import-templates/customers")).json.items.length === 0);
  check("a cashier can't save templates for vendors", (await C.post("/api/chedam/import-templates", { target: "parties", name: "x", columns: { a: "name" } })).status === 403);
  const rm = await M.post(`/api/chedam/import-templates/${tp.json.items[0].id}/remove`, {});
  check("removed", rm.json.items.length === 0);
  const log = (await M.get("/api/chedam/imports")).json.jobs;
  check("the import log has every kind", ["customers", "parties", "opening_stock"].every((k) => log.some((j) => j.kind === k)), JSON.stringify(log.map((j) => j.kind)));
} catch (e) { err = e; }
await t.finish(err);

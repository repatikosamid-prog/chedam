// Importing every kind of record (P5 step 6; FR-11.01, 11.03, 11.04, 11.08). For each import: the fields Chedam
// takes, with the names other systems give them (to suggest a mapping), and how a file value becomes Chedam's
// value. The built-in templates are the column layouts of exports from Square, Shopify, Lightspeed, Clover,
// Loyverse, QuickBooks, Xero, Wave and Zoho; detect() picks the template that fits the file's column names best
// (the store's own saved templates first). Pure; tested in Node.
import { similar } from "./map.js";
import { cents, barcode } from "./transform.js";

export const TARGETS = [
  ["products", "Products"],
  ["customers", "Customers (loyalty members)"],
  ["parties", "Vendors and clients"],
  ["opening_stock", "Opening stock (quantities on hand)"],
  ["open_bills", "Open bills and invoices (opening balances)"],
  ["staff", "Staff"],
];

// [field, label, synonyms, type, required]
export const FIELDS = {
  customers: [
    ["first_name", "First name", ["first name", "firstname", "given name", "prénom", "prenom"], "text", true],
    ["full_name", "Full name (first word is used)", ["name", "customer name", "customer", "full name", "nom", "client"], "text"],
    ["phone", "Phone", ["phone", "phone number", "mobile", "cell", "telephone", "téléphone", "tel"], "text"],
    ["card", "Loyalty card number", ["card", "card number", "loyalty card", "customer code", "reference id", "member number", "membership"], "text"],
    ["points", "Points balance", ["points", "points balance", "loyalty points", "balance", "reward points", "points de fidélité"], "int"],
    ["notes", "Notes", ["note", "notes", "comments", "remarques"], "text"],
  ],
  parties: [
    ["name", "Name", ["name", "vendor", "supplier", "customer", "company", "company name", "display name", "contact name", "contactname", "customer name", "vendor name", "fournisseur", "nom"], "text", true],
    ["kind", "Kind (vendor / client / both)", ["kind", "type", "contact type", "is supplier", "category"], "text"],
    ["legal_name", "Legal name", ["legal name", "company legal name", "raison sociale"], "text"],
    ["code", "Short code", ["code", "account number", "vendor code", "customer code", "accountnumber", "id"], "text"],
    ["email", "Email", ["email", "email address", "emailaddress", "emailid", "e-mail", "courriel"], "text"],
    ["phone", "Phone", ["phone", "phone number", "phonenumber", "telephone", "téléphone", "work phone"], "text"],
    ["website", "Website", ["website", "web", "url", "site web"], "text"],
    ["street", "Street", ["street", "address", "street address", "address 1", "billing address", "poaddressline1", "address line 1", "adresse"], "text"],
    ["city", "City", ["city", "billing city", "pocity", "town", "ville"], "text"],
    ["province", "Province", ["province", "state", "province/state", "billing state", "poregion", "region"], "text"],
    ["postal_code", "Postal code", ["postal code", "zip", "postal code/zip code", "billing code", "popostalcode", "code postal"], "text"],
    ["country", "Country", ["country", "billing country", "pocountry", "pays"], "country"],
    ["tax_id", "GST/HST number", ["gst", "gst number", "gst/hst", "hst number", "tax number", "taxnumber", "tax id", "business id no.", "gst treatment", "numéro de tps"], "text"],
    ["currency", "Currency", ["currency", "default currency", "devise"], "text"],
    ["payment_terms_days", "Payment terms (days)", ["terms", "payment terms", "net days", "due days", "duedateday"], "terms"],
    ["credit_limit_cents", "Credit limit", ["credit limit", "limite de crédit"], "money"],
    ["contact_name", "Contact person", ["contact", "contact person", "first name", "attention"], "text"],
    ["contact_email", "Contact email", ["contact email"], "text"],
    ["contact_phone", "Contact phone", ["contact phone", "mobile"], "text"],
    ["notes", "Notes", ["notes", "note", "memo", "remarks"], "text"],
  ],
  opening_stock: [
    ["barcode", "Barcode", ["barcode", "upc", "ean", "gtin", "variant barcode", "product code"], "barcode"],
    ["plu", "PLU", ["plu", "plu code"], "text"],
    ["product", "Product name", ["name", "item", "item name", "product", "product name", "title", "product/service", "nom"], "text"],
    ["qty", "Quantity on hand", ["quantity", "qty", "on hand", "qty on hand", "quantity on hand", "in stock", "stock", "current quantity", "inventory", "available", "quantité"], "number", true],
    ["cost_cents", "Unit cost", ["cost", "unit cost", "average cost", "default unit cost", "cost per item", "purchase cost", "default cost", "coût"], "money"],
    ["expiry_date", "Expiry date", ["expiry", "expiry date", "expiration", "best before", "exp", "date d'expiration"], "date"],
    ["lot_code", "Lot", ["lot", "lot code", "batch", "lot number"], "text"],
  ],
  open_bills: [
    ["kind", "Bill or invoice", ["kind", "type", "transaction type", "document type"], "text"],
    ["party", "Vendor or client", ["vendor", "supplier", "customer", "client", "contact", "name", "payee", "fournisseur"], "text", true],
    ["party_ref", "Their number", ["num", "number", "invoice number", "invoice no", "bill number", "ref", "reference", "invoicenumber", "no."], "text"],
    ["doc_date", "Date", ["date", "invoice date", "bill date", "transaction date", "invoicedate"], "date"],
    ["due_date", "Due date", ["due date", "due", "duedate", "échéance"], "date"],
    ["amount_cents", "Amount still owed", ["open balance", "balance", "amount due", "due", "outstanding", "balance due", "amount", "total", "solde"], "money", true],
    ["notes", "Notes", ["memo", "notes", "description"], "text"],
  ],
  staff: [
    ["name", "Name at sign-in", ["name", "employee", "display name", "nickname", "employee name", "nom"], "text", true],
    ["legal_name", "Legal name", ["legal name", "full name", "employee full name"], "text"],
    ["role", "Role", ["role", "access", "permission", "position level"], "text"],
    ["job_title", "Job title", ["job title", "title", "position", "job", "poste"], "text"],
    ["email", "Email", ["email", "work email", "email address", "courriel"], "text"],
    ["personal_phone", "Phone", ["phone", "mobile", "cell", "phone number", "téléphone"], "text"],
    ["start_date", "Start date", ["start date", "hire date", "hired", "date of hire", "date d'embauche"], "date"],
    ["birth_date", "Birth date", ["birth date", "date of birth", "dob", "birthday"], "date"],
    ["pay_type", "Pay type (hourly / salary)", ["pay type", "pay basis", "type of pay"], "text"],
    ["pay_rate_cents", "Pay rate", ["pay rate", "rate", "hourly rate", "wage", "salary", "taux"], "money"],
    ["hours_per_week", "Hours a week", ["hours per week", "weekly hours", "hours"], "number"],
    ["sin", "SIN", ["sin", "social insurance number", "nas"], "text"],
    ["street", "Street", ["street", "address", "home address"], "text"],
    ["city", "City", ["city"], "text"],
    ["province", "Province", ["province", "state"], "text"],
    ["postal_code", "Postal code", ["postal code", "zip"], "text"],
  ],
};

// Built-in templates (FR-11.08): {system, target, columns: {file column: field}}. A column name ending in * is a
// prefix ("Price [Main store]"). For products the fields are those of map.js.
export const TEMPLATES = [
  { system: "Square", target: "products", columns: { "Item Name": "name", "Category": "category", "Price": "price", "GTIN": "barcode", "Description": "notes", "Default Unit Cost": "cost", "Unit and Precision": "sold_by" } },
  { system: "Shopify", target: "products", columns: { "Title": "name", "Type": "category", "Variant Price": "price", "Variant Barcode": "barcode", "Cost per item": "cost", "Body (HTML)": "notes" } },
  { system: "Lightspeed", target: "products", columns: { "Item": "name", "Description": "name", "Category": "category", "Default - Price": "price", "Price": "price", "Default Cost": "cost", "UPC": "barcode", "EAN": "barcode" } },
  { system: "Clover", target: "products", columns: { "Name": "name", "Price": "price", "Cost": "cost", "Product Code": "barcode", "Categories": "category", "Tax Rates": "tax", "Price Unit": "sold_by" } },
  { system: "Loyverse", target: "products", columns: { "Name": "name", "Category": "category", "Cost": "cost", "Barcode": "barcode", "Price [*": "price", "Description": "notes", "Sold by weight": "sold_by" } },
  { system: "QuickBooks", target: "products", columns: { "Product/Service Name": "name", "Product/Service": "name", "Sales Price / Rate": "price", "Purchase Cost": "cost", "Category": "category", "Taxable": "tax", "Sales Description": "notes" } },
  { system: "Xero", target: "products", columns: { "ItemName": "name", "SalesUnitPrice": "price", "PurchasesUnitPrice": "cost", "SalesDescription": "notes" } },
  { system: "Wave", target: "products", columns: { "Name": "name", "Price": "price", "Description": "notes" } },
  { system: "Zoho", target: "products", columns: { "Item Name": "name", "Rate": "price", "Purchase Rate": "cost", "UPC": "barcode", "EAN": "barcode", "Category Name": "category", "Tax Name": "tax", "Unit": "sold_by" } },

  { system: "Square", target: "customers", columns: { "First Name": "first_name", "Phone Number": "phone", "Reference ID": "card", "Loyalty Points": "points", "Memo": "notes" } },
  { system: "Shopify", target: "customers", columns: { "First Name": "first_name", "Phone": "phone", "Default Address Phone": "phone", "Note": "notes" } },
  { system: "Lightspeed", target: "customers", columns: { "First Name": "first_name", "Phone": "phone", "Mobile": "phone", "Customer ID": "card", "Notes": "notes" } },
  { system: "Clover", target: "customers", columns: { "First Name": "first_name", "Phone Number": "phone" } },
  { system: "Loyverse", target: "customers", columns: { "Customer name": "full_name", "Phone": "phone", "Customer code": "card", "Points balance": "points", "Note": "notes" } },

  { system: "QuickBooks", target: "parties", columns: { "Vendor": "name", "Customer": "name", "Company name": "legal_name", "Email": "email", "Phone": "phone", "Street address": "street", "City": "city", "Province": "province", "Postal code": "postal_code", "Country": "country", "Terms": "payment_terms_days", "Business ID No.": "tax_id", "Account #": "code" } },
  { system: "Xero", target: "parties", columns: { "*ContactName": "name", "ContactName": "name", "AccountNumber": "code", "EmailAddress": "email", "PhoneNumber": "phone", "POAddressLine1": "street", "POCity": "city", "PORegion": "province", "POPostalCode": "postal_code", "POCountry": "country", "TaxNumber": "tax_id", "Website": "website" } },
  { system: "Wave", target: "parties", columns: { "Customer Name": "name", "Vendor Name": "name", "Email": "email", "Phone": "phone", "Address 1": "street", "City": "city", "Province/State": "province", "Postal Code/Zip Code": "postal_code", "Country": "country", "Currency": "currency" } },
  { system: "Zoho", target: "parties", columns: { "Display Name": "name", "Company Name": "legal_name", "EmailID": "email", "Phone": "phone", "Billing Address": "street", "Billing City": "city", "Billing State": "province", "Billing Code": "postal_code", "Billing Country": "country", "Payment Terms": "payment_terms_days", "Currency Code": "currency", "Contact Type": "kind" } },
  { system: "Square", target: "parties", columns: { "Vendor Name": "name", "Account Number": "code", "Contact Name": "contact_name", "Email": "email", "Phone Number": "phone", "Address Line 1": "street", "Locality": "city", "Administrative District Level 1": "province", "Postal Code": "postal_code", "Note": "notes" } },

  { system: "Square", target: "opening_stock", columns: { "Item Name": "product", "GTIN": "barcode", "Current Quantity *": "qty", "Default Unit Cost": "cost_cents" } },
  { system: "Shopify", target: "opening_stock", columns: { "Title": "product", "Variant Barcode": "barcode", "Variant Inventory Qty": "qty", "On hand": "qty", "Cost per item": "cost_cents" } },
  { system: "Lightspeed", target: "opening_stock", columns: { "Item": "product", "UPC": "barcode", "EAN": "barcode", "Qty.": "qty", "Remaining": "qty", "Avg. Cost": "cost_cents", "Default Cost": "cost_cents" } },
  { system: "Clover", target: "opening_stock", columns: { "Name": "product", "Product Code": "barcode", "Quantity": "qty", "Cost": "cost_cents" } },
  { system: "Loyverse", target: "opening_stock", columns: { "Name": "product", "Barcode": "barcode", "In stock [*": "qty", "Cost": "cost_cents" } },
  { system: "QuickBooks", target: "opening_stock", columns: { "Product/Service Name": "product", "Qty On Hand": "qty", "Purchase Cost": "cost_cents" } },
  { system: "Zoho", target: "opening_stock", columns: { "Item Name": "product", "UPC": "barcode", "Opening Stock": "qty", "Stock On Hand": "qty", "Purchase Rate": "cost_cents" } },

  { system: "QuickBooks", target: "open_bills", columns: { "Date": "doc_date", "Transaction type": "kind", "Num": "party_ref", "Vendor": "party", "Customer": "party", "Due date": "due_date", "Open balance": "amount_cents", "Memo/Description": "notes" } },
  { system: "Xero", target: "open_bills", columns: { "Contact": "party", "Invoice Number": "party_ref", "Reference": "party_ref", "Invoice Date": "doc_date", "Date": "doc_date", "Due Date": "due_date", "Due": "amount_cents" } },
  { system: "Wave", target: "open_bills", columns: { "Customer": "party", "Vendor": "party", "Invoice Number": "party_ref", "Bill Number": "party_ref", "Date": "doc_date", "Due Date": "due_date", "Amount Due": "amount_cents" } },
  { system: "Zoho", target: "open_bills", columns: { "Customer Name": "party", "Vendor Name": "party", "Invoice Number": "party_ref", "Bill Number": "party_ref", "Invoice Date": "doc_date", "Bill Date": "doc_date", "Due Date": "due_date", "Balance": "amount_cents" } },
];

const norm = (s) => String(s || "").trim().toLowerCase();
function headerMatches(h, col) { const a = norm(h), b = norm(col); return b.endsWith("*") ? a.startsWith(b.slice(0, -1)) : a === b; }

// The template (built-in or saved: {name, columns}) that fits the file's columns best, with the mapping it gives:
// {template, mapping: {columnIndex: field}, score (share of the template's columns found)}; null if none fits.
export function detect(head, target, saved = []) {
  const cands = saved.map((t) => ({ name: t.name, saved: true, columns: t.columns })).concat(TEMPLATES.filter((t) => t.target === target).map((t) => ({ name: t.system, saved: false, columns: t.columns })));
  let best = null;
  cands.forEach((t) => {
    const cols = Object.keys(t.columns);
    const mapping = {}, used = new Set();
    let found = 0;
    cols.forEach((c) => {
      const i = head.findIndex((h, k) => headerMatches(h, c) && !(k in mapping));
      if (i < 0) return;
      found++;
      if (used.has(t.columns[c]) && !["notes"].includes(t.columns[c])) return;   // two columns for one field: the first wins
      mapping[i] = t.columns[c]; used.add(t.columns[c]);
    });
    // Share of the file's columns that the template knows, and of the template's that are in the file
    const known = head.filter((h) => cols.some((c) => headerMatches(h, c))).length;
    const score = cols.length && head.length ? Math.min(1, (found / Math.min(cols.length, 6) + known / head.length) / 2) : 0;
    if (found >= 2 && score >= 0.5 && (!best || score > best.score || (score === best.score && t.saved))) best = { template: t, mapping, score: Math.round(score * 100) / 100 };
  });
  return best;
}

// Suggested field for each column (no template): by name, then by the kind of values
export function suggestFor(profiles, target) {
  const fields = FIELDS[target] || [];
  const cands = [];
  profiles.forEach((p) => {
    if (p.type === "empty") return;
    fields.forEach(([f, , syns, type]) => {
      let score = 0;
      syns.forEach((s) => { const c = norm(p.name), n = norm(s); const v = c === n ? 1 : c.includes(n) && n.length > 3 ? 0.8 : similar(c, n) * 0.85; if (v > score) score = v; });
      if (type === "money" && p.type === "money") score = Math.max(score, 0.5);
      if (type === "money" && ["text", "date"].includes(p.type)) score *= 0.5;
      if (type === "date" && p.type === "date") score = Math.min(1, score + 0.1);
      if (type === "barcode" && p.type === "barcode") score = Math.max(score, 0.6);
      if (score >= 0.55) cands.push({ col: p.index, field: f, score });
    });
  });
  cands.sort((a, b) => b.score - a.score);
  const out = {}, used = new Set();
  cands.forEach((c) => { if (out[c.col] || used.has(c.field)) return; out[c.col] = { field: c.field, confidence: c.score >= 0.9 ? "high" : c.score >= 0.7 ? "medium" : "low" }; used.add(c.field); });
  return out;
}

// "2026-10-11", "10/11/2026" (month first unless dayFirst), "11.10.2026", "Oct 11, 2026", Excel serial numbers
export function date(v, dayFirst = false) {
  const s = String(v === undefined || v === null ? "" : v).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000); return d.toISOString().substring(0, 10); }
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let [a, b] = [Number(m[1]), Number(m[2])], y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    if (a > 12) dayFirst = true; else if (b > 12) dayFirst = false;
    const [mo, d] = dayFirst ? [b, a] : [a, b];
    return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  const t = Date.parse(s);
  return isNaN(t) ? s : new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().substring(0, 10);
}

const COUNTRY = { canada: "CA", "united states": "US", usa: "US", us: "US", "u.s.a.": "US", mexico: "MX", india: "IN", china: "CN", "united kingdom": "GB", uk: "GB", france: "FR" };

// One file row -> Chedam's fields for the target. mapping: {columnIndex: field}
export function toRecord(fileRow, mapping, target, opts = {}) {
  const fields = Object.fromEntries((FIELDS[target] || []).map((f) => [f[0], f]));
  const out = {};
  Object.entries(mapping).forEach(([i, f]) => {
    if (!f || !fields[f]) return;
    const raw = fileRow[i] === undefined || fileRow[i] === null ? "" : fileRow[i];
    const type = fields[f][3];
    let v = String(raw).trim();
    if (type === "money") { const c = cents(raw); v = c === null ? "" : isNaN(c) ? String(raw) : Math.abs(c); }
    else if (type === "int" || type === "number") { const n = Number(String(raw).replace(/[, ]/g, "")); v = v === "" ? "" : isNaN(n) ? v : type === "int" ? Math.round(n) : n; }
    else if (type === "date") v = date(raw, opts.day_first);
    else if (type === "barcode") v = barcode(raw);
    else if (type === "country") v = v.length === 2 ? v.toUpperCase() : COUNTRY[v.toLowerCase()] || v.substring(0, 2).toUpperCase();
    else if (type === "terms") { const m = v.match(/(\d{1,3})/); v = /receipt|due on/i.test(v) ? 0 : m ? Number(m[1]) : ""; }
    if (out[f] === undefined || out[f] === "") out[f] = v;
  });
  if (target === "customers" && !out.first_name && out.full_name) out.first_name = String(out.full_name).split(/\s+/)[0];
  if (target === "open_bills" && out.kind) out.kind = /invoice|receivable|customer|client/i.test(out.kind) ? "invoice" : /bill|payable|vendor/i.test(out.kind) ? "bill" : out.kind;
  return out;
}

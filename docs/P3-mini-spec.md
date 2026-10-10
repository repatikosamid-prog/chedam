# P3 Buy and spend: mini-spec

Baseline: Master Specification v1.0 (Sections 7-9, 13). Status: **started 2026-10-10** (Sreya: develop P2-P4 non-stop, test everything at the end of P4 in one week). Sprint 3.

## Goal

The store buys and spends inside Chedam: vendors and clients, vendor price lists, purchase orders received against what was ordered, bills and invoices with payments and statements, vendor returns, receiving from a bill photo, landed cost of imports, expense claims and petty cash, layaway, special orders and quotes, house accounts, variants, bundles and serial numbers, delivery-app orders (manual), consignment, recall trace and customer feedback.

**Done when** (Section 13 phase gate): every Must below passes its tests; permissions are enforced on the hub; every write is in the event log; lists export; it is tested on the Pi with 3 devices and a power pull mid-sale; backup and restore are verified. Testing of P2, P3 and P4 happens together at the end of P4 (one week, Sreya, 2026-10-10).

## Build order

| Step | Delivers | Requirements |
| --- | --- | --- |
| 1. Parties ✅ built 2026-10-10 (21 tests) | Vendors and clients (one record can be both): contacts, addresses, payment terms, currency, tax ID, importer/exporter details, documents, notes; a communication log with follow-up reminders | FR-8.01, 8.07, 8.08 |
| 2. Vendor products and price lists ✅ built 2026-10-10 (18 tests) | Vendor SKU, pack size and cost per product and vendor; price list import (CSV/Excel); comparing vendors on cost; preferred vendor | FR-8.02 |
| 3. Purchase orders and reorder ✅ built 2026-10-10 (24 tests) | POs: draft, sent (PDF/print), partly or fully received; differences flagged; incoming stock; min/max reorder rules make draft POs | FR-8.03, 6.13 |
| 4. Bills, invoices, payments, vendor returns | Payables (vendor bills) and receivables (client invoices) with due dates, payments and statements; vendor returns and credits linked to the PO; vendor performance | FR-8.04, 8.05, 8.06 |
| 5. Receive from a bill photo; landed cost | Photo or PDF of a bill read into lines (in the browser), matched to the vendor and products (vendor code → barcode → name), review grid, totals and tax checks, PO check, learns matches; freight, duty and brokerage spread over the lines | FR-6.11, 6.12 |
| 6. Expenses and petty cash | Expense claims with receipt photos: submitted → approved/rejected → reimbursed (till cash, cheque, e-transfer, next pay); duplicate and missing-receipt flags; petty cash float with receipts and top-ups | FR-9.01-9.03 |
| 7. Orders, layaway, quotes, house accounts | Layaway and special orders (deposit, balance, pickup), reserved stock; quotes turned into a sale or an invoice; house accounts with monthly statements | FR-3.18-3.20, 6.10 |
| 8. Product variety | Variants (size × colour) under one parent; bundles and kits made of stocked items; serial/IMEI at sale and warranty lookup | FR-5.17-5.19 |
| 9. Delivery apps and consignment | Delivery orders, manual mode (platform, order number, items, platform prices; accepted → preparing → picked up / cancelled); consignment stock (vendor-owned until sold, payable on sale) | FR-8.09, 6.14 |
| 10. Recall trace and feedback | Lots sold, when, to which members; block recalled lots; feedback kiosk or QR on the receipt, rating and comment, report | FR-6.15, 7.09 |
| 11. Gate | With the P2-P4 test week | Section 13 |

## First design choices

| ID | Decision (proposed) |
| --- | --- |
| P3-a | **One party table** for vendors and clients (`parties`, kind vendor / client / both); customers of the till (loyalty, P2) stay separate: they are identified, never contacted, while parties are businesses or people the store deals with on account |
| P3-b | **Money documents** (POs, bills, invoices, credits) keep their currency and the exchange rate on the document date (FR-8.08); totals in CAD are stored next to them, so reports never re-convert |
| P3-c | **Receiving stays one path:** receiving against a PO, from a bill photo or by hand all end in the P1 receive action (lots, cost, FEFO), so stock rules do not fork |
| P3-d | **Bill photos are read in the browser** (no OCR on the Pi Zero): the device reads the text, the hub matches and checks. Learned matches (vendor code → product) are kept per vendor |
| P3-e | **Payables and receivables are ledgers of documents and payments**, not accounting entries; the accounting views (P&L, balance sheet, bank reconciliation) come in P4 and read these |

## Design decisions (step 1)

| ID | Decision |
| --- | --- |
| DL-154 | **Parties (FR-8.01)**, Home → Vendors and clients: one record per business or person the store buys from or sells to on account: vendor, client or both (P3-a); name, legal name, short code (unique, upper case), GST/HST, PST and CRA business numbers, importer / exporter, currency (3 letters, CAD by default), pay-within days and the terms as written, credit limit (clients: house accounts in step 7), email, phone, website, address, notes, documents (PDF or photos, protected), active. Contacts with a role and a main contact. Seen by managers, the accountant and staff (receiving, bills: `parties.view`); changed by managers (`parties.manage`); never by cashiers |
| DL-155 | **Communication log (FR-8.07):** anyone who sees parties logs a call, email, visit, meeting, note or order, with whom, and who wrote it when; a follow-up date makes a task for the writer, due then, linked to the party (Tasks shows it; the log shows open or done) |
| DL-156 | **Exchange rates (FR-8.08, P3-b):** managers enter the CAD value of one unit of a currency for a day (Vendors and clients → Exchange rates; source noted, e.g. Bank of Canada); a document in that currency uses the latest rate on or before its date (`/api/chedam/fx`); CAD is always 1 |

## Design decisions (step 2)

| ID | Decision |
| --- | --- |
| DL-157 | **Vendor products (FR-8.02)**, Home → Buying → Vendor prices: per vendor and product, the unit it comes in (one of the product's selling units, so its size in base units is known), the vendor's code (unique per vendor) and description, the cost per unit in the vendor's currency, minimum order, lead time, preferred vendor (one per product), in use. A cost change keeps the cost before it and when. Seen by managers, the accountant and staff (`purchasing.view`, all of whom see costs), changed by managers (`purchasing.manage`) |
| DL-158 | **Price lists:** a vendor's CSV or Excel file is read in the browser; the columns are guessed from their names (code, barcode, description, cost, minimum, lead time) and can be changed; rows are matched by the vendor's code, then by barcode (the catalogue's lookup); new links are made, costs updated; the result lists what went up and down and every row that matched nothing, with why |
| DL-159 | **Comparing vendors:** a product's vendors with the cost per base unit in CAD (the vendor's currency at the latest rate, step 1), cheapest first and marked; "Better prices" lists products whose preferred vendor is not the cheapest one with a price, with the saving in % |

## Design decisions (step 3)

| ID | Decision |
| --- | --- |
| DL-160 | **Purchase orders (FR-8.03)**, Buying → Purchase orders: numbered PO-000001…; a draft has the vendor, expected date, notes and lines (product, the unit it is ordered in, quantity, cost per unit in the vendor's currency: the vendor's price, else the product's cost); the exchange rate of the order date is kept on the PO with the CAD total (P3-b). **Send** marks it sent and makes the PDF for the store to email, print or read over the phone (Chedam sends nothing by itself); from then its quantities count as **incoming stock**. A draft changes freely; a sent one does not. Cancel (draft or sent, nothing received) and Close (sent or partly received: the rest is not coming) give the incoming back. Managers (`purchasing.manage`) make, send, cancel and close; whoever receives stock (`stock.receive`) receives |
| DL-161 | **Receiving against an order (P3-c):** what arrived per line (quantity, the cost on the bill, expiry for perishables) goes through the P1 receive action, so lots, FEFO, the product's last cost and the stock movements are the same as any delivery; the cost is converted at the PO's rate. The order becomes partly received or received; "The rest will not come" closes it. **Differences** are kept on each receipt and flag the PO: short (when closed), more than ordered, a different cost, an item not on the order; a task tells the managers. The same receipt sent twice (same op id) changes nothing (BR-10) |
| DL-162 | **Min/max reorder (FR-6.13):** each product has a reorder point (min, P1) and now "order up to" (max; 2 × the min when not set). Products at or below the min (on hand + incoming) are listed on Purchase orders; **Make the orders** creates one draft PO per vendor (the preferred vendor, else the cheapest with a price), each line in whole ordered units, enough to reach the max, at least the vendor's minimum. Products without a vendor are named. Drafts are reviewed and sent by a person |

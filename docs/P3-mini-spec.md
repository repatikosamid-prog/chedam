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
| 4. Bills, invoices, payments, vendor returns ✅ built 2026-10-10 (26 tests) | Payables (vendor bills) and receivables (client invoices) with due dates, payments and statements; vendor returns and credits linked to the PO; vendor performance | FR-8.04, 8.05, 8.06 |
| 5. Receive from a bill photo; landed cost ✅ built 2026-10-10 (17 tests; reading a real photo on a phone is checked in the test week) | Photo or PDF of a bill read into lines (in the browser), matched to the vendor and products (vendor code → barcode → name), review grid, totals and tax checks, PO check, learns matches; freight, duty and brokerage spread over the lines | FR-6.11, 6.12 |
| 6. Expenses and petty cash ✅ built 2026-10-10 (19 tests) | Expense claims with receipt photos: submitted → approved/rejected → reimbursed (till cash, cheque, e-transfer, next pay); duplicate and missing-receipt flags; petty cash float with receipts and top-ups | FR-9.01-9.03 |
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

## Design decisions (step 4)

| ID | Decision |
| --- | --- |
| DL-163 | **Bills and invoices (FR-8.04, P3-e)**, Buying → Bills and invoices: **bills** (we owe a vendor, B-…), **vendor credits** (VC-…), **invoices** (a client owes us, INV-…), **client credits** (CC-…). Each has the party, their reference (the vendor's invoice number: recorded once per vendor), date, due date (from the party's pay-within days unless given), lines, GST/HST and PST, total, the currency with the rate of its date and the CAD total, up to 3 photos or PDFs of the paper. Status open → partly paid → paid; **void** needs a reason and no payments. Aging of what is open (not due, 1-30, 31-60, 61-90, over 90 days late), in CAD. Managers and the accountant (`finance.manage`) record everything; purchasing managers also record vendor bills |
| DL-164 | **Payments:** cheque (number), e-transfer, bank transfer, cash, cash from the till, card, or **a credit applied** (a vendor credit to a bill, a client credit to an invoice, same party and currency: the credit is used up by the same amount). A payment can be taken off (a credit applied gets its amount back). **Statement of account** per party, in its currency: opening balance, documents and payments in the dates, running and closing balance, aging; as a PDF |
| DL-165 | **Bill from an order (three-way match):** "Make the bill from what was received" on a PO makes a bill with the received quantities at the order's costs; a bill linked to a PO whose amount differs from what was received says by how much ("above / below what was received") |
| DL-166 | **Returns to vendors (FR-8.05):** goods going back (from what the vendor sells us), their return number (RMA) and why: the stock goes out at once at cost, FEFO, as a stock adjustment "Returned to vendor" (a new reason); the return waits for the vendor's credit, recorded as a vendor credit linked to it (then applied to a bill). **Vendor performance (FR-8.06):** per vendor with received orders: on time (received by the expected date), short-shipped lines, damaged (returns whose reason says damaged, broken, leaking, expired or spoiled) |

## Design decisions (step 5)

| ID | Decision |
| --- | --- |
| DL-167 | **Reading the bill on the device (P3-d, FR-6.11):** Buying → Receive a bill (also from Add stock): a photo (the phone's camera) or a PDF. Photos are read with Tesseract (English model, LSTM engine, ~11 MB served by the hub from `ocr/`, loaded only when used and not cached by every device); PDFs with their own text (pdf.js), or read like a photo when they are scans. The text becomes lines (code, description, quantity, unit price, line total), the bill's number and date, subtotal, GST/HST, PST, freight and total; checks are shown when the lines do not add up to the subtotal, the GST/HST is not 5%, 13% or 15%, or subtotal + taxes + freight is not the total. Nothing is sent to an outside service |
| DL-168 | **Matching (hub):** for each line: a match **learned** from this vendor's earlier bills (their code, or their wording), the vendor's **code** in their price list, a **barcode**, then the closest **name** (the vendor's description or the product name, word overlap; taken at 50% or more), with up to three candidates; anything else waits for a person (search). The vendor's open orders are listed (the newest chosen) and each line says "as ordered" or how it differs. The review grid shows the read text of each line, product, unit, quantity, cost in the vendor's currency and expiry; lines can be left out |
| DL-169 | **Receiving and landed cost (FR-6.12, P3-c):** against the chosen order (its lines by product; others as extra items, flagged) or as a delivery, through the same receive action as everything else. **Freight, duty and brokerage** (CAD; the bill's freight is filled in) are spread over the lines by value and added to each item's cost, so lots and margins carry the landed cost; also when receiving an order by hand. The receipt keeps them and that it came from a bill. Confirming **learns** each line's match for this vendor and, for purchasing managers and the accountant, can **record the bill** (lines, freight/duty/brokerage as lines, GST/HST, PST, their invoice number and date) |

## Design decisions (step 6)

| ID | Decision |
| --- | --- |
| DL-170 | **Expense claims (FR-9.01)**, Home → Expenses, for everyone signed in: day, where, the amount paid with the GST/HST and PST in it, a category (setting `expenses.categories`), how it was paid (own money, the petty cash box, the store's card, cash from the till), what for, up to 5 receipt photos (camera) or PDFs, protected; numbered EX-…. People see their own claims; approvers (`expenses.approve`: managers, the accountant) see all, totals by category, export. Submitted → **approved** or **rejected** (a reason); nobody but the owner approves their own claim. A claim paid with the store's money (petty cash, card, till) is done when approved; one paid with the person's own money is **paid back**: cash from an open till (a pay-out on that till, so the Z report balances), the petty cash box, a cheque (number), an e-transfer, or with the next pay |
| DL-171 | **Flags (FR-9.02):** a possible **duplicate** (the same amount, same place or none given, within 3 days, by anyone) names the other claim; a **missing receipt** (no photo on a claim over `expenses.receipt_over_cents`, 0 = every claim); a photo can be added later. Flags guide the approver, they do not block |
| DL-172 | **Petty cash (FR-9.03):** the box has a float (`petty_cash.float_cents`, $200) and a running balance: expenses paid from it take it down at once (refused when the box has too little), paying someone back from it too, top-ups put money in, a **count** records what is really there and the difference (short / over), and a rejected claim paid from it records that the money should go back. Approvers see the box and its moves |

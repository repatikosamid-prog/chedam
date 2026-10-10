# P3 Buy and spend: mini-spec

Baseline: Master Specification v1.0 (Sections 7-9, 13). Status: **started 2026-10-10** (Sreya: develop P2-P4 non-stop, test everything at the end of P4 in one week). Sprint 3.

## Goal

The store buys and spends inside Chedam: vendors and clients, vendor price lists, purchase orders received against what was ordered, bills and invoices with payments and statements, vendor returns, receiving from a bill photo, landed cost of imports, expense claims and petty cash, layaway, special orders and quotes, house accounts, variants, bundles and serial numbers, delivery-app orders (manual), consignment, recall trace and customer feedback.

**Done when** (Section 13 phase gate): every Must below passes its tests; permissions are enforced on the hub; every write is in the event log; lists export; it is tested on the Pi with 3 devices and a power pull mid-sale; backup and restore are verified. Testing of P2, P3 and P4 happens together at the end of P4 (one week, Sreya, 2026-10-10).

## Build order

| Step | Delivers | Requirements |
| --- | --- | --- |
| 1. Parties | Vendors and clients (one record can be both): contacts, addresses, payment terms, currency, tax ID, importer/exporter details, documents, notes; a communication log with follow-up reminders | FR-8.01, 8.07, 8.08 |
| 2. Vendor products and price lists | Vendor SKU, pack size and cost per product and vendor; price list import (CSV/Excel); comparing vendors on cost; preferred vendor | FR-8.02 |
| 3. Purchase orders and reorder | POs: draft, sent (PDF/print), partly or fully received; differences flagged; incoming stock; min/max reorder rules make draft POs | FR-8.03, 6.13 |
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

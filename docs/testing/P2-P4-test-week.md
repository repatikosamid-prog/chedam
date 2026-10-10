# P2-P4 test week (Sreya)

One week to test everything built in P2 Engage, P3 Buy and spend and P4 People and money, as agreed on 2026-10-10 ("skip testing to the end of P4; put a week of time for it"). Claude ran the automated part of the gate first (see `docs/gate/P2-P4-gate.md`).

**Sheets** (each row: do it, compare, choose Pass / Fail / Blocked, write what happened when it is not a Pass):

| Sheet | Checks | Covers |
| --- | --- | --- |
| `Chedam-Manual-Tests-P2.xlsx` | 98 | Promotions, customers and loyalty, markdowns, customer display, dashboard and insights, tasks and checklists, messages, pings, inbox, help |
| `Chedam-Manual-Tests-P3.xlsx` | 66 | Vendors and clients, vendor prices, purchase orders, bills and payments, bill photo scanning, expenses, layaways and orders, variants and bundles, delivery and consignment, recalls and feedback |
| `Chedam-Manual-Tests-P4.xlsx` | 82 | People and leave, time clock, roster, time sheets, payroll, bank, card fees and statements, books, statements and returns, exports |

**Before you start:** the hub has the sample store (Demo Owner, Mira Manager, Ana Accountant, Cal Cashier, Sam Staff; PINs as before). Use the laptop, the iPhone and the till (Android later). Send Claude the filled sheets each evening (or the rows that failed) so fixes are ready the next morning.

## Plan

| Day | Morning | Afternoon |
| --- | --- | --- |
| 1 | P2: promotions, customers and loyalty, markdowns (with real selling at the till) | P2: customer display, dashboard, insights |
| 2 | P2: tasks, checklists, messages, pings, inbox, help | P3: vendors and clients, vendor prices, purchase orders and receiving |
| 3 | P3: bills, payments, a real bill photo scanned on the iPhone | P3: expenses and petty cash, layaways, special orders, quotes, house accounts |
| 4 | P3: variants, bundles, serial numbers, delivery orders, consignment, recalls, feedback | P4: people and leave, time clock (several people punching on the till), roster and swaps |
| 5 | P4: time sheets and payroll (a real pay period with PDOC numbers) | P4: bank (a real statement from the store's bank, CSV and OFX), card fees, platform payouts, vendor statements |
| 6 | P4: books, closing last month, statements, GST/HST and PST returns; give the accountant the exports | Gate with Claude: 3 real devices selling together, 10 plug pulls mid-sale, spare-card restore |
| 7 | Retest everything that failed (Claude's fixes) | Sign off P2-P4, or list what stays open |

## Gate items that need you

- **3 real devices** selling at the same time for 15 minutes (till, laptop, iPhone), including a card sale with the card type and a return.
- **Power pull mid-sale**: pull the Pi's plug 10 times while a sale is being paid; after each, the hub comes back in about 40 s and the sale is either complete or not there at all.
- **Spare card restore**: restore last night's backup onto the spare SD card and start the hub from it.
- **The accountant**: import the QuickBooks or Xero journal export for one month into a test company; compare the GST/HST return lines with their own figures.

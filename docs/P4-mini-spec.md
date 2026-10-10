# P4 People and money: mini-spec

Baseline: Master Specification v1.0 (Sections 7-10, 13; BR-30-32). Status: **started 2026-10-10** (Sreya: develop P2-P4 non-stop; then one test week for P2, P3 and P4 together). Sprint 4.

## Goal

The store runs its people and its books in Chedam: employee records with leave, the time clock with BC break and overtime alerts, the roster, time sheets, payroll preparation with pay stubs and ROE/T4 data, bank reconciliation and deposits, card fees and delivery-platform payouts, vendor statements, period close, financial statements, GST/HST and PST returns, and exports for the accountant.

**Done when** (Section 13 phase gate): every Must below passes its tests; permissions are enforced on the hub (SIN owner-only, encrypted); every write is in the event log; lists export; it is tested on the Pi with 3 devices and a power pull mid-sale; backup and restore are verified. Then the **P2-P4 test week** (Sreya).

## Build order

| Step | Delivers | Requirements |
| --- | --- | --- |
| 1. Employees and leave | Employee records: personal details, emergency contact, job, start date, pay type and rate, vacation entitlement, documents; SIN encrypted, owner-only; leave balances (vacation, sick, unpaid) that accrue | FR-9.09, 9.10 |
| 2. Time clock | Clock in/out and breaks on any device with the PIN, hub clock for all times; punch edits keep the original, who and why; BC break and overtime alerts before they happen | FR-9.04-9.06, BR-30-32 |
| 3. Roster | Weekly roster grid; publish; staff see their own schedule; swap requests; labour cost vs sales | FR-9.07 |
| 4. Time sheets | Per pay period: approved hours from punches, anomaly flags (missing punch-out, no break, overtime, unscheduled shifts), approval | FR-9.08 |
| 5. Payroll | Approved hours, overtime, vacation pay, reimbursements → gross; deductions entered from the CRA calculator or the accountant; line-by-line review; pay stubs each employee sees; payment record; ROE and T4 data | FR-9.11-9.13 |
| 6. Bank | Bank statement import (CSV, OFX, QFX); auto-match deposits, vendor payments, expenses, payroll; manual match; unmatched list; deposits of till cash to the bank, matched on the statement | FR-10.02, 10.03 |
| 7. Card fees, platform payouts, vendor statements | Card processing fees by card type (in margin and P&L); delivery platform payout statements and commission; vendor statement reconciliation | FR-10.05, 8.10, 10.04 |
| 8. Books and period close | Chedam's records turned into accounts (sales, tax, COGS, payables, receivables, payroll, cash, bank); period close and lock, owner unlock | FR-10.06 |
| 9. Statements and tax returns | Profit and loss, balance sheet, cash flow; GST/HST and BC PST return reports | FR-10.07, 10.08, 4.15 |
| 10. Accountant exports | Sales journal, expenses, payroll journal, reconciliation as QuickBooks/Xero-compatible CSV | FR-10.12 |
| 11. Gate and the P2-P4 test week | 3 devices, power pull, backup + restore, Pi load; Sreya's manual tests of P2, P3 and P4 | Section 13 |

## First design choices

| ID | Decision (proposed) |
| --- | --- |
| P4-a | **People are the existing users** (everyone who signs in); an employee record adds HR and pay details to a user. Someone paid but never signing in still gets a user (no PIN set, no device) |
| P4-b | **SIN and bank details are encrypted on the hub** with a key kept outside the database (the hub's secret file, backed up with the recovery key), shown only to the owner; never in exports or the event log |
| P4-c | **Deductions are entered, not calculated** (Master Specification R4): CPP, EI and income tax come from the CRA payroll calculator (PDOC) or the accountant, per employee per pay; Chedam adds hours, overtime, vacation pay and reimbursements, checks the totals and keeps the records. A payroll service connection is later (FR-9.14) |
| P4-d | **The books are derived, not keyed:** each money record (sale, return, bill, payment, expense, payroll, bank line) produces its journal lines by fixed rules into a small chart of accounts the accountant can rename and map; a closed period refuses changes (BR-34 kept) |
| P4-e | **BC first** (A2): BC employment standards for breaks and overtime (BR-31), BC PST; other provinces through the tax tables later |

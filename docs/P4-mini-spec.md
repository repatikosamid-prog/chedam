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

## Design decisions (step 1)

| ID | Decision |
| --- | --- |
| DL-186 | **Employee records (FR-9.09)**, Home → People: one record per person who signs in (P4-a): legal name, job, start and end dates, status (working, on leave, left), address, personal phone and email, emergency contact, pay type (hourly or salary) and rate, pay frequency, hours a week, overtime paid, vacation pay %, vacation and sick days a year, TD1 amounts, notes, documents (protected files). **Who sees what:** the owner (`hr.manage`, owner only) everything and makes all changes; managers (`hr.view`) the record without pay, SIN, bank or personal contact details; each person their own record and leave on the **Me** tab (not pay or bank) |
| DL-187 | **SIN and bank details (P4-b):** the SIN is checked (9 digits, the Luhn rule); SIN and bank details (institution 3, transit 5, account 5-12 digits) are encrypted with the hub's own key (`pb_data/chedam-hr.key`, made on first use, in the backups) and shown masked (•••-•••-286, ••••567). Only the owner can **show** the full SIN (asked first; who and when is recorded). They are never in the event log (logged as "[personal]"), exports or the data export |
| DL-188 | **Leave (FR-9.10):** hours in a ledger per kind (vacation, sick, unpaid). Each night a job adds, once a month, salaried vacation (days a year / 12 × hours a day; hourly staff get vacation pay as a % of each pay in step 5) and, once a year after 90 days of work, the BC paid sick days (setting `hr.leave`: 5 days); unused sick days expire at the new grant. Managers record leave taken (not more than is left, except unpaid); the owner adjusts a balance with a reason. Every line is in the history with who and why |

## Design decisions (step 2)

| ID | Decision |
| --- | --- |
| DL-189 | **Time clock (FR-9.04, 9.05)**, Home → Time clock: one shift per clock-in with its breaks; **every time is the hub's clock** (BR-30), never the device's. **Me:** clock in, start a break, back, clock out on your own signed-in device. **Someone else:** anyone punches on any paired device with their name and PIN; the device stays signed in as it was (wrong PINs count towards the lock). A shift belongs to the day it started. Who is on the clock now is shown on the screen. Shifts are kept like payroll records (retention) |
| DL-190 | **BC rules and alerts before they happen (BR-31, P4-e)**, setting `timeclock.rules`: a 30-minute meal break before 5 hours of work (only a break that long resets the count; it is unpaid unless `meal_paid`; shorter breaks are paid rest breaks); overtime 1.5× after 8 hours a day or 40 regular hours a week, double after 12 a day (none for people whose record says no overtime); 8 hours off between shifts. The screen warns 30 minutes ahead ("Take a meal break by 14:00", "Overtime starts at 17:35"); a job every 5 minutes sends each alert once per shift to the person and the managers (inbox, kind alert), plus "still clocked in after 14 hours" (a missed punch-out) |
| DL-191 | **Shifts and fixes (FR-9.06)**, Time clock → Shifts (`timeclock.manage`, managers): the week by person with paid hours, regular, overtime and double time, flags (no punch-out, no meal break, short rest, fixed, added); a fix changes in, out and breaks **with a reason**, keeps the original punches and every change (who, when, why); a shift nobody punched is added with a reason (not overlapping another). Nobody fixes their own punches except the owner |


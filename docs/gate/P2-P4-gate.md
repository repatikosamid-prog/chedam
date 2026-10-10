# P2-P4 gate (automated part)

Section 13 "Phase gate" for P2 Engage, P3 Buy and spend and P4 People and money, run by Claude on 2026-10-10 at the end of P4. The rest is Sreya's test week (`docs/testing/P2-P4-test-week.md`).

| Gate item | How | Result |
| --- | --- | --- |
| All Must requirements pass their tests | 57 hub suites on the PC (about 2,000 checks), 48 of them on the Pi itself (each on a fresh throwaway hub, `tools/pitest/run-on-pi.sh`) | **pass** after one test fix (below). Manual sheets: P2 98, P3 66, P4 82 checks for Sreya |
| Permissions enforced on the hub | per step; SIN and bank details encrypted, owner-only; pay, bank and books closed to the generic API | **pass** |
| Every write in the event log | `tools/gate/event-coverage.py` on the store hub | 586/586 records, integrity ok: **pass** |
| Exportable | step18 export groups cover every table; accountant CSVs (step 51) | **pass** |
| Pi load with the new features | 5 tills, a sale every 1.5 s each, 4 minutes: 266 online + 30 offline sales, 30 returns, 2,380 requests, 0 errors | **pass** (`loadtest-2026-10-10-p4-stress.json`) |
| Power pull mid-sale | P1 tests still apply (no change to the sale path except an optional card type); 10 real pulls | Sreya |
| Backup and restore | `chedam-backup test-restore` needs the backup drive, which is not plugged into the Pi | **Sreya**: plug the drive in, then Claude runs it; spare-card restore in the test week |
| 3 real devices | | Sreya |

## Measured on the Pi Zero 2 W

| | Result | Note |
| --- | --- | --- |
| NFR-05 payment to receipt | median 0.55 s, p95 1.17 s | as in P1 (accepted, DL-107) |
| NFR-08 hub memory | peak 161 MB under the stress pace (P1: 148 MB) | above 150 MB only at stress pace; store pace to be confirmed in the test week |
| Books on this month (after ~300 sales) | trial balance 2.5 s, journal 1.7 s, P&L 1.9 s, balance sheet 1.3 s, cash flow 2.6 s, journal export 1.2 s; memory steady | **watch:** the open month is worked out from every record each time, so a busy month (thousands of sales) will take tens of seconds on the Pi Zero. Closed months use their snapshot. If it is too slow in the test week: a daily cached summary (or the Pi 4 hub) |

## Found by the gate

1. `step3-access` read only the first 500 events; the P4 migrations (chart of accounts, settings) now write more than that at start-up, so three log checks missed theirs. The test now reads the tables it checks. Product unchanged.

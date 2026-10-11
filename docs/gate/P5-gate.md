# P5 gate (automated part)

Section 13 "Phase gate" for P5 Connect and enrich, run by Claude on 2026-10-11. The real-service and real-device items are Sreya's (below).

| Gate item | How | Result |
| --- | --- | --- |
| All Must requirements pass their tests | 60 hub suites on the PC (about 1,700 checks, with the 8 new P5 suites step52-59 and step60 for testing round 3); 46 on the Pi itself, each on a fresh throwaway hub (`tools/pitest/run-on-pi.sh`, 1,323 checks). The P5 suites that use the fake Square, Google, Microsoft and Open Food Facts run on the PC only (the Pi's test hub can't reach the PC's fakes) | **pass** after one test fix (below). Manual: `Chedam-Manual-Tests-P5.xlsx` (56 checks) and `Chedam-Retest-2026-10-11.xlsx` (18) |
| Permissions on the hub | owner only: card processor, cloud drive, remote support; secrets (processor token, cloud tokens, Google secret) sealed and hidden, never in answers, the event log or exports (tested); cashiers see only the cashier's screens | **pass** |
| Every write in the event log | `tools/gate/event-coverage.py` on the Pi's hub | 699/699 records, integrity ok: **pass** |
| Exportable | the P5 tables are in the export groups (step18 caught that they were not) | **pass** |
| Linked payments fall back | Square down, no terminal, training: the till keys the card in (step53) | **pass** (fake Square) |
| Pi load | 5 tills at stress pace (a sale every 1.5 s each), 4 minutes: 342 online + 30 offline sales, 41 returns, 15 voids, 2,285 requests, no lost or duplicated sales, stock = movements, Z = sales | **pass**; payment to receipt p95 1.36 s (P4: 1.17 s; target 1 s not met on the Pi Zero, accepted in DL-107), memory peak 161 MB (as P4) (`loadtest-2026-10-11-p5-stress.json`) |
| Power pull mid linked payment, 3 devices, backup + restore | | **Sreya** (with the Square sandbox and the backup drive) |

## Found by the gate

1. `step2-schema-eventlog` counted 58 permissions; P5 added 3 (payments.connect, cloud.connect, support.manage). The count was updated.
2. The load test sold a case when only loose cans were left, and the till refused it ("open a larger pack?"). With testing round 3's "sell beyond stock" decision (DL-240), the hub now opens what it can and goes below zero for the rest.

## Waiting for outside items

| Item | For |
| --- | --- |
| Square developer account, sandbox token, a Square Terminal (D1) | Linked payments and refunds for real (C01-C25) |
| Google and Microsoft app registrations (D2) | Cloud drive, off-site backup, remote view for real (D01-D14); browser sign-in from the phone to be checked (DL-228) |
| `cloudflared` installed on the Pi (Sreya's OK) | Remote support (S01-S06), and the web store next |
| OK to download the large reference datasets | Open Food Facts offline, CBSA tariff, nutrients, FoodKeeper, ITC-HS |
| A USB scale on a till PC | The till scale (T17) |

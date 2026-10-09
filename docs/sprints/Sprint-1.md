# Sprint 1: P1 Sell

**Goal:** a store can sell on the Pi hub, online and offline. **Started** 2026-10-06. **Spec:** `docs/P1-mini-spec.md`.

## Backlog

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 1-10 | Build steps 1-10 (products, tax, till, selling, printing, returns, labels, import/export, reports, gate) | Claude | Done, deployed `dev-b0e54bb` |
| T1 | Functional testing: `docs/testing/Chedam-Manual-Tests-P1-1-10.xlsx` (109 checks) | Sreya | In progress (2026-10-08) |
| T2 | Fix the bugs found in T1 | Claude | Round 1 built, tested and deployed 2026-10-09 (`dev-c5587c9`; DL-109..113, 808 hub tests): remove one line, item and sale discounts on receipts, 15 s back to selling, reprint needs a manager, till numbers, batch numbers, stock colours, label layout, iPhone PDF error, import template, export choice, "Saved ✓". Retest: `docs/testing/Chedam-Retest-2026-10-09.xlsx` (21 checks) |
| T3 | Retest of round 1 (`Chedam-Retest-2026-10-09.xlsx`, 21 checks) | Sreya | **All passed** (2026-10-09) |
| U1 | UI requests: Home button (the Chedam C), the business logo in the app (after asking the owner), fixed top bar and screen header | Claude | Done, deployed `dev-c80615e` (DL-115) |
| R1 | Receipts as PDF (save or print anywhere, no printer needed) | Claude | Built and tested 2026-10-09 (DL-116); deploys with P2 step 1 |
| N2 | Proposal: linked card terminal and a web store fed by the store's stock: `docs/proposals/card-terminal-and-webstore.md` | Sreya | Decided 2026-10-09 (DL-114): the store's own processor, P5; web store added to the plan (option A); owner manages DNS. Web store: option A |
| Q1 | Accountant review of the tax rules (blocks release) | Sreya | Due 2026-10-08 EOD |
| Q2 | Accept or change the return-policy defaults | Sreya | Open |
| G1 | Gate rows with real devices: L01 3 devices, L02 Android camera, L03 10 plug pulls, L04 spare-card restore, L05, L06 pilot week | Sreya + Claude | Open |
| N1 | Replace the temporary GST/PST/BN numbers with the real ones | Sreya | Open |
| H1 | Printer hardware (rows marked NEEDS PRINTER) | Sreya | No hardware yet |

## Decisions this sprint

- DL-114 (2026-10-09): card terminal links the processor the store already has (Square if none), in P5; web store added to the plan (option A); the store owner manages the domain's DNS.
- DL-107 (2026-10-08): payment p95 of 1.1-1.7 s on the Pi Zero is accepted for the pilot; the hub moves to a **Pi 4** later (more memory and faster storage, handles high stress).

## Decided 2026-10-09 (DL-116)

Pilot week skipped (the Pi has run since the start; production on a Pi 4). Q1, N1 and H1 move to the end. P1 development is done; Sprint 2 (P2) starts.

## Definition of done

All Must checks pass (T1, T2), the gate rows pass (G1), Q1 confirmed; then the P1 release.

## Review and retrospective

(At the end of the sprint.)

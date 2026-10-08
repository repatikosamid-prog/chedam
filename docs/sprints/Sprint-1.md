# Sprint 1: P1 Sell

**Goal:** a store can sell on the Pi hub, online and offline. **Started** 2026-10-06. **Spec:** `docs/P1-mini-spec.md`.

## Backlog

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 1-10 | Build steps 1-10 (products, tax, till, selling, printing, returns, labels, import/export, reports, gate) | Claude | Done, deployed `dev-b0e54bb` |
| T1 | Functional testing: `docs/testing/Chedam-Manual-Tests-P1-1-10.xlsx` (109 checks) | Sreya | In progress (2026-10-08) |
| T2 | Fix the bugs found in T1 | Claude | Waiting for T1 |
| Q1 | Accountant review of the tax rules (blocks release) | Sreya | Due 2026-10-08 EOD |
| Q2 | Accept or change the return-policy defaults | Sreya | Open |
| G1 | Gate rows with real devices: L01 3 devices, L02 Android camera, L03 10 plug pulls, L04 spare-card restore, L05, L06 pilot week | Sreya + Claude | Open |
| N1 | Replace the temporary GST/PST/BN numbers with the real ones | Sreya | Open |
| H1 | Printer hardware (rows marked NEEDS PRINTER) | Sreya | No hardware yet |

## Decisions this sprint

- DL-107 (2026-10-08): payment p95 of 1.1-1.7 s on the Pi Zero is accepted for the pilot; the hub moves to a **Pi 4** later (more memory and faster storage, handles high stress).

## Definition of done

All Must checks pass (T1, T2), the gate rows pass (G1), Q1 confirmed; then the P1 release.

## Review and retrospective

(At the end of the sprint.)

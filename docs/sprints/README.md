# Sprints

Chedam is built in agile sprints: **one phase of the Master Specification (Section 13) = one sprint**. Each sprint has a goal, a backlog (the phase's mini-spec build steps), a definition of done (the phase gate) and ends with a review and a retrospective.

| Sprint | Phase | Goal | Status |
| --- | --- | --- | --- |
| 0 | P0 Foundation | Pi hub, PWA shell, sign-in, backups, updates | Done (2026-10-03..05) |
| **1** | **P1 Sell** | **A store can sell on the Pi hub** | **Built; testing and release** (see `Sprint-1.md`) |
| 2 | P2 Engage | Customers, promotions, insights | Planned |
| 3 | P3 Buy and spend | Purchasing, vendors, expenses | Planned |
| 4 | P4 People and money | Staff, payroll inputs, accounting | Planned |
| 5 | P5 Connect and enrich | Integrations, product data | Planned |

## How a sprint runs

| Agile practice | In Chedam |
| --- | --- |
| Sprint planning | Mini-spec for the phase (`docs/Pn-mini-spec.md`): build order, design decisions, open questions |
| Backlog | The mini-spec's build steps, plus bugs from testing |
| Daily stand-up | The day's work log entry (`Work Log/entries/`) and its PDF |
| Increment | Each step deployed to the Pi after Sreya's go-ahead |
| Definition of done | The phase gate: Musts tested, offline, permissions, event log, export, 3 devices, power pull, backup/restore, pilot week; plus phase-specific blockers (P1: accountant review Q1) |
| Sprint review | Sreya's functional testing with the manual test sheet; gate report (`docs/gate/`) |
| Retrospective | What went well / what to change, written at the end of the sprint file |

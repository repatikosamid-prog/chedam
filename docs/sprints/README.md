# Sprints

Chedam is built in agile sprints: **one phase of the Master Specification (Section 13) = one sprint**. Each sprint has a goal, a backlog (the phase's mini-spec build steps), a definition of done (the phase gate) and ends with a review and a retrospective.

| Sprint | Phase | Goal | Status |
| --- | --- | --- | --- |
| 0 | P0 Foundation | Pi hub, PWA shell, sign-in, backups, updates | Done (2026-10-03..05) |
| 1 | P1 Sell | A store can sell on the Pi hub | Done (2026-10-09); Q1 tax review, real tax numbers and printer tests at the end (DL-116) |
| 2 | P2 Engage | Customers, promotions, insights | Built and deployed (2026-10-09..10); gate with the P2-P4 test week |
| 3 | P3 Buy and spend | Purchasing, vendors, expenses | Built and deployed (2026-10-10); gate with the P2-P4 test week |
| 4 | P4 People and money | Staff, payroll inputs, accounting | Built and deployed (2026-10-10); automated gate done, P2-P4 test week with Sreya |
| **5** | **P5 Connect and enrich** | **Integrations (linked card terminal: the store's own processor, DL-114), cloud backup and remote view, imports, reference data** | **Started 2026-10-11** (see `Sprint-5.md`) |
| 6 | Web store | Online shop fed by the store's stock, **hosted on the store's own Pi** through an outbound tunnel (DL-214, 2026-10-11, replaces option A of DL-114); also manager remote access (FR-12.06). Next after P5 | Planned |

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

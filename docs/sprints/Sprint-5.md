# Sprint 5: P5 Connect and enrich

Started 2026-10-11. Goal: the store's own card processor linked to the till (Square first), refunds and fees through it, off-site backup and the owner's remote view on Google Drive or OneDrive, imports for every kind of record with ready mappings, reference data that suggests, and remote support (see `docs/P5-mini-spec.md`).

## Backlog

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 1 | Payment interface, Square connect, terminal pairing | Claude | Done, deployed (27 tests; DL-215..217) |
| 2 | Linked card payments at the till | Claude | Done, deployed (26 tests; DL-218..220) |
| 3 | Linked refunds, processor fees and payouts | Claude | Done, deployed (25 tests; DL-221..223) |
| 4 | Cloud drive connection and off-site backup | Claude | Done, deployed (21 tests; DL-224, 225) |
| 5 | Owner remote view | Claude | Done, deployed (16 tests; DL-226..228) |
| 6 | Import everything, mapping templates | Claude | Done, deployed (36 tests; DL-229..231) |
| 7 | Reference data that suggests | Claude | To do |
| 8 | Remote support session | Claude | To do |
| 9 | Gate | Claude + Sreya | To do |

## Needed from outside

| Item | For | Status |
| --- | --- | --- |
| Square developer account, sandbox access token, a Square Terminal (D1) | Steps 1-3 for real; until then a fake Square in the tests | Waiting |
| Google and Microsoft app registrations (D2) | Steps 4-5 for real (and the email fallback from P2) | Waiting |

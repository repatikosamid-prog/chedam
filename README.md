# Chedam

Offline-first business system for small retail stores: POS, inventory, team messaging and back office, running on a low-cost hub (Raspberry Pi) over the store's own Wi-Fi. No subscriptions, no internet dependency.

## Status

Specification complete (Master Specification v1.0). Development starts with Phase 0 (Foundation).

## Repository layout

| Folder | Contents |
| --- | --- |
| `SDLC Docs Toosl softweare installers and ReadMe/MASTER Specifications` | Current master specification (the reference for all phases) |
| `SDLC Docs Toosl softweare installers and ReadMe/Versions` | Earlier spec versions and decision documents |

Planned folders as development starts:

| Folder | Contents |
| --- | --- |
| `hub/` | PocketBase hooks, migrations, hub scripts (backup, print, health) |
| `client/` | Svelte PWA source |
| `datasets/` | Dataset build scripts and packed reference data |
| `tools/` | Sample-data generator, update-package builder |
| `docs/` | Mini-specs per phase, conventions, decisions |

## Phases

P0 Foundation, P1 Sell, P2 Engage, P3 Buy and spend, P4 People and money, P5 Connect and enrich. See the Master Specification, Section 13.

## Owner

Sreya. All rights reserved.

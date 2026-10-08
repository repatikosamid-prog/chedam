# P1 gate (step 10)

Section 13 "Phase gate (every phase)" for P1, with the NFRs that apply. Automated parts were run by Claude on the Pi Zero 2 W hub (`chedam`, 192.168.50.101) on 2026-10-07/08; the rest is done with Sreya during functional testing (rows L01-L06 of `docs/testing/Chedam-Manual-Tests-P1-1-10.xlsx`).

| Gate item | How | Result |
| --- | --- | --- |
| All Must requirements pass their tests | 782 automated tests (20 suites) on every build; manual sheet (109 checks) | Automated: **pass**. Manual: Sreya |
| Works offline where specified | step14 tests; load test offline burst (30 uploads at the same moment, each sent twice); manual E01-E05 | Automated: **pass** (repeats answered with the first result). Manual: Sreya |
| Permissions enforced on the hub | access tests (step 3) and per step; cost fields: hook covers returns too (fixed in step 10) | **pass** |
| Every write in the event log | `tools/gate/event-coverage.py`: every record has its create event, every changed record an update event | Store hub 338/338; load-test hub 5104/5104: **pass** |
| Tasks create and close | tests per rule (drafts, oversold, variance, vendor returns, offline sales) | **pass** |
| Exportable to CSV/Excel | step 8 (lists, reports, full export) | **pass** |
| Tested on the Pi with 3 devices | 5 simulated tills (load test); 3 real devices: L01 | Simulated: **pass**. Real: Sreya |
| Power pull mid-sale | `tools/powertest/sale-writer.mjs`: 3 hard resets (sysrq b, no sync) while a till sells; 10 real plug pulls: L03 | 3/3 **pass**: 311 confirmed sales, 0 lost, 0 incomplete, 0 half sales, stock consistent, integrity ok, back in ~40 s. Real pulls: Sreya |
| Backup and restore verified | nightly verified backups; `chedam-backup test-restore` (29 tables); spare-card restore: L04 | **pass** (0.5 s, all tables equal). Spare card: Sreya |
| Pilot store at least one week | L06 | Open (Q9) |
| Decision log and specification updated | `docs/P1-mini-spec.md` DL-64..108 | Done |

## NFRs

| NFR | Target | Measured (Pi Zero 2 W) | Status |
| --- | --- | --- | --- |
| NFR-02 no lost or duplicated sales | 0 | 0 in all load and power tests (2,000+ sales) | **pass** |
| NFR-05 payment to receipt | < 1 s | Hub time per sale: median **0.45 s**; 95th percentile **1.1-1.7 s** when several tills pay at once or offline uploads arrive together. Laptop: median 0.1-0.2 s | **not met at the 95th percentile on the Pi Zero** (DL-107) |
| NFR-07 devices on the pilot hub | 5 | 5 tills selling together, 0 server errors | **pass** |
| NFR-08 hub memory | < 150 MB | Store pace (5 tills, a sale every ~15 s each): levels off at ~99 MB, peak 138 MB. Stress (a sale every ~1.5 s each): up to 148 MB while selling | **pass** at store pace; stress is at the edge |
| NFR-09 power pull mid-sale | survives | 3/3 software resets; 10 real pulls with Sreya | partly done |

## Found and fixed by the gate

1. **Hub memory on big lists (DL-108).** The cost-hiding hook loaded the access library and looked up the person's permissions for every record; a list of 500 records took the hub from ~50 MB to 230-416 MB (hard limit 220 MB). Fixed: a small hook with the answer cached 10 s per person; at most 200 rows a page of cost tables for app users; Stock and Counts read page by page (they also stopped at 1,000 products).
2. **Return costs visible to cashiers** through the generic API (returns and return lines were missing from the hook). Fixed, with tests.
3. A sale read each product's lots and each tax class several times; now once (no measurable speed change: the time is in the writes).

## Reports

- `loadtest-2026-10-07-p1-stress-before-fix.json`, `loadtest-2026-10-07-p1-stress.json`, `loadtest-2026-10-07-p1-store-pace.json`
- `powertest-2026-10-07-p1-sysrq.json` (records), `powertest-2026-10-08-p1-sales-sysrq.json` (sales)

## How to run (Claude)

```
ssh chedam 'bash -s start' < tools/loadtest/pi-loadtest.sh        # throwaway hub with the sample store
ssh -N -L 18099:127.0.0.1:8099 chedam &                            # tunnel
node tools/loadtest/sales-load.mjs http://127.0.0.1:18099 <token> 5 10 report.json 15
ssh chedam 'bash -s report' < tools/loadtest/pi-loadtest.sh; ssh chedam 'bash -s stop' < tools/loadtest/pi-loadtest.sh

ssh chedam 'bash -s install' < tools/powertest/pi-powertest.sh      # power-test hub (survives reboots)
node tools/powertest/sale-writer.mjs <token> 10 report.json         # someone pulls the plug 10 times (or --auto)
ssh chedam 'bash -s remove' < tools/powertest/pi-powertest.sh

ssh chedam 'sudo -u chedam-hub python3 - /opt/chedam/pb_data/data.db' < tools/gate/event-coverage.py
```

# P1 Sell: mini-spec

Baseline: Master Specification v1.0, Sections 7-11 and 13. Status: draft, 2026-10-06.

## Goal

A store can sell on the Pi hub: products with packs and singles, BC tax, the till from open to close, cash and standalone-card payments, receipts, returns and exchanges, stock by phone, labels and a product import. Tills keep selling when the hub is unreachable.

**Done when** (Section 13 phase gate): all Must requirements below pass their tests; offline selling works; permissions are enforced on the hub; every write is in the event log; lists export to CSV/Excel; tested on the Pi with 3 devices and a power pull mid-sale; backup and restore verified; piloted for a week (with P0, DL-63). **The P1 release is blocked until the accountant confirms the tax rules (open question Q1).**

## Build order

Each step: schema migration and sample data first, then hub rules with tests, then client screens.

| Step | Delivers | Requirements |
| --- | --- | --- |
| 1. Catalogue and tax tables ✅ built 2026-10-06: hub (74 tests) and screens (products, product form, categories, tax), checked in the browser | `categories`, `products`, `selling_units` (single, pack, case, by weight; nested), `price_history`, `deposits_fees`, `tax_types`, `tax_rates` (effective dates), `tax_classes`; BR-07 Draft/Active validation; barcode and PLU uniqueness; a task lists Drafts; product + units saved together; barcode lookup; product screens | FR-5.01-5.05, 4.01, 4.02, 4.04, 1.12 (tax part), BR-01, 03, 06-08 |
| 2. Stock 🔶 hub side built and tested 2026-10-06 (56 tests); screens and camera next | `stock_levels`, `stock_lots` (expiry, cost), `stock_movements`; add stock by phone (scan, existing or new product, lot/expiry, torch); "packs or singles?"; bulk add grid; pack break and pack make; damage and loss with reasons and approval; full stock count with variance approval; shrink report. **Camera over HTTPS gate test (R5, DL-63) here** | FR-6.01-6.08, BR-05, 14, 15 |
| 3. Till and checkout (online) | `tills`, `sales`, `sale_lines`, `payments`, `holds`, `soft_holds`, `tax_exemptions`; open with float by denomination, drops, pay-outs, close with count and Z-report; sales screen (grid, search, USB scan, PLU); cart (discounts, overrides with manager PIN); weighed items; age check; deposits; tax engine (per type per receipt, rounded once); payments (cash with 5¢ rounding, standalone card, store credit, USD cash, split); hold and recall; voids; training mode; FEFO; one-at-a-time hub processing with idempotent sale ids; soft holds | FR-3.01-3.12, 3.15, 3.17, 4.03-4.06, 1.12, BR-10, 11, 13, 16, 18, 21, 22 |
| 4. Offline selling | Dexie catalogue cache and sale queue on the till, amber offline bar, upload in order on reconnect, duplicates ignored, oversells accepted with an urgent task | FR-3.16, BR-12, Section 8.2, NFR-01, 02 |
| 5. Receipts and peripherals | Network ESC/POS printer found and tested from the hub, drawer kick, receipt layout (GST/HST information by amount, return barcode, savings), reprint | FR-1.11, 3.13, NFR-05, 14 |
| 6. Returns and exchanges | Return policy settings, find a sale, refund at price paid plus original tax, no-receipt returns at the lowest 30-day price with manager approval, per-item disposition, exchange on one screen, card refunds on the standalone terminal | FR-4.07-4.11, 4.13, 4.14, BR-17, 23 |
| 7. Labels | Label batch (scan, category, list; auto-added on price change and new product), templates, layouts, start position, exact-size PDF, reprint, alignment page | FR-5.13-5.16, BR-25 |
| 8. Import and export | Product import in the back-office browser (DuckDB-WASM): detect, profile, map, transform, validate (failing rows become Drafts), gap report, commit in one transaction with a job log; export any list; full business export | FR-11.01-11.07, 11.09, NFR-22 |
| 9. Money and audit reports | Till reconciliation, loss-prevention report, audit log viewer, 6-year retention (deletion blocked) | FR-10.01, 10.09, 10.11, 10.13, BR-34 |
| 10. Gate | 3 devices selling, power pull mid-sale ×10, offline queue test, camera test, memory under load with sales, backup + restore | Section 13 |

Should-haves (FR-1.16 screen-reader labels, FR-5.04 product autofill) are built when their step has time; FR-5.04's bundled data arrives with FR-11.10 in P5.

## Design decisions (step 1)

| ID | Decision |
| --- | --- |
| DL-64 | Stock and cost are kept in the product's **base unit** (`each`, `kg` or `lb`). Each selling unit has a `base_qty` the hub computes from its nesting (a case of 4 packs of 6 = 24). Product `cost_cents` is per base unit; a unit's cost is cost × base_qty, so margin is shown per unit |
| DL-65 | Barcodes stay a list on each selling unit (Section 10). One barcode belongs to one product; units of the same product may share it, which triggers "packs or singles?" (FR-6.03, Q7). PLUs are unique among products. The hub checks both on every save |
| DL-66 | A product saved as Active that fails BR-07 is refused with a list of what is missing; the import and the phone form save it as a Draft with those reasons instead (FR-11.05). `draft_reasons` is computed by the hub. One open task lists the Drafts (BR-08) |
| DL-67 | Price history is written by the hub in the same transaction as the price or cost change (alongside the event log). Making a product Active, or changing a price on an Active product, needs `prices.edit` (manager, owner); staff with `catalogue.edit` create products as Drafts and may update costs. The first price of a new unit is recorded too (0 → price) |
| DL-68 | Tax rates are rows with effective dates: GST 5% (federal) and BC PST 7% are seeded; other provinces and HST arrive as tax-table updates (FR-12.03). Tax classes: Standard (GST+PST), GST only, Zero-rated, Exempt; owners can add custom classes. **All tax data stays marked "pending accountant review" until Q1 is answered** |
| DL-69 | Weighed products need the Weighed Goods module; age limits and deposits/fees need Regulated Items. A product using a switched-off module stays a Draft |
| DL-70 | Table rules run **inside the change's transaction**: `lib/event_log.js` calls a table's `beforeWrite()` (checks) and `afterWrite()` (dependent writes) around each save, so checks cannot race and dependent writes roll back with the change. The "before" state comes from the database, not `record.original()`, which is stale when one record object is saved twice |
| DL-72 | **Cashiers do not see costs or margins** (Sreya, 2026-10-06). Permission `costs.view` (owner, manager, accountant, staff, who enter costs when receiving). Without it the hub hides `cost_cents` and the amounts of cost-history rows in every API answer, including realtime |
| DL-73 | Stock = loose base units + sealed packs per selling unit; on hand = loose + sealed × base quantity. Opening a case gives its inner packs; opening a pack of singles gives loose units. Lots carry expiry and cost per base unit; a lot's cost may have decimals of a cent (a case of 24 at $20.00 = 83.33 ¢ each), product costs stay whole cents (BR-01) |
| DL-74 | Stock changes only through `/api/chedam/stock/...`, one transaction per request; a whole receiving grid commits or nothing does. Each request carries an `op_id` made on the device; a repeat returns the first result (BR-10) |
| DL-75 | Lowering stock always needs a reason from `stock.reasons` (BR-05). A staff write-off worth more than `stock.approval_value_cents` (default $25, at cost) waits for a manager (`stock.approve`) and raises the "stock:approvals" task; managers' own write-offs post at once (BR-18, FR-6.06) |
| DL-76 | Receiving a perishable without an expiry uses today + shelf life; products marked "expiry entered at receiving" must have one. Write-offs and counts take expired lots first; sales (step 3) skip expired lots unless a manager overrides (BR-14). A count records "expected" when each line is counted, so sales during the count are not variance |
| DL-71 | Rule tasks are reused: when the condition returns, the last closed task with that `rule_key` is reopened instead of adding a new one |

## Open questions carried from the spec

- Q1: tax classes, zero-rated items, deposit/eco-fee tax treatment: accountant to confirm (blocks the P1 release, not the build).
- Q2: return policy defaults (30 days, $50 cashier limit, store credit without receipt): built as settings with these defaults; Sreya to accept.
- Q7: pack and single sharing a barcode: supported both ways (DL-65).
- Who may see costs and margins: decided, DL-72.
- Q1 accountant review: in progress (Sreya, 2026-10-06).

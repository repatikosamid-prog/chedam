# P2 Engage: mini-spec

Baseline: Master Specification v1.0 (Sections 7-11, 13). Status: **draft for Sreya's review, 2026-10-09**. Sprint 2.

## Goal

The store brings customers back and staff work together. It needs promotions and scheduled prices, customers with loyalty points, a customer-facing display, an owner dashboard and sales insights, plus messages, pings, announcements, tasks, checklists and the end-of-day report in the app. Everything keeps working offline where selling needs it: promotions and loyalty at the till.

**Done when** (Section 13 phase gate): every Must below passes its tests; promotions and loyalty work offline at the till; permissions are enforced on the hub; every write is in the event log; lists export; it is tested on the Pi with 3 devices and a power pull mid-sale; backup and restore are verified; it is piloted for a week.

**Before P2 code starts:** the spec says each phase is released and piloted before the next one starts. P1's gate still has open items: L01-L06 (3 devices, 10 plug pulls, Android camera, spare-card restore, pilot week), Q1 (accountant review of tax), N1 (real GST/PST/BN numbers) and H1 (printer). See "Decisions needed" below.

## Build order

Each step: schema migration and sample data first, then hub rules with tests, then client screens. The order puts what changes selling first, because the pilot store feels it most.

| Step | Delivers | Requirements |
| --- | --- | --- |
| 1. Promotions and scheduled prices | `promotions` (type, scope, dates/days/hours, limits, stackable, priority), scheduled prices with start/end; types: % off, $ off, fixed price, buy Y get X% / $X off, Y for $X, buy Y get Z free, mix and match, spend threshold, time-based, coupon; best single deal per item (no stacking unless marked; item > category > cart); preview with regular vs promo price, cost and new margin (below-cost warned); promo and promo-end labels queued; the till prices offline with the same code (`pricing_core.js` grows a promotions engine shared with the till) | FR-5.06-5.10, BR-20, 21, 25 |
| 2. Near-expiry markdowns and staff discounts | Automatic % off by days left, per lot, label queued; staff discount rules (who, %, limits per day/month), logged | FR-5.11, 5.20 |
| 3. Customers and loyalty | `customers` (first name, phone and/or card, notes; never contacted), find or join at the till in under 10 s with "customer agreed"; points earn and redeem (before tax, spread across lines, BR-21/24), receipt shows earned / redeemed / balance; loyalty cards printed with label layouts, card linked to a phone, lost card blocked with points moved; offline earn/redeem against the cached balance, double use becomes a task; returns reverse points; access and deletion on request (BC PIPA) | FR-7.01-7.06, 7.08, 4.12, BR-24 |
| 4. Promotion and loyalty reports | Promotion results (units, sales, margin, savings vs the prior period); members, active, points liability in $, top customers | FR-5.12, 7.07 |
| 5. Customer-facing display | A second screen (old tablet or phone, paired as "customer display") shows items, savings and the total live from its till | FR-3.14 |
| 6. Dashboard and sales insights | Role-based dashboard: attention list first, then KPI tiles and charts (sales, margin by category, P&L month to date as far as P2 data allows, inventory health, wastage); sales by hour/day heatmap, best/worst sellers, sell-through, year over year, margin by category | FR-2.01, 10.10 |
| 7. Tasks, checklists, reminders | Manual tasks (owner, due date, link to a record); opening/closing checklists and shift handover notes; licence, permit and insurance expiry reminders; wrong-storage alert (product temperature range vs its storage area) | FR-2.03, 2.11, 2.12, 6.16 |
| 8. Messages and announcements | 1:1, groups and an Everyone channel; attachments, mentions, reactions, read receipts, links to records; follows the person across devices; pinned announcements that need acknowledging, the owner sees who did | FR-2.04, 2.05 |
| 9. Pings and the till overlay | Device to device, to groups (all tills, all phones), to everyone; templates; normal banner or urgent full screen; reply in place; urgent repeats until acknowledged, escalates to managers after 5 min; shown over the Sell screen without losing the sale; never emailed | FR-2.06, 2.07, BR-42 |
| 10. Inbox, end-of-day report, email fallback | In-app inbox for reports and alerts with per-type deadlines and subscriptions; end-of-day report to the owner and chosen managers; email only if unread at the deadline and the hub is online, at most one per item, through the owner's connected Gmail/Outlook | FR-2.08-2.10, 12.07, BR-40, 41 |
| 11. Help | Built-in help pages and short training videos stored on the hub | FR-12.11 |
| 12. Gate | 3 devices, power pull mid-sale ×10 with promotions and loyalty, offline promotions/loyalty parity with the hub, realtime load on the Pi (messages and pings for 10 devices), backup + restore, pilot week | Section 13 |

## First design choices (to confirm as each step starts)

| ID | Decision (proposed) |
| --- | --- |
| P2-a | **One pricing engine:** promotions, loyalty redemption and discounts are added to `pricing_core.js`, which the hub and the offline till already share (DL-86). Order on a line: scheduled price → best promotion (BR-20) → line discount → cart discount and loyalty redemption spread across lines (BR-21) → tax (BR-22) |
| P2-b | **Promotions are data the till caches** in its offline pack (like prices today), with their dates, days and hours checked against the hub's clock (BR-30). An offline sale stores which promotion it used, so the upload never re-prices it |
| P2-c | **Loyalty balances offline:** the till caches the balance of customers it looked up recently, and a redemption made offline is checked when it uploads. A double use is accepted (the customer has gone) and a task is raised (FR-7.06) |
| P2-d | **Customers are identified, never contacted** (FR-7.01, DL-16): phone or card only to find them; no email or SMS from Chedam; access and deletion on request with a log (BC PIPA) |
| P2-e | **Messages and pings use PocketBase realtime (SSE)**, with the device headers on the subscribe request (conventions). The Pi Zero's memory is measured with 10 devices subscribed before release (gate step 12) |
| P2-f | **Email fallback** needs the owner's Google or Microsoft connection. It waits for the client IDs, like the cloud backup (P0 decision). Until then, everything stays in the app (in-app first is the rule anyway, Section 8.4) |
| P2-g | **Charts with Apache ECharts** (Section 12), loaded only on the dashboard and reports |

## Open questions

- **Q6** (spec): pilot loyalty settings. The defaults are 1 point per $1 after discounts and before tax, 100 points = $1, 500 points minimum to redeem (BR-24). Earn points on promoted items? Do points expire?
- **P2-Q1:** which promotion types does the pilot store actually run? All are Musts, but the order inside step 1 can follow what the store uses first.
- **P2-Q2:** customer display hardware: a spare tablet or phone on a stand?
- **P2-Q3:** who gets the end-of-day report, and by when (Q5 in the spec: 8 am the next morning by default)?
- **P2-Q4:** Google or Microsoft for the owner's email and cloud connection (client IDs, the same need as FR-12.08).

## Decisions needed before building

1. **Order:** finish P1's gate first (Sreya: L01-L06 with real devices, and the pilot week; Q1 accountant; N1 real tax numbers), or build P2 alongside while the P1 pilot runs? The spec allows reordering P2-P5, but says P1 must be released first.
2. Accept the build order above, or move something earlier (e.g. loyalty before promotions)?
3. Q6: the loyalty defaults.

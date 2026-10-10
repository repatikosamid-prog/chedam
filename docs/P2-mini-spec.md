# P2 Engage: mini-spec

Baseline: Master Specification v1.0 (Sections 7-11, 13). Status: **agreed 2026-10-09**, build started. Sprint 2.

## Goal

The store brings customers back and staff work together. It needs promotions and scheduled prices, customers with loyalty points, a customer-facing display, an owner dashboard and sales insights, plus messages, pings, announcements, tasks, checklists and the end-of-day report in the app. Everything keeps working offline where selling needs it: promotions and loyalty at the till.

**Done when** (Section 13 phase gate): every Must below passes its tests; promotions and loyalty work offline at the till; permissions are enforced on the hub; every write is in the event log; lists export; it is tested on the Pi with 3 devices and a power pull mid-sale; backup and restore are verified; it is piloted for a week.

**Order (DL-116):** P1 development is done. The pilot week is skipped (the Pi has run since the start; production will be a Pi 4). The tax review (Q1), real tax numbers (N1) and printer tests (H1) are done at the end.

## Build order

Each step: schema migration and sample data first, then hub rules with tests, then client screens. The order puts what changes selling first, because the pilot store feels it most.

| Step | Delivers | Requirements |
| --- | --- | --- |
| 1. Promotions and scheduled prices ✅ built 2026-10-09 (54 tests: engine, hub, offline parity; Promotions screen, Sell and labels checked in the browser) | `promotions` (type, scope, dates/days/hours, limits, stackable, priority), scheduled prices with start/end; types: % off, $ off, fixed price, buy Y get X% / $X off, Y for $X, buy Y get Z free, mix and match, spend threshold, time-based, coupon; best single deal per item (no stacking unless marked; item > category > cart); preview with regular vs promo price, cost and new margin (below-cost warned); promo and promo-end labels queued; the till prices offline with the same code (`pricing_core.js` grows a promotions engine shared with the till) | FR-5.06-5.10, BR-20, 21, 25 |
| 2. Near-expiry markdowns and staff discounts ✅ built 2026-10-09 (25 tests; settings, Sell and stickers checked in the browser) | Automatic % off by days left, per lot, label queued; staff discount rules (who, %, limits per day/month), logged | FR-5.11, 5.20 |
| 3. Customers and loyalty ✅ built 2026-10-09 (39 tests; join, sale with points, receipt, Customers screen checked in the browser) | `customers` (first name, phone and/or card, notes; never contacted), find or join at the till in under 10 s with "customer agreed"; points earn and redeem (before tax, spread across lines, BR-21/24), receipt shows earned / redeemed / balance; loyalty cards printed with label layouts, card linked to a phone, lost card blocked with points moved; offline earn/redeem against the cached balance, double use becomes a task; returns reverse points; access and deletion on request (BC PIPA) | FR-7.01-7.06, 7.08, 4.12, BR-24 |
| 4. Promotion and loyalty reports | Promotion results (units, sales, margin, savings vs the prior period); members, active, points liability in $, top customers | FR-5.12, 7.07 |
| 5. Customer-facing display | A separate screen facing the customer shows the items, savings and total live from its till. Any device with a browser works: a spare tablet or phone on a stand, or a small monitor with a cheap stick PC or Chromecast-type device. It is paired like any device, marked "customer display", and linked to one till. It needs no sign-in and has no buttons; when idle it shows the store's logo. (A second monitor on a laptop till also works: the display page opens in its own window on that monitor.) | FR-3.14 |
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

## Design decisions (step 1)

| ID | Decision |
| --- | --- |
| DL-117 | **One promotions engine** (`hub/pb_hooks/lib/promotions_core.js`), pure, used by the hub's quote and sale and by the offline till (`virtual:promotions-core`). Types: % off, $ off, sale price, buy X get Y (free / % off / $ off), X for $Y (one product), mix and match (several products), spend threshold; days and hours make any of them time-based; a coupon code makes any of them a coupon. Priced in this order: scheduled price → best deal → the cashier's own discount on what is left → sale discount → tax |
| DL-118 | **Best deal, no stacking (BR-20):** the deal that saves the most is applied first, then the next best on the items that are left, until none saves anything; ties go to item > category > cart. Bundle items are used up by their deal (the bought items of "buy 2 get 1", every item of "3 for $5"). Groups take the most expensive items first and the reward goes to the cheapest of each group. A stackable deal applies on top, to what is left of the price. Spend thresholds come last: the spend counts every item in scope after its deals; the discount goes to items without another deal (all items in scope when it stacks) |
| DL-119 | **Exact cents:** each deal's saving is rounded once and split over its lines by largest remainder, so "3 for $5.00" costs exactly $5.00 even across three lines. A price changed by hand gets no deal. The cashier's discount limit counts against the price after the deal |
| DL-120 | **Uses** count each time a deal applies (each item for per-item deals, each group for bundles); "most times in one sale" and "most times in total" use the same count. Offline sales count too and may go past the total (the customer has paid). Per customer limits wait for customers (step 3) |
| DL-121 | **Scheduled prices** (FR-5.06): a selling unit's price from a date (to a date); the one that started last wins. The regular price stays on the sale line, so the receipt shows "was". With the Promotions module off, neither deals nor scheduled prices apply |
| DL-122 | **Labels (BR-25):** when a deal or scheduled price is saved and already in force, its products go on the label batch at once; later starts and ends are queued by a minute job (`chedam_promotion_labels`). Ending a deal queues the labels back at the regular price. A label of a product on a simple deal prints the deal price big, with "SALE", the deal, the regular price and the end date (template field "Promotion") |
| DL-123 | **Managing:** `promotions.manage` (managers; the owner has all). Promotions and scheduled prices change only through `/api/chedam/promotions` and `/api/chedam/scheduled-prices`; anyone signed in can read them (the till shows deals). An ended promotion cannot be changed (copy it). Coupon codes are unique. Both tables are kept for the retention period (sales refer to them) and are in the data export ("Products and prices") |

## Design decisions (step 2)

| ID | Decision |
| --- | --- |
| DL-124 | **Near-expiry markdowns (FR-5.11)** are off until a manager switches them on (setting `promotions.markdowns`: steps "N days left or fewer → % off", perishable products only by default). A lot's % comes from its days left (store dates). The items of a sale take the marked-down lots in selling order (FEFO, the hub's own order), so the first items get the markdown of the oldest lot; a weighed line gets the share of its weight from marked lots. The markdown is one more deal in the engine: an item gets it or another deal, whichever saves more (BR-20). Training sales get no markdowns. The till's offline pack carries the marked-down lots, so offline prices match |
| DL-125 | **Best deal per item:** per-item deals (% off, $ off, sale price, markdown) are now chosen item by item; bundles (buy-get, X for $Y, mix and match) go first only when they gain more than the best per-item deals on the same items. (Found in step 2: choosing the deal that saved most overall gave a 30%-off-everything deal $2.40 where a markdown on one item plus 30% on the other gave $3.20.) |
| DL-126 | **Near-expiry stickers:** a minute job puts a sticker on the label batch for each item of a lot that reaches a (higher) markdown step, at that %, apart from the shelf label (`label_batch_items.markdown_pct`); the lot remembers its step (`stock_lots.markdown_pct`). The Promotions screen lists the stock marked down now |
| DL-127 | **Staff discounts (FR-5.20)** are off until switched on (setting `sales.staff_discount`: %, most per person per month, also on items with a deal or not, categories left out). On the till, "Staff sale": the staff member buying picks their name and enters their own PIN; the hub gives a one-time staff approval (5 minutes) that unlocks only the staff discount and never approves anything a manager must approve. The % applies to what is left of each eligible line after deals and the cashier's discount, up to the monthly amount left (completed, non-training sales this month). The sale records who and how much (`staff_user`, `staff_name`, `staff_discount_cents`; per line `staff_cents`); the receipt shows "Staff discount" under the items and "Staff purchase: name". Offline: refused (the PIN is checked on the hub) |

## Design decisions (step 3)

| ID | Decision |
| --- | --- |
| DL-128 | **Customers** (`customers`): a first name, a phone number (digits; a leading 1 of 11 digits dropped) and/or a loyalty card, "customer agreed" with its time, notes; never contacted. Joining at the till needs `customers.view` (cashiers, staff, managers) and the tick; one active member per phone. A cashier finds by phone or card only; managers (`customers.manage`) also by first name, and see the full phone number. Points live on the customer; every change is a `loyalty_ledger` row with the balance after (earn, redeem, reverse_earn, return_redeem, adjust, move_in/out) |
| DL-129 | **The programme (FR-7.03, Q6)** is the owner's (`loyalty.manage`, owner only) and **off until the owner switches it on** with their own values: points per $1 spent, points for $1 off, fewest points to use at once, points on items with a deal or not, categories without points, expiry (stored, not yet applied). While off, customers can join and be on sales, but earn nothing |
| DL-130 | **Arithmetic (BR-24, FR-7.04)** in `pricing_core.js` (shared with the offline till): points earned = (what the items cost after every discount and the points used, before tax) × points per $1, rounded down; points used come off before tax and are spread over the lines like a sale discount (BR-21); the points used are exactly those needed for the whole cents given, never more than asked, the balance or the sale. The receipt shows the member, points earned, used and the balance |
| DL-131 | **Returns (FR-4.12):** returned items take back their share of the points earned and give back their share of the points used, by net value returned / net value sold; several returns of one sale never exceed what the sale earned or used |
| DL-132 | **Cards (FR-7.05):** 13-digit numbers made by Chedam (29, a 10-digit serial, a check digit; scan as EAN-13), printed on a label sheet with the store name and a barcode. Scanning a new card at the till starts joining; a customer has one card in use (linking a new one blocks the old); a lost card is blocked and the points stay with the customer. Two records of one person: the points move into the one kept and the other is deleted |
| DL-133 | **Offline (FR-7.06):** the till's pack has the programme and the members' first names, card numbers and balances, with phone numbers only as salted SHA-256 hashes (the till finds a member by phone without holding phone numbers). The till earns and redeems with the same arithmetic. An offline sale's points are kept as the till counted; when the balance no longer covers the points used (spent elsewhere meanwhile), the sale stands and a task is raised. Joining needs the hub |
| DL-134 | **Privacy (BC PIPA, FR-7.08):** a manager can download everything Chedam holds about a customer (details, cards, purchases, points) and delete it on request: name, phone and notes removed, cards blocked, points gone; sales stay (6 years) without the name. The audit log records customers' name, phone and notes as "[personal]" (who changed which field and when is kept), so nothing personal survives a deletion. The phone hash is left out of data exports |

## Open questions

- **Q6 answered (Sreya, 2026-10-09):** the **business owner decides** the loyalty settings (points per $1, points per $1 off, minimum to redeem, points on promoted items, expiry). Loyalty stays off until the owner has set them in loyalty set-up; the spec's values (1 point per $1, 100 points = $1, minimum 500) are shown only as suggestions.
- **P2-Q1:** which promotion types does the pilot store actually run? All are Musts, but the order inside step 1 can follow what the store uses first.
- **P2-Q2:** customer display hardware: a spare tablet or phone on a stand?
- **P2-Q3:** who gets the end-of-day report, and by when (Q5 in the spec: 8 am the next morning by default)?
- **P2-Q4:** Google or Microsoft for the owner's email and cloud connection (client IDs, the same need as FR-12.08).

## Decided

1. Order: P2 now; P1's tax review, tax numbers and printer tests at the end (DL-116).
2. Build order as above.
3. Loyalty settings: the owner decides (Q6).

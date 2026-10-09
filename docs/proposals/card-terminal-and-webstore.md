# Proposal: linked card terminal and a web store (2026-10-09)

Sreya asked (testing feedback, 2026-10-09):
1. How can a Square or Clover type terminal be linked, so that pressing **Card** on the till wakes the card terminal by itself?
2. Can the owner run a website / online store that is updated from the store's stock automatically, on the Raspberry Pi 4? The domain is already in place.

Nothing here is built yet. The decisions at the end are needed first.

## 1. Linked card terminal

**Today (DL-14, Stage 1):** the terminal is standalone. The cashier presses Card, keys the amount into the terminal, and records the result (approved or declined, last 4 digits) on the till.

**Already planned in the Master Specification:** FR-3.21 "Linked card terminal (Square Terminal API first) when the hub is online; automatic fallback to standalone mode", phase P5. FR-3.22 adds a common interface for other processors (Helcim, Stripe Terminal, Moneris) later. Risk R1 ("owners won't switch without integrated card payments", high/high) is the reason it is in the plan at all. Open question **Q3**: Square first, or compare Helcim and Stripe on cost?

**How it would work (Square Terminal API):**

| Step | What happens |
| --- | --- |
| Set-up, once | The owner connects the store's Square account in Chedam (Square's own sign-in page; Chedam keeps the access token on the hub, encrypted, never on the tills). Each Square Terminal is paired to a Chedam till with a code shown on the terminal. |
| Pay by card | The cashier presses **Card**. The hub asks Square to send the amount to that till's terminal ("terminal checkout", referenced by the sale id). The terminal lights up and asks for the card. Nothing is keyed in. |
| Result | The hub checks the checkout's status every second or two (outbound only, so no port forwarding is needed). Approved: the payment is recorded with card brand, last 4 and Square's payment id, and the sale completes. Declined or cancelled on the terminal: shown on the till; try again or pay another way. |
| Refunds | A card refund on a return goes back through Square to the same card (Refunds API), with the original payment id. |
| No internet | The hub falls back to today's standalone mode: the cashier keys in the amount. Card payments are never blocked. |
| Reconciliation | Square's payout and settlement figures are fetched for each closed till, so Reports → Tills fills in the terminal total by itself (the batch number stays Chedam's, DL-111). |

**Clover** has a similar "semi-integrated" connection, but it needs a Clover developer account and approval through the merchant's Clover provider (in Canada usually a bank or Fiserv reseller). It fits FR-3.22 (other processors) once Square works.

**Needed from the store:** a Square account (Canada), a **Square Terminal** device (the stand-alone Square Reader for phones does not take Terminal API checkouts), a Square developer application (item D1 in the spec), and internet at the till for linked mode.

**Effort:** about one build step of its own (connect, pair, checkout, status, refund, fallback, tests with Square's sandbox). It can stay in P5 or be moved forward right after the P1 release if it matters for the pilot store.

## 2. Web store fed by the store's stock

**In the Master Specification:** "e-commerce storefront" is listed as **Later** (out of scope for now). This section is a proposal for adding it.

**Can the Pi 4 do it?** For a small shop, yes: a Pi 4 can serve a catalogue site to many visitors. Load is not the main concern. Running it **on the store's hub and opening the hub to the internet** is a concern, for four reasons:

- **Security:** the hub holds every sale, staff PINs, costs and the audit log, and it runs the tills. Anything that faces the internet is probed by bots all day. A problem there could stop the till.
- **Network:** the store's internet often allows no inbound connections. The current TELUS modem has no admin page, so port forwarding is not even possible.
- **Availability:** the shop goes offline whenever the store's power or internet is off, or the hub restarts for an update.
- **Payments:** online card payments must happen on the processor's own pages (PCI rules), not on the Pi.

**Recommended design: the hub stays private and pushes; the storefront lives outside.**

| Option | How | For | Against |
| --- | --- | --- | --- |
| **A (recommended)** Chedam storefront on a static host | The hub builds the shop pages itself (categories, products, photos, prices, "in stock / few left / sold out") and publishes them to a static host on the owner's domain, e.g. Cloudflare Pages or Netlify (free or nearly). It republishes when prices or stock change, at most every few minutes. Checkout opens the processor's hosted payment page (Square or Stripe). The hub fetches paid orders from the processor (outbound only) and turns them into **pick-up orders**, with stock reserved and a task for staff. | The Pi is never reachable from the internet. The site stays up when the store is closed or offline. No card data touches Chedam. Low cost, and the look is the store's own. | Stock on the site can be a few minutes behind, so the last item can occasionally sell twice (online and in store). The order then shows as a problem to call the customer about. |
| B Storefront on the Pi through a tunnel | The site runs on the hub; a Cloudflare Tunnel (outbound) makes it reachable without port forwarding. | Stock is always live. | Internet traffic reaches the store's hub; the site is down whenever the store is. It needs careful isolation (separate process and user, read-only copy of the data). |
| C Sync to Shopify or Square Online | Chedam sends products, prices and stock to a hosted shop through its API; online orders come back as pick-up orders. | Quickest to launch; delivery, taxes and payments are theirs. | Monthly fees and their transaction fees; their look; one more account to manage. |

Option A fits Chedam's rules best: offline first, the store owns its data, and no inbound access. Option C is the fallback if the owner wants a full online shop quickly. If Square is the card processor (Q3), the same Square account serves the terminal (section 1) and the online checkout.

**What the web store would need from Chedam:**

- A "Show online" switch per product, and product photos (not in P1).
- Online prices: the same as in store by default.
- Order handling: pick-up first (paid online, collected in store, ID check for age-restricted items, which should probably not be sold online at all: vape, tobacco, alcohol). Delivery later.
- Store pages: contact, opening hours, returns and privacy policy (required for online selling).
- DNS for the domain: a record pointing the shop's address (e.g. `shop.yourdomain.ca`) at the static host.

**Rough build order (A):** product photos and "show online" → site generator with publishing to the host → processor checkout links → order import as pick-up orders with stock holds → order screen for staff → policies pages → tests, including stock racing between the till and the web.

## Decisions (Sreya, 2026-10-09, DL-114)

1. **Processor:** link the system **the store already has** (Square, Clover or another); a new store without one starts with Square. So the common payment interface (FR-3.22) is built with the first link, and Square is the first adapter; Clover and others follow as stores need them.
2. **When:** the linked terminal stays in **P5**, as planned.
3. **Web store:** **added to the plan**, **option A** (Chedam storefront on a static host; the hub stays private). Pick-up first.
4. **Domain and DNS:** the **store owner** manages them. Chedam's web store set-up will show the exact DNS record to add.

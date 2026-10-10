<script>
  // Sales screen (FR-3.02-3.12): category grid, search, barcode (USB scanner, camera) and PLU entry;
  // cart with quantities, weights, discounts, price overrides, ID checks, removed lines kept (FR-3.11);
  // the hub's quote after every change (DL-79); manager PIN when needed (DL-81); payments with cash
  // rounding, card on the standalone terminal, US cash, split (DL-82); hold/recall; training mode;
  // tax exemption; receipt. The cart is kept on this device so a reload does not lose the sale.
  // Each line has its own remove button and discount; the whole sale can have a discount too, and the
  // screen and receipt say which discount was for what. After a sale the receipt stays 15 s for
  // printing, then the till is back to selling (a tap on the receipt area keeps it).
  // Offline (FR-3.16, DL-86..89): products and prices come from the offline pack; when the hub does not
  // answer, the till prices the sale itself, prints an offline receipt and queues the sale for upload.
  import { onMount } from "svelte";
  import { api, isHubDown } from "../lib/api.js";
  import { off, getPack, refreshPack, enqueue, nextOfflineRef, syncQueue, tillInfo, saveTillInfo, tillWaiting } from "../lib/offline.svelte.js";
  import { quoteOffline, lookupOffline } from "../lib/offline_price.js";
  import { s, go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money, toCents, newId } from "../lib/catalogue.js";
  import { newCart, toInput, settle, cashSuggestions, cashRound, METHOD } from "../lib/till.js";
  import Scanner from "../components/Scanner.svelte";
  import Approve from "../components/Approve.svelte";
  import StaffPin from "../components/StaffPin.svelte";
  import CustomerPanel from "../components/CustomerPanel.svelte";
  import Receipt from "../components/Receipt.svelte";
  import PrintButtons from "../components/PrintButtons.svelte";
  import RefundChooser from "../components/RefundChooser.svelte";
  import ReturnSlip from "../components/ReturnSlip.svelte";
  import { ex, endExchange } from "../lib/exchange.svelte.js";

  const KEY = "chedam.cart";
  let info = $state(null);                       // /tills/current: till, settings, business
  let products = $state([]), units = $state({}), cats = $state([]);
  let cat = $state(""), search = $state(""), code = $state("");
  let cart = $state(newCart());
  let quote = $state(null), quoting = $state(false), error = $state(""), note = $state("");
  let mode = $state("sell");                     // sell | pay | done
  let payments = $state([]), saleId = "", sale = $state(null), busy = $state(false);
  let dialog = $state(null);                     // {kind: weight|choose|age|edit|approve|discount|exempt|holds|card|usd|other|void, ...}
  let scanning = $state(false);
  let headH = $state(0);                         // the fixed header row: the cart stays just under it
  let codeInput;
  let qTimer;
  let ix = $state.raw(null);                               // offline pack (indexed)
  const perms = () => ({ discount: can("sales.discount"), approve: can("sales.approve"), exempt: can("sales.tax_exempt") });

  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* private mode */ } };
  const live = $derived(cart.lines.filter((l) => !l.voided));
  const qline = (key) => (quote ? quote.lines.find((l) => l.key === key) : null);
  const problems = $derived(quote ? quote.problems : []);
  const settings = $derived(info ? info.settings : ix ? ix.settings : {});
  const st = $derived(quote ? settle(quote.total_cents, payments, settings) : null);

  onMount(() => {
    try { const c = JSON.parse(localStorage.getItem(KEY) || "null"); if (c && Array.isArray(c.lines)) cart = c; } catch { /* none */ }
    (async () => {
      await Promise.all([loadTill(), loadCatalogue()]);
      if (cart.lines.length) requote();
      focusCode();
    })();
    const t = setInterval(() => { if (!isHubDown()) refreshPack().then((p) => p && usePack(p)); }, 120000);
    return () => clearInterval(t);
  });

  // The till's own open till is remembered, so offline sales still belong to it. A till opened offline
  // (DL-90) is uploaded first when the hub answers; until it has arrived, this device's copy counts.
  async function loadTill(again = true) {
    const r = await api("GET", "/api/chedam/tills/current");
    if (r.status === 0) { info = tillInfo(); return; }
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    const mine = tillInfo();
    if (!r.json.till && mine && mine.till && mine.till.offline && (await tillWaiting(mine.till.id))) {
      if (again) { await syncQueue(); return loadTill(false); }
      info = { ...r.json, till: mine.till };
      return;
    }
    info = r.json;
    saveTillInfo({ till: r.json.till ? { id: r.json.till.id, number: r.json.till.number } : null, settings: r.json.settings, business: r.json.business });
  }

  let promoOn = $state(false);                   // Promotions module on: the Coupon button
  let custOn = $state(false);                    // Customers and Loyalty module on: the Customer button
  function usePack(p) {
    ix = p;
    promoOn = !!(p.modules && p.modules.promotions);
    custOn = !!(p.modules && p.modules.customers);
    products = [...p.products].sort((a, b) => a.name.localeCompare(b.name));
    units = p.unitsOf;
    cats = [...p.categories].sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));
    if (!cat && cats[0]) cat = cats[0].id;
  }

  // Products and prices from the offline pack: the copy on this device first, then the hub's.
  async function loadCatalogue() {
    const local = await getPack();
    if (local) usePack(local);
    const fresh = await refreshPack();
    if (fresh) usePack(fresh);
    if (!ix) error = "This till has no product list yet. Connect to the hub once to download it.";
  }

  function offlineQuote() {
    if (!ix) { error = "No product list on this till yet: connect to the hub once."; return null; }
    return quoteOffline($state.snapshot(cart), ix, perms());
  }

  function focusCode() { setTimeout(() => codeInput && codeInput.focus(), 50); }
  // Prompts that appear (weight, cash amount) take the keyboard, so a typed weight never lands in the scan box.
  function focusNow(node) { setTimeout(() => { node.focus(); if (node.select) node.select(); }, 30); }

  // ---- Cart --------------------------------------------------------------------------------------

  function changed() { keep(); clearTimeout(qTimer); qTimer = setTimeout(requote, 250); }

  async function requote() {
    if (!cart.lines.length) { quote = null; softHolds([]); return; }
    if (isHubDown()) { quote = offlineQuote(); return; }
    quoting = true;
    const r = await api("POST", "/api/chedam/sales/quote", toInput(cart));
    quoting = false;
    if (r.status === 0) { quote = offlineQuote(); return; }
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    error = "";
    quote = r.json;
    softHolds(quote.lines.filter((l) => !l.voided).map((l) => ({ product: l.product, qty_base: l.base_qty })));
  }

  function softHolds(items) {
    if (cart.training || isHubDown()) return;
    api("POST", "/api/chedam/sales/soft-holds", { cart_id: cart.id, items });
  }

  function add(p, u, extra = {}) {
    note = "";
    if (u.kind === "weight" && extra.weight === undefined) { dialog = { kind: "weight", p, u, value: "" }; return; }
    if (p.age_restricted && !extra.age_checked) { dialog = { kind: "age", p, u, extra }; return; }
    const same = cart.lines.find((l) => !l.voided && l.product === p.id && l.selling_unit === u.id && u.kind !== "weight" && !l.discount && l.price_cents === undefined);
    if (same) same.qty += 1;
    else cart.lines.push({ key: newId(), product: p.id, selling_unit: u.id, name: p.name + (u.kind === "single" || u.kind === "weight" ? "" : " (" + u.name + ")"),
      kind: u.kind, base_unit: p.base_unit, qty: u.kind === "weight" ? extra.weight : 1, weight: extra.weight, age_checked: !!extra.age_checked });
    changed();
    focusCode();
  }

  function tapProduct(p) {
    const list = units[p.id] || [];
    if (list.length === 1) add(p, list[0]);
    else if (list.length > 1) dialog = { kind: "choose", options: list.map((u) => ({ p, u })) };
  }

  async function onCode(c) {
    c = String(c || "").trim();
    code = "";
    if (!c) return;
    // The till's own list first (fast, and works offline); the hub only to explain a miss.
    let r = ix ? { ok: true, json: lookupOffline(ix, c) } : null;
    if ((!r || !r.json.matches.length) && !isHubDown()) {
      const h = await api("GET", "/api/chedam/catalogue/lookup?code=" + encodeURIComponent(c));
      if (h.ok || h.status !== 0) r = h;
      if (!h.ok && h.status !== 0) { if (!(await handleRefusal(h))) error = h.message; return; }
    }
    if (!r) { error = "No product list on this till yet: connect to the hub once."; return; }
    const m = r.json.matches.filter((x) => x.sellable);
    if (!m.length) { error = r.json.matches.length ? "'" + r.json.matches[0].product.name + "' is not for sale yet." : "No product with code " + c + (isHubDown() ? " on this till's list." : "."); focusCode(); return; }
    error = "";
    const asP = (x) => ({ id: x.product.id, name: x.product.name, base_unit: x.product.base_unit, age_restricted: x.product.age_restricted, min_age: x.product.min_age });
    if (m.length > 1) { dialog = { kind: "choose", options: m.map((x) => ({ p: asP(x), u: x.unit })) }; return; }   // packs or singles?
    add(asP(m[0]), m[0].unit);
  }

  function setQty(l, q) {
    if (l.kind === "weight") { const w = Number(q); if (w > 0) { l.weight = w; l.qty = w; } }
    else { const n = Math.max(1, Math.round(Number(q) || 1)); l.qty = n; }
    changed();
  }

  function removeLine(l) { l.voided = true; dialog = null; changed(); }   // kept as a removed line (FR-3.11)

  function openPack(key) {
    const p = cart.lines.find((l) => l.key === key);
    cart.lines.filter((l) => p && l.product === p.product).forEach((l) => (l.break_pack = true));
    changed();
  }

  function clearCart(ask = true) {
    if (ask && live.length && !confirm("Clear this sale?")) return;
    softHolds([]);
    cart = newCart(cart.training);
    quote = null; payments = []; mode = "sell"; keep(); focusCode();
  }

  function toggleTraining() {
    if (live.length) { error = "Finish or clear the sale before switching training mode."; return; }
    cart.training = !cart.training; keep();
  }

  // ---- Pay ---------------------------------------------------------------------------------------

  function startPay() {
    error = "";
    if (!quote || !live.length) return;
    if (problems.length) { error = problems[0].message; return; }
    if (!cart.training && !(info && info.till)) { error = "Open the till first (Till, then Open till)."; return; }
    if (quote.needs_approval.length && !cart.approval) { dialog = { kind: "approve", what: quote.needs_approval }; return; }
    payments = []; saleId = newId(); mode = "pay";
    // Exchange (FR-4.13): the returned items pay first; the hub records the return and this sale together.
    if (ex.draft) {
      if (cart.training) { error = "Switch training off for an exchange."; mode = "sell"; return; }
      if (isHubDown()) { error = "Exchanges need the hub."; mode = "sell"; return; }
      payments = [{ method: "exchange", amount_cents: Math.min(ex.draft.credit_cents, quote.total_cents) }];
    }
  }

  function approved(a) { cart.approval = a.approval; dialog = null; keep(); note = "Approved by " + a.by + "."; startPay(); }

  function pay(p) {
    payments = [...payments, p];
    dialog = null;
    const r = settle(quote.total_cents, payments, settings);
    if (r.remaining <= 0) finish();
  }

  // Exchange: what the customer still pays is in `payments`; refunds: what goes back when the returned
  // items are worth more than the new ones.
  let exReturn = $state(null);
  async function finishExchange(refunds) {
    busy = true; error = "";
    const d = ex.draft;
    const now = new Date().toISOString();
    const r = await api("POST", "/api/chedam/returns", { id: d.id, ...d.body, refunds: refunds || [], device_time: now, expected_refund_cents: d.credit_cents,
      exchange: { id: saleId, ...toInput(cart), expected_total_cents: quote.total_cents, payments: payments.filter((p) => p.method !== "exchange"), device_time: now } }, { timeout: 20000 });
    busy = false;
    if (!r.ok) {
      if (await handleRefusal(r)) return;
      error = r.status === 0 ? "The hub did not answer. Check Sales and Returns before trying again." : r.message;
      payments = []; mode = "sell";
      return;
    }
    sale = r.json.sale; exReturn = r.json.return;
    endExchange();
    mode = "done";
    cart = newCart(false); quote = null; payments = []; keep();
    loadTill();
  }

  // Store credit (FR-3.08): the code from the slip, checked on the hub.
  async function checkCredit(e) {
    e.preventDefault();
    const r = await api("GET", "/api/chedam/store-credits/" + encodeURIComponent(dialog.code.trim()));
    if (!r.ok) { dialog.error = r.status === 0 ? "Store credit needs the hub." : r.message; return; }
    if (r.json.status !== "active" || !r.json.balance_cents) { dialog.error = "This store credit is used up."; return; }
    pay({ method: "store_credit", amount_cents: Math.min(r.json.balance_cents, st.remaining), reference: r.json.code });
  }

  async function finish() {
    if (ex.draft) return finishExchange([]);
    busy = true; error = "";
    if (quote.offline) { busy = false; return finishOffline(quote); }
    const body = { id: saleId, ...toInput(cart), expected_total_cents: quote.total_cents, payments, device_time: new Date().toISOString() };
    const r = await api("POST", "/api/chedam/sales", body, { timeout: 20000 });
    busy = false;
    if (r.status === 0) {
      // The hub stopped answering during payment: finish offline with the same sale id. If the hub did
      // get the sale after all, the upload is answered with that first result (BR-10).
      const q2 = offlineQuote();
      if (q2 && !q2.problems.length && q2.total_cents === quote.total_cents) return finishOffline(q2);
      if (q2) quote = q2;
      error = "The hub stopped answering and this till prices the sale differently. Check the total and take payment again.";
      payments = []; mode = "sell";
      return;
    }
    if (!r.ok) {
      if (await handleRefusal(r)) return;
      error = r.message;
      if (r.status === 409 && r.json && r.json.data && r.json.data.quote) quote = r.json.data.quote;
      if (r.status !== 0) { payments = []; mode = "sell"; }
      return;
    }
    sale = r.json.sale;
    mode = "done";
    cart = newCart(cart.training); quote = null; payments = []; keep();
    loadTill();
  }

  // Offline sale (DL-87): offline receipt number, receipt printed from this till's figures, sale queued.
  async function finishOffline(q) {
    const st2 = settle(q.total_cents, payments, settings);
    if (st2.remaining > 0) { error = "Not paid in full."; return; }
    const ref = nextOfflineRef();
    const now = new Date();
    const payload = { id: saleId, offline: true, offline_ref: ref, device_time: now.toISOString(), cashier: s.me.user.id,
      till: info && info.till ? info.till.id : "", training: cart.training, tax_mode: q.tax_mode, lines: q.upload_lines,
      cart_discount_cents: q.cart_discount_cents + (q.loyalty ? q.loyalty.redeem_cents : 0), cart_discount_label: q.cart_discount_label, promotions: q.promotions || [], coupons: q.coupons || [], exempt: q.exempt, exempt_cents: q.exempt_cents,
      customer: q.loyalty ? q.loyalty.customer.id : "", loyalty_earned: q.loyalty ? q.loyalty.earn : 0, loyalty_redeemed: q.loyalty ? q.loyalty.redeem_points : 0, loyalty_redeem_cents: q.loyalty ? q.loyalty.redeem_cents : 0,
      totals: { total_cents: q.total_cents, tax_cents: q.tax_cents, subtotal_cents: q.subtotal_cents, discount_cents: q.discount_cents, deposit_cents: q.deposit_cents },
      payments: $state.snapshot(payments) };
    const live2 = q.lines.filter((l) => !l.voided);
    const receipt = { id: saleId, number: ref, offline: true, offline_ref: ref, status: "completed", training: cart.training, tax_mode: q.tax_mode,
      completed_at: now.toISOString(), cashier: s.me.user.name, subtotal_cents: q.subtotal_cents, discount_cents: q.discount_cents, tax_cents: q.tax_cents,
      cart_discount_cents: q.cart_discount_cents, cart_discount_label: q.cart_discount_label,
      customer: q.loyalty ? q.loyalty.customer.id : "", customer_name: q.loyalty ? q.loyalty.customer.first_name : "", loyalty_earned: q.loyalty ? q.loyalty.earn : 0,
      loyalty_redeemed: q.loyalty ? q.loyalty.redeem_points : 0, loyalty_redeem_cents: q.loyalty ? q.loyalty.redeem_cents : 0, loyalty_balance: q.loyalty ? q.loyalty.balance_after : 0,
      deposit_cents: q.deposit_cents, total_cents: q.total_cents, rounding_cents: st2.rounding, paid_cents: q.total_cents + st2.rounding, change_cents: st2.change,
      taxes: q.taxes, exempt: q.exempt, payments: st2.applied, business: (ix && ix.business) || (info && info.business) || {},
      lines: live2.map((l, i) => ({ ...l, line_no: i + 1 })),
      savings_cents: live2.reduce((a, l) => a + Math.max(0, Math.round(l.regular_price_cents * l.qty) - l.gross_cents) + l.line_discount_cents + l.cart_discount_cents, 0) };
    try { await enqueue(payload, receipt); }
    catch { error = "This device could not save the sale (storage is full or blocked). Do not hand over the goods; try again."; return; }
    sale = receipt;
    mode = "done";
    cart = newCart(cart.training); quote = null; payments = []; keep();
    syncQueue();
  }

  function newSale() { stopBack(); sale = null; exReturn = null; mode = "sell"; note = ""; focusCode(); }

  // Back to selling by itself, 15 s after a sale (time to print the receipt). Any tap on the receipt
  // area (reprint, void, the buyer's name) keeps the screen until New sale.
  const BACK_AFTER = 15;
  let back = $state(0), backTimer;
  function stopBack() { clearInterval(backTimer); back = 0; }
  // A tap or a key anywhere on the receipt area (except New sale) keeps the screen.
  function keepOnTouch(node) {
    const stop = (e) => { if (!e.target.closest("[data-newsale]")) stopBack(); };
    node.addEventListener("pointerdown", stop);
    node.addEventListener("keydown", stop);
    return { destroy() { node.removeEventListener("pointerdown", stop); node.removeEventListener("keydown", stop); } };
  }
  const doneId = $derived(mode === "done" && sale ? sale.id : "");   // a void changes the sale, not its id
  $effect(() => {
    if (!doneId) return;
    back = BACK_AFTER;
    backTimer = setInterval(() => { back -= 1; if (back <= 0) newSale(); }, 1000);
    return () => clearInterval(backTimer);
  });

  // ---- Holds -------------------------------------------------------------------------------------

  async function hold() {
    if (!live.length) return;
    const label = prompt("Name for this sale (e.g. customer):", "") ?? null;
    if (label === null) return;
    const r = await api("POST", "/api/chedam/holds", { label, cart: $state.snapshot(cart), total_cents: quote ? quote.total_cents : 0 });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    note = "Sale held. Any till can recall it.";
    clearCart(false);
  }

  async function showHolds() {
    const r = await api("GET", "/api/chedam/holds");
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    dialog = { kind: "holds", list: r.json };
  }

  async function recall(h) {
    if (live.length) { error = "Finish or hold the current sale first."; return; }
    const r = await api("POST", "/api/chedam/holds/" + h.id + "/recall", {});
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    cart = { ...newCart(cart.training), lines: r.json.cart.lines || [], cart_discount: r.json.cart.cart_discount || null, exempt: r.json.cart.exempt || null, coupons: r.json.cart.coupons || [],
      customer: r.json.cart.customer || null, redeem_points: r.json.cart.redeem_points || 0 };
    dialog = null; changed();
  }

  async function voidLast(reason, approval) {
    const r = await api("POST", "/api/chedam/sales/" + sale.id + "/void", { reason, approval });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    sale = r.json; dialog = null; loadTill();
  }

  const visible = $derived(search.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()) && units[p.id])
    : products.filter((p) => p.category === cat && units[p.id]));
  const priceOf = (p) => { const u = (units[p.id] || []).find((x) => x.is_default) || (units[p.id] || [])[0]; return u ? money(u.price_cents) + (u.kind === "weight" ? "/" + p.base_unit : "") : ""; };
</script>

<section class="space-y-3">
  <div class="screen-head flex flex-wrap items-center justify-between gap-2" bind:clientHeight={headH}>
    <div class="flex items-center gap-3">
      <button class="min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
      <h1 class="text-xl font-bold">Sell</h1>
      {#if off.pending || off.problems}<span class="rounded-lg bg-warn/10 px-2 py-0.5 text-sm text-warn">{off.pending} offline {off.pending === 1 ? "sale" : "sales"} waiting{off.problems ? " · " + off.problems + " need a manager" : ""}</span>{/if}
      {#if info}<span class="rounded-lg px-2 py-0.5 text-sm {info.till ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}">{info.till ? (info.till.number ? "Till " + info.till.number + " open" : "Till open (opened offline)") : "Till closed"}</span>{/if}
    </div>
    <div class="flex gap-2 overflow-x-auto max-sm:-mx-1 max-sm:w-full max-sm:px-1 [&>button]:shrink-0">
      {#if can("sales.return")}<button class="btn-ghost min-h-10 text-sm" onclick={() => go("returns")}>Return</button>{/if}
      <button class="btn-ghost min-h-10 text-sm" onclick={showHolds}>Recall</button>
      <button class="btn-ghost min-h-10 text-sm" onclick={() => go("sales")}>Sales</button>
      <button class="btn-ghost min-h-10 text-sm" onclick={() => go("till")}>Till</button>
      <button class="btn-ghost min-h-10 text-sm {cart.training ? 'border-warn text-warn' : ''}" onclick={toggleTraining}>{cart.training ? "Training on" : "Training"}</button>
    </div>
  </div>
  {#if cart.training}<p class="rounded-xl bg-warn/15 px-3 py-2 text-center font-semibold text-warn">TRAINING MODE · practice sales never change stock, money or reports</p>{/if}
  {#if ex.draft && mode !== "done"}
    <p class="rounded-xl bg-accent/10 px-3 py-2">Exchange: returned items ({ex.draft.label}) are worth <b>{money(ex.draft.credit_cents)}</b>. Ring up the new items and press Pay.
      <button class="underline" onclick={() => { if (confirm("Cancel the exchange? Nothing has been returned yet.")) endExchange(); }}>Cancel exchange</button></p>
  {/if}
  {#if info && !info.till && !cart.training}
    <p class="rounded-xl bg-warn/10 px-3 py-2">The till is closed. <button class="underline" onclick={() => go("till")}>Open the till</button> to sell, or switch on training.</p>
  {/if}
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if note}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{note}</p>{/if}

  {#if dialog && dialog.kind === "approve"}
    <Approve what={dialog.what} onApproved={approved} onCancel={() => (dialog = null)} />
  {:else if dialog && dialog.kind === "staff"}
    <StaffPin pct={settings.staff_discount ? settings.staff_discount.pct : 0} onDone={(x) => { cart.staff = x; dialog = null; changed(); }} onCancel={() => (dialog = null)} />
  {:else if dialog && dialog.kind === "void"}
    {#if can("sales.void")}
      <div class="card space-y-2 border-bad"><p>Void {sale.number}? Stock goes back; refund the customer the same way they paid.</p>
        <input class="field" bind:value={dialog.reason} placeholder="Reason" aria-label="Reason for the void" />
        <div class="flex gap-2"><button class="btn" disabled={!dialog.reason} onclick={() => voidLast(dialog.reason)}>Void sale</button><button class="btn-ghost" onclick={() => (dialog = null)}>Cancel</button></div></div>
    {:else if !dialog.approval}
      <input class="field" bind:value={dialog.reason} placeholder="Reason for the void" aria-label="Reason for the void" />
      <Approve what={["Void " + sale.number]} permission="sales.void" onApproved={(a) => voidLast(dialog.reason || "Voided", a.approval)} onCancel={() => (dialog = null)} />
    {/if}
  {/if}

  {#if mode === "done" && sale}
    <div class="grid gap-4 lg:grid-cols-[1fr_auto]" use:keepOnTouch>
      <div class="card space-y-3 text-center">
        {#if sale.offline}<p class="rounded-xl bg-warn/10 px-3 py-2 text-warn">Saved on this till (hub not reachable). It uploads by itself when the hub is back.</p>{/if}
        {#if sale.change_cents}<p class="text-muted">Change</p><p class="text-5xl font-bold tabular-nums">{money(sale.change_cents)}</p>
        {:else}<p class="text-3xl font-bold">Paid ✓</p>{/if}
        <p class="text-muted">{sale.number} · {money(sale.total_cents + sale.rounding_cents)}</p>
        <div class="flex flex-wrap justify-center gap-2 print:hidden">
          <button class="btn" data-newsale onclick={newSale}>New sale{back ? " (" + back + ")" : ""}</button>
          {#if sale.status === "completed" && !sale.offline}<button class="btn-ghost" onclick={() => (dialog = { kind: "void", reason: "" })}>Void</button>{/if}
        </div>
        {#key sale.id}<PrintButtons {sale} auto={true} local={!!sale.offline} />{/key}
        {#if back}<p class="text-sm text-muted print:hidden" role="timer">Back to selling in {back} s · <button class="underline" onclick={stopBack}>Stay here</button></p>{/if}
      </div>
      <div class="space-y-4">
        {#if exReturn}
          <div class="card space-y-2 text-center print:hidden"><p>Exchange recorded with return <b>{exReturn.number}</b>{exReturn.paid_cents > (exReturn.refunds.find((x) => x.method === "exchange") || { amount_cents: 0 }).amount_cents ? " · refunded " + money(exReturn.paid_cents - (exReturn.refunds.find((x) => x.method === "exchange") || { amount_cents: 0 }).amount_cents) : ""}.</p>
            {#key exReturn.id}<PrintButtons sale={exReturn} kind="return" auto={true} />{/key}</div>
          <ReturnSlip ret={exReturn} />
        {/if}
        <Receipt {sale} />
      </div>
    </div>
  {:else}
  <div class="grid gap-4 lg:grid-cols-[1fr_24rem]">
    <!-- Products -->
    <div class="min-w-0 space-y-3 print:hidden">
      {#if scanning}
        <Scanner onCode={(c) => { scanning = false; onCode(c); }} onClose={() => (scanning = false)} />
      {:else}
        <form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); onCode(code); }}>
          <label class="sr-only" for="scan">Scan a barcode or type a PLU</label>
          <input id="scan" bind:this={codeInput} class="field" bind:value={code} autocomplete="off" placeholder="Scan or type barcode / PLU" disabled={mode !== "sell"} />
          <button class="btn-ghost" type="submit" disabled={mode !== "sell"}>Add</button>
          <button class="btn-ghost" type="button" onclick={() => (scanning = true)} disabled={mode !== "sell"} aria-label="Scan with the camera">📷</button>
        </form>
      {/if}
      <input class="field" type="search" bind:value={search} placeholder="Search products" aria-label="Search products" disabled={mode !== "sell"} />
      {#if !search.trim()}
        <div class="flex gap-2 overflow-x-auto pb-1">
          {#each cats as c (c.id)}
            <button class="min-h-12 shrink-0 rounded-xl border px-3 font-semibold {cat === c.id ? 'text-white' : 'border-line bg-card'}"
              style={cat === c.id ? "background:" + (c.colour || "var(--accent)") + ";border-color:" + (c.colour || "var(--accent)") : "border-left:6px solid " + (c.colour || "var(--line)")}
              onclick={() => (cat = c.id)}>{c.name}</button>
          {/each}
        </div>
      {/if}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {#each visible as p (p.id)}
          <button class="flex min-h-20 flex-col justify-between rounded-xl border border-line bg-card p-2 text-left disabled:opacity-50" disabled={mode !== "sell"} onclick={() => tapProduct(p)}>
            <span class="font-semibold leading-tight">{p.name}</span>
            <span class="text-sm text-muted">{priceOf(p)}</span>
          </button>
        {/each}
        {#if !visible.length}<p class="text-muted">No products here.</p>{/if}
      </div>
    </div>

    <!-- Cart -->
    <div class="card flex flex-col gap-3 lg:sticky lg:self-start" style="top: calc(var(--app-top, 0px) + {headH}px + 0.5rem)">
      {#if dialog && dialog.kind === "weight"}
        <form class="space-y-2 rounded-xl border border-accent p-3" onsubmit={(e) => { e.preventDefault(); const w = Number(dialog.value); if (w > 0) { const d = dialog; dialog = null; add(d.p, d.u, { weight: w }); } }}>
          <label class="block"><span class="font-semibold">{dialog.p.name}: weight ({dialog.p.base_unit})</span>
            <input class="field" type="number" min="0.001" step="0.001" bind:value={dialog.value} use:focusNow /></label>
          <div class="flex gap-2"><button class="btn" type="submit">Add</button><button class="btn-ghost" type="button" onclick={() => (dialog = null)}>Cancel</button></div>
        </form>
      {:else if dialog && dialog.kind === "choose"}
        <div class="space-y-2 rounded-xl border border-accent p-3">
          <p class="font-semibold">Packs or singles?</p>
          <div class="flex flex-wrap gap-2">{#each dialog.options as o (o.u.id)}<button class="btn-ghost" onclick={() => { dialog = null; add(o.p, o.u); }}>{o.u.name} · {money(o.u.price_cents)}</button>{/each}</div>
          <button class="btn-ghost" onclick={() => (dialog = null)}>Cancel</button>
        </div>
      {:else if dialog && dialog.kind === "age"}
        <div class="space-y-2 rounded-xl border border-warn p-3">
          <p class="font-semibold">Check ID: {dialog.p.name} is {dialog.p.min_age}+</p>
          <p class="text-sm text-muted">Confirm you saw valid photo ID showing the customer is {dialog.p.min_age} or older. This is recorded.</p>
          <div class="flex gap-2"><button class="btn" onclick={() => { const d = dialog; dialog = null; add(d.p, d.u, { ...d.extra, age_checked: true }); }}>ID checked</button>
            <button class="btn-ghost" onclick={() => (dialog = null)}>No ID: do not sell</button></div>
        </div>
      {:else if dialog && dialog.kind === "edit"}
        {@const l = cart.lines.find((x) => x.key === dialog.key)}
        <form class="space-y-2 rounded-xl border border-accent p-3" onsubmit={(e) => { e.preventDefault(); dialog = null; changed(); }}>
          <p class="font-semibold">{l.name}</p>
          <label class="block"><span class="text-sm text-muted">{l.kind === "weight" ? "Weight (" + l.base_unit + ")" : "Quantity"}</span>
            <input class="field" type="number" min={l.kind === "weight" ? 0.001 : 1} step={l.kind === "weight" ? 0.001 : 1} value={l.qty} onchange={(e) => setQty(l, e.currentTarget.value)} /></label>
          {#if can("sales.discount")}
            <div class="grid grid-cols-2 gap-2">
              <label class="block"><span class="text-sm text-muted">Discount on this item</span>
                <select class="field" value={l.discount ? l.discount.type : "pct"} onchange={(e) => (l.discount = { type: e.currentTarget.value, value: l.discount ? l.discount.value : 0 })}>
                  <option value="pct">%</option><option value="amount">$</option></select></label>
              <label class="block"><span class="text-sm text-muted">{l.discount && l.discount.type === "amount" ? "Amount ($)" : "Percent"}</span>
                <input class="field" inputmode="decimal" value={l.discount ? (l.discount.type === "amount" ? (l.discount.value / 100).toFixed(2) : l.discount.value) : ""}
                  onchange={(e) => { const t = l.discount ? l.discount.type : "pct"; const v = t === "amount" ? toCents(e.currentTarget.value) : Number(e.currentTarget.value); l.discount = v ? { type: t, value: v } : null; }} /></label>
            </div>
          {/if}
          <label class="block"><span class="text-sm text-muted">Price per {l.kind === "weight" ? l.base_unit : "item"} ($), regular {money(qline(l.key) ? qline(l.key).regular_price_cents : 0)}</span>
            <input class="field" inputmode="decimal" value={l.price_cents !== undefined ? (l.price_cents / 100).toFixed(2) : ""}
              onchange={(e) => { const c = toCents(e.currentTarget.value); l.price_cents = c === null || isNaN(c) ? undefined : c; }} /></label>
          {#if l.price_cents !== undefined}
            <label class="block"><span class="text-sm text-muted">Reason for the price change</span><input class="field" bind:value={l.override_reason} maxlength="200" /></label>
          {/if}
          <div class="flex flex-wrap gap-2"><button class="btn" type="submit">Done</button><button class="btn-ghost text-bad" type="button" onclick={() => removeLine(l)}>Remove line</button></div>
        </form>
      {:else if dialog && dialog.kind === "discount"}
        <form class="space-y-2 rounded-xl border border-accent p-3" onsubmit={(e) => { e.preventDefault(); const v = dialog.type === "amount" ? toCents(dialog.value) : Number(dialog.value); cart.cart_discount = v ? { type: dialog.type, value: v } : null; dialog = null; changed(); }}>
          <p class="font-semibold">Discount on the whole sale</p>
          <p class="text-sm text-muted">For one product only, use "Discount this item" under it.</p>
          <div class="grid grid-cols-2 gap-2">
            <select class="field" bind:value={dialog.type} aria-label="Discount type"><option value="pct">%</option><option value="amount">$</option></select>
            <input class="field" inputmode="decimal" bind:value={dialog.value} aria-label="Discount value" />
          </div>
          <div class="flex gap-2"><button class="btn" type="submit">Apply</button><button class="btn-ghost" type="button" onclick={() => { cart.cart_discount = null; dialog = null; changed(); }}>Remove discount</button></div>
        </form>
      {:else if dialog && dialog.kind === "customer"}
        <CustomerPanel {ix} onPick={(c) => { cart.customer = { id: c.id, first_name: c.first_name, points: c.points, card: c.card || "" }; cart.redeem_points = 0; dialog = null; changed(); }} onCancel={() => (dialog = null)} />
      {:else if dialog && dialog.kind === "points"}
        <form class="space-y-2 rounded-xl border border-accent p-3" onsubmit={(e) => { e.preventDefault(); cart.redeem_points = Math.max(0, Math.floor(Number(dialog.value) || 0)); dialog = null; changed(); }}>
          <label class="block"><span class="font-semibold">Points to use ({quote && quote.loyalty ? quote.loyalty.customer.points : 0} available)</span>
            <input class="field" type="number" min="0" step="1" bind:value={dialog.value} use:focusNow /></label>
          <div class="flex gap-2"><button class="btn" type="submit">Use</button><button class="btn-ghost" type="button" onclick={() => { cart.redeem_points = 0; dialog = null; changed(); }}>Don't use points</button></div>
        </form>
      {:else if dialog && dialog.kind === "coupon"}
        <form class="space-y-2 rounded-xl border border-accent p-3" onsubmit={(e) => { e.preventDefault(); const c = dialog.code.trim().toUpperCase(); if (c && !(cart.coupons || []).includes(c)) cart.coupons = [...(cart.coupons || []), c]; dialog = null; changed(); }}>
          <label class="block"><span class="font-semibold">Coupon code</span>
            <input class="field uppercase" bind:value={dialog.code} autocomplete="off" maxlength="30" placeholder="Scan or type the code" use:focusNow /></label>
          {#each cart.coupons || [] as c (c)}<p class="flex items-center justify-between text-sm"><span>{c}</span><button type="button" class="text-bad underline" onclick={() => { cart.coupons = cart.coupons.filter((x) => x !== c); changed(); }}>Remove</button></p>{/each}
          <div class="flex gap-2"><button class="btn" type="submit">Add</button><button class="btn-ghost" type="button" onclick={() => (dialog = null)}>Close</button></div>
        </form>
      {:else if dialog && dialog.kind === "exempt"}
        <form class="space-y-2 rounded-xl border border-accent p-3" onsubmit={(e) => { e.preventDefault(); cart.exempt = dialog.reason ? { reason: dialog.reason, reference: dialog.reference } : null; dialog = null; changed(); }}>
          <p class="font-semibold">Tax-exempt sale</p>
          <select class="field" bind:value={dialog.reason} aria-label="Reason"><option value="">Not exempt</option>
            {#each Object.entries(settings.exempt_reasons || {}) as [k, v] (k)}<option value={k}>{v.label} (no {v.types.join(", ")})</option>{/each}</select>
          <input class="field" bind:value={dialog.reference} placeholder="Card or certificate number" aria-label="Reference number" />
          <button class="btn" type="submit">Apply</button>
        </form>
      {:else if dialog && dialog.kind === "holds"}
        <div class="space-y-2 rounded-xl border border-accent p-3">
          <p class="font-semibold">Held sales</p>
          {#each dialog.list as h (h.id)}
            <button class="btn-ghost w-full justify-between" onclick={() => recall(h)}><span>{h.label || "No name"} · {h.items} lines</span><span>{money(h.total_cents)}</span></button>
          {:else}<p class="text-muted">No held sales.</p>{/each}
          <button class="btn-ghost" onclick={() => (dialog = null)}>Close</button>
        </div>
      {/if}

      <div class="flex items-center justify-between"><h2 class="font-semibold">Sale</h2>{#if quoting}<span class="text-xs text-muted">pricing…</span>{:else if quote && quote.offline}<span class="text-xs text-warn">offline prices</span>{/if}</div>
      {#if !live.length}<p class="text-muted">Scan or tap a product.</p>{/if}
      <ul class="divide-y divide-line">
        {#each cart.lines as l (l.key)}
          {@const ql = qline(l.key)}
          {@const pr = problems.find((x) => x.key === l.key)}
          {#if !l.voided}
            <li class="py-2">
              <div class="flex items-start justify-between gap-2">
                <button class="min-w-0 text-left" disabled={mode !== "sell"} onclick={() => (dialog = { kind: "edit", key: l.key })}>
                  <span class="block font-semibold leading-tight">{l.name}{l.age_checked ? " · ID ✓" : ""}</span>
                  <span class="block text-sm text-muted">{l.kind === "weight" ? l.qty + " " + l.base_unit : l.qty} × {ql ? money(ql.price_cents) : "…"}{l.price_cents !== undefined ? " (new price)" : ""}</span>
                  {#if ql && ql.promo_cents}<span class="block text-sm text-ok">🏷 {ql.promo_label} −{money(ql.promo_cents)}</span>{/if}
                  {#if ql && ql.staff_cents}<span class="block text-sm text-ok">Staff discount −{money(ql.staff_cents)}</span>{/if}
                  {#if ql && ql.line_discount_cents - (ql.promo_cents || 0) - (ql.staff_cents || 0) > 0}<span class="block text-sm text-ok">Item discount {ql.discount_label ? "(" + ql.discount_label + ") " : ""}−{money(ql.line_discount_cents - (ql.promo_cents || 0) - (ql.staff_cents || 0))}</span>{/if}
                  {#if ql && ql.deposit_cents}<span class="block text-xs text-muted">+ deposit {money(ql.deposit_cents)}</span>{/if}
                </button>
                <div class="flex shrink-0 items-center gap-1">
                  {#if l.kind !== "weight" && mode === "sell"}
                    <button class="h-10 w-10 rounded-lg border border-line" aria-label="One less" onclick={() => (l.qty > 1 ? setQty(l, l.qty - 1) : removeLine(l))}>−</button>
                    <button class="h-10 w-10 rounded-lg border border-line" aria-label="One more" onclick={() => setQty(l, l.qty + 1)}>+</button>
                  {/if}
                  <span class="w-20 text-right font-semibold tabular-nums">{ql ? money(ql.gross_cents - ql.line_discount_cents) : ""}</span>
                  {#if mode === "sell"}<button class="h-10 w-10 rounded-lg border border-line text-bad" aria-label={"Remove " + l.name} title="Remove this item" onclick={() => removeLine(l)}>✕</button>{/if}
                </div>
              </div>
              {#if mode === "sell" && can("sales.discount")}
                <button class="mt-1 min-h-8 text-sm text-accent underline" onclick={() => (dialog = { kind: "edit", key: l.key })}>{l.discount ? "Change item discount" : "Discount this item"}</button>
              {/if}
              {#if pr}
                <p class="mt-1 text-sm text-bad">{pr.message}
                  {#if pr.type === "pack_break"}<button class="ml-1 underline" onclick={() => openPack(l.key)}>Open a pack</button>{/if}
                  {#if pr.type === "age"}<button class="ml-1 underline" onclick={() => { l.age_checked = true; changed(); }}>ID checked</button>{/if}
                </p>
              {/if}
            </li>
          {/if}
        {/each}
      </ul>
      {#if problems.some((x) => !x.key)}<p class="text-sm text-bad">{problems.find((x) => !x.key).message}</p>{/if}
      {#if cart.customer}
        <div class="rounded-xl bg-accent/10 px-3 py-2 text-sm">
          <p class="flex items-center justify-between gap-2"><span>Customer: <b>{cart.customer.first_name}</b>{quote && quote.loyalty ? " · " + quote.loyalty.customer.points + " points" : ""}</span>
            <button class="underline" onclick={() => { cart.customer = null; cart.redeem_points = 0; changed(); }}>Remove</button></p>
          {#if quote && quote.loyalty && quote.loyalty.enabled}
            <p class="flex items-center justify-between gap-2"><span>Earns {quote.loyalty.earn} points{quote.loyalty.redeem_points ? " · uses " + quote.loyalty.redeem_points : ""} · balance after {quote.loyalty.balance_after}</span>
              {#if mode === "sell"}<button class="underline" onclick={() => (dialog = { kind: "points", value: cart.redeem_points || quote.loyalty.customer.points })}>{cart.redeem_points ? "Change points" : "Use points"}</button>{/if}</p>
          {/if}
        </div>
      {/if}
      {#if cart.staff}
        <p class="flex items-center justify-between gap-2 rounded-xl bg-accent/10 px-3 py-2 text-sm"><span>Staff sale: <b>{cart.staff.name}</b>{quote && quote.staff ? " · " + quote.staff.pct + "% · " + money(quote.staff.cents) + " off" + (quote.staff.left_cents !== null ? " · " + money(quote.staff.left_cents) + " left this month" : "") : ""}</span>
          <button class="underline" onclick={() => { cart.staff = null; changed(); }}>Remove</button></p>
      {/if}

      {#if quote && live.length}
        <div class="space-y-1 border-t border-line pt-2 text-sm">
          {#each quote.promotions || [] as a (a.id)}<p class="flex justify-between text-ok"><span>🏷 {a.name}{a.times > 1 ? " ×" + a.times : ""}</span><span>−{money(a.saving_cents)}</span></p>{/each}
          {#if quote.loyalty && quote.loyalty.redeem_cents}<p class="flex justify-between text-ok"><span>Points used ({quote.loyalty.redeem_points})</span><span>−{money(quote.loyalty.redeem_cents)}</span></p>{/if}
          {#if quote.staff && quote.staff.cents}<p class="flex justify-between text-ok"><span>Staff discount ({quote.staff.name})</span><span>−{money(quote.staff.cents)}</span></p>{/if}
          {#if quote.discount_cents - quote.cart_discount_cents - (quote.promotions || []).reduce((x, a) => x + a.saving_cents, 0) - (quote.staff ? quote.staff.cents : 0) - (quote.loyalty ? quote.loyalty.redeem_cents : 0) > 0}<p class="flex justify-between text-ok"><span>Item discounts</span><span>−{money(quote.discount_cents - quote.cart_discount_cents - (quote.promotions || []).reduce((x, a) => x + a.saving_cents, 0) - (quote.staff ? quote.staff.cents : 0) - (quote.loyalty ? quote.loyalty.redeem_cents : 0))}</span></p>{/if}
          {#if (quote.coupons_unused || []).length}<p class="text-warn">Coupon {quote.coupons_unused.join(", ")} gives nothing on this sale (unknown, not now, or no items for it).</p>{/if}
          {#if quote.cart_discount_cents}<p class="flex justify-between text-ok"><span>Sale discount{quote.cart_discount_label ? " (" + quote.cart_discount_label + ")" : ""}</span><span>−{money(quote.cart_discount_cents)}</span></p>{/if}
          {#if quote.deposit_cents}<p class="flex justify-between"><span>Deposits and fees</span><span>{money(quote.deposit_cents)}</span></p>{/if}
          {#each quote.taxes as x (x.code + x.rate)}<p class="flex justify-between"><span>{x.label} {x.rate}%{quote.tax_mode === "tax_included" ? " incl." : ""}</span><span>{money(x.tax_cents)}</span></p>{/each}
          {#if quote.exempt}<p class="text-ok">Exempt: {quote.exempt.label} ({money(quote.exempt_cents)} not charged)</p>{/if}
          <p class="flex justify-between text-2xl font-bold"><span>Total</span><span class="tabular-nums">{money(quote.total_cents)}</span></p>
          {#if settings.cash_rounding && quote.cash_total_cents !== quote.total_cents}<p class="flex justify-between text-muted"><span>Cash</span><span>{money(quote.cash_total_cents)}</span></p>{/if}
          {#if cart.approval}<p class="text-ok">Manager approval ready</p>{/if}
        </div>
      {/if}

      {#if mode === "sell"}
        <div class="flex flex-wrap gap-2">
          <button class="btn flex-1 text-lg" disabled={!live.length || !quote || quoting} onclick={startPay}>Pay {quote ? money(quote.total_cents) : ""}</button>
        </div>
        <div class="flex flex-wrap gap-2 text-sm">
          {#if can("sales.discount")}<button class="btn-ghost min-h-10 text-sm" disabled={!live.length} onclick={() => (dialog = { kind: "discount", type: cart.cart_discount ? cart.cart_discount.type : "pct", value: "" })}>Sale discount</button>{/if}
          {#if can("sales.tax_exempt")}<button class="btn-ghost min-h-10 text-sm" disabled={!live.length} onclick={() => (dialog = { kind: "exempt", reason: cart.exempt ? cart.exempt.reason : "", reference: cart.exempt ? cart.exempt.reference : "" })}>Tax exempt</button>{/if}
          {#if custOn && can("customers.view")}<button class="btn-ghost min-h-10 text-sm" onclick={() => (dialog = { kind: "customer" })}>{cart.customer ? "Customer ✓" : "Customer"}</button>{/if}
          {#if promoOn}<button class="btn-ghost min-h-10 text-sm" disabled={!live.length} onclick={() => (dialog = { kind: "coupon", code: "" })}>Coupon{(cart.coupons || []).length ? " (" + cart.coupons.length + ")" : ""}</button>{/if}
          {#if settings.staff_discount && settings.staff_discount.enabled && !cart.staff && !cart.training}<button class="btn-ghost min-h-10 text-sm" disabled={!live.length || isHubDown()} onclick={() => (dialog = { kind: "staff" })}>Staff sale</button>{/if}
          <button class="btn-ghost min-h-10 text-sm" disabled={!live.length} onclick={hold}>Hold</button>
          <button class="btn-ghost min-h-10 text-sm text-bad" disabled={!cart.lines.length} onclick={() => clearCart()}>Clear sale</button>
        </div>
      {:else if mode === "pay" && st && ex.draft && ex.draft.credit_cents >= quote.total_cents}
        <div class="space-y-2 border-t border-line pt-2">
          <p class="flex justify-between"><span>Returned items</span><span>{money(ex.draft.credit_cents)}</span></p>
          <p class="flex justify-between"><span>New items</span><span>−{money(quote.total_cents)}</span></p>
          {#if ex.draft.credit_cents > quote.total_cents}
            <RefundChooser total={ex.draft.credit_cents - quote.total_cents} receipt={ex.draft.receipt} cardMax={ex.draft.card_max_cents} {busy} onDone={finishExchange} />
          {:else}<button class="btn" disabled={busy} onclick={() => finishExchange([])}>Complete exchange</button>{/if}
          <button class="btn-ghost" disabled={busy} onclick={() => { payments = []; mode = "sell"; dialog = null; }}>Back to the sale</button>
          {#if busy}<p class="text-muted">Saving…</p>{/if}
        </div>
      {:else if mode === "pay" && st}
        <div class="space-y-2 border-t border-line pt-2">
          {#each payments as p, i (i)}
            <p class="flex justify-between text-sm"><span>{METHOD[p.method]}{p.last4 ? " ****" + p.last4 : ""}{p.status === "declined" ? " · declined" : ""}</span><span>{money(p.amount_cents)}{p.method === "usd_cash" ? " US" : ""}</span></p>
          {/each}
          <p class="flex justify-between text-xl font-bold"><span>To pay</span><span class="tabular-nums">{money(st.remaining)}</span></p>
          {#if (settings.payment_methods || []).includes("cash")}
            <p class="text-sm text-muted">Cash {money(st.cash_due)}</p>
            <div class="flex flex-wrap gap-2">
              {#each cashSuggestions(st.cash_due) as c (c)}<button class="btn-ghost" disabled={busy} onclick={() => pay({ method: "cash", amount_cents: c })}>{money(c)}</button>{/each}
              <button class="btn-ghost" disabled={busy} onclick={() => (dialog = { kind: "other", value: "" })}>Other</button>
            </div>
          {/if}
          {#if dialog && dialog.kind === "other"}
            <form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); const c = toCents(dialog.value); if (c > 0) pay({ method: "cash", amount_cents: c }); }}>
              <input class="field" inputmode="decimal" bind:value={dialog.value} placeholder="Cash given ($)" aria-label="Cash given" use:focusNow /><button class="btn" type="submit">OK</button></form>
          {/if}
          <div class="flex flex-wrap gap-2">
            {#if (settings.payment_methods || []).includes("card")}<button class="btn" disabled={busy} onclick={() => (dialog = { kind: "card", amount: (st.remaining / 100).toFixed(2), last4: "", reference: "" })}>Card</button>{/if}
            {#if (settings.payment_methods || []).includes("usd_cash")}<button class="btn-ghost" disabled={busy} onclick={() => (dialog = { kind: "usd", value: "" })}>US cash</button>{/if}
            {#if !isHubDown() && !cart.training}<button class="btn-ghost" disabled={busy} onclick={() => (dialog = { kind: "credit", code: "", error: "" })}>Store credit</button>{/if}
          </div>
          {#if dialog && dialog.kind === "card"}
            <div class="space-y-2 rounded-xl border border-accent p-3">
              <p class="text-sm">Key this amount into the card terminal, then record the result.</p>
              <label class="block"><span class="text-sm text-muted">Amount ($)</span><input class="field" inputmode="decimal" bind:value={dialog.amount} /></label>
              <div class="grid grid-cols-2 gap-2">
                <label class="block"><span class="text-sm text-muted">Card last 4</span><input class="field" inputmode="numeric" maxlength="4" bind:value={dialog.last4} /></label>
                <label class="block"><span class="text-sm text-muted">Approval / reference</span><input class="field" bind:value={dialog.reference} maxlength="60" /></label>
              </div>
              <div class="flex flex-wrap gap-2">
                <button class="btn" onclick={() => pay({ method: "card", amount_cents: toCents(dialog.amount), last4: dialog.last4, reference: dialog.reference })}>Approved</button>
                <button class="btn-ghost text-bad" onclick={() => pay({ method: "card", status: "declined", amount_cents: toCents(dialog.amount), last4: dialog.last4 })}>Declined</button>
              </div>
            </div>
          {:else if dialog && dialog.kind === "credit"}
            <form class="space-y-2 rounded-xl border border-accent p-3" onsubmit={checkCredit}>
              <label class="block"><span class="text-sm text-muted">Store credit code (scan the slip's barcode or type it)</span>
                <input class="field" bind:value={dialog.code} placeholder="SC-XXXX-XXXX" autocomplete="off" use:focusNow /></label>
              {#if dialog.error}<p class="text-sm text-bad">{dialog.error}</p>{/if}
              <button class="btn" type="submit">Use the credit</button>
            </form>
          {:else if dialog && dialog.kind === "usd"}
            <form class="space-y-2 rounded-xl border border-accent p-3" onsubmit={(e) => { e.preventDefault(); const c = toCents(dialog.value); if (c > 0) pay({ method: "usd_cash", amount_cents: c }); }}>
              <label class="block"><span class="text-sm text-muted">US dollars given (1 US = {settings.usd_rate} CAD; change in CAD)</span>
                <input class="field" inputmode="decimal" bind:value={dialog.value} use:focusNow /></label>
              <button class="btn" type="submit">OK</button>
            </form>
          {/if}
          <button class="btn-ghost" disabled={busy} onclick={() => { payments = []; mode = "sell"; dialog = null; }}>Back to the sale</button>
          {#if busy}<p class="text-muted">Saving…</p>{/if}
          {#if error && !busy && payments.length}<button class="btn" onclick={finish}>Try again</button>{/if}
        </div>
      {/if}
    </div>
  </div>
  {/if}
</section>

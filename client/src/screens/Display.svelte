<script>
  // Customer-facing display (P2 step 5, FR-3.14): the items, savings and total of one till's sale, live;
  // "thank you" with the change after payment; the store's logo when idle. No sign-in, no buttons.
  // A device paired as a customer display asks the hub about once a second (the till it shows is set in
  // the device manager). local: a window on the till itself (a second monitor, opened from Sell), fed
  // straight from the till through a BroadcastChannel, so it works offline too.
  import { onMount, tick } from "svelte";
  import { api } from "../lib/api.js";
  import { money } from "../lib/catalogue.js";
  import { CHANNEL } from "../lib/customer_display.js";

  let { local = false } = $props();
  let st = $state({ kind: "idle" }), brand = $state({ name: "", logo: "" }), linked = $state(true), reach = $state(true), logoOk = $state(true);
  let list = $state(null);
  let v = 0;

  onMount(() => {
    try { const b = JSON.parse(localStorage.getItem("chedam.brand") || "null"); if (b) brand = b; } catch { /* none */ }
    let bc = null;
    try {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = (e) => { if (e.data && e.data.kind) st = e.data; };
      bc.postMessage({ ask: true });
    } catch { bc = null; }
    // Keep the screen on (where the browser allows it)
    let lock = null;
    const wake = () => { if (navigator.wakeLock && document.visibilityState === "visible") navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {}); };
    wake();
    document.addEventListener("visibilitychange", wake);
    let stop = false, t;
    async function poll() {
      const r = await api("GET", "/api/chedam/display" + (v ? "?v=" + v : ""), null, { quiet: true, timeout: 5000 });
      reach = r.ok;
      if (r.ok && !r.json.same) { v = r.json.v; st = r.json.state; linked = r.json.linked; if (r.json.brand) { brand = r.json.brand; logoOk = true; } }
      if (!stop) t = setTimeout(poll, 1000);
    }
    if (!local) poll();
    return () => { stop = true; clearTimeout(t); if (bc) bc.close(); document.removeEventListener("visibilitychange", wake); if (lock) lock.release().catch(() => {}); };
  });

  // The newest item stays in view.
  $effect(() => { if (st.kind === "sale" && st.lines && list) tick().then(() => { list.scrollTop = list.scrollHeight; }); });
  const qty = (l) => (l.unit ? l.qty + " " + l.unit : l.qty);
</script>

<div class="display fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg text-ink" style="cursor: none">
  {#if st.kind === "sale" || st.kind === "pay"}
    <div class="flex items-center justify-between gap-3 border-b border-line px-6 py-3">
      <span class="text-2xl font-bold">{brand.name}</span>
      {#if st.customer}<span class="text-xl">Hi {st.customer.first_name} · <b>{st.customer.points}</b> points{st.customer.earn ? " · earns " + st.customer.earn : ""}{st.customer.redeem ? " · using " + st.customer.redeem : ""}</span>{/if}
    </div>
    {#if st.training}<p class="bg-warn/15 py-1 text-center text-lg font-semibold text-warn">Training: practice sale</p>{/if}
    <div class="flex min-h-0 flex-1 flex-col md:flex-row">
      <ul class="min-h-0 flex-1 divide-y divide-line overflow-y-auto px-6" bind:this={list}>
        {#each st.lines || [] as l, i (i)}
          <li class="flex items-start justify-between gap-4 py-3 text-2xl">
            <span class="min-w-0"><span class="block font-semibold">{l.name}</span>
              <span class="block text-lg text-muted">{qty(l)} × {money(l.price_cents)}{l.regular_price_cents > l.price_cents ? " (was " + money(l.regular_price_cents) + ")" : ""}</span>
              {#if l.promo_label}<span class="block text-lg text-ok">🏷 {l.promo_label}</span>{/if}
              {#if l.save_cents > 0}<span class="block text-lg text-ok">You save {money(l.save_cents)}</span>{/if}</span>
            <span class="shrink-0 font-semibold tabular-nums">{money(l.total_cents)}</span>
          </li>
        {/each}
      </ul>
      <div class="flex shrink-0 flex-col justify-end gap-2 border-line bg-soft px-6 py-4 text-2xl md:w-96 md:border-l">
        {#if st.discount_cents > 0}<p class="flex justify-between text-ok"><span>{st.discount_label || "Discount"}</span><span>−{money(st.discount_cents)}</span></p>{/if}
        {#if st.points_cents > 0}<p class="flex justify-between text-ok"><span>Points used</span><span>−{money(st.points_cents)}</span></p>{/if}
        {#if st.tax_cents}<p class="flex justify-between text-lg"><span>Tax</span><span>{money(st.tax_cents)}</span></p>{/if}
        {#if st.deposit_cents}<p class="flex justify-between text-lg"><span>Deposits</span><span>{money(st.deposit_cents)}</span></p>{/if}
        <p class="flex justify-between text-4xl font-bold"><span>Total</span><span class="tabular-nums">{money(st.total_cents)}</span></p>
        {#if st.savings_cents > 0}<p class="rounded-xl bg-ok/10 px-3 py-2 text-center text-ok">You save {money(st.savings_cents)}</p>{/if}
        {#if st.kind === "pay" && st.paid_cents > 0}<p class="flex justify-between"><span>Paid</span><span>{money(st.paid_cents)}</span></p>{/if}
        {#if st.kind === "pay"}<p class="flex justify-between font-bold"><span>{st.remaining_cents > 0 ? "To pay" : "Paid in full"}</span><span>{st.remaining_cents > 0 ? money(st.remaining_cents) : ""}</span></p>{/if}
      </div>
    </div>
  {:else if st.kind === "done"}
    <div class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p class="text-6xl font-bold">Thank you!</p>
      <p class="text-3xl">Total {money(st.total_cents)}{st.change_cents > 0 ? "" : " · paid"}</p>
      {#if st.change_cents > 0}<p class="text-5xl font-bold">Change {money(st.change_cents)}</p>{/if}
      {#if st.savings_cents > 0}<p class="text-3xl text-ok">You saved {money(st.savings_cents)}</p>{/if}
      {#if st.customer}<p class="text-2xl">{st.customer.first_name}: {st.customer.earned ? "+" + st.customer.earned + " points · " : ""}balance {st.customer.balance} points</p>{/if}
      {#if brand.name}<p class="text-xl text-muted">{brand.name}</p>{/if}
    </div>
  {:else}
    <div class="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      {#if brand.logo && logoOk}<img src={brand.logo} alt={brand.name} class="max-h-[50vh] max-w-[80vw] object-contain" onerror={() => (logoOk = false)} />{/if}
      {#if brand.name}<p class="text-5xl font-bold">{brand.name}</p>{:else if !brand.logo}<img src="./icons/icon-192.png" alt="Chedam" class="h-32 w-32 rounded-3xl" />{/if}
      <p class="text-3xl text-muted">Welcome</p>
    </div>
  {/if}
  {#if !local && (!linked || !reach)}
    <p class="px-4 py-1 text-center text-sm text-muted">{!reach ? "Waiting for the hub…" : "Not showing a till yet: in Devices, choose which till this screen shows."}</p>
  {/if}
</div>

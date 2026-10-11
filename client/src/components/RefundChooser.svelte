<script>
  // How a refund goes back (FR-4.14, FR-4.10): cash (rounded to 5 cents when it finishes the refund,
  // BR-16), card on the standalone terminal (up to what the card paid; the cashier confirms it went
  // through), or store credit (a code printed on the slip). Without a receipt: store credit only.
  // P5 step 3: what was paid on the linked terminal goes back to the same card through the processor
  // (linkedMax; Interac on the terminal), and refunds already made for this return come back after a reload.
  // onDone(refunds) when the whole amount is covered.
  import { onMount } from "svelte";
  import { money, toCents } from "../lib/catalogue.js";
  import { cashRound, METHOD } from "../lib/till.js";
  import { isHubDown } from "../lib/api.js";
  import { refundLinked, acceptedFor } from "../lib/linked.js";

  let { total, receipt = true, cardMax = 0, linkedMax = 0, saleId = "", refId = "", busy = false, onDone } = $props();
  let list = $state([]), card = $state(null), linking = $state(""), linkError = $state("");

  const given = $derived(list.reduce((a, x) => a + x.amount_cents, 0));
  const left = $derived(Math.max(0, total - given));
  const cardUsed = $derived(list.filter((x) => x.method === "card").reduce((a, x) => a + x.amount_cents, 0));
  const linkedUsed = $derived(list.filter((x) => x.processor_refund).reduce((a, x) => a + x.amount_cents, 0));
  const linkedLeft = $derived(Math.max(0, linkedMax - linkedUsed));
  // The standalone terminal: what the card paid outside the linked terminal
  const cardLeft = $derived(Math.max(0, cardMax - linkedMax - (cardUsed - linkedUsed)));

  function add(x) {
    list = [...list, x];
    card = null;
    const rest = total - list.reduce((a, y) => a + y.amount_cents, 0);
    if (x.method === "cash" || rest <= 0) onDone(list.map((y) => ({ ...y })));
  }
  const addLinked = (items) => items.filter((x) => !list.some((y) => y.processor_refund === x.id)).forEach((x) => add({ method: "card", amount_cents: x.amount_cents, processor_refund: x.id, last4: x.last4 }));

  onMount(async () => {
    if (!linkedMax || !refId || isHubDown()) return;
    const back = await acceptedFor(refId);
    if (back.length) addLinked(back);
  });

  async function toCard() {
    linkError = ""; linking = "Sending the refund…";
    const amount = Math.min(left, linkedLeft);
    const res = await refundLinked({ sale: saleId, ref: refId, purpose: "return", amount_cents: amount }, (m) => (linking = m));
    linking = "";
    if (!res.ok) { linkError = res.message; return; }
    addLinked(res.items);
  }
</script>

<div class="space-y-2">
  {#each list as x, i (i)}<p class="flex justify-between text-sm"><span>{METHOD[x.method]}{x.last4 ? " ****" + x.last4 : ""}{x.processor_refund ? " · back to the card" : ""}</span><span>{money(x.amount_cents)}</span></p>{/each}
  <p class="flex justify-between text-xl font-bold"><span>To refund</span><span class="tabular-nums">{money(left)}</span></p>
  {#if linking}<p class="rounded-xl border border-accent p-3 text-lg font-semibold" aria-live="polite">{linking}</p>
  {:else if left > 0}
    <div class="flex flex-wrap gap-2">
      {#if receipt && linkedLeft > 0 && !isHubDown()}<button class="btn" disabled={busy} onclick={toCard}>Back to the card {money(Math.min(left, linkedLeft))}</button>{/if}
      {#if receipt}<button class="btn" disabled={busy} onclick={() => add({ method: "cash", amount_cents: left })}>Cash {money(cashRound(left))}</button>{/if}
      {#if receipt && cardLeft > 0}<button class="btn-ghost" disabled={busy} onclick={() => (card = { amount: (Math.min(left, cardLeft) / 100).toFixed(2), last4: "", reference: "" })}>Card</button>{/if}
      <button class="btn-ghost" disabled={busy} onclick={() => add({ method: "store_credit", amount_cents: left })}>Store credit {money(left)}</button>
    </div>
    {#if linkError}<p class="text-sm text-bad" role="alert">{linkError}</p>{/if}
    {#if !receipt}<p class="text-sm text-muted">Without a receipt the refund is store credit.</p>{/if}
    {#if card}
      <div class="space-y-2 rounded-xl border border-accent p-3">
        <p class="text-sm">Do the refund on the card terminal (up to {money(Math.min(left, cardLeft))}, what the card paid), then confirm here.</p>
        <label class="block"><span class="text-sm text-muted">Amount ($)</span><input class="field" inputmode="decimal" bind:value={card.amount} /></label>
        <div class="grid grid-cols-2 gap-2">
          <label class="block"><span class="text-sm text-muted">Card last 4</span><input class="field" inputmode="numeric" maxlength="4" bind:value={card.last4} /></label>
          <label class="block"><span class="text-sm text-muted">Reference</span><input class="field" bind:value={card.reference} maxlength="60" /></label>
        </div>
        <div class="flex gap-2">
          <button class="btn" disabled={busy || !(toCents(card.amount) > 0) || toCents(card.amount) > Math.min(left, cardLeft)}
            onclick={() => add({ method: "card", amount_cents: toCents(card.amount), last4: card.last4, reference: card.reference })}>Refund went through</button>
          <button class="btn-ghost" onclick={() => (card = null)}>Cancel</button>
        </div>
      </div>
    {/if}
  {/if}
  {#if list.length && !list.some((x) => x.processor_refund)}<button class="text-sm underline" disabled={busy} onclick={() => (list = [])}>Start the refund again</button>{/if}
</div>

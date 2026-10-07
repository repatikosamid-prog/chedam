<script>
  // Till (FR-3.01, 3.11, 1.12): open with the float counted by denomination; running totals; cash drop,
  // pay-out (manager), float added, no-sale with reason; close with the count -> Z report and variance.
  // Managers (settings.manage) also set payment methods, float, cash rounding, US rate and limits here.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money, toCents } from "../lib/catalogue.js";
  import { METHOD } from "../lib/till.js";
  import { off, syncQueue, queued, retry, discard } from "../lib/offline.svelte.js";

  let info = $state(null), error = $state(""), ok = $state(""), busy = $state(false);
  let count = $state({}), usd = $state(""), cash = $state(null), z = $state(null);
  let sets = $state(null);

  const denoms = $derived(info ? info.settings.denominations : []);
  const counted = $derived(denoms.reduce((a, d) => a + d * (Number(count[d]) || 0), 0));
  const label = (d) => (d >= 100 ? "$" + d / 100 : d + "¢");

  async function load() {
    const r = await api("GET", "/api/chedam/tills/current");
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    info = r.json;
    count = {};
  }
  onMount(load);

  async function openTill() {
    busy = true; error = "";
    const body = counted ? { float_detail: Object.fromEntries(Object.entries(count).filter(([, n]) => Number(n))) } : { float_cents: info.settings.float_default_cents };
    const r = await api("POST", "/api/chedam/tills/open", body);
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    ok = "Till " + r.json.number + " is open with " + money(r.json.float_cents) + ".";
    z = null;
    load();
  }

  async function cashMove(e) {
    e.preventDefault();
    const amount = cash.type === "no_sale" ? 0 : toCents(cash.amount);
    if (cash.type !== "no_sale" && !(amount > 0)) { error = "Enter an amount."; return; }
    const r = await api("POST", `/api/chedam/tills/${info.till.id}/cash`, { type: cash.type, amount_cents: amount, reason: cash.reason });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    ok = { drop: "Cash drop recorded.", payout: "Pay-out recorded.", float_add: "Float added.", no_sale: "Drawer opened (no sale) recorded." }[cash.type];
    cash = null;
    load();
  }

  let problemSales = $state([]);
  async function loadProblems() { problemSales = (await queued()).filter((q) => q.status === "problem"); }
  loadProblems();

  async function closeTill() {
    // Offline sales must reach the hub first, or the Z report would miss them (DL-88).
    if (off.pending || off.problems) { error = "Upload the offline sales first (" + (off.pending + off.problems) + " on this till)."; return; }
    if (!confirm("Close the till with " + money(counted) + " counted?")) return;
    busy = true; error = "";
    const body = { counted_detail: Object.fromEntries(Object.entries(count).filter(([, n]) => Number(n))) };
    if (usd !== "") body.counted_usd_cents = toCents(usd) || 0;
    const r = await api("POST", `/api/chedam/tills/${info.till.id}/close`, body);
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    z = r.json.z_report;
    ok = "Till closed.";
    load();
  }

  async function loadSettings() {
    const keys = ["sales.payment_methods", "sales.cash_rounding", "sales.usd_rate", "sales.discount_limit_pct", "sales.override_limit_pct", "till.float_default_cents"];
    const r = await api("GET", "/api/collections/settings/records?perPage=50&filter=" + encodeURIComponent(keys.map((k) => `key='${k}'`).join(" || ")));
    if (!r.ok) { error = r.message; return; }
    const v = Object.fromEntries(r.json.items.map((x) => [x.key, x]));
    sets = { rec: v, methods: [...v["sales.payment_methods"].value], rounding: v["sales.cash_rounding"].value, usd: v["sales.usd_rate"].value,
      disc: v["sales.discount_limit_pct"].value, over: v["sales.override_limit_pct"].value, float: (v["till.float_default_cents"].value / 100).toFixed(2) };
  }

  async function saveSettings(e) {
    e.preventDefault();
    const put = (k, value) => api("PATCH", "/api/collections/settings/records/" + sets.rec[k].id, { value });
    const all = await Promise.all([put("sales.payment_methods", sets.methods), put("sales.cash_rounding", !!sets.rounding),
      put("sales.usd_rate", Number(sets.usd)), put("sales.discount_limit_pct", Number(sets.disc)), put("sales.override_limit_pct", Number(sets.over)),
      put("till.float_default_cents", toCents(sets.float) || 0)]);
    const bad = all.find((r) => !r.ok);
    if (bad) { error = bad.message; return; }
    ok = "Till settings saved."; sets = null; load();
  }

  function when(t) { return t ? new Date(t.replace(" ", "T")).toLocaleString() : ""; }
</script>

<section class="space-y-4">
  <div>
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("sell")}>← Sell</button>
    <h1 class="text-xl font-bold">Till</h1>
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if z}
    <div class="card space-y-1 print:border-none">
      <h2 class="text-lg font-bold">Z report · till {z.till}</h2>
      <p class="text-sm text-muted">{when(z.opened_at)} – {new Date(z.closed_at).toLocaleString()}</p>
      <p class="flex justify-between"><span>Sales</span><span>{z.sales_count} ({z.items} items)</span></p>
      <p class="flex justify-between"><span>Gross</span><span>{money(z.gross_cents)}</span></p>
      <p class="flex justify-between"><span>Discounts</span><span>−{money(z.discount_cents)}</span></p>
      {#each z.taxes as x (x.code + x.rate)}<p class="flex justify-between"><span>{x.label} {x.rate}% on {money(x.base_cents)}</span><span>{money(x.tax_cents)}</span></p>{/each}
      <p class="flex justify-between"><span>Deposits and fees</span><span>{money(z.deposit_cents)}</span></p>
      <p class="flex justify-between font-semibold"><span>Total</span><span>{money(z.total_cents + z.rounding_cents)}</span></p>
      {#each z.payments as p (p.method)}<p class="flex justify-between"><span>{METHOD[p.method]} ({p.count})</span><span>{money(p.amount_cents)}</span></p>{/each}
      <p class="flex justify-between"><span>Voided sales / removed lines / no-sales</span><span>{z.voided_sales} / {z.voided_lines} / {z.no_sales}</span></p>
      <p class="flex justify-between"><span>Declined cards · training sales · exempt sales</span><span>{z.declined_cards} · {z.training_sales} · {z.exempt_sales}</span></p>
      <hr class="border-line" />
      <p class="flex justify-between"><span>Float + cash − drops − pay-outs</span><span>{money(z.float_cents)} + {money(z.cash_in_cents)} − {money(z.drops_cents)} − {money(z.payouts_cents)}</span></p>
      <p class="flex justify-between font-semibold"><span>Expected cash</span><span>{money(z.expected_cash_cents)}</span></p>
      <p class="flex justify-between font-semibold"><span>Counted</span><span>{money(z.counted_cents)}</span></p>
      <p class="flex justify-between text-lg font-bold {z.variance_cents < 0 ? 'text-bad' : z.variance_cents > 0 ? 'text-warn' : 'text-ok'}"><span>{z.variance_cents < 0 ? "Short" : z.variance_cents > 0 ? "Over" : "Balanced"}</span><span>{money(Math.abs(z.variance_cents))}</span></p>
      {#if z.usd_tendered_cents}<p class="flex justify-between"><span>US cash expected / counted</span><span>{money(z.usd_tendered_cents)} / {money(z.counted_usd_cents || 0)} US</span></p>{/if}
      <button class="btn-ghost mt-2 print:hidden" onclick={() => window.print()}>Print Z report</button>
    </div>
  {/if}

  {#if info}
    {#if !info.till}
      <div class="card space-y-3">
        <h2 class="font-semibold">Open the till</h2>
        <p class="text-sm text-muted">Count the float in the drawer, or leave the counts empty to use the default float of {money(info.settings.float_default_cents)}.</p>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {#each denoms as d (d)}<label class="block"><span class="text-sm text-muted">{label(d)}</span><input class="field" type="number" min="0" step="1" bind:value={count[d]} /></label>{/each}
        </div>
        <p class="font-semibold">Float: {money(counted || info.settings.float_default_cents)}</p>
        <button class="btn" disabled={busy || !can("sales.sell")} onclick={openTill}>Open till</button>
      </div>
    {:else}
      {@const sm = info.till.summary}
      <div class="card space-y-1">
        <h2 class="font-semibold">Till {info.till.number} · open since {when(info.till.opened_at)}</h2>
        <p class="flex justify-between"><span>Sales</span><span>{sm.sales_count} · {money(sm.total_cents + sm.rounding_cents)}</span></p>
        {#each sm.payments as p (p.method)}<p class="flex justify-between text-sm"><span>{METHOD[p.method]} ({p.count})</span><span>{money(p.amount_cents)}</span></p>{/each}
        <p class="flex justify-between font-semibold"><span>Cash expected in the drawer</span><span>{money(sm.expected_cash_cents)}</span></p>
        <div class="flex flex-wrap gap-2 pt-2">
          <button class="btn-ghost" onclick={() => (cash = { type: "drop", amount: "", reason: "" })}>Cash drop</button>
          <button class="btn-ghost" onclick={() => (cash = { type: "float_add", amount: "", reason: "" })}>Add float</button>
          {#if can("till.manage")}<button class="btn-ghost" onclick={() => (cash = { type: "payout", amount: "", reason: "" })}>Pay-out</button>{/if}
          <button class="btn-ghost" onclick={() => (cash = { type: "no_sale", amount: "", reason: "" })}>No sale (open drawer)</button>
        </div>
      </div>
      {#if cash}
        <form class="card grid gap-3 sm:grid-cols-2" onsubmit={cashMove}>
          <h2 class="font-semibold sm:col-span-2">{{ drop: "Cash drop to the safe", payout: "Pay-out from the drawer", float_add: "Add to the float", no_sale: "Open the drawer without a sale" }[cash.type]}</h2>
          {#if cash.type !== "no_sale"}<label class="block"><span class="text-sm text-muted">Amount ($)</span><input class="field" inputmode="decimal" bind:value={cash.amount} required /></label>{/if}
          <label class="block"><span class="text-sm text-muted">Reason{cash.type === "payout" || cash.type === "no_sale" ? "" : " (optional)"}</span><input class="field" bind:value={cash.reason} maxlength="200" required={cash.type === "payout" || cash.type === "no_sale"} /></label>
          <div class="flex gap-2 sm:col-span-2"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (cash = null)}>Cancel</button></div>
        </form>
      {/if}
      {#if off.pending || problemSales.length}
        <div class="card space-y-2 border-warn">
          <h2 class="font-semibold text-warn">Offline sales on this till</h2>
          {#if off.pending}<p>{off.pending} waiting to upload. <button class="underline" disabled={off.syncing} onclick={async () => { await syncQueue(); loadProblems(); }}>{off.syncing ? "Uploading…" : "Upload now"}</button></p>{/if}
          {#each problemSales as q (q.id)}
            <div class="rounded-xl bg-bad/10 p-2 text-sm">
              <p><b>{q.receipt ? q.receipt.number : q.id}</b> · {money(q.payload.totals.total_cents)}: the hub refused it: {q.error}</p>
              {#if can("till.manage")}<div class="mt-1 flex gap-2"><button class="underline" onclick={async () => { await retry(q.id); loadProblems(); }}>Try again</button>
                <button class="underline text-bad" onclick={async () => { if (confirm("Remove this offline sale from the till? Record it by hand.")) { await discard(q.id); loadProblems(); } }}>Remove</button></div>
              {:else}<p>A manager must look at it before the till closes.</p>{/if}
            </div>
          {/each}
        </div>
      {/if}
      <div class="card space-y-3">
        <h2 class="font-semibold">Close the till</h2>
        <p class="text-sm text-muted">Count the cash in the drawer (Canadian), and any US cash separately.</p>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {#each denoms as d (d)}<label class="block"><span class="text-sm text-muted">{label(d)}</span><input class="field" type="number" min="0" step="1" bind:value={count[d]} /></label>{/each}
        </div>
        {#if info.settings.payment_methods.includes("usd_cash")}
          <label class="block max-w-xs"><span class="text-sm text-muted">US cash counted ($ US)</span><input class="field" inputmode="decimal" bind:value={usd} /></label>
        {/if}
        <p class="font-semibold">Counted: {money(counted)}</p>
        <button class="btn" disabled={busy} onclick={closeTill}>Close till and print Z report</button>
      </div>
    {/if}

    {#if can("settings.manage")}
      {#if !sets}<button class="btn-ghost" onclick={loadSettings}>Till settings</button>
      {:else}
        <form class="card grid gap-3 sm:grid-cols-2" onsubmit={saveSettings}>
          <h2 class="font-semibold sm:col-span-2">Till settings (FR-1.12)</h2>
          <fieldset class="sm:col-span-2"><legend class="text-sm text-muted">Payment methods</legend>
            {#each ["cash", "card", "usd_cash"] as m (m)}<label class="mr-4 inline-flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-accent" value={m} bind:group={sets.methods} /> {METHOD[m]}</label>{/each}
          </fieldset>
          <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={sets.rounding} /> Round cash to 5¢</label>
          <label class="block"><span class="text-sm text-muted">CAD for 1 US dollar</span><input class="field" type="number" min="0" step="0.0001" bind:value={sets.usd} /></label>
          <label class="block"><span class="text-sm text-muted">Default float ($)</span><input class="field" inputmode="decimal" bind:value={sets.float} /></label>
          <label class="block"><span class="text-sm text-muted">Cashier discount limit (%)</span><input class="field" type="number" min="0" max="100" step="0.5" bind:value={sets.disc} /></label>
          <label class="block"><span class="text-sm text-muted">Price lowered beyond (%) needs a manager</span><input class="field" type="number" min="0" max="100" step="0.5" bind:value={sets.over} /></label>
          <div class="flex gap-2 sm:col-span-2"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (sets = null)}>Cancel</button></div>
        </form>
      {/if}
    {/if}
  {:else if !error}<p class="text-muted">Loading…</p>{/if}
</section>

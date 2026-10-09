<script>
  // Shrink and loss report (FR-6.07): damage, loss, stock taken away and count shortfalls, at cost,
  // by reason and by product, for a date range. Export to CSV (FR-11.09 for this list).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";
  import { money, qty } from "../lib/catalogue.js";

  const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  let from = $state(ymd(new Date(Date.now() - 30 * 86400000))), to = $state(ymd(new Date()));
  let r = $state(null), error = $state("");

  async function load() {
    const res = await api("GET", `/api/chedam/stock/shrink?from=${from}&to=${to}`);
    if (!res.ok) { if (!(await handleRefusal(res))) error = res.message; return; }
    error = ""; r = res.json;
  }
  onMount(load);

  function csv() {
    const rows = [["Product", "Quantity", "Value at cost"], ...r.by_product.map((p) => [p.name, p.qty_base, (p.value_cents / 100).toFixed(2)]),
      [], ["Reason", "Entries", "Value at cost"], ...r.by_reason.map((x) => [x.reason, x.entries, (x.value_cents / 100).toFixed(2)])];
    const text = rows.map((row) => row.map((c) => '"' + String(c ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
    a.download = `shrink-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("stock")}>← Stock</button>
    <h1 class="text-xl font-bold">Shrink and loss</h1>
  </div>
  <form class="card flex flex-wrap items-end gap-3" onsubmit={(e) => { e.preventDefault(); load(); }}>
    <label class="block"><span class="text-sm text-muted">From</span><input class="field" type="date" bind:value={from} /></label>
    <label class="block"><span class="text-sm text-muted">To</span><input class="field" type="date" bind:value={to} /></label>
    <button class="btn" type="submit">Show</button>
    {#if r && r.entries}<button class="btn-ghost" type="button" onclick={csv}>Export CSV</button>{/if}
  </form>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if r}
    <div class="card"><p class="text-2xl font-bold">{money(r.total_cents)} <span class="text-base font-normal text-muted">at cost · {r.entries} {r.entries === 1 ? "entry" : "entries"}</span></p></div>
    <div class="card">
      <h2 class="mb-2 font-semibold">By reason</h2>
      {#if r.by_reason.length}
        <ul class="divide-y divide-line">{#each r.by_reason as x (x.reason)}<li class="flex justify-between gap-2 py-2"><span>{x.reason} <span class="text-sm text-muted">· {x.entries}</span></span><b class="tabular-nums">{money(x.value_cents)}</b></li>{/each}</ul>
      {:else}<p class="text-muted">No losses in this period.</p>{/if}
    </div>
    {#if r.by_product.length}
      <div class="card">
        <h2 class="mb-2 font-semibold">By product</h2>
        <ul class="divide-y divide-line">{#each r.by_product as x (x.product)}<li class="flex justify-between gap-2 py-2"><span>{x.name} <span class="text-sm text-muted">· {qty(x.qty_base, x.base_unit || "each")}</span></span><b class="tabular-nums">{money(x.value_cents)}</b></li>{/each}</ul>
      </div>
    {/if}
  {/if}
</section>

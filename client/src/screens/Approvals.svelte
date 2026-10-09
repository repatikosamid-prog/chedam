<script>
  // Stock approvals (FR-6.06, 6.08, BR-18): write-offs above the store's limit and submitted counts.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";
  import { money, MOVES } from "../lib/catalogue.js";

  let p = $state(null), error = $state(""), ok = $state("");

  async function load() {
    const r = await api("GET", "/api/chedam/stock/pending");
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    p = r.json;
  }
  onMount(load);

  async function decide(m, d) {
    const r = await api("POST", `/api/chedam/stock/movements/${m.id}/${d}`, {});
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    ok = d === "approve" ? "Approved: stock updated." : "Rejected: stock unchanged.";
    load();
  }
  function when(t) { return t ? new Date(t.replace(" ", "T")).toLocaleString() : ""; }
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("stock")}>← Stock</button>
    <h1 class="text-xl font-bold">Approvals</h1>
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}
  {#if p}
    {#if !p.movements.length && !p.counts.length}<p class="card text-muted">Nothing waiting.</p>{/if}
    {#each p.movements as m (m.id)}
      <div class="card space-y-2">
        <h2 class="font-semibold">{MOVES[m.type]}: {m.unit_qty} × {m.unit_name} of {m.product_name}</h2>
        <p class="text-sm text-muted">{m.reason}{m.note ? " · " + m.note : ""}{m.value_cents !== undefined ? " · " + money(Math.abs(m.value_cents)) + " at cost" : ""} · {when(m.at)}</p>
        {#if m.photo}<img class="max-h-48 rounded-xl" alt="Photo of the damage" src={"/api/files/stock_movements/" + m.id + "/" + m.photo + "?thumb=320x320"} />{/if}
        <div class="flex gap-2">
          <button class="btn" onclick={() => decide(m, "approve")}>Approve</button>
          <button class="btn-ghost" onclick={() => decide(m, "reject")}>Reject</button>
        </div>
      </div>
    {/each}
    {#each p.counts as c (c.id)}
      <div class="card flex flex-wrap items-center justify-between gap-2">
        <span><b>Count: {c.name}</b><span class="block text-sm text-muted">Submitted {when(c.submitted_at)}</span></span>
        <button class="btn-ghost" onclick={() => go("counts")}>Review</button>
      </div>
    {/each}
  {:else if !error}<p class="text-muted">Loading…</p>{/if}
</section>

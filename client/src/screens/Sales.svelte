<script>
  // Recent sales: find by receipt number, open the receipt, reprint, void while the till is open
  // (manager, FR-3.11). Managers and the accountant also see the tax-exempt sales report (FR-4.05).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import Receipt from "../components/Receipt.svelte";
  import Approve from "../components/Approve.svelte";

  let list = $state([]), q = $state(""), sale = $state(null), error = $state(""), voiding = $state(null), exempt = $state(null);

  async function load() {
    const f = ["deleted_at=''"];
    const t = q.trim().replace(/['\\]/g, "");
    if (t) f.push(`number~'${t}'`);
    const r = await api("GET", "/api/collections/sales/records?perPage=50&sort=-completed_at&fields=id,number,completed_at,total_cents,rounding_cents,status,training&filter=" + encodeURIComponent(f.join(" && ")));
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    list = r.json.items;
  }
  onMount(load);

  async function open(id) {
    const r = await api("GET", "/api/chedam/sales/" + id);
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    sale = r.json; voiding = null; error = "";
  }

  async function doVoid(approval) {
    const r = await api("POST", "/api/chedam/sales/" + sale.id + "/void", { reason: voiding.reason, approval });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; voiding = null; return; }
    sale = r.json; voiding = null; load();
  }

  async function showExempt() {
    const r = await api("GET", "/api/chedam/sales/reports/exempt");
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    exempt = r.json;
  }

  function when(t) { return t ? new Date(t.replace(" ", "T")).toLocaleString() : ""; }
</script>

<section class="space-y-4">
  <div class="flex flex-wrap items-end justify-between gap-2">
    <div>
      <button class="mb-1 min-h-10 text-sm underline" onclick={() => (sale ? (sale = null) : go("sell"))}>← {sale ? "Sales" : "Sell"}</button>
      <h1 class="text-xl font-bold">{sale ? sale.number : "Sales"}</h1>
    </div>
    {#if !sale && can("sales.view")}<button class="btn-ghost" onclick={showExempt}>Tax-exempt report</button>{/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  {#if sale}
    <div class="flex flex-wrap gap-2 print:hidden">
      <button class="btn-ghost" onclick={() => window.print()}>Reprint</button>
      {#if sale.status === "completed" && can("sales.sell")}<button class="btn-ghost text-bad" onclick={() => (voiding = { reason: "" })}>Void sale</button>{/if}
    </div>
    {#if voiding}
      <div class="card space-y-2 border-bad print:hidden">
        <label class="block"><span class="text-sm text-muted">Reason for the void</span><input class="field" bind:value={voiding.reason} maxlength="300" /></label>
        {#if can("sales.void")}
          <button class="btn" disabled={!voiding.reason.trim()} onclick={() => doVoid(undefined)}>Void sale</button>
        {:else if voiding.reason.trim()}
          <Approve what={["Void " + sale.number]} permission="sales.void" onApproved={(a) => doVoid(a.approval)} onCancel={() => (voiding = null)} />
        {/if}
      </div>
    {/if}
    <Receipt {sale} />
  {:else if exempt}
    <div class="card">
      <h2 class="mb-2 font-semibold">Tax-exempt sales {exempt.from} to {exempt.to}: {money(exempt.total_exempt_cents)} not charged</h2>
      <ul class="divide-y divide-line text-sm">
        {#each exempt.rows as x (x.sale)}<li class="flex flex-wrap justify-between gap-2 py-2"><span>{x.number} · {x.reason} · {x.reference}</span><span>{money(x.exempt_cents)}</span></li>
        {:else}<li class="py-2 text-muted">None.</li>{/each}
      </ul>
      <button class="btn-ghost mt-2" onclick={() => (exempt = null)}>Back</button>
    </div>
  {:else}
    <form class="card flex gap-2" onsubmit={(e) => { e.preventDefault(); load(); }}>
      <label class="sr-only" for="num">Receipt number</label>
      <input id="num" class="field" bind:value={q} placeholder="Receipt number (e.g. S-000012)" autocomplete="off" />
      <button class="btn-ghost" type="submit">Find</button>
    </form>
    <div class="card">
      <ul class="divide-y divide-line">
        {#each list as x (x.id)}
          <li><button class="flex min-h-14 w-full items-center justify-between gap-2 py-2 text-left" onclick={() => open(x.id)}>
            <span><b>{x.number}</b> <span class="text-sm text-muted">{when(x.completed_at)}</span></span>
            <span class="text-right">{money(x.total_cents + x.rounding_cents)}<span class="block text-sm {x.status === 'voided' ? 'text-bad' : x.training ? 'text-warn' : 'text-muted'}">{x.status === "voided" ? "Voided" : x.training ? "Training" : "Completed"}</span></span>
          </button></li>
        {:else}<li class="py-2 text-muted">No sales yet.</li>{/each}
      </ul>
    </div>
  {/if}
</section>

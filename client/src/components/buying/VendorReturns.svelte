<script>
  // Returns to vendors (P3 step 4; FR-8.05): goods going back (the stock goes out now, at cost, as "Returned to
  // vendor"), the vendor's return number, then the credit they give; and vendor performance (FR-8.06):
  // on time, short-shipped, damaged.
  import { onMount } from "svelte";
  import { api } from "../../lib/api.js";
  import { can, handleRefusal } from "../../lib/session.svelte.js";
  import { money } from "../../lib/catalogue.js";

  let { vendors = [] } = $props();
  const manage = can("purchasing.manage");
  let items = $state([]), perf = $state([]), form = $state(null), credit = $state(null), error = $state(""), vprods = $state([]);
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  async function load() {
    const [a, b] = await Promise.all([api("GET", "/api/chedam/vendor-returns"), api("GET", "/api/chedam/vendors/performance")]);
    if (a.ok) items = a.json.items; else await fail(a);
    if (b.ok) perf = b.json.vendors;
  }
  onMount(load);
  async function pickVendor() {
    form.lines = [];
    const r = await api("GET", `/api/chedam/vendors/${form.vendor}/products`);
    vprods = r.ok ? r.json.items : [];
  }
  async function send(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/vendor-returns", { vendor: form.vendor, rma: form.rma, reason: form.reason, lines: form.lines.map((l) => ({ product: l.product, selling_unit: l.selling_unit, qty: Number(l.qty), reason: l.reason })) });
    if (!r.ok) return fail(r);
    form = null; load();
  }
  async function saveCredit(e) {
    e.preventDefault();
    const r = await api("POST", `/api/chedam/vendor-returns/${credit.id}/credit`, { amount_cents: Math.round(Number(credit.amount) * 100), party_ref: credit.ref });
    if (!r.ok) return fail(r);
    credit = null; load();
  }
  const fmt = (v) => (v === null ? "—" : v + "%");
</script>

{#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
{#if manage && !form}<div class="flex justify-end"><button class="btn min-h-10 text-sm" onclick={() => { form = { vendor: vendors[0] ? vendors[0].id : "", rma: "", reason: "", lines: [] }; pickVendor(); }}>Send goods back</button></div>{/if}
{#if form}
  <form class="card space-y-2" onsubmit={send}>
    <div class="grid gap-2 sm:grid-cols-3">
      <label class="block"><span class="text-sm text-muted">Vendor</span><select class="field" bind:value={form.vendor} onchange={pickVendor}>{#each vendors as v (v.id)}<option value={v.id}>{v.name}</option>{/each}</select></label>
      <label class="block"><span class="text-sm text-muted">Their return number (RMA)</span><input class="field" bind:value={form.rma} maxlength="60" /></label>
      <label class="block"><span class="text-sm text-muted">Why</span><input class="field" bind:value={form.reason} maxlength="200" placeholder="Damaged in transit" /></label>
    </div>
    {#each form.lines as l, i (i)}
      <div class="grid grid-cols-[1fr_5rem_1fr_auto] gap-2"><span class="text-sm">{l.name}</span><input class="field min-h-10 py-1" type="number" min="0" step="any" bind:value={l.qty} aria-label="Quantity" />
        <input class="field min-h-10 py-1" bind:value={l.reason} placeholder="Reason" aria-label="Reason" /><button type="button" class="text-bad" aria-label="Remove" onclick={() => (form.lines = form.lines.filter((_, k) => k !== i))}>✕</button></div>
    {/each}
    <div class="flex flex-wrap gap-1">{#each vprods as x (x.id)}<button type="button" class="btn-ghost min-h-8 text-sm" onclick={() => (form.lines = [...form.lines, { product: x.product, selling_unit: x.selling_unit, name: x.product_name + " · " + (x.unit_name || "base"), qty: 1, reason: "" }])}>+ {x.product_name}</button>{/each}</div>
    <p class="text-sm text-muted">The stock goes out now (at cost, "Returned to vendor"). Record their credit when it comes.</p>
    <div class="flex gap-2"><button class="btn" type="submit" disabled={!form.lines.length}>Send back</button><button class="btn-ghost" type="button" onclick={() => (form = null)}>Cancel</button></div>
  </form>
{/if}
{#each items as r (r.id)}
  <div class="card space-y-1">
    <p class="flex flex-wrap justify-between gap-2"><b>{r.number} · {r.vendor_name}{r.rma ? " · RMA " + r.rma : ""}</b><span class="text-sm {r.status === 'credited' ? 'text-ok' : 'text-warn'}">{r.status === "credited" ? "Credited" : "Waiting for their credit"} · {money(r.value_cad_cents)} at cost</span></p>
    <p class="text-sm text-muted">{r.lines.map((l) => l.qty + " × " + l.name + (l.reason ? " (" + l.reason + ")" : "")).join(" · ")}{r.reason ? " · " + r.reason : ""}</p>
    {#if r.status === "shipped" && (manage || can("finance.manage"))}
      {#if credit && credit.id === r.id}
        <form class="flex flex-wrap gap-2" onsubmit={saveCredit}><input class="field w-32" inputmode="decimal" bind:value={credit.amount} placeholder="Credit amount" aria-label="Credit amount" />
          <input class="field w-40" bind:value={credit.ref} placeholder="Their credit no." aria-label="Their credit number" /><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (credit = null)}>Cancel</button></form>
      {:else}<button class="btn-ghost min-h-10 text-sm" onclick={() => (credit = { id: r.id, amount: (r.value_cad_cents / 100).toFixed(2), ref: "" })}>Record their credit</button>{/if}
    {/if}
  </div>
{:else}<p class="text-muted">No goods sent back.</p>{/each}
<div class="card space-y-1">
  <h2 class="font-semibold">Vendor performance</h2>
  {#each perf as v (v.id)}<p class="flex flex-wrap justify-between gap-2 text-sm"><span>{v.name} · {v.orders} orders</span><span>on time {fmt(v.on_time_pct)} · short {fmt(v.short_pct)} · damaged {fmt(v.damage_pct)}</span></p>
  {:else}<p class="text-sm text-muted">Shown once orders from a vendor are received.</p>{/each}
</div>

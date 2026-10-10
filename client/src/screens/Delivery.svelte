<script>
  // Delivery-app orders, manual mode (P3 step 9; FR-8.09): type in an order from the platform's tablet
  // (platform, its order number, the items at the platform's prices): accepted (stock kept aside) → preparing →
  // picked up (a sale on this till, paid by the platform) or cancelled. Managers set each platform's prices.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";

  let data = $state({ platforms: [], items: [] }), showAll = $state(false), form = $state(null), error = $state(""), ok = $state("");
  let q = $state(""), hits = $state([]), priceTab = $state(false), price = $state({ platform: "", q: "", hits: [], unit: null, value: "" });
  const STATUS = { accepted: "Accepted", preparing: "Preparing", picked_up: "Picked up", cancelled: "Cancelled" };
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  async function load() {
    const r = await api("GET", "/api/chedam/delivery" + (showAll ? "" : "?open=1"));
    if (r.ok) data = r.json; else fail(r);
  }
  onMount(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); });

  async function find(text, set) {
    const t = text.trim().replace(/'/g, "");
    if (!t) { set([]); return; }
    const r = await api("GET", "/api/collections/selling_units/records?perPage=10&expand=product&filter=" + encodeURIComponent(`deleted_at='' && product.name~'${t}' && product.status='active'`), null, { quiet: true });
    set(r.ok ? r.json.items : []);
  }
  async function accept(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/delivery", { platform: form.platform, number: form.number, customer_name: form.name, notes: form.notes,
      lines: form.lines.map((l) => ({ product: l.product, selling_unit: l.selling_unit, qty: Number(l.qty) })) });
    if (!r.ok) return fail(r);
    ok = r.json.platform + " " + r.json.number + " accepted: " + money(r.json.total_cents) + "."; form = null; load();
  }
  async function act(o, action) {
    if (action === "cancel" && !confirm("Cancel " + o.platform + " " + o.number + "?")) return;
    const r = await api("POST", `/api/chedam/delivery/${o.id}/${action}`, {});
    if (!r.ok) return fail(r);
    if (action === "picked_up") ok = o.number + " picked up; the sale is on this till.";
    load();
  }
  async function savePrice(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/delivery/prices", { platform: price.platform, selling_unit: price.unit.id, price_cents: Math.round(Number(price.value) * 100) });
    if (!r.ok) return fail(r);
    ok = price.platform + " price saved."; price.unit = null; price.value = "";
  }
  const label = (u) => (u.expand && u.expand.product ? u.expand.product.name : "") + " · " + u.name;
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Delivery orders</h1></div>
    <div class="flex gap-2">
      {#if can("prices.edit") || can("catalogue.edit")}<button class="btn-ghost min-h-10 text-sm" onclick={() => { priceTab = !priceTab; price.platform = data.platforms[0] || ""; }}>Platform prices</button>{/if}
      <button class="btn min-h-10 text-sm" onclick={() => (form = { platform: data.platforms[0] || "", number: "", name: "", notes: "", lines: [] })}>New order</button>
    </div>
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if priceTab}
    <form class="card grid gap-2 sm:grid-cols-3" onsubmit={savePrice}>
      <label class="block"><span class="text-sm text-muted">Platform</span><select class="field" bind:value={price.platform}>{#each data.platforms as p (p)}<option value={p}>{p}</option>{/each}</select></label>
      <div class="sm:col-span-2">{#if price.unit}<p class="pt-6 font-semibold">{label(price.unit)} <span class="text-sm text-muted">(store {money(price.unit.price_cents)})</span> <button type="button" class="underline" onclick={() => (price.unit = null)}>change</button></p>
        {:else}<label class="block"><span class="text-sm text-muted">Item</span><input class="field" bind:value={price.q} oninput={() => find(price.q, (x) => (price.hits = x))} /></label>
          <div class="flex flex-wrap gap-1">{#each price.hits as u (u.id)}<button type="button" class="btn-ghost min-h-8 text-sm" onclick={() => { price.unit = u; price.hits = []; price.q = ""; }}>{label(u)}</button>{/each}</div>{/if}</div>
      <label class="block"><span class="text-sm text-muted">Price on {price.platform} ($)</span><input class="field" inputmode="decimal" bind:value={price.value} /></label>
      <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit" disabled={!price.unit}>Save</button><button class="btn-ghost" type="button" onclick={() => (priceTab = false)}>Close</button></div>
    </form>
  {/if}

  {#if form}
    <form class="card space-y-2" onsubmit={accept}>
      <div class="grid gap-2 sm:grid-cols-3">
        <label class="block"><span class="text-sm text-muted">Platform</span><select class="field" bind:value={form.platform}>{#each data.platforms as p (p)}<option value={p}>{p}</option>{/each}</select></label>
        <label class="block"><span class="text-sm text-muted">Their order number</span><input class="field" bind:value={form.number} required maxlength="40" /></label>
        <label class="block"><span class="text-sm text-muted">Customer (as shown)</span><input class="field" bind:value={form.name} maxlength="80" /></label>
      </div>
      <input class="field" bind:value={q} oninput={() => find(q, (x) => (hits = x))} placeholder="Add an item: type its name" aria-label="Add an item" />
      <div class="flex flex-wrap gap-1">{#each hits as u (u.id)}<button type="button" class="btn-ghost min-h-8 text-sm" onclick={() => { form.lines = [...form.lines, { product: u.product, selling_unit: u.id, name: label(u), qty: 1 }]; hits = []; q = ""; }}>{label(u)}</button>{/each}</div>
      {#each form.lines as l, i (i)}<div class="flex items-center gap-2"><span class="flex-1 text-sm">{l.name}</span><input class="field w-20" type="number" min="1" step="1" bind:value={l.qty} aria-label="Quantity" />
        <button type="button" class="text-bad" aria-label="Remove" onclick={() => (form.lines = form.lines.filter((_, k) => k !== i))}>✕</button></div>{/each}
      <input class="field" bind:value={form.notes} maxlength="500" placeholder="Notes (allergies, substitutions…)" aria-label="Notes" />
      <p class="text-xs text-muted">Prices are the platform's (set under Platform prices), else the store's.</p>
      <div class="flex gap-2"><button class="btn" type="submit" disabled={!form.lines.length || !form.number}>Accept the order</button><button class="btn-ghost" type="button" onclick={() => (form = null)}>Cancel</button></div>
    </form>
  {/if}

  <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={showAll} onchange={load} /> Show finished</label>
  {#each data.items as o (o.id)}
    <div class="card space-y-1 {o.status === 'accepted' ? 'border-warn' : ''}">
      <div class="flex flex-wrap justify-between gap-2"><p class="font-semibold">{o.platform} · {o.number}{o.customer_name ? " · " + o.customer_name : ""}</p><p><b>{money(o.total_cents)}</b> · {STATUS[o.status]}</p></div>
      <p class="text-sm">{o.lines.map((l) => l.qty + " × " + l.name).join(" · ")}</p>
      {#if o.notes}<p class="text-sm text-muted">{o.notes}</p>{/if}
      <div class="flex flex-wrap gap-2">
        {#if o.status === "accepted"}<button class="btn-ghost min-h-10 text-sm" onclick={() => act(o, "preparing")}>Preparing</button>{/if}
        {#if o.status === "accepted" || o.status === "preparing"}<button class="btn min-h-10 text-sm" onclick={() => act(o, "picked_up")}>Picked up (sale on this till)</button>
          <button class="btn-danger min-h-10 text-sm" onclick={() => act(o, "cancel")}>Cancel</button>{/if}
      </div>
    </div>
  {:else}<p class="text-muted">No {showAll ? "" : "open "}delivery orders.</p>{/each}
</section>

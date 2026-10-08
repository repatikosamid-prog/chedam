<script>
  // Stock counts (FR-6.08): start a count, find each product by scanning or searching, enter sealed
  // packs and loose items, see the variance, submit; a manager approves (variance applied) or cancels.
  import { onMount } from "svelte";
  import { api, apiAll } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { qty } from "../lib/catalogue.js";
  import Scanner from "../components/Scanner.svelte";

  let counts = $state([]), cur = $state(null), lines = $state([]), names = $state({});
  let error = $state(""), ok = $state(""), scanning = $state(false), newName = $state("");
  let entry = $state(null);       // { product, name, base_unit, units, loose, sealed: {} }
  let search = $state(""), found = $state([]);

  const STATUS = { open: "Open", submitted: "Waiting for approval", approved: "Approved", cancelled: "Cancelled" };

  async function load() {
    const r = await api("GET", "/api/collections/stock_counts/records?perPage=50&sort=-created_at&filter=" + encodeURIComponent("deleted_at=''"));
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    counts = r.json.items;
    if (cur) { cur = counts.find((c) => c.id === cur.id) || null; await loadLines(); }
  }
  async function loadLines() {
    if (!cur) return;
    const r = await apiAll("/api/collections/stock_count_lines/records?sort=-counted_at&filter=" + encodeURIComponent(`count='${cur.id}'`), 500);
    if (r.ok) {
      lines = r.json.items;
      const need = lines.map((l) => l.product).filter((id) => !names[id]);
      if (need.length) {
        const p = await apiAll("/api/collections/products/records?fields=id,name,base_unit&filter=" + encodeURIComponent(need.map((i) => `id='${i}'`).join(" || ")));
        if (p.ok) { const n = { ...names }; p.json.items.forEach((x) => (n[x.id] = x)); names = n; }
      }
    }
  }
  onMount(load);

  async function start(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/stock/counts", { name: newName.trim() || undefined });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    newName = "";
    await load();
    open(counts.find((c) => c.id === r.json.id));
  }

  async function open(c) { cur = c; entry = null; ok = ""; error = ""; await loadLines(); }

  async function pick(productId) {
    const r = await api("GET", "/api/chedam/stock/products/" + productId);
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    const v = r.json;
    const prev = lines.find((l) => l.product === productId);
    const sealed = {};
    v.units.filter((u) => u.kind === "pack" || u.kind === "case").forEach((u) => (sealed[u.id] = prev && prev.counted_detail ? prev.counted_detail.sealed[u.id] || 0 : ""));
    entry = { product: productId, name: v.product.name, base_unit: v.product.base_unit, units: v.units, sealed,
      loose: prev && prev.counted_detail ? prev.counted_detail.loose : "" };
    found = []; search = "";
  }

  async function onCode(code) {
    scanning = false;
    const r = await api("GET", "/api/chedam/catalogue/lookup?code=" + encodeURIComponent(code));
    if (r.ok && r.json.matches.length) pick(r.json.matches[0].product.id);
    else error = "No product with code " + code + ".";
  }

  async function find() {
    const t = search.trim().replace(/['\\]/g, "");
    if (!t) { found = []; return; }
    const r = await api("GET", "/api/collections/products/records?perPage=20&sort=name&fields=id,name&filter=" + encodeURIComponent(`deleted_at='' && status!='archived' && name~'${t}'`));
    found = r.ok ? r.json.items : [];
  }

  async function saveLine(e) {
    e.preventDefault();
    const detail = { loose: Number(entry.loose) || 0, sealed: {} };
    Object.entries(entry.sealed).forEach(([k, n]) => { if (Number(n)) detail.sealed[k] = Number(n); });
    const r = await api("POST", `/api/chedam/stock/counts/${cur.id}/lines`, { product: entry.product, detail });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    ok = entry.name + ": counted " + qty(r.json.counted_base, entry.base_unit) + ".";
    entry = null;
    loadLines();
  }

  async function act(action) {
    if (action === "approve" && !confirm("Apply the differences to stock?")) return;
    if (action === "cancel" && !confirm("Cancel this count? Nothing changes in stock.")) return;
    const r = await api("POST", `/api/chedam/stock/counts/${cur.id}/${action}`, {});
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    ok = action === "approve" ? "Approved. Stock now matches the count." : action === "submit" ? "Submitted for approval." : "Cancelled.";
    load();
  }

  const unitName = (u) => u.name;
  function variance(l) { return Math.round((l.counted_base - l.expected_base) * 1000) / 1000; }
</script>

<section class="space-y-4">
  <div>
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => (cur ? (cur = null) : go("stock"))}>← {cur ? "Counts" : "Stock"}</button>
    <h1 class="text-xl font-bold">{cur ? cur.name : "Stock counts"}</h1>
    {#if cur}<p class="text-muted">{STATUS[cur.status]}</p>{/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if !cur}
    {#if can("stock.count")}
      <form class="card flex flex-wrap gap-2" onsubmit={start}>
        <label class="sr-only" for="cname">Name of the count</label>
        <input id="cname" class="field min-w-0 flex-1" bind:value={newName} maxlength="120" placeholder="e.g. Beverages, Saturday" />
        <button class="btn" type="submit">Start a count</button>
      </form>
    {/if}
    <div class="card">
      {#if counts.length}
        <ul class="divide-y divide-line">
          {#each counts as c (c.id)}
            <li><button class="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left" onclick={() => open(c)}>
              <span class="font-semibold">{c.name}</span><span class="text-sm text-muted">{STATUS[c.status]}</span></button></li>
          {/each}
        </ul>
      {:else}<p class="text-muted">No counts yet.</p>{/if}
    </div>
  {:else}
    {#if cur.status === "open" && can("stock.count")}
      {#if scanning}
        <Scanner {onCode} onClose={() => (scanning = false)} />
      {:else if !entry}
        <div class="card space-y-2">
          <div class="flex flex-wrap gap-2">
            <button class="btn" onclick={() => (scanning = true)}>Scan a product</button>
            <label class="sr-only" for="find">Find a product</label>
            <input id="find" class="field w-full min-w-0 sm:w-auto sm:flex-1" type="search" bind:value={search} oninput={find} placeholder="…or search by name" autocomplete="off" />
          </div>
          {#each found as f (f.id)}<button class="btn-ghost w-full justify-start" onclick={() => pick(f.id)}>{f.name}</button>{/each}
        </div>
      {/if}
      {#if entry}
        <form class="card space-y-3 border-accent" onsubmit={saveLine}>
          <h2 class="font-semibold">{entry.name}</h2>
          {#each entry.units.filter((u) => u.kind === "pack" || u.kind === "case") as u (u.id)}
            <label class="block"><span class="text-sm text-muted">Sealed {unitName(u)}</span>
              <input class="field" type="number" min="0" step="1" bind:value={entry.sealed[u.id]} /></label>
          {/each}
          <label class="block"><span class="text-sm text-muted">Loose {entry.base_unit === "each" ? "items" : "(" + entry.base_unit + ")"}</span>
            <input class="field" type="number" min="0" step={entry.base_unit === "each" ? 1 : 0.001} bind:value={entry.loose} /></label>
          <div class="flex gap-2"><button class="btn" type="submit">Save count</button><button class="btn-ghost" type="button" onclick={() => (entry = null)}>Cancel</button></div>
        </form>
      {/if}
    {/if}

    <div class="card">
      <h2 class="mb-2 font-semibold">Counted ({lines.length})</h2>
      {#if lines.length}
        <ul class="divide-y divide-line text-sm">
          {#each lines as l (l.id)}
            {@const d = variance(l)}
            {@const bu = names[l.product] ? names[l.product].base_unit : "each"}
            <li class="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{names[l.product] ? names[l.product].name : "…"}</span>
              <span class="tabular-nums">{qty(l.counted_base, bu)} counted · expected {qty(l.expected_base, bu)} ·
                <b class={d < 0 ? "text-bad" : d > 0 ? "text-warn" : "text-ok"}>{d > 0 ? "+" : ""}{qty(d, bu)}</b></span>
            </li>
          {/each}
        </ul>
      {:else}<p class="text-muted">Nothing counted yet.</p>{/if}
    </div>

    <div class="flex flex-wrap gap-2">
      {#if cur.status === "open" && can("stock.count") && lines.length}<button class="btn" onclick={() => act("submit")}>Submit for approval</button>{/if}
      {#if cur.status === "submitted" && can("stock.approve")}<button class="btn" onclick={() => act("approve")}>Approve and apply</button>{/if}
      {#if (cur.status === "open" || cur.status === "submitted") && can("stock.approve")}<button class="btn-ghost" onclick={() => act("cancel")}>Cancel count</button>{/if}
    </div>
  {/if}
</section>

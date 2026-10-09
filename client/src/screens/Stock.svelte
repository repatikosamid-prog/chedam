<script>
  // Stock list (FR-6.01): every product's stock with a colour status (out, low = at or under its
  // reorder point, ok); search, filter. Entry point to receiving, counts, approvals and the shrink report.
  import ExportMenu from "../components/ExportMenu.svelte";
  import { onMount } from "svelte";
  import { api, apiAll } from "../lib/api.js";
  import { s, go, can, handleRefusal } from "../lib/session.svelte.js";
  import { qty } from "../lib/catalogue.js";

  let products = $state([]), levels = $state({}), pending = $state(0);
  let q = $state(""), show = $state("all"), error = $state(""), loading = $state(true);

  onMount(async () => {
    const [p, l] = await Promise.all([
      apiAll("/api/collections/products/records?sort=name&fields=id,name,base_unit,reorder_point,status&filter=" + encodeURIComponent("deleted_at='' && status!='archived'")),
      apiAll("/api/collections/stock_levels/records?fields=product,on_hand,loose_qty,sealed", 500),
    ]);
    loading = false;
    if (!p.ok) { if (!(await handleRefusal(p))) error = p.message; return; }
    products = p.json.items;
    if (l.ok) levels = Object.fromEntries(l.json.items.map((x) => [x.product, x]));
    if (can("stock.approve")) {
      const r = await api("GET", "/api/chedam/stock/pending");
      if (r.ok) pending = r.json.movements.length + r.json.counts.length;
    }
  });

  function status(p) {
    const on = levels[p.id] ? levels[p.id].on_hand : 0;
    if (on <= 0) return "out";
    if (p.reorder_point > 0 && on <= p.reorder_point) return "low";
    return "ok";
  }
  const LABEL = { out: "Out", low: "Low", ok: "In stock" };
  const COLOUR = { out: "bg-bad/10 text-bad", low: "bg-warn/10 text-warn", ok: "bg-ok/10 text-ok" };

  const shown = $derived(products.filter((p) => (show === "all" || status(p) === show || (show === "attention" && status(p) !== "ok"))
    && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))));

  function open(id) { s.stockProductId = id; go("stockitem"); }
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-3">
    <div>
      <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
      <h1 class="text-xl font-bold">Stock</h1>
    </div>
    <div class="flex flex-wrap gap-2">
      <ExportMenu title="Stock" rows={shown} columns={[{ key: "name", label: "Product" }, { key: "status", label: "Product status" },
        { key: "on_hand", label: "On hand", value: (p) => (levels[p.id] ? levels[p.id].on_hand : 0) }, { key: "base_unit", label: "Unit" },
        { key: "reorder_point", label: "Reorder point" }, { key: "stock", label: "Stock", value: (p) => LABEL[status(p)] }]} />
      {#if can("stock.approve")}<button class="btn-ghost" onclick={() => go("approvals")}>Approvals{pending ? " (" + pending + ")" : ""}</button>{/if}
      {#if can("costs.view")}<button class="btn-ghost" onclick={() => go("shrink")}>Shrink report</button>{/if}
      {#if can("stock.count")}<button class="btn-ghost" onclick={() => go("counts")}>Counts</button>{/if}
      {#if can("stock.receive")}<button class="btn" onclick={() => go("receive")}>Add stock</button>{/if}
    </div>
  </div>

  <div class="card grid gap-3 sm:grid-cols-[2fr_1fr]">
    <label class="block"><span class="text-sm text-muted">Search</span><input class="field" type="search" bind:value={q} autocomplete="off" /></label>
    <label class="block"><span class="text-sm text-muted">Show</span>
      <select class="field" bind:value={show}>
        <option value="all">All</option><option value="attention">Low and out</option><option value="out">Out of stock</option><option value="low">Low</option>
      </select></label>
  </div>

  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  <div class="card">
    {#if loading}<p class="text-muted">Loading…</p>
    {:else if !shown.length}<p class="text-muted">Nothing to show.</p>
    {:else}
      <ul class="divide-y divide-line">
        {#each shown as p (p.id)}
          {@const st = status(p)}
          <li>
            <button class="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left" onclick={() => open(p.id)}>
              <span class="min-w-0">
                <span class="block truncate font-semibold">{p.name}</span>
                {#if p.status === "draft"}<span class="text-sm text-warn">Draft</span>{/if}
              </span>
              <span class="flex shrink-0 items-center gap-3">
                <span class="font-semibold tabular-nums">{qty(levels[p.id] ? levels[p.id].on_hand : 0, p.base_unit)}</span>
                <span class="rounded-lg px-2 py-0.5 text-sm {COLOUR[st]}">{LABEL[st]}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

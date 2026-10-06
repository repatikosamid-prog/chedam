<script>
  // Product list (FR-5.01, 5.02): search by name, barcode or PLU; filter by category and status;
  // the default unit's price and, for people with costs.view, the margin (DL-72). Drafts show why.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { s, go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money, margin, STATUS } from "../lib/catalogue.js";

  const PAGE = 50;
  let items = $state([]), units = $state({}), cats = $state([]);
  let q = $state(""), cat = $state(""), status = $state(s.productFilter || "");
  let page = $state(1), total = $state(0), error = $state(""), loading = $state(false);
  let timer;

  const catName = (id) => (cats.find((c) => c.id === id) || {}).name || "No category";

  async function load(more = false) {
    loading = true;
    page = more ? page + 1 : 1;
    const f = ["deleted_at=''"];
    if (status) f.push(`status='${status}'`);
    else f.push("status!='archived'");
    if (cat) f.push(`category='${cat}'`);
    let ids = null;
    const term = q.trim();
    if (term) {
      // A scanned or typed code goes straight to its product.
      if (/^[0-9A-Za-z-]{4,48}$/.test(term) && /\d/.test(term)) {
        const l = await api("GET", "/api/chedam/catalogue/lookup?code=" + encodeURIComponent(term));
        if (l.ok && l.json.matches.length) ids = [...new Set(l.json.matches.map((m) => m.product.id))];
      }
      const safe = term.replace(/['\\]/g, "");
      f.push(ids ? "(" + ids.map((i) => `id='${i}'`).join(" || ") + ` || name~'${safe}')` : `(name~'${safe}' || name_fr~'${safe}')`);
    }
    const r = await api("GET", `/api/collections/products/records?perPage=${PAGE}&page=${page}&sort=name&filter=` + encodeURIComponent(f.join(" && ")));
    loading = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    error = "";
    total = r.json.totalItems;
    items = more ? [...items, ...r.json.items] : r.json.items;
    const need = r.json.items.map((p) => p.id);
    if (need.length) {
      const u = await api("GET", "/api/collections/selling_units/records?perPage=500&sort=sort&filter=" +
        encodeURIComponent("deleted_at='' && (" + need.map((i) => `product='${i}'`).join(" || ") + ")"));
      if (u.ok) {
        const next = { ...(more ? units : {}) };
        u.json.items.forEach((x) => { (next[x.product] ||= []).push(x); });
        units = next;
      }
    }
  }

  onMount(async () => {
    const c = await api("GET", "/api/collections/categories/records?perPage=500&sort=sort,name&filter=" + encodeURIComponent("deleted_at=''"));
    if (c.ok) cats = c.json.items;
    s.productFilter = "";
    load();
  });

  function typed() { clearTimeout(timer); timer = setTimeout(() => load(), 300); }

  function main(p) {
    const list = units[p.id] || [];
    return list.find((u) => u.is_default) || list.find((u) => u.sell_at_pos) || list[0];
  }

  function open(id) { s.productId = id; go("product"); }
</script>

<section class="space-y-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
      <h1 class="text-xl font-bold">Products</h1>
    </div>
    <div class="flex flex-wrap gap-2">
      {#if can("catalogue.edit")}<button class="btn-ghost" onclick={() => go("categories")}>Categories</button>{/if}
      <button class="btn-ghost" onclick={() => go("tax")}>Tax</button>
      {#if can("catalogue.edit")}<button class="btn" onclick={() => open("")}>Add product</button>{/if}
    </div>
  </div>

  <div class="card grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
    <label class="block">
      <span class="text-sm text-muted">Search name, barcode or PLU</span>
      <input class="field" type="search" bind:value={q} oninput={typed} autocomplete="off" />
    </label>
    <label class="block">
      <span class="text-sm text-muted">Category</span>
      <select class="field" bind:value={cat} onchange={() => load()}>
        <option value="">All</option>
        {#each cats as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </label>
    <label class="block">
      <span class="text-sm text-muted">Status</span>
      <select class="field" bind:value={status} onchange={() => load()}>
        <option value="">Active and drafts</option>
        <option value="active">Active</option>
        <option value="draft">Drafts</option>
        <option value="archived">Archived</option>
      </select>
    </label>
  </div>

  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  <div class="card">
    <p class="mb-2 text-sm text-muted">{total} {total === 1 ? "product" : "products"}</p>
    {#if items.length}
      <ul class="divide-y divide-line">
        {#each items as p (p.id)}
          {@const u = main(p)}
          {@const m = u && p.cost_cents !== undefined ? margin(u.price_cents, p.cost_cents * (u.base_qty || 1)) : null}
          <li>
            <button class="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left" onclick={() => open(p.id)}>
              <span class="min-w-0">
                <span class="block truncate font-semibold">{p.name}</span>
                <span class="block truncate text-sm text-muted">
                  {catName(p.category)}{u ? " · " + u.name : ""}{p.plu ? " · PLU " + p.plu : ""}
                  {#if p.status === "draft" && p.draft_reasons && p.draft_reasons.length} · <span class="text-warn">{p.draft_reasons[0].message}</span>{/if}
                </span>
              </span>
              <span class="shrink-0 text-right">
                <span class="block font-semibold">{u && u.price_cents ? money(u.price_cents) + (u.kind === "weight" ? "/" + p.base_unit : "") : "—"}</span>
                <span class="block text-sm {p.status === 'active' ? 'text-ok' : p.status === 'draft' ? 'text-warn' : 'text-muted'}">
                  {STATUS[p.status]}{m ? " · " + m.margin.toFixed(0) + "%" : ""}
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if items.length < total}
        <button class="btn-ghost mt-3 w-full" disabled={loading} onclick={() => load(true)}>{loading ? "Loading…" : "Show more"}</button>
      {/if}
    {:else if !loading}
      <p class="text-muted">No products found.</p>
    {/if}
  </div>
</section>

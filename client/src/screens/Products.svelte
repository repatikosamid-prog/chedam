<script>
  // Product list (FR-5.01, 5.02): search by name, barcode or PLU; filter by category and status;
  // the default unit's price and, for people with costs.view, the margin (DL-72). Drafts show why.
  // T3: brand; the "Below zero" tab lists products whose stock went below zero, to count and correct (printable).
  import ExportMenu from "../components/ExportMenu.svelte";
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
      f.push(ids ? "(" + ids.map((i) => `id='${i}'`).join(" || ") + ` || name~'${safe}')` : `(name~'${safe}' || name_fr~'${safe}' || brand~'${safe}')`);
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

  // ---- Below zero (T3): stock levels under 0, with the product, its code and a column to write the count in
  let tab = $state("all"), neg = $state([]), negLoading = $state(false);
  async function loadNeg() {
    negLoading = true;
    const r = await api("GET", "/api/collections/stock_levels/records?perPage=500&sort=on_hand&expand=product&filter=" + encodeURIComponent("on_hand < 0 && deleted_at=''"));
    negLoading = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    const pids = r.json.items.map((x) => x.product);
    let codes = {};
    if (pids.length) {
      const u = await api("GET", "/api/collections/selling_units/records?perPage=500&filter=" + encodeURIComponent("deleted_at='' && (" + pids.map((i) => `product='${i}'`).join(" || ") + ")"));
      if (u.ok) u.json.items.forEach((x) => { if (!codes[x.product] && (x.barcodes || []).length) codes[x.product] = x.barcodes[0]; });
    }
    neg = r.json.items.map((x) => { const pr = (x.expand && x.expand.product) || {}; return { id: x.product, name: pr.name || "(removed product)", brand: pr.brand || "", plu: pr.plu || "",
      category: catName(pr.category), unit: pr.base_unit || "", code: codes[x.product] || pr.plu || "", on_hand: Math.round(x.on_hand * 1000) / 1000 }; });
  }
  const today = new Date().toLocaleDateString();
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-3">
    <div>
      <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
      <h1 class="text-xl font-bold">Products</h1>
    </div>
    <div class="flex flex-wrap gap-2">
      <ExportMenu title="Products" rows={items} columns={[{ key: "name", label: "Name" }, { key: "category", label: "Category", value: (p) => catName(p.category) },
        { key: "status", label: "Status" }, { key: "unit", label: "Unit", value: (p) => (main(p) || {}).name || "" },
        { key: "price", label: "Price", value: (p) => (main(p) ? (main(p).price_cents / 100).toFixed(2) : "") },
        { key: "barcode", label: "Barcode", value: (p) => ((main(p) || {}).barcodes || [])[0] || "" }, { key: "plu", label: "PLU" },
        ...(can("costs.view") ? [{ key: "cost", label: "Cost (per base unit)", value: (p) => (p.cost_cents !== undefined ? (p.cost_cents / 100).toFixed(2) : "") }] : [])]} />
      {#if can("catalogue.edit")}<button class="btn-ghost" onclick={() => go("categories")}>Categories</button>{/if}
      <button class="btn-ghost" onclick={() => go("tax")}>Tax</button>
      {#if can("catalogue.edit")}<button class="btn" onclick={() => open("")}>Add product</button>{/if}
    </div>
  </div>

  <div class="flex flex-wrap gap-2 print:hidden">{#each [["all", "All products"], ["negative", "Below zero (to count)"]] as [k, l] (k)}<button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; if (k === "negative") loadNeg(); }}>{l}</button>{/each}</div>

  {#if tab === "negative"}
    <div class="card space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p class="text-sm text-muted">Products sold beyond their stock. Count them on the shelf, then correct the stock (Stock → Count or Receive).</p>
        <div class="flex gap-2"><ExportMenu title="Below zero" rows={neg} columns={[{ key: "name", label: "Product" }, { key: "brand", label: "Brand" }, { key: "code", label: "Barcode / PLU" }, { key: "category", label: "Category" }, { key: "on_hand", label: "In Chedam" }, { key: "counted", label: "Counted", value: () => "" }]} />
          <button class="btn min-h-10" disabled={!neg.length} onclick={() => window.print()}>Print for counting</button></div>
      </div>
      <h2 class="hidden font-bold print:block">Stock check: products below zero · {today}</h2>
      {#if negLoading}<p class="text-muted">Loading…</p>
      {:else if neg.length}
        <table class="w-full text-sm">
          <thead><tr class="text-left"><th class="py-1">Product</th><th>Barcode / PLU</th><th>Category</th><th class="text-right">In Chedam</th><th class="w-24 text-right">Counted</th></tr></thead>
          <tbody>{#each neg as x (x.id)}<tr class="border-t border-line"><td class="py-2"><button class="text-left underline print:no-underline" onclick={() => open(x.id)}>{x.name}</button>{x.brand ? " · " + x.brand : ""}</td>
            <td class="font-mono">{x.code}</td><td>{x.category}</td><td class="text-right font-semibold text-bad">{x.on_hand} {x.unit}</td><td class="border-b border-line"></td></tr>{/each}</tbody>
        </table>
        <p class="hidden pt-4 text-sm print:block">Counted by: ______________________   Date: ____________</p>
      {:else}<p class="text-ok">No product is below zero.</p>{/if}
    </div>
  {:else}
  <div class="card grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
    <label class="block">
      <span class="text-sm text-muted">Search name, brand, barcode or PLU</span>
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
                  {p.brand ? p.brand + " · " : ""}{catName(p.category)}{u ? " · " + u.name : ""}{p.plu ? " · PLU " + p.plu : ""}
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
  {/if}
</section>

<script>
  // Product form (FR-5.01-5.03, 5.05, BR-07): product details, selling units (single, packs, cases,
  // by weight; nested), barcodes, tax class, what keeps it a Draft, price history. Saved with its units
  // in one request (POST /api/chedam/catalogue/products). Costs and margins only with costs.view
  // (DL-72); making it active or changing a live price only with prices.edit (DL-67). Read-only
  // without catalogue.edit. Camera scanning arrives with P1 step 2 (DL-63).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { s, go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money, toCents, toDollars, margin, newId, baseQty, splitCodes, KINDS, BASE_UNITS, STATUS } from "../lib/catalogue.js";

  const edit = can("catalogue.edit");
  const showCost = can("costs.view");
  const mayPrice = can("prices.edit");
  const isNew = !s.productId;
  const fromReceive = s.returnTo === "receive";

  let p = $state({ name: "", name_fr: "", category: "", base_unit: "each", tax_class: "", plu: "", pos_button: false,
    reorder_point: 0, description: "", tare: 0, scale_code: "", scale_ack: false, perishable: false, shelf_life_days: 0,
    expiry_at_receiving: false, storage_area: "", age_restricted: false, min_age: 19, deposits_fees: [], imported: false,
    hs_code: "", origin_country: "", non_returnable: false, size_qty: 0, size_unit: "", status: "draft" });
  let costText = $state("");
  let units = $state([]);          // { id, saved, name, kind, contains_qty, contains_unit, codes, priceText, sell_at_pos, is_default }
  let removed = $state([]);        // ids of saved units to remove
  let problems = $state([]), history = $state([]), taxes = $state([]);
  let cats = $state([]), classes = $state([]), areas = $state([]), fees = $state([]), mods = $state({});
  let error = $state(""), ok = $state(""), busy = $state(false), loaded = $state(false);

  const byWeight = $derived(p.base_unit === "kg" || p.base_unit === "lb");
  const hasSavedUnits = $derived(units.some((u) => u.saved));
  const cost = $derived(toCents(costText));

  function unitFrom(u) {
    return { id: u.id, saved: true, name: u.name, kind: u.kind, contains_qty: u.contains_qty || "", contains_unit: u.contains_unit || "",
      codes: (u.barcodes || []).join(" "), priceText: u.price_cents ? toDollars(u.price_cents) : "", oldPrice: u.price_cents, sell_at_pos: u.sell_at_pos, is_default: u.is_default };
  }

  function blankUnit(kind) {
    const single = units.find((u) => u.kind === "single" || u.kind === "weight");
    return { id: newId(), saved: false, name: kind === "weight" ? "per " + p.base_unit : kind === "single" ? "Single" : kind === "pack" ? "Pack" : "Case",
      kind, contains_qty: kind === "pack" || kind === "case" ? "" : "", contains_unit: (kind === "pack" || kind === "case") && single ? single.id : "",
      codes: "", priceText: "", oldPrice: 0, sell_at_pos: true, is_default: !units.length };
  }

  async function loadProduct() {
    const r = await api("GET", "/api/chedam/catalogue/products/" + s.productId);
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    show(r.json);
  }

  function show(v) {
    Object.keys(p).forEach((k) => { if (v.product[k] !== undefined) p[k] = v.product[k]; });
    costText = v.product.cost_cents ? toDollars(v.product.cost_cents) : "";
    units = v.units.map(unitFrom);
    removed = [];
    problems = v.problems;
    history = v.price_history;
    taxes = v.taxes;
  }

  onMount(async () => {
    const list = (col, extra = "") => api("GET", `/api/collections/${col}/records?perPage=500${extra}&filter=` + encodeURIComponent("deleted_at=''"));
    const [c, t, a, f, m] = await Promise.all([list("categories", "&sort=sort,name"), list("tax_classes", "&sort=sort"),
      list("storage_areas", "&sort=sort"), list("deposits_fees"), api("GET", "/api/collections/modules/records?perPage=100")]);
    if (c.ok) cats = c.json.items;
    if (t.ok) classes = t.json.items;
    if (a.ok) areas = a.json.items.filter((x) => x.active !== false);
    if (f.ok) fees = f.json.items.filter((x) => x.active);
    if (m.ok) mods = Object.fromEntries(m.json.items.map((x) => [x.module, x.enabled]));
    if (isNew) {
      const std = classes.find((x) => x.code === "standard");
      if (std) p.tax_class = std.id;
      units = [blankUnit("single")];
      // From "Add stock": an unknown barcode starts a new product with it filled in.
      if (s.newBarcode) { units[0].codes = s.newBarcode; s.newBarcode = ""; }
    } else {
      await loadProduct();
    }
    loaded = true;
  });

  function setBase(v) {
    p.base_unit = v;
    // A new product switches its only unit between "Single" and "per kg/lb".
    if (!hasSavedUnits) units = units.map((u) => (u.kind === "single" || u.kind === "weight")
      ? { ...u, kind: v === "each" ? "single" : "weight", name: v === "each" ? "Single" : "per " + v } : u);
  }

  function addUnit(kind) { units = [...units, blankUnit(kind)]; }

  function removeUnit(u) {
    if (units.some((o) => o.contains_unit === u.id)) { error = "Another unit contains '" + u.name + "'. Change that one first."; return; }
    if (u.saved) removed = [...removed, u.id];
    units = units.filter((x) => x !== u);
    if (!units.some((x) => x.is_default) && units[0]) units[0].is_default = true;
  }

  function setDefault(u) { units.forEach((x) => (x.is_default = x === u)); }

  function unitCost(u) {
    if (cost == null || isNaN(cost)) return null;
    const q = baseQty(u, units);
    return isNaN(q) ? null : Math.round(cost * q);
  }

  async function save(activate) {
    error = ""; ok = "";
    if (!p.name.trim()) { error = "Enter a name."; return; }
    if (showCost && isNaN(cost)) { error = "The cost is not a valid amount."; return; }
    for (const u of units) {
      const c = toCents(u.priceText);
      if (c !== null && isNaN(c)) { error = "The price of '" + u.name + "' is not a valid amount."; return; }
    }
    const body = { product: { ...p }, units: [], activate: !!activate };
    delete body.product.status;
    if (!isNew) body.product.id = s.productId;
    if (showCost) body.product.cost_cents = cost ?? 0;
    body.product.min_age = p.age_restricted ? Number(p.min_age) || 0 : 0;
    ["reorder_point", "tare", "shelf_life_days", "size_qty"].forEach((k) => (body.product[k] = Number(body.product[k]) || 0));
    if (!body.product.size_qty) body.product.size_unit = "";
    units.forEach((u, i) => body.units.push({ id: u.id, name: u.name, kind: u.kind,
      contains_qty: u.kind === "pack" || u.kind === "case" ? Number(u.contains_qty) || 0 : 0,
      contains_unit: u.kind === "pack" || u.kind === "case" ? u.contains_unit : "",
      barcodes: splitCodes(u.codes), price_cents: toCents(u.priceText) ?? 0, sell_at_pos: u.sell_at_pos, is_default: u.is_default, sort: i + 1 }));
    removed.forEach((id) => body.units.push({ id, deleted: true }));
    busy = true;
    const r = await api("POST", "/api/chedam/catalogue/products", body, { timeout: 15000 });
    busy = false;
    if (!r.ok) {
      if (await handleRefusal(r)) return;
      error = r.message;
      if (r.json && r.json.data && Array.isArray(r.json.data.problems)) problems = r.json.data.problems;
      return;
    }
    s.productId = r.json.product.id;
    show(r.json);
    ok = r.json.product.status === "active" ? "Saved. The product can be sold." : "Saved as a Draft.";
  }

  async function setStatus(status) {
    if (status === "archived" && !confirm("Archive '" + p.name + "'? It can no longer be sold; its history is kept.")) return;
    const r = await api("PATCH", "/api/collections/products/records/" + s.productId, { status });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    await loadProduct();
    ok = status === "archived" ? "Archived." : "Active again.";
  }

  const unitName = (id) => (units.find((u) => u.id === id) || {}).name || "a removed unit";
  function when(t) { return t ? new Date(t.replace(" ", "T")).toLocaleString() : ""; }
  function pct(n) { return n == null ? "" : n.toFixed(1) + "%"; }
  // What the chosen class charges (as saved; a changed class shows after saving).
  const taxLine = $derived.by(() => {
    if (isNew) return "";
    if (taxes.length) return taxes.map((x) => x.label + " " + x.rate + "%").join(" + ");
    const c = classes.find((x) => x.id === p.tax_class);
    return c && c.treatment === "zero_rated" ? "0% (zero-rated)" : c && c.treatment === "exempt" ? "No tax (exempt)" : "";
  });
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => { const to = s.returnTo || "products"; s.returnTo = ""; go(to); }}>← {s.returnTo === "receive" ? "Add stock" : "Products"}</button>
    <h1 class="text-xl font-bold">{isNew ? "New product" : p.name || "Product"}
      {#if !isNew}<span class="ml-2 rounded-lg px-2 py-0.5 text-sm align-middle {p.status === 'active' ? 'bg-ok/10 text-ok' : p.status === 'draft' ? 'bg-warn/10 text-warn' : 'bg-soft text-muted'}">{STATUS[p.status]}</span>{/if}
    </h1>
  </div>

  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if problems.length && p.status !== "active"}
    <div class="card border-warn">
      <h2 class="mb-1 font-semibold text-warn">Before it can be sold</h2>
      <ul class="list-disc pl-5">{#each problems as x, i (i)}<li>{x.message}</li>{/each}</ul>
    </div>
  {/if}

  {#if loaded}
  <fieldset disabled={!edit || busy} class="space-y-4">
    <div class="card grid gap-3 sm:grid-cols-2">
      <label class="block sm:col-span-2"><span class="text-sm text-muted">Name</span>
        <input class="field" bind:value={p.name} maxlength="160" required /></label>
      <label class="block"><span class="text-sm text-muted">French name (labels, optional)</span>
        <input class="field" bind:value={p.name_fr} maxlength="160" /></label>
      {#if p.base_unit === "each"}
        <div class="block"><span class="text-sm text-muted">Size of one (for the unit price on labels, optional)</span>
          <div class="flex gap-2"><input class="field" type="number" min="0" step="any" bind:value={p.size_qty} aria-label="Size" placeholder="e.g. 200" />
            <select class="field max-w-28" bind:value={p.size_unit} aria-label="Size unit"><option value="">—</option><option value="g">g</option><option value="kg">kg</option><option value="ml">mL</option><option value="l">L</option><option value="each">items</option></select></div></div>
      {/if}
      <label class="block"><span class="text-sm text-muted">Category</span>
        <select class="field" bind:value={p.category}>
          <option value="">Choose…</option>
          {#each cats as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select></label>
      <label class="block"><span class="text-sm text-muted">Sold</span>
        <select class="field" value={p.base_unit} disabled={hasSavedUnits} onchange={(e) => setBase(e.currentTarget.value)}>
          {#each Object.entries(BASE_UNITS) as [k, v] (k)}
            {#if k === "each" || mods.weighed_goods || p.base_unit === k}<option value={k}>{v}</option>{/if}
          {/each}
        </select>
        {#if hasSavedUnits}<span class="text-xs text-muted">Fixed once the product has saved units.</span>{/if}</label>
      <label class="block"><span class="text-sm text-muted">Tax class</span>
        <select class="field" bind:value={p.tax_class}>
          <option value="">Choose…</option>
          {#each classes as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
        {#if taxLine}<span class="text-xs text-muted">Charges now: {taxLine}{taxes.some((x) => x.pending_review) ? " (pending accountant review)" : ""}</span>{/if}</label>
      {#if showCost}
        <label class="block"><span class="text-sm text-muted">Cost per {p.base_unit === "each" ? "item" : p.base_unit} ($, before tax)</span>
          <input class="field" inputmode="decimal" bind:value={costText} placeholder="0.00" /></label>
      {/if}
      <label class="block"><span class="text-sm text-muted">PLU (produce code, optional)</span>
        <input class="field" inputmode="numeric" bind:value={p.plu} maxlength="6" /></label>
      <label class="block"><span class="text-sm text-muted">Reorder when stock falls to</span>
        <input class="field" type="number" min="0" step="any" bind:value={p.reorder_point} /></label>
      <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={p.pos_button} />
        <span>Button on the till (items without a barcode)</span></label>
      <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={p.non_returnable} />
        <span>Cannot be returned</span></label>
    </div>

    <!-- Selling units (FR-5.03) -->
    <div class="card space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">How it is sold</h2>
        {#if edit}
          <div class="flex flex-wrap gap-2">
            {#if p.base_unit === "each"}<button type="button" class="btn-ghost min-h-10 text-sm" onclick={() => addUnit("single")}>+ Single</button>
            {:else}<button type="button" class="btn-ghost min-h-10 text-sm" onclick={() => addUnit("weight")}>+ By weight</button>{/if}
            <button type="button" class="btn-ghost min-h-10 text-sm" onclick={() => addUnit("pack")}>+ Pack</button>
            <button type="button" class="btn-ghost min-h-10 text-sm" onclick={() => addUnit("case")}>+ Case</button>
          </div>
        {/if}
      </div>
      {#if !units.length}<p class="text-muted">No selling units yet.</p>{/if}
      {#each units as u (u.id)}
        {@const price = toCents(u.priceText)}
        {@const uc = showCost ? unitCost(u) : null}
        {@const m = showCost && price ? margin(price, uc) : null}
        {@const q = baseQty(u, units)}
        <div class="space-y-2 rounded-xl border border-line p-3">
          <div class="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
            <label class="block"><span class="text-sm text-muted">Name</span><input class="field" bind:value={u.name} maxlength="80" /></label>
            <label class="block"><span class="text-sm text-muted">Kind</span>
              <select class="field" bind:value={u.kind} disabled={u.saved}>
                {#each Object.entries(KINDS) as [k, v] (k)}
                  {#if (k === "single" && p.base_unit === "each") || (k === "weight" && p.base_unit !== "each") || k === "pack" || k === "case" || u.kind === k}<option value={k}>{v}</option>{/if}
                {/each}
              </select></label>
            <label class="block"><span class="text-sm text-muted">Price ($){u.kind === "weight" ? " per " + p.base_unit : ""}</span>
              <input class="field" inputmode="decimal" bind:value={u.priceText} placeholder="0.00"
                disabled={p.status === "active" && u.saved && !mayPrice} /></label>
          </div>
          {#if u.kind === "pack" || u.kind === "case"}
            <div class="grid gap-2 sm:grid-cols-2">
              <label class="block"><span class="text-sm text-muted">Contains how many</span>
                <input class="field" type="number" min="0" step={p.base_unit === "each" ? 1 : 0.001} bind:value={u.contains_qty} /></label>
              <label class="block"><span class="text-sm text-muted">Of</span>
                <select class="field" bind:value={u.contains_unit}>
                  <option value="">{p.base_unit === "each" ? "single items" : p.base_unit}</option>
                  {#each units.filter((o) => o.id !== u.id && o.contains_unit !== u.id) as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
                </select></label>
            </div>
            <p class="text-sm text-muted">= {isNaN(q) ? "?" : q} {p.base_unit === "each" ? (q === 1 ? "item" : "items") : p.base_unit}</p>
          {/if}
          <label class="block"><span class="text-sm text-muted">Barcodes (scan or type; several separated by spaces)</span>
            <input class="field" bind:value={u.codes} autocomplete="off" /></label>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap gap-4">
              <label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={u.sell_at_pos} /> Sold at the till</label>
              <label class="flex min-h-10 items-center gap-2"><input type="radio" name="default-unit" class="h-5 w-5 accent-accent" checked={u.is_default} onchange={() => setDefault(u)} /> Main unit</label>
            </div>
            {#if edit}<button type="button" class="min-h-10 px-2 text-sm text-bad underline" onclick={() => removeUnit(u)}>Remove</button>{/if}
          </div>
          {#if m}
            <p class="text-sm {m.below ? 'text-bad' : 'text-muted'}">Cost {money(uc)} · margin {pct(m.margin)}{m.markup != null ? " · markup " + pct(m.markup) : ""}{m.below ? " · below cost!" : ""}</p>
          {/if}
          {#if price && price > 0 && u.kind !== "single" && u.kind !== "weight" && q > 0}
            <p class="text-xs text-muted">{money(Math.round(price / q))} per {p.base_unit === "each" ? "item" : p.base_unit}</p>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Type-specific details (BR-07) -->
    {#if byWeight}
      <div class="card grid gap-3 sm:grid-cols-2">
        <h2 class="font-semibold sm:col-span-2">Weighed item</h2>
        <label class="block"><span class="text-sm text-muted">Scale code (if not the PLU)</span><input class="field" bind:value={p.scale_code} maxlength="10" /></label>
        <label class="block"><span class="text-sm text-muted">Tare ({p.base_unit}, container weight)</span><input class="field" type="number" min="0" step="0.001" bind:value={p.tare} /></label>
        <label class="flex min-h-12 items-center gap-3 sm:col-span-2"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={p.scale_ack} />
          <span>Weighed on a Measurement Canada approved scale</span></label>
      </div>
    {/if}

    <div class="card grid gap-3 sm:grid-cols-2">
      <label class="flex min-h-12 items-center gap-3 sm:col-span-2"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={p.perishable} />
        <span class="font-semibold">Perishable (has an expiry)</span></label>
      {#if p.perishable}
        <label class="block"><span class="text-sm text-muted">Shelf life (days)</span>
          <input class="field" type="number" min="0" step="1" bind:value={p.shelf_life_days} disabled={p.expiry_at_receiving} /></label>
        <label class="block"><span class="text-sm text-muted">Storage area</span>
          <select class="field" bind:value={p.storage_area}>
            <option value="">Choose…</option>
            {#each areas as a (a.id)}<option value={a.id}>{a.name}{a.temp_min_c != null && a.temp_max_c != null && (a.temp_min_c || a.temp_max_c) ? ` (${a.temp_min_c} to ${a.temp_max_c} °C)` : ""}</option>{/each}
          </select></label>
        <label class="flex min-h-12 items-center gap-3 sm:col-span-2"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={p.expiry_at_receiving} />
          <span>Expiry date entered for each delivery instead</span></label>
      {/if}
    </div>

    {#if mods.regulated_items || p.age_restricted || p.deposits_fees.length}
      <div class="card grid gap-3 sm:grid-cols-2">
        <h2 class="font-semibold sm:col-span-2">Regulated</h2>
        <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={p.age_restricted} />
          <span>Age-restricted (ID check at the till)</span></label>
        {#if p.age_restricted}
          <label class="block"><span class="text-sm text-muted">Minimum age</span><input class="field" type="number" min="1" max="99" bind:value={p.min_age} /></label>
        {/if}
        {#if fees.length}
          <fieldset class="sm:col-span-2">
            <legend class="text-sm text-muted">Deposits and fees (per {p.base_unit === "each" ? "item" : p.base_unit})</legend>
            {#each fees as f (f.id)}
              <label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" value={f.id} bind:group={p.deposits_fees} />
                {f.name} · {money(f.amount_cents)}</label>
            {/each}
          </fieldset>
        {/if}
      </div>
    {/if}

    <div class="card grid gap-3 sm:grid-cols-2">
      <label class="flex min-h-12 items-center gap-3 sm:col-span-2"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={p.imported} />
        <span class="font-semibold">Imported by the store</span></label>
      {#if p.imported}
        <label class="block"><span class="text-sm text-muted">HS code</span><input class="field" inputmode="numeric" bind:value={p.hs_code} maxlength="14" /></label>
        <label class="block"><span class="text-sm text-muted">Country of origin (2 letters, e.g. IN)</span>
          <input class="field uppercase" bind:value={p.origin_country} maxlength="2" oninput={(e) => (p.origin_country = e.currentTarget.value.toUpperCase())} /></label>
      {/if}
      <label class="block sm:col-span-2"><span class="text-sm text-muted">Notes</span><textarea class="field" rows="2" bind:value={p.description} maxlength="1000"></textarea></label>
    </div>
  </fieldset>

  {#if edit}
    <div class="flex flex-wrap gap-2">
      {#if p.status === "active"}
        <button class="btn" disabled={busy} onclick={() => save(false)}>{busy ? "Saving…" : "Save"}</button>
      {:else if p.status === "draft"}
        {#if mayPrice}<button class="btn" disabled={busy} onclick={() => save(true)}>{busy ? "Saving…" : "Save and make active"}</button>{/if}
        <button class={mayPrice ? "btn-ghost" : "btn"} disabled={busy} onclick={() => save(false)}>Save as draft</button>
      {/if}
      {#if !isNew && p.status === "active"}<button class="btn-ghost" disabled={busy} onclick={() => setStatus("archived")}>Archive</button>{/if}
      {#if !isNew && !fromReceive}<button class="btn-ghost" onclick={() => { s.stockProductId = s.productId; go("stockitem"); }}>Stock</button>{/if}
      {#if s.returnTo === "receive" && s.productId}
        <button class="btn-ghost" onclick={() => { s.receiveProduct = s.productId; s.returnTo = ""; go("receive"); }}>Add it to the delivery</button>
      {/if}
      {#if !isNew && p.status === "archived" && mayPrice}<button class="btn-ghost" disabled={busy} onclick={() => setStatus("active")}>Make active again</button>{/if}
    </div>
    {#if p.status !== "active" && !mayPrice}<p class="text-sm text-muted">A manager makes new products active (sets them on sale).</p>{/if}
  {/if}

  {#if history.length}
    <details class="card">
      <summary class="min-h-10 cursor-pointer font-semibold">Price history</summary>
      <ul class="mt-2 divide-y divide-line text-sm">
        {#each history as h, i (i)}
          <li class="flex flex-wrap justify-between gap-2 py-2">
            <span>{h.field === "cost" ? "Cost" : "Price of " + unitName(h.selling_unit)}: {money(h.old_cents)} → {money(h.new_cents)}</span>
            <span class="text-muted">{when(h.at)}</span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
  {:else}
    <p class="text-muted">Loading…</p>
  {/if}
</section>

<script>
  // Buying (P3 steps 2-4). Vendor prices (FR-8.02): what each vendor sells us (their code, the unit it comes
  // in, cost and currency, minimum, lead time, preferred), importing a vendor's price list (CSV/Excel, matched
  // by their code then barcode), comparing vendors for a product (CAD per base unit), and products whose
  // preferred vendor is not the cheapest. Purchase orders and bills arrive as their own tabs (steps 3-4).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import { readBytes, headerRow } from "../lib/import/read.js";
  import ExportMenu from "../components/ExportMenu.svelte";
  import Orders from "../components/buying/Orders.svelte";
  import Bills from "../components/buying/Bills.svelte";

  const manage = can("purchasing.manage");
  const tabs = [["orders", "Purchase orders"], ["bills", "Bills and invoices"], ["prices", "Vendor prices"], ["compare", "Compare vendors"], ["better", "Better prices"]];
  let tab = $state(location.hash === "#buying-bills" ? "bills" : "prices"), error = $state("");
  let vendors = $state([]), vendor = $state(""), items = $state([]), edit = $state(null), units = $state([]);
  let pq = $state(""), hits = $state([]), cmp = $state(null), cmpName = $state("");
  let better = $state([]), imp = $state(null), impResult = $state(null);

  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const cur = (c, code) => (code && code !== "CAD" ? (c / 100).toFixed(2) + " " + code : money(c));

  async function load() {
    error = "";
    if (!vendors.length) {
      const r = await api("GET", "/api/collections/parties/records?perPage=200&sort=name&filter=" + encodeURIComponent("deleted_at='' && (kind='vendor' || kind='both')"));
      if (r.ok) { vendors = r.json.items; if (!vendor && vendors.length) vendor = vendors[0].id; } else return fail(r);
    }
    if (tab === "prices" && vendor) { const r = await api("GET", `/api/chedam/vendors/${vendor}/products`); if (r.ok) items = r.json.items; else await fail(r); }
    if (tab === "better") { const r = await api("GET", "/api/chedam/purchasing/better"); if (r.ok) better = r.json.items; else await fail(r); }
  }
  onMount(load);

  async function findProducts() {
    const q = pq.trim().replace(/'/g, "");
    if (!q) { hits = []; return; }
    const r = await api("GET", "/api/collections/products/records?perPage=10&fields=id,name&filter=" + encodeURIComponent(`deleted_at='' && name~'${q}'`));
    hits = r.ok ? r.json.items : [];
  }
  async function compare(p) {
    cmpName = p.name; hits = []; pq = p.name;
    const r = await api("GET", `/api/chedam/products/${p.id}/vendors`);
    if (r.ok) cmp = r.json; else fail(r);
  }
  async function startEdit(x) {
    edit = x ? { ...x, cost: (x.cost_cents / 100).toFixed(2) } : { id: "", product: "", product_name: "", selling_unit: "", vendor_sku: "", description: "", cost: "", min_order_qty: 1, lead_days: 2, preferred: false, active: true };
    units = [];
    if (edit.product) loadUnits(edit.product);
  }
  async function loadUnits(pid) {
    const r = await api("GET", "/api/collections/selling_units/records?perPage=50&sort=sort&filter=" + encodeURIComponent(`product='${pid}' && deleted_at=''`));
    units = r.ok ? r.json.items : [];
  }
  async function pickProduct(p) { edit.product = p.id; edit.product_name = p.name; hits = []; pq = ""; await loadUnits(p.id); if (units.length && !edit.selling_unit) edit.selling_unit = units[units.length - 1].id; }
  async function saveVP(e) {
    e.preventDefault();
    const body = { vendor, product: edit.product, selling_unit: edit.selling_unit, vendor_sku: edit.vendor_sku, description: edit.description, cost_cents: Math.round(Number(edit.cost) * 100),
      min_order_qty: Number(edit.min_order_qty) || 0, lead_days: Number(edit.lead_days) || 0, preferred: edit.preferred, active: edit.active };
    const r = edit.id ? await api("PATCH", "/api/collections/vendor_products/records/" + edit.id, body) : await api("POST", "/api/collections/vendor_products/records", body);
    if (!r.ok) return fail(r);
    edit = null; load();
  }

  // Price list: read the file here; columns guessed from their names
  const GUESS = { vendor_sku: /^(vendor.?)?(sku|code|item.?(no|number|#)|article|product.?code)$/i, barcode: /^(barcode|upc|ean|gtin)$/i, description: /^(description|name|item|product)$/i,
    cost: /^(cost|price|unit.?(cost|price)|net|case.?(cost|price))$/i, min_order_qty: /^(min|minimum|moq|min.?order)/i, lead_days: /^lead/i };
  async function readList(file) {
    impResult = null;
    if (!file) return;
    const t = (await readBytes(file.name, new Uint8Array(await file.arrayBuffer()))).tables[0];
    if (!t || !t.rows.length) { error = "Nothing found in that file."; return; }
    const h = headerRow(t.rows);
    const head = t.rows[h].map((x) => String(x).trim());
    const map = {};
    Object.keys(GUESS).forEach((k) => { const i = head.findIndex((c) => GUESS[k].test(c)); map[k] = i; });
    imp = { name: file.name, head, map, rows: t.rows.slice(h + 1).filter((r) => r.some((c) => String(c).trim())) };
  }
  async function sendList() {
    const rows = imp.rows.map((r) => Object.fromEntries(Object.keys(imp.map).filter((k) => imp.map[k] >= 0).map((k) => [k, String(r[imp.map[k]] ?? "").trim()])));
    const r = await api("POST", `/api/chedam/vendors/${vendor}/price-list`, { rows }, { timeout: 60000 });
    if (!r.ok) return fail(r);
    impResult = r.json; imp = null; load();
  }
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
    <h1 class="text-xl font-bold">Buying</h1>
  </div>
  <div class="flex flex-wrap gap-2">
    {#each tabs as [k, l] (k)}<button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; edit = null; load(); }}>{l}</button>{/each}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  {#if tab === "orders"}<Orders {vendors} />{/if}
  {#if tab === "bills"}<Bills />{/if}

  {#if tab === "prices"}
    <div class="flex flex-wrap items-end gap-2">
      <label class="block flex-1"><span class="text-sm text-muted">Vendor</span><select class="field" bind:value={vendor} onchange={load}>{#each vendors as v (v.id)}<option value={v.id}>{v.name} ({v.currency})</option>{/each}</select></label>
      {#if manage}<button class="btn-ghost min-h-12" onclick={() => startEdit(null)}>Add a product</button>
        <label class="btn-ghost flex min-h-12 cursor-pointer items-center">Import price list<input class="sr-only" type="file" accept=".csv,.txt,.xlsx,.xls,.ods" onchange={(e) => readList(e.currentTarget.files[0])} /></label>{/if}
      <ExportMenu title="Vendor prices" rows={items} columns={[{ key: "product_name", label: "Product" }, { key: "unit_name", label: "Unit" }, { key: "vendor_sku", label: "Vendor code" }, { key: "pack_qty", label: "Base units" },
        { key: "c", label: "Cost", value: (x) => x.cost_cents / 100 }, { key: "currency", label: "Currency" }, { key: "min_order_qty", label: "Minimum" }, { key: "lead_days", label: "Lead days" }, { key: "preferred", label: "Preferred" }]} />
    </div>
    {#if imp}
      <div class="card space-y-2">
        <p class="font-semibold">{imp.name}: {imp.rows.length} rows. Which column is which?</p>
        <div class="grid gap-2 sm:grid-cols-3">
          {#each [["vendor_sku", "Their code"], ["barcode", "Barcode"], ["description", "Description"], ["cost", "Cost (their currency)"], ["min_order_qty", "Minimum order"], ["lead_days", "Lead days"]] as [k, l] (k)}
            <label class="block"><span class="text-sm text-muted">{l}</span><select class="field" bind:value={imp.map[k]}><option value={-1}>(none)</option>{#each imp.head as h, i (i)}<option value={i}>{h || "column " + (i + 1)}</option>{/each}</select></label>
          {/each}
        </div>
        <p class="text-sm text-muted">Rows are matched by their code first, then by barcode. A cost change keeps the cost before it.</p>
        <div class="flex gap-2"><button class="btn" disabled={imp.map.cost < 0 || (imp.map.vendor_sku < 0 && imp.map.barcode < 0)} onclick={sendList}>Import</button><button class="btn-ghost" onclick={() => (imp = null)}>Cancel</button></div>
      </div>
    {/if}
    {#if impResult}
      <div class="card space-y-1 text-sm">
        <p class="font-semibold">Imported: {impResult.created} new, {impResult.updated} changed, {impResult.unchanged} the same, {impResult.unmatched.length} not matched</p>
        {#if impResult.up.length}<p class="text-bad">Up: {impResult.up.map((x) => x.product + " " + money(x.from_cents) + " → " + money(x.to_cents)).join(" · ")}</p>{/if}
        {#if impResult.down.length}<p class="text-ok">Down: {impResult.down.map((x) => x.product + " " + money(x.from_cents) + " → " + money(x.to_cents)).join(" · ")}</p>{/if}
        {#each impResult.unmatched as u (u.row)}<p class="text-warn">Row {u.row}: {u.vendor_sku || u.barcode} {u.description} · {u.reason}</p>{/each}
      </div>
    {/if}
    {#if edit}
      <form class="card grid gap-2 sm:grid-cols-3" onsubmit={saveVP}>
        <div class="sm:col-span-3">{#if edit.product}<p class="font-semibold">{edit.product_name}</p>{:else}
          <input class="field" bind:value={pq} oninput={findProducts} placeholder="Product name" aria-label="Product" />
          <div class="flex flex-wrap gap-1">{#each hits as p (p.id)}<button type="button" class="btn-ghost min-h-8 text-sm" onclick={() => pickProduct(p)}>{p.name}</button>{/each}</div>{/if}</div>
        <label class="block"><span class="text-sm text-muted">Comes as</span><select class="field" bind:value={edit.selling_unit}><option value="">Base unit</option>{#each units as u (u.id)}<option value={u.id}>{u.name} ({u.base_qty})</option>{/each}</select></label>
        <label class="block"><span class="text-sm text-muted">Their code</span><input class="field" bind:value={edit.vendor_sku} maxlength="60" /></label>
        <label class="block"><span class="text-sm text-muted">Cost</span><input class="field" inputmode="decimal" bind:value={edit.cost} required /></label>
        <label class="block sm:col-span-3"><span class="text-sm text-muted">Their description</span><input class="field" bind:value={edit.description} maxlength="200" /></label>
        <label class="block"><span class="text-sm text-muted">Minimum order</span><input class="field" type="number" min="0" step="any" bind:value={edit.min_order_qty} /></label>
        <label class="block"><span class="text-sm text-muted">Lead time (days)</span><input class="field" type="number" min="0" max="365" bind:value={edit.lead_days} /></label>
        <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={edit.preferred} /> Preferred vendor</label>
        <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={edit.active} /> In use</label>
        <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit" disabled={!edit.product}>Save</button><button class="btn-ghost" type="button" onclick={() => (edit = null)}>Cancel</button></div>
      </form>
    {/if}
    {#each items as x (x.id)}
      <div class="card flex flex-wrap items-center justify-between gap-2 {x.active ? '' : 'opacity-60'}">
        <span><span class="block font-semibold">{x.product_name}{x.preferred ? " ★" : ""}</span>
          <span class="block text-sm text-muted">{x.unit_name || "base unit"} ({x.pack_qty}){x.vendor_sku ? " · " + x.vendor_sku : ""}{x.min_order_qty ? " · min " + x.min_order_qty : ""}{x.lead_days ? " · " + x.lead_days + " days" : ""}</span></span>
        <span class="text-right"><b>{cur(x.cost_cents, x.currency)}</b>{#if x.previous_cost_cents && x.previous_cost_cents !== x.cost_cents}<span class="block text-xs {x.cost_cents > x.previous_cost_cents ? 'text-bad' : 'text-ok'}">was {cur(x.previous_cost_cents, x.currency)}</span>{/if}
          {#if manage}<button class="block text-sm underline" onclick={() => startEdit(x)}>Change</button>{/if}</span>
      </div>
    {:else}<p class="text-muted">Nothing from this vendor yet.</p>{/each}
  {/if}

  {#if tab === "compare"}
    <div class="card space-y-2">
      <input class="field" bind:value={pq} oninput={findProducts} placeholder="Find a product" aria-label="Product" />
      <div class="flex flex-wrap gap-1">{#each hits as p (p.id)}<button class="btn-ghost min-h-8 text-sm" onclick={() => compare(p)}>{p.name}</button>{/each}</div>
    </div>
    {#if cmp}
      <div class="card space-y-1">
        <h2 class="font-semibold">{cmpName}</h2>
        {#each cmp.vendors as v (v.id)}
          <p class="flex flex-wrap justify-between gap-2 text-sm {v.cheapest ? 'font-semibold text-ok' : ''}"><span>{v.vendor_name}{v.preferred ? " ★" : ""} · {v.unit_name || "base"} ({v.pack_qty}) · {cur(v.cost_cents, v.currency)}</span>
            <span>{v.cad_per_base_cents === null ? "no exchange rate" : money(Math.round(v.cad_per_base_cents)) + " per base unit"}{v.cheapest ? " · cheapest" : ""}</span></p>
        {:else}<p class="text-muted">No vendor sells this product yet.</p>{/each}
      </div>
    {/if}
  {/if}

  {#if tab === "better"}
    {#each better as b (b.product)}<p class="card flex flex-wrap justify-between gap-2 text-sm"><span><b>{b.product_name}</b> · {b.best_vendor} is cheaper</span><span>{money(Math.round(b.preferred_cents))} → {money(Math.round(b.best_cents))} per base unit · <b class="text-ok">−{b.saving_pct}%</b></span></p>
    {:else}<p class="text-muted">Your preferred vendors are the cheapest ones you have prices for.</p>{/each}
  {/if}
</section>

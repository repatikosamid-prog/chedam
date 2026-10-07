<script>
  // Add stock by phone and the quick bulk grid (FR-6.02, 6.03, 6.04): scan (camera, USB scanner or
  // typing), "packs or singles?" when a barcode is shared, unknown barcode -> new product form with the
  // barcode filled in, one row per product and unit (scanning again adds 1), cost per unit with the
  // last cost as default (▲/▼ %), lot and expiry. The grid is kept on this device until it is saved,
  // and saved in one transaction; its op id makes a retry safe (BR-10).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { s, go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money, toCents, toDollars, opId, newId } from "../lib/catalogue.js";
  import Scanner from "../components/Scanner.svelte";

  const KEY = "chedam.receive.draft";
  const showCost = can("costs.view");
  let draft = $state({ op: opId(), rows: [] });
  let scanning = $state(false), choose = $state(null), unknown = $state(""), typed = $state("");
  let error = $state(""), ok = $state(""), busy = $state(false);

  function keep() { try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch { /* private mode */ } }

  onMount(async () => {
    try { const d = JSON.parse(localStorage.getItem(KEY) || "null"); if (d && Array.isArray(d.rows)) draft = d; } catch { /* none */ }
    if (s.receiveProduct) { const id = s.receiveProduct; s.receiveProduct = ""; await addProduct(id, "", ""); }
  });

  async function details(id) {
    const r = await api("GET", "/api/chedam/catalogue/products/" + id);
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return null; }
    return r.json;
  }

  async function addProduct(id, unitId, code) {
    const v = await details(id);
    if (!v) return;
    const units = v.units;
    const u = units.find((x) => x.id === unitId) || units.find((x) => x.is_default) || units[0];
    if (!u) { error = "'" + v.product.name + "' has no selling units yet."; return; }
    const same = draft.rows.find((r) => r.product === id && r.selling_unit === u.id);
    if (same) { same.qty = Number(same.qty || 0) + 1; keep(); return; }
    const last = v.product.cost_cents !== undefined ? Math.round(v.product.cost_cents * (u.base_qty || 1)) : null;
    draft.rows = [{ key: newId(), product: id, name: v.product.name, base_unit: v.product.base_unit, units: units.map((x) => ({ id: x.id, name: x.name, kind: x.kind, base_qty: x.base_qty })),
      selling_unit: u.id, qty: u.kind === "weight" ? "" : 1, last_cost: last, costText: last ? toDollars(last) : "", lot_code: "", expiry_date: "",
      perishable: v.product.perishable, needs_expiry: v.product.perishable && (v.product.expiry_at_receiving || !(v.product.shelf_life_days > 0)),
      shelf_life_days: v.product.shelf_life_days, code, status: v.product.status, base_cost: v.product.cost_cents }, ...draft.rows];
    keep();
  }

  async function onCode(code) {
    error = ""; ok = ""; unknown = ""; choose = null;
    const r = await api("GET", "/api/chedam/catalogue/lookup?code=" + encodeURIComponent(code));
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    const m = r.json.matches;
    if (!m.length) { unknown = code; scanning = false; return; }
    const products = [...new Set(m.map((x) => x.product.id))];
    if (m.length > 1 && products.length === 1) { choose = { code, matches: m }; scanning = false; return; }   // packs or singles? (FR-6.03)
    await addProduct(m[0].product.id, m[0].unit.id, code);
  }

  function setUnit(row, uid) {
    row.selling_unit = uid;
    const u = row.units.find((x) => x.id === uid);
    if (row.base_cost !== undefined && row.base_cost !== null) { row.last_cost = Math.round(row.base_cost * (u.base_qty || 1)); row.costText = toDollars(row.last_cost); }
    keep();
  }

  function remove(row) { draft.rows = draft.rows.filter((r) => r !== row); keep(); }

  function newProduct() {
    s.newBarcode = unknown; s.productId = ""; s.returnTo = "receive"; unknown = "";
    go("product");
  }

  function change(row) {
    const c = toCents(row.costText);
    if (!row.last_cost || c == null || isNaN(c)) return "";
    const p = ((c - row.last_cost) / row.last_cost) * 100;
    return Math.abs(p) < 0.05 ? "same as last" : (p > 0 ? "▲ " : "▼ ") + Math.abs(p).toFixed(1) + "% vs last " + money(row.last_cost);
  }

  async function save() {
    error = ""; ok = "";
    const lines = [];
    for (const r of draft.rows) {
      const n = Number(r.qty);
      if (!(n > 0)) { error = "Enter how many for '" + r.name + "'."; return; }
      const c = showCost ? toCents(r.costText) : null;
      if (c !== null && isNaN(c)) { error = "The cost for '" + r.name + "' is not a valid amount."; return; }
      if (r.needs_expiry && !r.expiry_date) { error = "Enter the expiry date for '" + r.name + "'."; return; }
      lines.push({ product: r.product, selling_unit: r.selling_unit, qty: n, cost_cents: c, lot_code: r.lot_code, expiry_date: r.expiry_date });
    }
    if (!lines.length) { error = "Scan or add something first."; return; }
    busy = true;
    const res = await api("POST", "/api/chedam/stock/receive", { op_id: draft.op, lines }, { timeout: 20000 });
    busy = false;
    if (!res.ok) {
      if (await handleRefusal(res)) return;
      error = res.status === 0 ? "The hub did not answer. Your list is kept on this phone; try Save again." : res.message;
      return;
    }
    ok = "Stock added: " + lines.length + (lines.length === 1 ? " line." : " lines.");
    draft = { op: opId(), rows: [] };
    keep();
  }

  function clearAll() { if (confirm("Clear this list without saving?")) { draft = { op: opId(), rows: [] }; keep(); } }
</script>

<section class="space-y-4">
  <div>
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("stock")}>← Stock</button>
    <h1 class="text-xl font-bold">Add stock</h1>
    <p class="text-muted">Scan each item. Scanning the same item again adds one more.</p>
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if scanning}
    <Scanner continuous {onCode} onClose={() => (scanning = false)} />
  {:else}
    <div class="card flex flex-wrap gap-2">
      <button class="btn" onclick={() => (scanning = true)}>Scan with camera</button>
      <form class="flex w-full min-w-0 gap-2 sm:w-auto sm:flex-1" onsubmit={(e) => { e.preventDefault(); if (typed.trim()) { onCode(typed.trim()); typed = ""; } }}>
        <label class="sr-only" for="code">Barcode or PLU</label>
        <input id="code" class="field" bind:value={typed} autocomplete="off" placeholder="Type or USB-scan a code" />
        <button class="btn-ghost" type="submit">Add</button>
      </form>
    </div>
  {/if}

  {#if choose}
    <div class="card space-y-2 border-accent">
      <h2 class="font-semibold">Packs or singles?</h2>
      <p class="text-sm text-muted">{choose.matches[0].product.name} · barcode {choose.code}</p>
      <div class="flex flex-wrap gap-2">
        {#each choose.matches as m (m.unit.id)}
          <button class="btn-ghost" onclick={() => { addProduct(m.product.id, m.unit.id, choose.code); choose = null; }}>{m.unit.name}</button>
        {/each}
      </div>
    </div>
  {/if}

  {#if unknown}
    <div class="card space-y-2 border-warn">
      <p><b>{unknown}</b> is not in your products yet.</p>
      <div class="flex flex-wrap gap-2">
        {#if can("catalogue.edit")}<button class="btn" onclick={newProduct}>New product with this barcode</button>{/if}
        <button class="btn-ghost" onclick={() => (unknown = "")}>Skip</button>
      </div>
    </div>
  {/if}

  {#each draft.rows as r (r.key)}
    {@const u = r.units.find((x) => x.id === r.selling_unit)}
    <div class="card space-y-2">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h2 class="font-semibold">{r.name}</h2>
          {#if r.status === "draft"}<p class="text-sm text-warn">Draft: a manager makes it active before it can be sold.</p>{/if}
        </div>
        <button class="min-h-10 px-2 text-sm text-bad underline" onclick={() => remove(r)}>Remove</button>
      </div>
      <div class="grid gap-2 sm:grid-cols-3">
        <label class="block"><span class="text-sm text-muted">Unit</span>
          <select class="field" value={r.selling_unit} onchange={(e) => setUnit(r, e.currentTarget.value)}>
            {#each r.units as x (x.id)}<option value={x.id}>{x.name}</option>{/each}
          </select></label>
        <label class="block"><span class="text-sm text-muted">{u && u.kind === "weight" ? "Weight (" + r.base_unit + ")" : "How many"}</span>
          <input class="field" type="number" min="0" step={u && u.kind === "weight" ? 0.001 : 1} bind:value={r.qty} oninput={keep} /></label>
        {#if showCost}
          <label class="block"><span class="text-sm text-muted">Cost per {u ? u.name.toLowerCase() : "unit"} ($)</span>
            <input class="field" inputmode="decimal" bind:value={r.costText} oninput={keep} placeholder="0.00" />
            <span class="text-xs text-muted">{change(r)}</span></label>
        {/if}
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="block"><span class="text-sm text-muted">Lot (optional)</span><input class="field" bind:value={r.lot_code} oninput={keep} maxlength="60" /></label>
        {#if r.perishable}
          <label class="block"><span class="text-sm text-muted">Expiry{r.needs_expiry ? "" : " (blank = today + " + r.shelf_life_days + " days)"}</span>
            <input class="field" type="date" bind:value={r.expiry_date} onchange={keep} required={r.needs_expiry} /></label>
        {/if}
      </div>
    </div>
  {/each}

  {#if draft.rows.length}
    <div class="flex flex-wrap gap-2">
      <button class="btn" disabled={busy} onclick={save}>{busy ? "Saving…" : "Save " + draft.rows.length + (draft.rows.length === 1 ? " line" : " lines")}</button>
      <button class="btn-ghost" disabled={busy} onclick={clearAll}>Clear</button>
    </div>
    <p class="text-xs text-muted">This list stays on this device until you save it.</p>
  {/if}
</section>

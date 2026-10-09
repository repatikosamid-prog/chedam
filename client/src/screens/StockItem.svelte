<script>
  // One product's stock (FR-6.01): on hand, sealed packs and loose, lots by expiry (FEFO), recent
  // changes; adjust, damage or loss with a reason and photo (FR-6.06), open or make packs (FR-6.05).
  // Write-offs above the store's limit wait for a manager (BR-18).
  import { onMount } from "svelte";
  import { api, apiForm } from "../lib/api.js";
  import { s, go, can, handleRefusal } from "../lib/session.svelte.js";
  import { qty, money, opId, MOVES } from "../lib/catalogue.js";

  let v = $state(null), error = $state(""), ok = $state(""), busy = $state(false);
  let form = $state(null);        // { kind: "adjust" | "pack", ... }
  let photo = $state(null);

  const unitName = (id) => (v && v.units.find((u) => u.id === id) || {}).name || "";
  const packs = $derived(v ? v.units.filter((u) => u.kind === "pack" || u.kind === "case") : []);
  const loose = $derived(v ? v.units.find((u) => u.kind === "single" || u.kind === "weight") : null);
  const ST = { out: ["Out of stock", "bg-bad/10 text-bad"], low: ["Low", "bg-warn/10 text-warn"], ok: ["In stock", "bg-ok/10 text-ok"] };

  async function load() {
    const r = await api("GET", "/api/chedam/stock/products/" + s.stockProductId);
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    v = r.json;
  }
  onMount(load);

  function startAdjust(type) {
    error = ""; ok = ""; photo = null;
    form = { kind: "adjust", op: opId(), type, direction: "out", selling_unit: loose ? loose.id : (packs[0] || {}).id, qty: "", reason: "", note: "" };
  }
  function startPack(mode) {
    error = ""; ok = "";
    form = { kind: "pack", op: opId(), mode, selling_unit: (packs[0] || {}).id, count: 1, damaged: 0 };
  }
  const reasonList = $derived(form && form.kind === "adjust" && v ? (v.reasons[form.type] || []) : []);
  const opensLoose = $derived(form && form.kind === "pack" && v ? (() => {
    const u = v.units.find((x) => x.id === form.selling_unit);
    if (!u || !u.contains_unit) return true;
    const inner = v.units.find((x) => x.id === u.contains_unit);
    return !inner || inner.kind === "single" || inner.kind === "weight";
  })() : false);

  async function submit(e) {
    e.preventDefault();
    busy = true; error = "";
    let r;
    if (form.kind === "adjust") {
      const body = { op_id: form.op, product: v.product.id, selling_unit: form.selling_unit, qty: Number(form.qty), type: form.type,
        direction: form.type === "adjust" ? form.direction : "out", reason: form.reason, note: form.note };
      if (photo) {
        const fd = new FormData();
        Object.entries(body).forEach(([k, x]) => fd.append(k, String(x)));
        fd.append("photo", photo);
        r = await apiForm("POST", "/api/chedam/stock/adjust", fd);
      } else {
        r = await api("POST", "/api/chedam/stock/adjust", body);
      }
    } else {
      r = await api("POST", "/api/chedam/stock/" + (form.mode === "break" ? "pack-break" : "pack-make"),
        { op_id: form.op, product: v.product.id, selling_unit: form.selling_unit, count: Number(form.count), damaged: Number(form.damaged) || 0 });
    }
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    const m = r.json.movements[0];
    ok = m && m.status === "pending" ? "Saved. It is worth more than the limit, so a manager approves it before stock changes." : "Saved.";
    form = null;
    load();
  }

  function when(t) { return t ? new Date(t.replace(" ", "T")).toLocaleString() : ""; }
  function day(t) { return t ? new Date(t + "T12:00:00").toLocaleDateString() : ""; }

  // Recent changes in colour: stock in (received, returned) and sold differ at a glance; damage and loss
  // stand out; the text says it too, so colour is never the only sign.
  function moveColour(m) {
    if (m.type === "receive" || m.type === "return") return "text-stock-in";
    if (m.type === "sale") return m.qty_base > 0 ? "text-stock-in" : "text-stock-out";
    if (m.type === "damage" || m.type === "loss") return "text-bad";
    return "";
  }
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("stock")}>← Stock</button>
    {#if v}<h1 class="text-xl font-bold">{v.product.name}</h1>{/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if v}
    <div class="card space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-2xl font-bold tabular-nums">{qty(v.level.on_hand, v.product.base_unit)} <span class="text-base font-normal text-muted">on hand</span></p>
        <span class="rounded-lg px-2 py-0.5 text-sm {ST[v.status][1]}">{ST[v.status][0]}</span>
      </div>
      <ul class="text-sm">
        {#each Object.entries(v.level.sealed) as [uid, n] (uid)}<li>{n} sealed × {unitName(uid)}</li>{/each}
        <li>{qty(v.level.loose_qty, v.product.base_unit)} loose{v.product.base_unit === "each" ? " items" : ""}</li>
        {#if v.product.reorder_point}<li class="text-muted">Reorder at {qty(v.product.reorder_point, v.product.base_unit)}</li>{/if}
      </ul>
      <div class="flex flex-wrap gap-2 pt-1">
        {#if can("stock.receive")}<button class="btn" onclick={() => { s.receiveProduct = v.product.id; go("receive"); }}>Add stock</button>{/if}
        {#if can("stock.adjust")}
          <button class="btn-ghost" onclick={() => startAdjust("damage")}>Damage</button>
          <button class="btn-ghost" onclick={() => startAdjust("loss")}>Loss</button>
          <button class="btn-ghost" onclick={() => startAdjust("adjust")}>Adjust</button>
          {#if packs.length}<button class="btn-ghost" onclick={() => startPack("break")}>Open packs</button>
            <button class="btn-ghost" onclick={() => startPack("make")}>Make packs</button>{/if}
        {/if}
      </div>
    </div>

    {#if form}
      <form class="card grid gap-3 sm:grid-cols-2" onsubmit={submit}>
        {#if form.kind === "adjust"}
          <h2 class="font-semibold sm:col-span-2">{form.type === "damage" ? "Record damage" : form.type === "loss" ? "Record a loss" : "Adjust stock"}</h2>
          {#if form.type === "adjust"}
            <label class="block"><span class="text-sm text-muted">Direction</span>
              <select class="field" bind:value={form.direction}><option value="in">Add (found)</option><option value="out">Take away</option></select></label>
          {/if}
          <label class="block"><span class="text-sm text-muted">Unit</span>
            <select class="field" bind:value={form.selling_unit}>{#each v.units as u (u.id)}<option value={u.id}>{u.name}</option>{/each}</select></label>
          <label class="block"><span class="text-sm text-muted">How many</span>
            <input class="field" type="number" min="0" step={v.product.base_unit === "each" ? 1 : 0.001} bind:value={form.qty} required /></label>
          <label class="block"><span class="text-sm text-muted">Reason</span>
            <select class="field" bind:value={form.reason} required><option value="">Choose…</option>{#each reasonList as r (r)}<option value={r}>{r}</option>{/each}</select></label>
          <label class="block sm:col-span-2"><span class="text-sm text-muted">Note</span><input class="field" bind:value={form.note} maxlength="1000" /></label>
          {#if form.type !== "adjust"}
            <label class="block sm:col-span-2"><span class="text-sm text-muted">Photo (optional)</span>
              <input class="field" type="file" accept="image/*" capture="environment" onchange={(e) => (photo = e.currentTarget.files[0] || null)} /></label>
          {/if}
        {:else}
          <h2 class="font-semibold sm:col-span-2">{form.mode === "break" ? "Open sealed packs" : "Make packs"}</h2>
          <label class="block"><span class="text-sm text-muted">Pack</span>
            <select class="field" bind:value={form.selling_unit}>{#each packs as u (u.id)}<option value={u.id}>{u.name} ({v.level.sealed[u.id] || 0} sealed)</option>{/each}</select></label>
          <label class="block"><span class="text-sm text-muted">How many</span><input class="field" type="number" min="1" step="1" bind:value={form.count} required /></label>
          {#if form.mode === "break" && opensLoose}
            <label class="block"><span class="text-sm text-muted">Damaged items found inside (optional)</span>
              <input class="field" type="number" min="0" step="1" bind:value={form.damaged} /></label>
          {/if}
        {/if}
        <div class="flex gap-2 sm:col-span-2">
          <button class="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          <button class="btn-ghost" type="button" onclick={() => (form = null)}>Cancel</button>
        </div>
      </form>
    {/if}

    <div class="card">
      <h2 class="mb-2 font-semibold">Lots (sold oldest expiry first)</h2>
      {#if v.lots.length}
        <ul class="divide-y divide-line text-sm">
          {#each v.lots as l (l.id)}
            <li class="flex flex-wrap justify-between gap-2 py-2">
              <span>{qty(l.qty, v.product.base_unit)}{l.lot_code ? " · lot " + l.lot_code : ""}{l.cost_cents !== undefined ? " · " + money(l.cost_cents) + " each" : ""}</span>
              <span class={l.expired ? "font-semibold text-bad" : "text-muted"}>{l.expiry_date ? (l.expired ? "Expired " : "Expires ") + day(l.expiry_date) : "No expiry"}</span>
            </li>
          {/each}
        </ul>
      {:else}<p class="text-muted">No stock.</p>{/if}
    </div>

    <div class="card">
      <h2 class="mb-2 font-semibold">Recent changes</h2>
      {#if v.movements.length}
        <p class="mb-1 flex flex-wrap gap-x-4 text-sm"><span class="text-stock-in">■ Received / returned</span><span class="text-stock-out">■ Sold</span><span class="text-bad">■ Damaged / lost</span></p>
        <ul class="divide-y divide-line text-sm">
          {#each v.movements as m (m.id)}
            <li class="py-2">
              <div class="flex flex-wrap justify-between gap-2">
                <span class={moveColour(m)}><b>{m.type === "sale" && m.qty_base > 0 ? "Sale voided" : MOVES[m.type] || m.type}</b> {m.qty_base ? (m.qty_base > 0 ? "+" : "") + qty(m.qty_base, v.product.base_unit) : ""}
                  {m.unit_qty && m.selling_unit ? "(" + m.unit_qty + " × " + unitName(m.selling_unit) + ")" : ""}
                  {#if m.status !== "posted"}<span class="text-warn"> · {m.status === "pending" ? "waiting for approval" : "rejected"}</span>{/if}</span>
                <span class="text-muted">{when(m.at)}</span>
              </div>
              {#if m.reason || m.note}<p class="text-muted">{[m.reason, m.note].filter(Boolean).join(" · ")}{m.value_cents !== undefined && m.value_cents ? " · " + money(Math.abs(m.value_cents)) : ""}</p>{/if}
            </li>
          {/each}
        </ul>
      {:else}<p class="text-muted">No changes yet.</p>{/if}
    </div>
  {:else if !error}<p class="text-muted">Loading…</p>{/if}
</section>

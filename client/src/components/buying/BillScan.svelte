<script>
  // Receive from a bill (P3 step 5; FR-6.11, 6.12): take a photo of the vendor's bill (or choose its PDF); this
  // device reads it; the hub matches each line (learned from earlier bills, the vendor's code, barcode, name);
  // a person checks the review grid (product, unit, quantity, cost, expiry), the totals and tax checks, the
  // vendor's open order, freight / duty / brokerage to spread, and receives it, also recording the bill.
  import { api } from "../../lib/api.js";
  import { can, handleRefusal } from "../../lib/session.svelte.js";
  import { money, newId } from "../../lib/catalogue.js";
  import { readBill } from "../../lib/bill_reader.js";

  let { vendors = [] } = $props();
  const billRights = can("finance.manage") || can("purchasing.manage");
  let vendor = $state(vendors[0] ? vendors[0].id : ""), busy = $state(""), error = $state(""), ok = $state("");
  let read = $state(null), m = $state(null), rows = $state([]), po = $state(""), landed = $state({ freight: "", duty: "", brokerage: "" }), makeBill = $state(billRights), ref = $state(""), day = $state(""), gst = $state(""), pst = $state("");
  let rate = $state(1), units = $state({}), q = $state({}), hits = $state({});
  const cur = $derived(m ? m.currency : "CAD");
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };

  async function take(file) {
    if (!file || !vendor) return;
    error = ""; ok = ""; m = null; read = null;
    try { read = await readBill(file, (s) => (busy = s)); }
    catch (e) { busy = ""; error = "This device could not read the bill: " + (e && e.message ? e.message : e); return; }
    busy = "Matching the lines";
    const r = await api("POST", "/api/chedam/bill-scan/match", { vendor, lines: read.lines }, { timeout: 30000 });
    busy = "";
    if (!r.ok) return fail(r);
    m = r.json; ref = read.ref || ""; day = read.date || ""; gst = read.totals.gst_cents !== null ? (read.totals.gst_cents / 100).toFixed(2) : ""; pst = read.totals.pst_cents !== null ? (read.totals.pst_cents / 100).toFixed(2) : "";
    po = m.orders.length ? m.orders[0].id : "";
    const fx = await api("GET", "/api/chedam/fx?currency=" + m.currency, null, { quiet: true });
    rate = fx.ok ? fx.json.rate : 1;
    landed = { freight: read.totals.freight_cents ? ((read.totals.freight_cents * rate) / 100).toFixed(2) : "", duty: "", brokerage: "" };
    rows = m.lines.map((l) => ({ ...l, use: true, qty: l.qty, cost: (l.unit_cents / 100).toFixed(2), expiry: "" }));
    rows.forEach((x) => { if (x.product) loadUnits(x.product); });
  }
  async function loadUnits(pid) {
    if (units[pid]) return;
    const r = await api("GET", "/api/collections/selling_units/records?perPage=50&sort=sort&filter=" + encodeURIComponent(`product='${pid}' && deleted_at=''`), null, { quiet: true });
    units[pid] = r.ok ? r.json.items : [];
  }
  async function search(i) {
    const t = (q[i] || "").trim().replace(/'/g, "");
    if (!t) { hits[i] = []; return; }
    const r = await api("GET", "/api/collections/products/records?perPage=8&fields=id,name&filter=" + encodeURIComponent(`deleted_at='' && name~'${t}'`), null, { quiet: true });
    hits[i] = r.ok ? r.json.items : [];
  }
  async function pick(i, p) {
    rows[i].product = p.id || p.product; rows[i].product_name = p.name; rows[i].selling_unit = p.selling_unit || ""; hits[i] = []; q[i] = "";
    await loadUnits(rows[i].product);
    if (!rows[i].selling_unit && units[rows[i].product].length) rows[i].selling_unit = units[rows[i].product][units[rows[i].product].length - 1].id;
  }
  const sum = $derived(rows.filter((r) => r.use).reduce((a, r) => a + Math.round(Number(r.qty) * Number(r.cost) * 100), 0));
  const ready = $derived(rows.some((r) => r.use && r.product) && rows.every((r) => !r.use || r.product));

  async function confirm() {
    error = "";
    const body = { vendor, po, op_id: newId(), lines: rows.filter((r) => r.use).map((r) => ({ product: r.product, selling_unit: r.selling_unit, qty: Number(r.qty), cost_cents: Math.round(Number(r.cost) * 100),
      expiry_date: r.expiry || undefined, raw_code: r.code, raw_description: r.description })),
      landed: { freight_cents: Math.round(Number(landed.freight || 0) * 100), duty_cents: Math.round(Number(landed.duty || 0) * 100), brokerage_cents: Math.round(Number(landed.brokerage || 0) * 100) },
      bill: makeBill ? { make: true, party_ref: ref, doc_date: day || undefined, taxes: [gst ? { code: "GST", label: "GST/HST", cents: Math.round(Number(gst) * 100) } : null, pst ? { code: "PST", label: "PST", cents: Math.round(Number(pst) * 100) } : null].filter(Boolean) } : null };
    busy = "Receiving";
    const r = await api("POST", "/api/chedam/bill-scan/confirm", body, { timeout: 60000 });
    busy = "";
    if (!r.ok) return fail(r);
    ok = r.json.received + " lines received into stock" + (r.json.po ? " against the order" : "") + (r.json.bill ? "; bill " + r.json.bill.number + " recorded" : "") + ". The matches are remembered for this vendor.";
    m = null; read = null; rows = [];
  }
  const VIA = { learned: "remembered", vendor_code: "their code", barcode: "barcode", name: "by name" };
</script>

{#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
{#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}
<div class="card flex flex-wrap items-end gap-2">
  <label class="block flex-1"><span class="text-sm text-muted">Vendor</span><select class="field" bind:value={vendor}>{#each vendors as v (v.id)}<option value={v.id}>{v.name}</option>{/each}</select></label>
  <label class="btn flex min-h-12 cursor-pointer items-center">📷 Photo of the bill<input class="sr-only" type="file" accept="image/*" capture="environment" onchange={(e) => take(e.currentTarget.files[0])} /></label>
  <label class="btn-ghost flex min-h-12 cursor-pointer items-center">PDF or picture<input class="sr-only" type="file" accept="application/pdf,image/*" onchange={(e) => take(e.currentTarget.files[0])} /></label>
</div>
{#if busy}<p class="text-muted" role="status">{busy}…</p>{/if}

{#if m}
  <div class="card space-y-2">
    <p class="font-semibold">{rows.length} lines read{read.ref ? " · bill " + read.ref : ""}{read.date ? " · " + read.date : ""}</p>
    {#each read.checks as c (c)}<p class="text-sm text-warn">⚠ {c}</p>{/each}
    {#if m.orders.length}<label class="block"><span class="text-sm text-muted">Against the order</span><select class="field" bind:value={po}><option value="">No order (a delivery)</option>{#each m.orders as o (o.id)}<option value={o.id}>{o.number} · {o.order_date}</option>{/each}</select></label>{/if}
    {#each rows as r, i (i)}
      <div class="space-y-1 border-t border-line pt-2 {r.use ? '' : 'opacity-50'}">
        <p class="flex flex-wrap items-center gap-2 text-xs text-muted"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={r.use} aria-label="Receive this line" /> <span class="font-mono">{r.raw}</span></p>
        <div class="grid gap-2 sm:grid-cols-[1fr_9rem_5rem_6rem_9rem]">
          <div>{#if r.product}<p class="text-sm"><b>{r.product_name}</b> <span class="text-muted">({VIA[r.via] || "chosen"}{r.po_check ? " · " + r.po_check : ""})</span> <button class="underline" onclick={() => { r.product = ""; }}>change</button></p>
            {:else}<input class="field min-h-10 py-1" bind:value={q[i]} oninput={() => search(i)} placeholder="Which product?" aria-label="Product" />
              <div class="flex flex-wrap gap-1">{#each r.candidates || [] as c (c.product)}<button class="btn-ghost min-h-8 text-xs" onclick={() => pick(i, c)}>{c.name} ({Math.round(c.score * 100)}%)</button>{/each}{#each hits[i] || [] as p (p.id)}<button class="btn-ghost min-h-8 text-xs" onclick={() => pick(i, p)}>{p.name}</button>{/each}</div>{/if}</div>
          <select class="field min-h-10 py-1" bind:value={r.selling_unit} aria-label="Unit">{#each units[r.product] || [] as u (u.id)}<option value={u.id}>{u.name} ({u.base_qty})</option>{/each}</select>
          <input class="field min-h-10 py-1" type="number" min="0" step="any" bind:value={r.qty} aria-label="Quantity" />
          <input class="field min-h-10 py-1" inputmode="decimal" bind:value={r.cost} aria-label={"Cost each, " + cur} title={"Cost each, " + cur} />
          <input class="field min-h-10 py-1" type="date" bind:value={r.expiry} aria-label="Expiry" title="Expiry (perishables)" />
        </div>
      </div>
    {/each}
    <p class="text-right">Lines {(sum / 100).toFixed(2)} {cur}{read.totals.subtotal_cents !== null ? " · bill subtotal " + (read.totals.subtotal_cents / 100).toFixed(2) : ""}</p>
    <div class="grid gap-2 sm:grid-cols-3">
      <label class="block"><span class="text-sm text-muted">Freight (CAD)</span><input class="field" inputmode="decimal" bind:value={landed.freight} /></label>
      <label class="block"><span class="text-sm text-muted">Duty (CAD)</span><input class="field" inputmode="decimal" bind:value={landed.duty} /></label>
      <label class="block"><span class="text-sm text-muted">Brokerage (CAD)</span><input class="field" inputmode="decimal" bind:value={landed.brokerage} /></label>
    </div>
    <p class="text-xs text-muted">Freight, duty and brokerage are spread over the lines by value, so each item's cost includes its share (landed cost).</p>
    {#if billRights}
      <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={makeBill} /> Also record the bill (to pay)</label>
      {#if makeBill}<div class="grid gap-2 sm:grid-cols-4">
        <label class="block"><span class="text-sm text-muted">Their invoice no.</span><input class="field" bind:value={ref} /></label>
        <label class="block"><span class="text-sm text-muted">Date</span><input class="field" type="date" bind:value={day} /></label>
        <label class="block"><span class="text-sm text-muted">GST/HST ({cur})</span><input class="field" inputmode="decimal" bind:value={gst} /></label>
        <label class="block"><span class="text-sm text-muted">PST ({cur})</span><input class="field" inputmode="decimal" bind:value={pst} /></label></div>{/if}
    {/if}
    <div class="flex gap-2"><button class="btn" disabled={!ready || !!busy} onclick={confirm}>Receive into stock</button><button class="btn-ghost" onclick={() => { m = null; rows = []; }}>Cancel</button></div>
    <details><summary class="cursor-pointer text-sm text-muted">The text that was read</summary><pre class="whitespace-pre-wrap text-xs">{read.text}</pre></details>
  </div>
{/if}

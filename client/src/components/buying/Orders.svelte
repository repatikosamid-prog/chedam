<script>
  // Purchase orders (P3 step 3; FR-8.03, 6.13): the list (open / all), products needing reorder and "Make the
  // orders", a new order (vendor, lines from what the vendor sells, quantities and costs), one order's lines,
  // PDF to send, send / cancel / close, receiving what arrived (expiry for perishables, cost when different,
  // close when the rest will not come) and the differences of each receipt.
  import { onMount } from "svelte";
  import { api } from "../../lib/api.js";
  import { can, handleRefusal, s } from "../../lib/session.svelte.js";
  import { money, newId } from "../../lib/catalogue.js";
  import { docPdf } from "../../lib/doc_pdf.js";

  let { vendors = [] } = $props();
  const manage = can("purchasing.manage");
  const receiver = can("stock.receive") || manage;
  const STATUS = { draft: "Draft", sent: "Sent", partial: "Partly received", received: "Received", closed: "Closed", cancelled: "Cancelled" };
  let show = $state("open"), orders = $state([]), needs = $state([]), error = $state(""), ok = $state("");
  let open = $state(null), draft = $state(null), recv = $state(null), vprods = $state([]);

  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const cur = (c, code) => (c === undefined ? "" : code && code !== "CAD" ? (c / 100).toFixed(2) + " " + code : money(c));
  async function load() {
    error = "";
    const r = await api("GET", "/api/chedam/purchase-orders?status=" + (show === "open" ? "open" : ""));
    if (r.ok) orders = r.json.orders; else await fail(r);
    if (manage) { const n = await api("GET", "/api/chedam/purchase-orders/needs"); if (n.ok) needs = n.json.items; }
  }
  onMount(load);

  async function openPO(id) {
    const r = await api("GET", "/api/chedam/purchase-orders/" + id);
    if (r.ok) { open = r.json; recv = null; draft = null; } else fail(r);
  }
  async function reorder() {
    const r = await api("POST", "/api/chedam/purchase-orders/reorder", {});
    if (!r.ok) return fail(r);
    ok = r.json.created.length ? r.json.created.length + " draft order(s): " + r.json.created.map((x) => x.number).join(", ") + "." : "Nothing to order.";
    if (r.json.no_vendor.length) ok += " No vendor for: " + r.json.no_vendor.map((x) => x.name).join(", ") + ".";
    load();
  }

  // ---- New or changed draft
  async function loadVendorProducts(vid) {
    const r = await api("GET", `/api/chedam/vendors/${vid}/products`);
    vprods = r.ok ? r.json.items.filter((x) => x.active) : [];
  }
  async function newDraft() {
    draft = { id: "", vendor: vendors[0] ? vendors[0].id : "", expected_date: "", notes: "", lines: [] };
    if (draft.vendor) loadVendorProducts(draft.vendor);
  }
  function editDraft() {
    draft = { id: open.id, vendor: open.vendor, expected_date: open.expected_date, notes: open.notes,
      lines: open.lines.map((l) => ({ product: l.product, selling_unit: l.selling_unit, name: l.product_name + " · " + l.unit_name, qty: l.qty, cost: (l.cost_cents / 100).toFixed(2) })) };
    loadVendorProducts(open.vendor); open = null;
  }
  const addVP = (x) => { draft.lines = [...draft.lines, { product: x.product, selling_unit: x.selling_unit, name: x.product_name + " · " + (x.unit_name || "base"), qty: Math.max(1, x.min_order_qty || 1), cost: (x.cost_cents / 100).toFixed(2) }]; };
  async function saveDraft(e) {
    e.preventDefault();
    const body = { vendor: draft.vendor, expected_date: draft.expected_date, notes: draft.notes,
      lines: draft.lines.map((l) => ({ product: l.product, selling_unit: l.selling_unit, qty: Number(l.qty), cost_cents: l.cost === "" ? undefined : Math.round(Number(l.cost) * 100) })) };
    const r = draft.id ? await api("POST", "/api/chedam/purchase-orders/" + draft.id, body) : await api("POST", "/api/chedam/purchase-orders", body);
    if (!r.ok) return fail(r);
    draft = null; open = r.json; load();
  }
  async function act(action) {
    if (action === "cancel" && !confirm("Cancel " + open.number + "?")) return;
    if (action === "close" && !confirm("Close " + open.number + "? What has not arrived will no longer be expected.")) return;
    const r = await api("POST", `/api/chedam/purchase-orders/${open.id}/${action}`, {});
    if (!r.ok) return fail(r);
    open = r.json; load();
    if (action === "send") pdf();
  }
  async function pdf() {
    const b = s.brand || {};
    const v = vendors.find((x) => x.id === open.vendor) || {};
    const doc = await docPdf({ title: "PURCHASE ORDER", number: open.number, date: open.order_date, store: { name: b.name || "", address: [] },
      party: { name: open.vendor_name, address: [[v.street, v.city, v.province, v.postal_code].filter(Boolean).join(", ")], contact: [v.email, v.phone].filter(Boolean).join(" · ") }, partyLabel: "Vendor",
      meta: [["Expected", open.expected_date], ["Currency", open.currency]],
      columns: [{ label: "Code", w: 22 }, { label: "Item", w: 70 }, { label: "Unit", w: 30 }, { label: "Qty", w: 14, align: "right" }, { label: "Cost", w: 20, align: "right" }, { label: "Total", w: 22, align: "right" }],
      rows: open.lines.map((l) => [l.vendor_sku, l.description || l.product_name, l.unit_name, l.qty, ((l.cost_cents || 0) / 100).toFixed(2), ((l.line_total_cents || 0) / 100).toFixed(2)]),
      totals: [["Total " + open.currency, ((open.total_cents || 0) / 100).toFixed(2)]], notes: open.notes });
    doc.save(open.number + ".pdf");
  }

  // ---- Receiving
  function startReceive() {
    recv = { op: newId(), close: false, note: "", lines: open.lines.map((l) => ({ po_line: l.id, name: l.product_name + " · " + l.unit_name, left: Math.max(0, l.qty - l.received_qty),
      qty: Math.max(0, l.qty - l.received_qty), cost: l.cost_cents !== undefined ? (l.cost_cents / 100).toFixed(2) : "", expiry: "", product: l.product })) };
  }
  async function sendReceive(e) {
    e.preventDefault();
    const body = { op_id: recv.op, close: recv.close, note: recv.note,
      lines: recv.lines.filter((l) => Number(l.qty) > 0).map((l) => ({ po_line: l.po_line, qty: Number(l.qty), expiry_date: l.expiry || undefined, cost_cents: l.cost === "" ? undefined : Math.round(Number(l.cost) * 100) })) };
    const r = await api("POST", `/api/chedam/purchase-orders/${open.id}/receive`, body, { timeout: 30000 });
    if (!r.ok) return fail(r);
    open = r.json; recv = null; load();
    const last = open.receipts[open.receipts.length - 1];
    ok = "Received into stock." + (last && last.differences.length ? " Differences: " + last.differences.map((d) => d.kind).join(", ") + " (a task was made)." : "");
  }
  const DIFF = { short: "short", over: "more than ordered", cost: "different cost", extra: "not on the order" };
</script>

{#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
{#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

{#if draft}
  <form class="card space-y-2" onsubmit={saveDraft}>
    <div class="grid gap-2 sm:grid-cols-3">
      <label class="block"><span class="text-sm text-muted">Vendor</span><select class="field" bind:value={draft.vendor} disabled={!!draft.id} onchange={() => { draft.lines = []; loadVendorProducts(draft.vendor); }}>{#each vendors as v (v.id)}<option value={v.id}>{v.name} ({v.currency})</option>{/each}</select></label>
      <label class="block"><span class="text-sm text-muted">Expected</span><input class="field" type="date" bind:value={draft.expected_date} /></label>
      <label class="block"><span class="text-sm text-muted">Notes for the vendor</span><input class="field" bind:value={draft.notes} maxlength="2000" /></label>
    </div>
    {#each draft.lines as l, i (i)}
      <div class="grid grid-cols-[1fr_5rem_6rem_auto] items-center gap-2"><span class="text-sm">{l.name}</span>
        <input class="field min-h-10 py-1" type="number" min="0" step="any" bind:value={l.qty} aria-label="Quantity" />
        <input class="field min-h-10 py-1" inputmode="decimal" bind:value={l.cost} aria-label="Cost" />
        <button type="button" class="text-bad" aria-label="Remove" onclick={() => (draft.lines = draft.lines.filter((_, k) => k !== i))}>✕</button></div>
    {/each}
    <details><summary class="cursor-pointer text-sm text-accent underline">Add what this vendor sells ({vprods.length})</summary>
      <div class="mt-1 flex flex-wrap gap-1">{#each vprods as x (x.id)}<button type="button" class="btn-ghost min-h-8 text-sm" onclick={() => addVP(x)}>{x.product_name} · {x.unit_name || "base"} · {cur(x.cost_cents, x.currency)}</button>{:else}<span class="text-sm text-muted">Add prices for this vendor in Vendor prices first.</span>{/each}</div></details>
    <div class="flex gap-2"><button class="btn" type="submit" disabled={!draft.lines.length}>Save draft</button><button class="btn-ghost" type="button" onclick={() => (draft = null)}>Cancel</button></div>
  </form>
{:else if open}
  <div class="card space-y-2">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div><p class="text-lg font-bold">{open.number} · {open.vendor_name}</p>
        <p class="text-sm text-muted">{STATUS[open.status]}{open.source === "reorder" ? " · made by reorder" : ""} · ordered {open.order_date}{open.expected_date ? " · expected " + open.expected_date : ""} · {open.currency}{open.currency !== "CAD" ? " at " + open.fx_rate : ""}</p></div>
      <button class="btn-ghost min-h-10 text-sm" onclick={() => (open = null)}>Back to the list</button>
    </div>
    {#each open.lines as l (l.id)}
      <p class="flex flex-wrap justify-between gap-2 border-b border-line py-1 text-sm"><span>{l.product_name} · {l.unit_name}{l.vendor_sku ? " · " + l.vendor_sku : ""}</span>
        <span>{l.qty} × {cur(l.cost_cents, open.currency)} = <b>{cur(l.line_total_cents, open.currency)}</b> · <span class={l.received_qty >= l.qty ? "text-ok" : l.received_qty ? "text-warn" : "text-muted"}>received {l.received_qty}</span></span></p>
    {/each}
    {#if open.total_cents !== undefined}<p class="text-right font-semibold">Total {cur(open.total_cents, open.currency)}{open.currency !== "CAD" ? " (" + money(open.total_cad_cents) + ")" : ""}</p>{/if}
    {#if open.notes}<p class="text-sm">{open.notes}</p>{/if}
    <div class="flex flex-wrap gap-2">
      <button class="btn-ghost min-h-10 text-sm" onclick={pdf}>PDF</button>
      {#if manage && open.status === "draft"}<button class="btn min-h-10 text-sm" onclick={() => act("send")}>Send (marks sent, makes the PDF)</button><button class="btn-ghost min-h-10 text-sm" onclick={editDraft}>Change</button>{/if}
      {#if receiver && (open.status === "sent" || open.status === "partial")}<button class="btn min-h-10 text-sm" onclick={startReceive}>Receive</button>{/if}
      {#if manage && (open.status === "sent" || open.status === "partial")}<button class="btn-ghost min-h-10 text-sm" onclick={() => act("close")}>Close (no more coming)</button>{/if}
      {#if manage && (open.status === "draft" || open.status === "sent")}<button class="btn-danger min-h-10 text-sm" onclick={() => act("cancel")}>Cancel</button>{/if}
    </div>
    {#if recv}
      <form class="space-y-2 border-t border-line pt-2" onsubmit={sendReceive}>
        <p class="font-semibold">What arrived</p>
        {#each recv.lines as l (l.po_line)}
          <div class="grid gap-2 sm:grid-cols-[1fr_5rem_6rem_9rem]"><span class="text-sm">{l.name} <span class="text-muted">({l.left} left)</span></span>
            <input class="field min-h-10 py-1" type="number" min="0" step="any" bind:value={l.qty} aria-label="Quantity arrived" />
            <input class="field min-h-10 py-1" inputmode="decimal" bind:value={l.cost} aria-label="Cost on the bill" title="Cost on the bill (per unit)" />
            <input class="field min-h-10 py-1" type="date" bind:value={l.expiry} aria-label="Expiry date" title="Expiry (perishables)" /></div>
        {/each}
        <label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={recv.close} /> The rest will not come: close the order</label>
        <input class="field" bind:value={recv.note} maxlength="1000" placeholder="Note (optional)" aria-label="Note" />
        <div class="flex gap-2"><button class="btn" type="submit">Receive into stock</button><button class="btn-ghost" type="button" onclick={() => (recv = null)}>Cancel</button></div>
      </form>
    {/if}
    {#each open.receipts as r (r.id)}
      <p class="text-sm"><b>Received</b> {new Date(r.at.replace(" ", "T")).toLocaleString()} by {r.by}{r.differences.length ? "" : " · as ordered ✓"}</p>
      {#each r.differences as d, i (i)}<p class="pl-4 text-sm text-warn">⚠ {(open.lines.find((l) => l.product === d.product) || {}).product_name || "Item"}: {DIFF[d.kind]}{d.ordered !== undefined ? " (ordered " + d.ordered + ", received " + d.received + ")" : ""}{d.kind === "cost" ? " (" + cur(d.ordered_cost_cents, open.currency) + " → " + cur(d.received_cost_cents, open.currency) + ")" : ""}</p>{/each}
    {/each}
  </div>
{:else}
  <div class="flex flex-wrap items-center gap-2">
    {#each [["open", "Open"], ["all", "All"]] as [k, l] (k)}<button class="min-h-10 rounded-lg px-3 text-sm {show === k ? 'bg-soft font-semibold' : 'border border-line'}" onclick={() => { show = k; load(); }}>{l}</button>{/each}
    {#if manage}<button class="btn ml-auto min-h-10 text-sm" onclick={newDraft}>New order</button>{/if}
  </div>
  {#if manage && needs.length}
    <div class="card space-y-1">
      <div class="flex flex-wrap justify-between gap-2"><p class="font-semibold">{needs.length} product(s) at or below their reorder point</p><button class="btn min-h-10 text-sm" onclick={reorder}>Make the orders</button></div>
      <p class="text-sm text-muted">{needs.slice(0, 12).map((n) => n.name + " (" + n.on_hand + (n.incoming ? " + " + n.incoming + " coming" : "") + ")").join(" · ")}{needs.length > 12 ? " …" : ""}</p>
    </div>
  {/if}
  {#each orders as o (o.id)}
    <button class="card flex w-full flex-wrap items-center justify-between gap-2 text-left" onclick={() => openPO(o.id)}>
      <span><span class="block font-semibold">{o.number} · {o.vendor_name}</span><span class="block text-sm text-muted">{o.order_date}{o.expected_date ? " → " + o.expected_date : ""} · {o.line_count} lines{o.differences ? " · ⚠ differences" : ""}</span></span>
      <span class="text-right"><span class="block text-sm {o.status === 'partial' || o.status === 'sent' ? 'text-warn' : o.status === 'received' ? 'text-ok' : 'text-muted'}">{STATUS[o.status]}</span>{#if o.total_cents !== undefined}<b>{cur(o.total_cents, o.currency)}</b>{/if}</span>
    </button>
  {:else}<p class="text-muted">No {show === "open" ? "open " : ""}orders.</p>{/each}
{/if}

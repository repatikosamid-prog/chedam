<script>
  // Buy a product (T3, 2026-10-11): how many you need, and the best supplier for it. The hub ranks every vendor that
  // sells it by cost in CAD per unit (their price list, else the last price paid), with the last purchase, price
  // changes, lead time, minimum and consignment, and how to reach them. Then: a draft purchase order, or for a
  // vendor's own website (portal) a quick-order file of their codes and quantities to upload there, and the
  // portal opened next to it. Chedam never signs in to a vendor's portal or submits an order on it.
  import { api } from "../../lib/api.js";
  import { can, handleRefusal } from "../../lib/session.svelte.js";
  import { money } from "../../lib/catalogue.js";

  let { productId = "" } = $props();
  let q = $state(""), hits = $state([]), product = $state(productId), qty = $state(""), res = $state(null), error = $state(""), ok = $state(""), busy = $state(false);
  const manage = can("purchasing.manage");
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };

  async function find() {
    const t = q.trim().replace(/['\\]/g, "");
    if (!t) { hits = []; return; }
    const r = await api("GET", "/api/collections/products/records?perPage=10&sort=name&fields=id,name,brand&filter=" + encodeURIComponent(`deleted_at='' && status!='archived' && (name~'${t}' || brand~'${t}')`), null, { quiet: true });
    hits = r.ok ? r.json.items : [];
  }
  async function rank(id) {
    if (id) product = id;
    error = ""; ok = ""; busy = true; hits = [];
    const r = await api("GET", `/api/chedam/purchasing/best-supplier?product=${product}&qty=${Number(qty) || 0}`);
    busy = false;
    if (!r.ok) return fail(r);
    res = r.json;
    if (!qty && res.product.reorder_max) qty = String(Math.max(0, res.product.reorder_max - res.product.on_hand));
  }
  if (productId) rank(productId);

  async function draft(v) {
    const units = v.order_units || Math.max(1, Math.ceil((Number(qty) || 1) / (v.pack_qty || 1)));
    const r = await api("POST", "/api/chedam/purchase-orders", { vendor: v.vendor, lines: [{ product: res.product.id, qty: units, cost_cents: v.order_unit_cents || undefined }] });
    if (!r.ok) return fail(r);
    ok = `Draft order for ${v.vendor_name} made (${units} × ${v.vendor_sku || res.product.name}). Purchase orders → send it, or order on their portal.`;
  }
  // Their codes and quantities, as most vendor portals take in "quick order" / "upload a list"
  function quickOrder(v) {
    const units = v.order_units || Math.max(1, Math.ceil((Number(qty) || 1) / (v.pack_qty || 1)));
    const csv = "item,quantity\r\n" + [v.vendor_sku || res.product.name, units].map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(",") + "\r\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `order-${v.vendor_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    if (v.ordering.portal_url) window.open(v.ordering.portal_url, "_blank", "noopener");
  }
</script>

<div class="space-y-3">
  <div class="card grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
    <label class="block"><span class="text-sm text-muted">Product</span><input class="field" bind:value={q} oninput={find} placeholder={res ? res.product.name : "Name or brand"} autocomplete="off" /></label>
    <label class="block"><span class="text-sm text-muted">How many ({res ? res.product.base_unit : "units"})</span><input class="field" type="number" min="0" step="any" bind:value={qty} /></label>
    <div class="flex items-end"><button class="btn" disabled={!product || busy} onclick={() => rank()}>{busy ? "Checking…" : "Find the best supplier"}</button></div>
    {#if hits.length}<div class="flex flex-wrap gap-1 sm:col-span-3">{#each hits as h (h.id)}<button class="btn-ghost min-h-10 text-sm" onclick={() => { q = h.name; rank(h.id); }}>{h.name}{h.brand ? " · " + h.brand : ""}</button>{/each}</div>{/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}
  {#if res}
    <p class="text-sm"><b>{res.product.name}</b>: {res.product.on_hand} on hand{res.product.reorder_point ? " · reorder at " + res.product.reorder_point : ""}{res.product.reorder_max ? " · up to " + res.product.reorder_max : ""}</p>
    {#each res.vendors as v (v.vendor)}
      <div class="card space-y-1 {v.best ? 'border-ok' : ''}">
        <p class="flex flex-wrap justify-between gap-2"><span class="font-semibold">{v.best ? "★ Best: " : ""}{v.vendor_name}</span>
          <span>{v.cad_per_base !== null ? money(Math.round(v.cad_per_base)) + " per " + res.product.base_unit : "no price"} <span class="text-sm text-muted">({v.basis})</span></span></p>
        {#if v.reasons.length}<p class="text-sm text-muted">{v.reasons.join(" · ")}</p>{/if}
        {#if v.order_units}<p class="text-sm">Order {v.order_units} × {v.vendor_sku || "their unit"}{v.pack_qty > 1 ? " (" + v.pack_qty + " each)" : ""}{v.order_unit_cents ? " at " + money(v.order_unit_cents) + (v.currency !== "CAD" ? " " + v.currency : "") : ""}</p>{/if}
        <p class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {#if v.contact}<span>{v.contact.name}</span>{#if v.contact.phone}<a class="underline" href={"tel:" + v.contact.phone}>📞 {v.contact.phone}</a>{/if}{#if v.contact.email}<a class="underline" href={"mailto:" + v.contact.email}>✉ {v.contact.email}</a>{/if}{/if}
          {#if v.ordering.email && (!v.contact || v.contact.email !== v.ordering.email)}<a class="underline" href={"mailto:" + v.ordering.email}>✉ orders: {v.ordering.email}</a>{/if}
          {#if v.ordering.portal_url}<a class="underline" href={v.ordering.portal_url} target="_blank" rel="noopener">🌐 their portal{v.ordering.portal_account ? " (account " + v.ordering.portal_account + ")" : ""}</a>{/if}
          {#if v.ordering.cutoff}<span class="text-muted">order by {v.ordering.cutoff}</span>{/if}
        </p>
        {#if manage}<div class="flex flex-wrap gap-2">
          <button class="btn-ghost min-h-10 text-sm" onclick={() => draft(v)}>Make a draft order</button>
          {#if v.ordering.portal_url || v.ordering.method === "portal"}<button class="btn-ghost min-h-10 text-sm" onclick={() => quickOrder(v)}>Quick-order file + open portal</button>{/if}
        </div>{/if}
      </div>
    {:else}<p class="text-muted">No vendor sells this yet: add it in Vendor prices, or set the product's Supplier.</p>{/each}
  {/if}
</div>

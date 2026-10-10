<script>
  // Layaways, special orders and quotes (P3 step 7; FR-3.18, 3.19, 6.10): the open ones by kind; a new one (who:
  // a client with an account, or a name and phone; the items; a deposit at this till); one order's deposits
  // (take more, give back), ordered / arrived, cancel (deposit back or kept by a manager), a quote turned into
  // a layaway, special order or invoice, and "Ring up at the till" (the deposit is used when paying).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { s, go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import { docPdf } from "../lib/doc_pdf.js";

  const KIND = { layaway: "Layaway", special_order: "Special order", quote: "Quote" };
  const STATUS = { open: "Open", ordered: "Ordered", ready: "Ready for pickup", picked_up: "Picked up", cancelled: "Cancelled", expired: "Expired", converted: "Turned into an order or invoice" };
  let kind = $state("layaway"), showAll = $state(false), items = $state([]), clients = $state([]), till = $state(null), error = $state(""), ok = $state("");
  let open = $state(null), form = $state(null), q = $state(""), hits = $state([]);
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };

  async function load() {
    error = "";
    const r = await api("GET", `/api/chedam/client-orders?kind=${kind}${showAll ? "" : "&open=1"}`);
    if (r.ok) items = r.json.items; else await fail(r);
    if (!till) { const t = await api("GET", "/api/chedam/tills/current", null, { quiet: true }); till = t.ok ? t.json.till : null; }
    if (!clients.length && can("parties.view")) { const p = await api("GET", "/api/collections/parties/records?perPage=200&sort=name&filter=" + encodeURIComponent("deleted_at='' && kind!='vendor'"), null, { quiet: true }); if (p.ok) clients = p.json.items; }
  }
  onMount(load);

  async function find() {
    const t = q.trim().replace(/'/g, "");
    if (!t) { hits = []; return; }
    const r = await api("GET", "/api/collections/selling_units/records?perPage=12&expand=product&filter=" + encodeURIComponent(`deleted_at='' && product.name~'${t}' && product.status='active'`), null, { quiet: true });
    hits = r.ok ? r.json.items : [];
  }
  const addLine = (u) => { form.lines = [...form.lines, { product: u.product, selling_unit: u.id, name: (u.expand && u.expand.product ? u.expand.product.name : "") + " · " + u.name, qty: 1, price: (u.price_cents / 100).toFixed(2) }]; hits = []; q = ""; };
  const total = $derived(form ? form.lines.reduce((a, l) => a + Math.round(Number(l.qty) * Number(l.price) * 100), 0) : 0);
  async function save(e) {
    e.preventDefault();
    const body = { kind: form.kind, party: form.party || undefined, name: form.name, phone: form.phone, notes: form.notes, due_date: form.due || undefined,
      lines: form.lines.map((l) => ({ product: l.product, selling_unit: l.selling_unit, qty: Number(l.qty), price_cents: Math.round(Number(l.price) * 100) })),
      deposit: form.deposit ? { amount_cents: Math.round(Number(form.deposit) * 100), method: form.method, till: till ? till.id : "" } : undefined };
    const r = await api("POST", "/api/chedam/client-orders", body);
    if (!r.ok) return fail(r);
    form = null; open = r.json; load();
  }
  async function act(action, body = {}) {
    const r = await api("POST", `/api/chedam/client-orders/${open.id}/${action}`, body);
    if (!r.ok) return fail(r);
    open = r.json; load();
  }
  async function money2(action) {
    const v = prompt(action === "pay" ? "Amount taken ($):" : "Amount given back ($):", action === "refund" ? (open.deposit_left_cents / 100).toFixed(2) : "");
    if (!v) return;
    const method = confirm("Card? (OK = card, Cancel = cash)") ? "card" : "cash";
    act(action, { amount_cents: Math.round(Number(v) * 100), method, till: till ? till.id : "" });
  }
  function cancel() {
    if (!confirm("Cancel " + open.number + "?")) return;
    if (open.deposit_left_cents > 0) {
      const keep = can("sales.approve") && confirm("Keep the deposit of " + money(open.deposit_left_cents) + "? (OK = keep it, Cancel = give it back)");
      act("cancel", { refund: keep ? { keep: true } : { method: confirm("Give it back by card? (OK = card, Cancel = cash)") ? "card" : "cash", till: till ? till.id : "" } });
    } else act("cancel", {});
  }
  function ringUp() { s.tillOrder = open.id; go("sell"); }
  async function pdf() {
    const b = s.brand || {};
    const doc = await docPdf({ title: KIND[open.kind].toUpperCase(), number: open.number, date: open.created_at.substring(0, 10), store: { name: b.name || "", address: [] }, party: { name: open.who, address: [], contact: open.phone }, partyLabel: "For",
      meta: [[open.kind === "quote" ? "Valid until" : "Pick up by", open.due_date]],
      columns: [{ label: "Item", w: 100 }, { label: "Qty", w: 15, align: "right" }, { label: "Price", w: 22, align: "right" }, { label: "Total", w: 22, align: "right" }],
      rows: open.lines.map((l) => [l.name, l.qty, (l.price_cents / 100).toFixed(2), (l.total_cents / 100).toFixed(2)]),
      totals: [["Total before tax", (open.total_cents / 100).toFixed(2)], ["Deposit paid", (open.paid_cents / 100).toFixed(2)]], notes: open.notes });
    doc.save(open.number + ".pdf");
  }
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => (open || form ? ((open = null), (form = null)) : go("home"))}>← {open || form ? "Orders" : "Back"}</button><h1 class="text-xl font-bold">{open ? KIND[open.kind] + " " + open.number : "Customer orders"}</h1></div>
    {#if !open && !form}<button class="btn min-h-10 text-sm" onclick={() => (form = { kind, party: "", name: "", phone: "", notes: "", due: "", lines: [], deposit: "", method: "cash" })}>New {KIND[kind].toLowerCase()}</button>{/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if form}
    <form class="card space-y-2" onsubmit={save}>
      <div class="grid gap-2 sm:grid-cols-3">
        {#if clients.length}<label class="block"><span class="text-sm text-muted">Client with an account (optional)</span><select class="field" bind:value={form.party}><option value="">None</option>{#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select></label>{/if}
        {#if !form.party}<label class="block"><span class="text-sm text-muted">First name</span><input class="field" bind:value={form.name} maxlength="80" /></label>
          <label class="block"><span class="text-sm text-muted">Phone (to call when ready)</span><input class="field" bind:value={form.phone} maxlength="30" inputmode="tel" /></label>{/if}
      </div>
      <input class="field" bind:value={q} oninput={find} placeholder="Add an item: type its name" aria-label="Find an item" />
      <div class="flex flex-wrap gap-1">{#each hits as u (u.id)}<button type="button" class="btn-ghost min-h-8 text-sm" onclick={() => addLine(u)}>{u.expand && u.expand.product ? u.expand.product.name : ""} · {u.name} · {money(u.price_cents)}</button>{/each}</div>
      {#each form.lines as l, i (i)}
        <div class="grid grid-cols-[1fr_4rem_6rem_auto] items-center gap-2"><span class="text-sm">{l.name}</span><input class="field min-h-10 py-1" type="number" min="1" step="1" bind:value={l.qty} aria-label="Quantity" />
          <input class="field min-h-10 py-1" inputmode="decimal" bind:value={l.price} aria-label="Price each" disabled={form.kind !== "quote"} /><button type="button" class="text-bad" aria-label="Remove" onclick={() => (form.lines = form.lines.filter((_, k) => k !== i))}>✕</button></div>
      {/each}
      <p class="text-right">Total before tax <b>{money(total)}</b></p>
      <div class="grid gap-2 sm:grid-cols-3">
        <label class="block"><span class="text-sm text-muted">{form.kind === "quote" ? "Valid until" : form.kind === "layaway" ? "Pick up by" : "Expected"}</span><input class="field" type="date" bind:value={form.due} /></label>
        {#if form.kind !== "quote"}
          <label class="block"><span class="text-sm text-muted">Deposit now ($){form.kind === "layaway" ? " · at least 20%" : ""}</span><input class="field" inputmode="decimal" bind:value={form.deposit} /></label>
          <label class="block"><span class="text-sm text-muted">Paid by</span><select class="field" bind:value={form.method}><option value="cash">Cash</option><option value="card">Card</option></select></label>
        {/if}
      </div>
      {#if form.kind !== "quote" && !till}<p class="text-sm text-warn">Open the till on this device to take the deposit.</p>{/if}
      <input class="field" bind:value={form.notes} maxlength="1000" placeholder="Notes (size, colour, when to call…)" aria-label="Notes" />
      <div class="flex gap-2"><button class="btn" type="submit" disabled={!form.lines.length}>Save</button><button class="btn-ghost" type="button" onclick={() => (form = null)}>Cancel</button></div>
    </form>
  {:else if open}
    <div class="card space-y-1">
      <p class="text-sm text-muted">{STATUS[open.status]} · for {open.who}{open.phone ? " (" + open.phone + ")" : ""} · {open.kind === "quote" ? "valid until" : "by"} {open.due_date || "—"}{open.reserved ? " · goods kept aside" : ""}</p>
      {#each open.lines as l, i (i)}<p class="flex justify-between text-sm"><span>{l.qty} × {l.name}</span><span>{money(l.total_cents)}</span></p>{/each}
      <p class="flex justify-between font-semibold"><span>Total before tax</span><span>{money(open.total_cents)}</span></p>
      {#if open.kind !== "quote"}<p class="flex justify-between text-sm"><span>Deposit paid{open.deposit_required_cents ? " (at least " + money(open.deposit_required_cents) + ")" : ""}</span><span>{money(open.paid_cents)}{open.applied_cents ? " · used " + money(open.applied_cents) : ""}</span></p>{/if}
      {#each open.payments as p (p.id)}<p class="text-xs text-muted">{new Date(p.at.replace(" ", "T")).toLocaleString()} · {p.kind === "deposit" ? "taken" : "given back"} {money(p.amount_cents)} by {p.method} · {p.by}</p>{/each}
      {#if open.notes}<p class="text-sm">{open.notes}</p>{/if}
      <div class="flex flex-wrap gap-2 pt-2">
        <button class="btn-ghost min-h-10 text-sm" onclick={pdf}>PDF</button>
        {#if ["open", "ready"].includes(open.status) && (open.kind !== "special_order" || open.status === "ready")}<button class="btn min-h-10 text-sm" onclick={ringUp}>Ring up at the till</button>{/if}
        {#if ["open", "ordered", "ready"].includes(open.status) && open.kind !== "quote"}<button class="btn-ghost min-h-10 text-sm" disabled={!till} onclick={() => money2("pay")}>Take a payment</button>
          {#if open.deposit_left_cents > 0}<button class="btn-ghost min-h-10 text-sm" disabled={!till} onclick={() => money2("refund")}>Give some back</button>{/if}{/if}
        {#if open.kind === "special_order" && open.status === "open"}<button class="btn-ghost min-h-10 text-sm" onclick={() => act("ordered", {})}>Ordered from the vendor</button>{/if}
        {#if open.kind === "special_order" && open.status === "ordered"}<button class="btn min-h-10 text-sm" onclick={() => act("ready", {})}>Arrived: ready for pickup</button>{/if}
        {#if open.kind === "quote" && open.status === "open"}
          <button class="btn-ghost min-h-10 text-sm" onclick={() => act("convert", { to: "layaway", deposit: { amount_cents: Math.ceil(open.total_cents * 0.2), method: "cash", till: till ? till.id : "" } })}>Make it a layaway (20% cash)</button>
          <button class="btn-ghost min-h-10 text-sm" onclick={() => act("convert", { to: "special_order" })}>Make it a special order</button>
          {#if open.party}<button class="btn-ghost min-h-10 text-sm" onclick={() => act("convert", { to: "invoice" })}>Make it an invoice</button>{/if}
        {/if}
        {#if ["open", "ordered", "ready"].includes(open.status)}<button class="btn-danger min-h-10 text-sm" onclick={cancel}>Cancel</button>{/if}
      </div>
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      {#each Object.entries(KIND) as [k, l] (k)}<button class="min-h-10 rounded-xl px-3 {kind === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { kind = k; load(); }}>{l}s</button>{/each}
      <label class="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={showAll} onchange={load} /> Show finished</label>
    </div>
    {#each items as o (o.id)}
      <button class="card flex w-full flex-wrap items-center justify-between gap-2 text-left" onclick={() => (open = o)}>
        <span><span class="block font-semibold">{o.number} · {o.who}</span><span class="block text-sm text-muted">{o.lines.length} items · {STATUS[o.status]}{o.due_date ? " · " + o.due_date : ""}</span></span>
        <span class="text-right"><b>{money(o.total_cents)}</b>{#if o.paid_cents}<span class="block text-xs text-muted">paid {money(o.paid_cents)}</span>{/if}</span>
      </button>
    {:else}<p class="text-muted">No {KIND[kind].toLowerCase()}s{showAll ? "" : " open"}.</p>{/each}
  {/if}
</section>

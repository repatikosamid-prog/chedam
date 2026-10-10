<script>
  // Bills and invoices (P3 step 4; FR-8.04): what we owe vendors (bills, vendor credits) and what clients owe
  // us (invoices, client credits); aging; one document with its payments (cheque, e-transfer, cash, card,
  // bank transfer, till cash, a credit applied), taking a payment off, void; a new document with lines, taxes
  // and a photo of the paper bill; a party's statement as a PDF.
  import { onMount } from "svelte";
  import { api } from "../../lib/api.js";
  import { can, handleRefusal, s } from "../../lib/session.svelte.js";
  import { money } from "../../lib/catalogue.js";
  import { docPdf } from "../../lib/doc_pdf.js";

  const fin = can("finance.manage");
  const KIND = { bill: "Bill", vendor_credit: "Vendor credit", invoice: "Invoice", client_credit: "Client credit" };
  const METHOD = { cheque: "Cheque", e_transfer: "E-transfer", bank_transfer: "Bank transfer", cash: "Cash", till_cash: "Cash from the till", card: "Card", credit: "Apply a credit" };
  let side = $state("payable"), show = $state("open"), list = $state({ items: [], aging: {} }), parties = $state([]), error = $state("");
  let open = $state(null), form = $state(null), payf = $state(null), stm = $state(null), fileToken = $state("");
  const today = () => new Date().toISOString().substring(0, 10);
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const amt = (c, cur) => (cur && cur !== "CAD" ? (c / 100).toFixed(2) + " " + cur : money(c));

  async function load() {
    error = "";
    const r = await api("GET", `/api/chedam/bills?side=${side}&status=${show === "open" ? "open" : ""}`);
    if (r.ok) list = r.json; else await fail(r);
    if (!parties.length) { const p = await api("GET", "/api/collections/parties/records?perPage=300&sort=name&filter=" + encodeURIComponent("deleted_at=''")); if (p.ok) parties = p.json.items; }
  }
  onMount(load);
  const sideParties = $derived(parties.filter((p) => p.kind === "both" || p.kind === (side === "payable" ? "vendor" : "client")));

  async function openDoc(id) {
    const r = await api("GET", "/api/chedam/bills/" + id);
    if (!r.ok) return fail(r);
    open = r.json; payf = null; stm = null;
    if (open.attachment.length) { const t = await api("POST", "/api/files/token", {}, { quiet: true }); fileToken = t.ok ? t.json.token : ""; }
  }
  function newDoc(kind) {
    form = { kind, party: sideParties[0] ? sideParties[0].id : "", party_ref: "", doc_date: today(), due_date: "", notes: "", gst: "", pst: "", files: [],
      lines: [{ description: "", qty: 1, unit: "" }] };
  }
  async function saveDoc(e) {
    e.preventDefault();
    const data = { kind: form.kind, party: form.party, party_ref: form.party_ref, doc_date: form.doc_date, due_date: form.due_date || undefined, notes: form.notes,
      lines: form.lines.filter((l) => l.description || l.unit).map((l) => ({ description: l.description, qty: Number(l.qty) || 1, unit_cents: Math.round(Number(l.unit) * 100) })),
      taxes: [form.gst ? { code: "GST", label: "GST/HST", cents: Math.round(Number(form.gst) * 100) } : null, form.pst ? { code: "PST", label: "PST", cents: Math.round(Number(form.pst) * 100) } : null].filter(Boolean) };
    let r;
    if (form.files.length) {
      const f = new FormData();
      f.append("data", JSON.stringify(data));
      form.files.forEach((x) => f.append("attachment", x));
      r = await api("POST", "/api/chedam/bills", f, { timeout: 30000 });
    } else r = await api("POST", "/api/chedam/bills", data);
    if (!r.ok) return fail(r);
    form = null; open = r.json; load();
  }
  const credits = $derived(open ? list.items.filter((x) => x.party === open.party && x.kind === (open.kind === "bill" ? "vendor_credit" : "client_credit") && x.balance_cents > 0 && x.currency === open.currency) : []);
  async function pay(e) {
    e.preventDefault();
    const r = await api("POST", `/api/chedam/bills/${open.id}/pay`, { day: payf.day, amount_cents: Math.round(Number(payf.amount) * 100), method: payf.method, reference: payf.reference, credit_doc: payf.credit });
    if (!r.ok) return fail(r);
    open = r.json; payf = null; load();
  }
  async function unpay(p) { if (!confirm("Take this payment off?")) return; const r = await api("POST", `/api/chedam/bill-payments/${p.id}/void`, {}); if (r.ok) { open = r.json; load(); } else fail(r); }
  async function voidIt() { const reason = prompt("Why is it void?"); if (!reason) return; const r = await api("POST", `/api/chedam/bills/${open.id}/void`, { reason }); if (r.ok) { open = r.json; load(); } else fail(r); }

  async function statement(partyId) {
    const r = await api("GET", `/api/chedam/parties/${partyId}/statement`);
    if (r.ok) { stm = r.json; open = null; } else fail(r);
  }
  async function statementPdf() {
    const p = stm.party, b = s.brand || {};
    const doc = await docPdf({ title: "STATEMENT", number: p.name, date: stm.to, store: { name: b.name || "", address: [] }, party: { name: p.name, address: [[p.street, p.city, p.province, p.postal_code].filter(Boolean).join(", ")] },
      meta: [["From", stm.from], ["Currency", p.currency]],
      columns: [{ label: "Date", w: 22 }, { label: "Document", w: 80 }, { label: "Amount", w: 25, align: "right" }, { label: "Balance", w: 25, align: "right" }],
      rows: [[stm.from, "Opening balance", "", (stm.opening_cents / 100).toFixed(2)]].concat(stm.rows.map((r) => [r.day, r.what + " " + r.ref, (r.amount_cents / 100).toFixed(2), (r.balance_cents / 100).toFixed(2)])),
      totals: [["Current", (stm.aging.current / 100).toFixed(2)], ["1-30 days late", (stm.aging.d30 / 100).toFixed(2)], ["31-60", (stm.aging.d60 / 100).toFixed(2)], ["61-90", (stm.aging.d90 / 100).toFixed(2)], ["Over 90", (stm.aging.over90 / 100).toFixed(2)], ["Balance " + p.currency, (stm.closing_cents / 100).toFixed(2)]] });
    doc.save("Statement " + p.name + " " + stm.to + ".pdf");
  }
</script>

{#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
{#if form}
  <form class="card space-y-2" onsubmit={saveDoc}>
    <p class="font-semibold">New {KIND[form.kind].toLowerCase()}</p>
    <div class="grid gap-2 sm:grid-cols-4">
      <label class="block sm:col-span-2"><span class="text-sm text-muted">{side === "payable" ? "Vendor" : "Client"}</span><select class="field" bind:value={form.party} required>{#each sideParties as p (p.id)}<option value={p.id}>{p.name} ({p.currency})</option>{/each}</select></label>
      <label class="block"><span class="text-sm text-muted">{side === "payable" ? "Their invoice no." : "Their PO no. (optional)"}</span><input class="field" bind:value={form.party_ref} maxlength="60" /></label>
      <label class="block"><span class="text-sm text-muted">Date</span><input class="field" type="date" bind:value={form.doc_date} /></label>
    </div>
    {#each form.lines as l, i (i)}
      <div class="grid grid-cols-[1fr_4rem_6rem_auto] gap-2"><input class="field min-h-10 py-1" bind:value={l.description} placeholder="What" aria-label="What" />
        <input class="field min-h-10 py-1" type="number" min="0" step="any" bind:value={l.qty} aria-label="Quantity" /><input class="field min-h-10 py-1" inputmode="decimal" bind:value={l.unit} placeholder="Each" aria-label="Amount each" />
        <button type="button" class="text-bad" aria-label="Remove line" onclick={() => (form.lines = form.lines.filter((_, k) => k !== i))}>✕</button></div>
    {/each}
    <button type="button" class="text-sm text-accent underline" onclick={() => (form.lines = [...form.lines, { description: "", qty: 1, unit: "" }])}>Add a line</button>
    <div class="grid gap-2 sm:grid-cols-4">
      <label class="block"><span class="text-sm text-muted">GST/HST</span><input class="field" inputmode="decimal" bind:value={form.gst} /></label>
      <label class="block"><span class="text-sm text-muted">PST</span><input class="field" inputmode="decimal" bind:value={form.pst} /></label>
      <label class="block"><span class="text-sm text-muted">Due (empty: from their terms)</span><input class="field" type="date" bind:value={form.due_date} /></label>
      <label class="block"><span class="text-sm text-muted">Photo or PDF of it</span><input class="field" type="file" accept="image/*,application/pdf" multiple onchange={(e) => (form.files = [...e.currentTarget.files].slice(0, 3))} /></label>
    </div>
    <input class="field" bind:value={form.notes} maxlength="2000" placeholder="Notes" aria-label="Notes" />
    <div class="flex gap-2"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (form = null)}>Cancel</button></div>
  </form>
{:else if stm}
  <div class="card space-y-1">
    <div class="flex flex-wrap justify-between gap-2"><p class="text-lg font-bold">Statement · {stm.party.name}</p>
      <div class="flex gap-2"><button class="btn-ghost min-h-10 text-sm" onclick={statementPdf}>PDF</button><button class="btn-ghost min-h-10 text-sm" onclick={() => (stm = null)}>Back</button></div></div>
    <p class="text-sm text-muted">{stm.from} to {stm.to} · {stm.party.currency}</p>
    <p class="flex justify-between text-sm"><span>Opening balance</span><span>{(stm.opening_cents / 100).toFixed(2)}</span></p>
    {#each stm.rows as r, i (i)}<p class="flex justify-between gap-2 border-b border-line text-sm"><span>{r.day} · {r.what} {r.ref}</span><span>{(r.amount_cents / 100).toFixed(2)} · <b>{(r.balance_cents / 100).toFixed(2)}</b></span></p>{/each}
    <p class="flex justify-between font-bold"><span>Balance</span><span>{(stm.closing_cents / 100).toFixed(2)} {stm.party.currency}</span></p>
    <p class="text-sm text-muted">Current {(stm.aging.current / 100).toFixed(2)} · 1-30 days late {(stm.aging.d30 / 100).toFixed(2)} · 31-60 {(stm.aging.d60 / 100).toFixed(2)} · 61-90 {(stm.aging.d90 / 100).toFixed(2)} · over 90 {(stm.aging.over90 / 100).toFixed(2)} (CAD)</p>
  </div>
{:else if open}
  <div class="card space-y-2">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div><p class="text-lg font-bold">{KIND[open.kind]} {open.number}{open.party_ref ? " · " + open.party_ref : ""}</p>
        <p class="text-sm text-muted">{open.party_name} · {open.doc_date} · due {open.due_date}{open.overdue_days ? " · " + open.overdue_days + " days late" : ""} · {open.status}{open.currency !== "CAD" ? " · " + open.currency + " at " + open.fx_rate : ""}</p></div>
      <button class="btn-ghost min-h-10 text-sm" onclick={() => (open = null)}>Back to the list</button>
    </div>
    {#if open.match_note}<p class="text-sm text-warn">⚠ {open.match_note}</p>{/if}
    {#each open.lines as l, i (i)}<p class="flex justify-between text-sm"><span>{l.description}{l.qty !== 1 ? " · " + l.qty + " × " + amt(l.unit_cents, open.currency) : ""}</span><span>{amt(l.total_cents, open.currency)}</span></p>{/each}
    {#each open.taxes as tx (tx.code)}<p class="flex justify-between text-sm text-muted"><span>{tx.label}</span><span>{amt(tx.cents, open.currency)}</span></p>{/each}
    <p class="flex justify-between font-bold"><span>Total</span><span>{amt(open.total_cents, open.currency)}{open.currency !== "CAD" ? " (" + money(open.total_cad_cents) + ")" : ""}</span></p>
    {#each open.payments as p (p.id)}<p class="flex flex-wrap justify-between gap-2 text-sm text-ok"><span>{p.day} · {METHOD[p.method] || p.method}{p.reference ? " " + p.reference : ""} · {p.by}</span>
      <span>−{amt(p.amount_cents, open.currency)} {#if fin}<button class="text-bad underline" onclick={() => unpay(p)}>Take off</button>{/if}</span></p>{/each}
    <p class="flex justify-between font-semibold"><span>Left to {open.kind === "invoice" || open.kind === "bill" ? "pay" : "use"}</span><span>{amt(open.balance_cents, open.currency)}</span></p>
    {#each open.attachment as a (a)}<a class="block text-sm underline" target="_blank" rel="noopener" href={`/api/files/${open.collectionId}/${open.id}/${a}?token=${fileToken}`}>📎 {a}</a>{/each}
    {#if open.notes}<p class="text-sm">{open.notes}</p>{/if}
    <div class="flex flex-wrap gap-2">
      {#if fin && (open.status === "open" || open.status === "partial") && (open.kind === "bill" || open.kind === "invoice")}<button class="btn min-h-10 text-sm" onclick={() => (payf = { day: today(), amount: (open.balance_cents / 100).toFixed(2), method: open.kind === "bill" ? "cheque" : "e_transfer", reference: "", credit: "" })}>{open.kind === "bill" ? "Record a payment" : "Record money received"}</button>{/if}
      <button class="btn-ghost min-h-10 text-sm" onclick={() => statement(open.party)}>Statement</button>
      {#if fin && open.status !== "void" && !open.paid_cents}<button class="btn-danger min-h-10 text-sm" onclick={voidIt}>Void</button>{/if}
    </div>
    {#if payf}
      <form class="grid gap-2 border-t border-line pt-2 sm:grid-cols-4" onsubmit={pay}>
        <label class="block"><span class="text-sm text-muted">Day</span><input class="field" type="date" bind:value={payf.day} /></label>
        <label class="block"><span class="text-sm text-muted">Amount ({open.currency})</span><input class="field" inputmode="decimal" bind:value={payf.amount} /></label>
        <label class="block"><span class="text-sm text-muted">How</span><select class="field" bind:value={payf.method}>{#each Object.entries(METHOD) as [k, l] (k)}{#if k !== "credit" || credits.length}<option value={k}>{l}</option>{/if}{/each}</select></label>
        {#if payf.method === "credit"}<label class="block"><span class="text-sm text-muted">Credit</span><select class="field" bind:value={payf.credit}>{#each credits as c (c.id)}<option value={c.id}>{c.number} · {amt(c.balance_cents, c.currency)}</option>{/each}</select></label>
        {:else}<label class="block"><span class="text-sm text-muted">Cheque no. / reference</span><input class="field" bind:value={payf.reference} maxlength="80" /></label>{/if}
        <div class="flex gap-2 sm:col-span-4"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (payf = null)}>Cancel</button></div>
      </form>
    {/if}
  </div>
{:else}
  <div class="flex flex-wrap items-center gap-2">
    {#each [["payable", "We owe (bills)"], ["receivable", "Owed to us (invoices)"]] as [k, l] (k)}<button class="min-h-10 rounded-lg px-3 text-sm {side === k ? 'bg-soft font-semibold' : 'border border-line'}" onclick={() => { side = k; load(); }}>{l}</button>{/each}
    {#each [["open", "Open"], ["all", "All"]] as [k, l] (k)}<button class="min-h-10 rounded-lg px-3 text-sm {show === k ? 'bg-soft font-semibold' : 'border border-line'}" onclick={() => { show = k; load(); }}>{l}</button>{/each}
    <span class="ml-auto flex gap-2">
      {#if side === "payable"}<button class="btn min-h-10 text-sm" onclick={() => newDoc("bill")}>New bill</button><button class="btn-ghost min-h-10 text-sm" onclick={() => newDoc("vendor_credit")}>Vendor credit</button>
      {:else if fin}<button class="btn min-h-10 text-sm" onclick={() => newDoc("invoice")}>New invoice</button><button class="btn-ghost min-h-10 text-sm" onclick={() => newDoc("client_credit")}>Client credit</button>{/if}
    </span>
  </div>
  {#if list.aging && list.aging.total !== undefined}
    <div class="card grid gap-1 text-sm sm:grid-cols-6">
      {#each [["Total open", list.aging.total], ["Not due", list.aging.current], ["1-30 late", list.aging.d30], ["31-60", list.aging.d60], ["61-90", list.aging.d90], ["Over 90", list.aging.over90]] as [l, v] (l)}
        <p>{l}<b class="block {l !== 'Total open' && l !== 'Not due' && v ? 'text-warn' : ''}">{money(v || 0)}</b></p>{/each}
    </div>
  {/if}
  {#each list.items as x (x.id)}
    <button class="card flex w-full flex-wrap items-center justify-between gap-2 text-left {x.overdue_days ? 'border-warn' : ''}" onclick={() => openDoc(x.id)}>
      <span><span class="block font-semibold">{KIND[x.kind]} {x.number}{x.party_ref ? " · " + x.party_ref : ""} · {x.party_name}</span>
        <span class="block text-sm text-muted">{x.doc_date} · due {x.due_date}{x.overdue_days ? " · " + x.overdue_days + " days late" : ""} · {x.status}</span></span>
      <span class="text-right"><b>{amt(x.balance_cents, x.currency)}</b><span class="block text-xs text-muted">of {amt(x.total_cents, x.currency)}</span></span>
    </button>
  {:else}<p class="text-muted">Nothing {show === "open" ? "open" : "here"}.</p>{/each}
{/if}

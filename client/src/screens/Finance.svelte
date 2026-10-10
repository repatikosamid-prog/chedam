<script>
  // Financial statements and tax returns (P4 step 9; FR-10.07, 10.08, 4.15), books.manage (the accountant; the
  // owner). From the books: profit and loss (with the period before), balance sheet, cash flow; the GST/HST
  // return (regular method) and the BC PST return with the commission; record a return as filed. Printable.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";

  let tab = $state("pnl"), error = $state(""), ok = $state(""), data = $state(null), filed = $state(null), extra = $state(""), form = $state(null);
  const today = () => new Date().toISOString().substring(0, 10);
  const lastMonth = () => { const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 0); const f = (x) => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); return [f(a), f(b)]; };
  let from = $state(lastMonth()[0]), to = $state(lastMonth()[1]);
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const c = (v) => Math.round(Number(String(v || "0").replace(/[$,\s]/g, "")) * 100) || 0;

  async function load() {
    error = ""; data = null;
    if (tab === "filed") { const r = await api("GET", "/api/chedam/tax-returns"); if (r.ok) filed = r.json; else await fail(r); return; }
    const qs = tab === "balance" ? `to=${to}` : `from=${from}&to=${to}` + (tab === "pnl" ? "&compare=1" : "") + (tab === "gst" && extra ? "&instalments_cents=" + c(extra) : "") + (tab === "pst" && extra ? "&self_assessed_cents=" + c(extra) : "");
    const r = await api("GET", `/api/chedam/statements/${tab}?${qs}`);
    if (r.ok) data = r.json; else await fail(r);
  }
  onMount(load);
  async function fileIt(e) {
    e.preventDefault();
    const b = { kind: tab, from, to, filed_on: form.filed_on, confirmation: form.confirmation, paid_on: form.paid_on, note: form.note };
    if (tab === "gst") b.instalments_cents = c(extra); else b.self_assessed_cents = c(extra);
    const r = await api("POST", "/api/chedam/tax-returns", b);
    if (!r.ok) return fail(r);
    ok = "Recorded as filed."; form = null;
  }
</script>

{#snippet rows(ls, total, label)}
  {#each ls as l (l.key)}<p class="flex justify-between pl-4 text-sm"><span>{l.code} {l.name}</span><span>{money(l.cents)}</span></p>{/each}
  <p class="flex justify-between border-t border-line font-semibold"><span>{label}</span><span>{money(total)}</span></p>
{/snippet}
{#snippet line(n, label, v, strong)}
  <p class="flex justify-between border-b border-line text-sm {strong ? 'font-semibold' : ''}"><span>{n ? n + " · " : ""}{label}</span><span>{money(v)}</span></p>
{/snippet}

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Statements and returns</h1></div>
    <button class="btn-ghost min-h-10 text-sm" onclick={() => window.print()}>Print</button>
  </div>
  <div class="flex flex-wrap gap-2">{#each [["pnl", "Profit and loss"], ["balance", "Balance sheet"], ["cashflow", "Cash flow"], ["gst", "GST/HST return"], ["pst", "PST return"], ["filed", "Filed returns"]] as [k, l] (k)}<button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; extra = ""; form = null; ok = ""; load(); }}>{l}</button>{/each}</div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if tab !== "filed"}
    <div class="card flex flex-wrap items-end gap-2">
      {#if tab !== "balance"}<label class="block"><span class="text-sm text-muted">From</span><input class="field" type="date" bind:value={from} /></label>{/if}
      <label class="block"><span class="text-sm text-muted">{tab === "balance" ? "On" : "To"}</span><input class="field" type="date" bind:value={to} /></label>
      {#if tab === "gst"}<label class="block"><span class="text-sm text-muted">Instalments paid ($)</span><input class="field w-32" inputmode="decimal" bind:value={extra} /></label>{/if}
      {#if tab === "pst"}<label class="block"><span class="text-sm text-muted">PST due on purchases ($)</span><input class="field w-32" inputmode="decimal" bind:value={extra} /></label>{/if}
      <button class="btn-ghost min-h-10" onclick={load}>Show</button>
    </div>
  {/if}

  {#if data && tab === "pnl"}
    <div class="card space-y-1">
      <h2 class="font-semibold">Profit and loss, {data.from} to {data.to}</h2>
      {@render rows(data.revenue, data.revenue_cents, "Revenue")}
      {@render rows(data.cost, data.cost_cents, "Cost of sales")}
      <p class="flex justify-between font-semibold"><span>Gross profit{data.gross_margin_pct != null ? " (" + data.gross_margin_pct + "%)" : ""}</span><span>{money(data.gross_profit_cents)}</span></p>
      {@render rows(data.expenses, data.expenses_cents, "Expenses")}
      <p class="flex justify-between font-semibold"><span>Operating income</span><span>{money(data.operating_cents)}</span></p>
      {#if data.other.length}{@render rows(data.other, data.other_cents, "Other income")}{/if}
      <p class="flex justify-between border-t-2 border-line text-lg font-bold"><span>Net income</span><span>{money(data.net_income_cents)}</span></p>
      {#if data.card_fees_estimate_cents}<p class="text-sm text-muted">Card fees not yet seen in the bank (estimated): {money(data.card_fees_estimate_cents)} → net {money(data.net_income_with_estimates_cents)}</p>{/if}
      {#if data.previous}<p class="text-sm text-muted">Period before ({data.previous.from} to {data.previous.to}): revenue {money(data.previous.revenue_cents)}, gross profit {money(data.previous.gross_profit_cents)}, net income {money(data.previous.net_income_cents)}</p>{/if}
    </div>
  {:else if data && tab === "balance"}
    <div class="card space-y-1">
      <h2 class="font-semibold">Balance sheet on {data.to}</h2>
      {@render rows(data.assets, data.assets_cents, "Total assets")}
      {@render rows(data.liabilities, data.liabilities_cents, "Total liabilities")}
      {@render rows(data.equity, data.equity_cents, "Owner's equity")}
      <p class="flex justify-between pl-4 text-sm"><span>Earnings to date</span><span>{money(data.earnings_cents)}</span></p>
      <p class="flex justify-between border-t-2 border-line font-bold"><span>Liabilities and equity</span><span>{money(data.liabilities_cents + data.equity_cents + data.earnings_cents)}</span></p>
      <p class={data.balanced ? "text-sm text-ok" : "text-sm text-bad"}>{data.balanced ? "Balanced" : "Not balanced: tell Claude"}</p>
    </div>
  {:else if data && tab === "cashflow"}
    <div class="card space-y-1">
      <h2 class="font-semibold">Cash flow, {data.from} to {data.to}</h2>
      {@render line("", "Cash at the start", data.opening_cents, true)}
      <p class="pt-2 text-sm font-semibold">Operating</p>
      {#each data.operating as x (x.label)}{@render line("", x.label, x.cents)}{/each}
      {@render line("", "Net from operating", data.operating_cents, true)}
      {#if data.financing.length}<p class="pt-2 text-sm font-semibold">Financing (loans, owner)</p>{#each data.financing as x (x.label)}{@render line("", x.label, x.cents)}{/each}{@render line("", "Net from financing", data.financing_cents, true)}{/if}
      {@render line("", "Cash at the end", data.closing_cents, true)}
      <p class="text-sm text-muted">Cash: tills and safe, petty cash, bank accounts, deposits in transit, payments not yet on a statement.</p>
    </div>
  {:else if data && tab === "gst"}
    <div class="card space-y-1">
      <h2 class="font-semibold">GST/HST return, {data.from} to {data.to} (regular method)</h2>
      {@render line("101", "Sales and other revenue", data.line101_cents)}
      {@render line("103", "GST/HST collected or collectible", data.line103_cents)}
      {@render line("104", "Adjustments", data.line104_cents)}
      {@render line("105", "Total GST/HST and adjustments", data.line105_cents, true)}
      {@render line("106", "Input tax credits (ITCs)", data.line106_cents)}
      {@render line("107", "Adjustments", data.line107_cents)}
      {@render line("108", "Total ITCs and adjustments", data.line108_cents, true)}
      {@render line("109", "Net tax", data.line109_cents, true)}
      {@render line("110", "Instalments paid", data.line110_cents)}
      {@render line("113A", data.refund ? "Refund claimed" : "Balance to pay", Math.abs(data.line113a_cents), true)}
    </div>
  {:else if data && tab === "pst"}
    <div class="card space-y-1">
      <h2 class="font-semibold">BC PST return, {data.from} to {data.to}</h2>
      {@render line("", "Sales subject to PST", data.sales_subject_cents)}
      {@render line("", "PST collected", data.collected_cents)}
      {@render line("", "Less the commission (" + data.commission_pct + "%)", data.commission_cents)}
      {@render line("", "PST due on purchases (self-assessed)", data.purchases_pst_cents)}
      {@render line("", "Net PST to remit", data.net_cents, true)}
    </div>
  {/if}
  {#if data && (tab === "gst" || tab === "pst")}
    {#if form}
      <form class="card grid gap-2 sm:grid-cols-4" onsubmit={fileIt}>
        <label class="block"><span class="text-sm text-muted">Filed on</span><input class="field" type="date" bind:value={form.filed_on} required /></label>
        <label class="block"><span class="text-sm text-muted">Confirmation no.</span><input class="field" bind:value={form.confirmation} maxlength="60" /></label>
        <label class="block"><span class="text-sm text-muted">Paid on</span><input class="field" type="date" bind:value={form.paid_on} /></label>
        <label class="block"><span class="text-sm text-muted">Note</span><input class="field" bind:value={form.note} maxlength="300" /></label>
        <div class="flex gap-2 sm:col-span-4"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (form = null)}>Cancel</button></div>
      </form>
    {:else}<button class="btn min-h-10 text-sm" onclick={() => (form = { filed_on: today(), confirmation: "", paid_on: "", note: "" })}>Record as filed</button>{/if}
  {/if}
  {#if tab === "filed" && filed}
    {#each filed.items as x (x.id)}
      <div class="card flex flex-wrap justify-between gap-2 text-sm"><span><b>{x.kind === "gst" ? "GST/HST" : "PST"}</b> · {x.period_from} to {x.period_to} · filed {x.filed_on}{x.confirmation ? " · " + x.confirmation : ""} · {x.by_name}</span><span>{x.net_cents < 0 ? "refund " + money(-x.net_cents) : money(x.net_cents)}{x.paid_on ? " · paid " + x.paid_on : ""}</span></div>
    {:else}<p class="text-muted">No returns recorded yet.</p>{/each}
  {/if}
</section>

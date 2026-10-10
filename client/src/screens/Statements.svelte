<script>
  // Fees and statements (P4 step 7; FR-10.05, 8.10, 10.04), finance.manage.
  // Card fees: card payments by card type with the estimated fee (rates in setting cards.fees) and the actual
  // fee where the bank's card deposits were matched. Platform payouts: enter a delivery platform's payout
  // statement (and paste its order list) to check it against Chedam's orders; matched to the bank by itself.
  // Vendor statements: enter or paste the vendor's statement to check it against the bills.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import ExportMenu from "../components/ExportMenu.svelte";

  const TYPE = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", interac: "Debit (Interac)", discover: "Discover", other: "Other", not_given: "Type not given" };
  let tab = $state("fees"), error = $state(""), ok = $state("");
  const first = () => new Date().toISOString().substring(0, 8) + "01", today = () => new Date().toISOString().substring(0, 10);
  let from = $state(first()), to = $state(today()), fees = $state(null), pays = $state(null), pform = $state(null), vendors = $state([]), stm = $state(null), vform = $state(null), last = $state(null);
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const c = (v) => Math.round(Number(String(v || "0").replace(/[$,\s]/g, "")) * 100) || 0;

  async function load() {
    error = "";
    if (tab === "fees") { const r = await api("GET", `/api/chedam/card-fees?from=${from}&to=${to}`); if (r.ok) fees = r.json; else await fail(r); }
    if (tab === "payouts") { const r = await api("GET", "/api/chedam/payouts"); if (r.ok) pays = r.json; else await fail(r); }
    if (tab === "vendors") {
      if (!vendors.length) { const r = await api("GET", "/api/collections/parties/records?perPage=200&sort=name&filter=" + encodeURIComponent("deleted_at='' && (kind='vendor' || kind='both')"), null, { quiet: true }); vendors = r.ok ? (r.json.items || []) : []; }
      const r = await api("GET", "/api/chedam/vendor-statements"); if (r.ok) stm = r.json; else await fail(r);
    }
  }
  onMount(load);
  // "number, amount" per line (a copy from the platform's or vendor's statement)
  const rows = (text) => String(text || "").split(/\r?\n/).map((l) => l.split(/[,\t;]/).map((x) => x.trim())).filter((x) => x[0]);
  async function savePayout(e) {
    e.preventDefault();
    const b = { platform: pform.platform, period_from: pform.from, period_to: pform.to, day: pform.day, gross_cents: c(pform.gross), commission_cents: c(pform.commission), fees_cents: c(pform.fees),
      adjustments_cents: c(pform.adjustments), payout_cents: c(pform.payout), note: pform.note, orders: rows(pform.orders).map((x) => ({ number: x[0], amount_cents: c(x[x.length - 1]) })) };
    const r = await api("POST", "/api/chedam/payouts", b);
    if (!r.ok) return fail(r);
    last = r.json; pform = null; load();
  }
  async function cancelPayout(x) { const r = await api("POST", `/api/chedam/payouts/${x.id}/cancel`, {}); if (r.ok) load(); else fail(r); }
  async function saveStatement(e) {
    e.preventDefault();
    const b = { party: vform.party, statement_date: vform.date, closing_balance_cents: c(vform.closing), note: vform.note,
      lines: rows(vform.lines).map((x) => ({ ref: x[0], amount_cents: c(x[1]), kind: /pay/i.test(x[2] || "") ? "payment" : /cr/i.test(x[2] || "") ? "credit" : "invoice", day: x[3] || "" })) };
    const r = await api("POST", "/api/chedam/vendor-statements", b);
    if (!r.ok) return fail(r);
    last = r.json; vform = null; load();
  }
</script>

{#snippet payoutCheck(x)}
  <p class="text-sm">Chedam: {x.check.chedam_orders} orders, {money(x.check.chedam_total_cents)} · statement gross {money(x.gross_cents)}{x.check.gross_difference_cents ? " · difference " + money(x.check.gross_difference_cents) : " ✓"}</p>
  {#each x.check.missing_on_statement || [] as o (o.number)}<p class="text-sm text-warn">⚠ {o.number} ({money(o.total_cents)}) is in Chedam but not on the statement</p>{/each}
  {#each x.check.not_in_chedam || [] as o (o.number)}<p class="text-sm text-warn">⚠ {o.number} ({money(o.amount_cents)}) is on the statement but not in Chedam</p>{/each}
  {#each x.check.amount_differences || [] as o (o.number)}<p class="text-sm text-warn">⚠ {o.number}: Chedam {money(o.chedam_cents)}, statement {money(o.statement_cents)}</p>{/each}
{/snippet}
{#snippet vendorCheck(x)}
  <p class="text-sm">Statement {money(x.closing_balance_cents)} · Chedam {money(x.check.chedam_balance_cents)} as of {x.statement_date}{x.difference_cents ? " · difference " + money(x.difference_cents) : " ✓"}</p>
  {#if x.check.agreed && x.check.agreed.length}<p class="text-sm text-ok">{x.check.agreed.length} agreed</p>{/if}
  {#each x.check.amount_differences || [] as o (o.ref)}<p class="text-sm text-warn">⚠ {o.ref} ({o.number}): Chedam {money(o.chedam_cents)}, statement {money(o.statement_cents)}</p>{/each}
  {#each x.check.missing_in_chedam || [] as o (o.ref)}<p class="text-sm text-bad">⚠ {o.ref} {o.day} {money(o.amount_cents)}: not recorded in Chedam (record the bill)</p>{/each}
  {#each x.check.not_on_statement || [] as o (o.number)}<p class="text-sm text-warn">⚠ {o.number} {o.party_ref ? "(" + o.party_ref + ")" : ""} {o.doc_date}: {money(o.balance_cents)} open in Chedam, not on the statement</p>{/each}
{/snippet}

<section class="space-y-4">
  <div class="screen-head"><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Fees and statements</h1></div>
  <div class="flex flex-wrap gap-2">{#each [["fees", "Card fees"], ["payouts", "Platform payouts"], ["vendors", "Vendor statements"]] as [k, l] (k)}<button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; last = null; load(); }}>{l}</button>{/each}</div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if tab === "fees" && fees}
    <div class="card flex flex-wrap items-end gap-2">
      <label class="block"><span class="text-sm text-muted">From</span><input class="field" type="date" bind:value={from} /></label>
      <label class="block"><span class="text-sm text-muted">To</span><input class="field" type="date" bind:value={to} /></label>
      <button class="btn-ghost min-h-10" onclick={load}>Show</button>
      <ExportMenu title="Card fees" rows={fees.days} columns={[{ key: "day", label: "Day" }, { key: "a", label: "Card sales", value: (d) => d.amount_cents / 100 }, { key: "e", label: "Estimated fee", value: (d) => d.est_fee_cents / 100 }, { key: "x", label: "Actual fee", value: (d) => (d.actual_fee_cents === null ? "" : d.actual_fee_cents / 100) }]} />
    </div>
    <div class="card overflow-x-auto">
      <table class="w-full min-w-[480px] text-sm">
        <thead><tr class="text-left"><th>Card type</th><th>Payments</th><th>Amount</th><th>Estimated fee</th><th>Rate</th></tr></thead>
        <tbody>{#each fees.types as x (x.card_type)}<tr class="border-t border-line"><td>{TYPE[x.card_type]}</td><td>{x.payments}</td><td>{money(x.amount_cents)}</td><td>{money(x.est_fee_cents)}</td><td>{x.est_rate_pct}%</td></tr>{/each}
          <tr class="border-t border-line font-semibold"><td>All cards</td><td>{fees.total.payments}</td><td>{money(fees.total.amount_cents)}</td><td>{money(fees.total.est_fee_cents)}</td><td></td></tr></tbody>
      </table>
      <p class="mt-2 text-sm">Actual fees from the bank: {fees.total.actual_days ? money(fees.total.actual_fee_cents) + " on " + fees.total.actual_days + " days (" + fees.total.actual_rate_pct + "% of " + money(fees.total.actual_amount_cents) + ")" : "none matched yet (Bank → match the card deposits)"}</p>
      <p class="text-sm"><b>Fees for the period: {money(fees.total.fee_cents)}</b> <span class="text-muted">(actual where known, else estimated; goes to the P&L)</span></p>
    </div>
  {:else if tab === "payouts" && pays}
    <button class="btn min-h-10 text-sm" onclick={() => { last = null; pform = { platform: pays.names[0] || "", from: first(), to: today(), day: today(), gross: "", commission: "", fees: "", adjustments: "", payout: "", orders: "", note: "" }; }}>Enter a payout statement</button>
    {#if pform}
      <form class="card grid gap-2 sm:grid-cols-3" onsubmit={savePayout}>
        <label class="block"><span class="text-sm text-muted">Platform</span><select class="field" bind:value={pform.platform}>{#each pays.names as p (p)}<option value={p}>{p}</option>{/each}</select></label>
        <label class="block"><span class="text-sm text-muted">Orders from</span><input class="field" type="date" bind:value={pform.from} /></label>
        <label class="block"><span class="text-sm text-muted">to</span><input class="field" type="date" bind:value={pform.to} /></label>
        <label class="block"><span class="text-sm text-muted">Gross sales ($)</span><input class="field" inputmode="decimal" bind:value={pform.gross} required /></label>
        <label class="block"><span class="text-sm text-muted">Commission ($)</span><input class="field" inputmode="decimal" bind:value={pform.commission} /></label>
        <label class="block"><span class="text-sm text-muted">Other fees ($)</span><input class="field" inputmode="decimal" bind:value={pform.fees} /></label>
        <label class="block"><span class="text-sm text-muted">Adjustments (+/− $)</span><input class="field" inputmode="decimal" bind:value={pform.adjustments} /></label>
        <label class="block"><span class="text-sm text-muted">Payout ($)</span><input class="field" inputmode="decimal" bind:value={pform.payout} required /></label>
        <label class="block"><span class="text-sm text-muted">Paid on</span><input class="field" type="date" bind:value={pform.day} /></label>
        <label class="block sm:col-span-3"><span class="text-sm text-muted">Their orders (optional, one per line: order number, amount)</span><textarea class="field font-mono" rows="4" bind:value={pform.orders} placeholder="UE-1001, 23.50"></textarea></label>
        <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit">Check and save</button><button class="btn-ghost" type="button" onclick={() => (pform = null)}>Cancel</button></div>
      </form>
    {/if}
    {#if last && last.platform}<div class="card space-y-1"><p class="font-semibold">Saved: {last.platform} {last.period_from} to {last.period_to}</p>{@render payoutCheck(last)}</div>{/if}
    {#each pays.platforms as p (p.platform)}<p class="text-sm"><b>{p.platform}</b>: {p.statements} statements · gross {money(p.gross_cents)} · commission {money(p.commission_cents)} ({p.commission_pct}%) · fees {money(p.fees_cents)} · paid out {money(p.payout_cents)}</p>{/each}
    {#each pays.items as x (x.id)}
      <div class="card space-y-1">
        <p class="flex flex-wrap justify-between gap-2"><span><b>{x.platform}</b> · {x.period_from} to {x.period_to} · paid {x.day}</span><span>{money(x.payout_cents)} · <span class={x.status === "matched" ? "text-ok" : "text-warn"}>{x.status === "matched" ? "In the bank" : "Expected"}</span></span></p>
        <p class="text-sm text-muted">Gross {money(x.gross_cents)} · commission {money(x.commission_cents)} ({x.commission_pct}%) · fees {money(x.fees_cents)}{x.adjustments_cents ? " · adjustments " + money(x.adjustments_cents) : ""}</p>
        {@render payoutCheck(x)}
        {#if x.status === "expected"}<button class="text-sm underline" onclick={() => cancelPayout(x)}>Cancel</button>{/if}
      </div>
    {:else}<p class="text-muted">No payout statements yet.</p>{/each}
  {:else if tab === "vendors" && stm}
    <button class="btn min-h-10 text-sm" onclick={() => { last = null; vform = { party: vendors[0] ? vendors[0].id : "", date: today(), closing: "", lines: "", note: "" }; }}>Check a vendor statement</button>
    {#if vform}
      <form class="card grid gap-2 sm:grid-cols-3" onsubmit={saveStatement}>
        <label class="block"><span class="text-sm text-muted">Vendor</span><select class="field" bind:value={vform.party}>{#each vendors as v (v.id)}<option value={v.id}>{v.name}</option>{/each}</select></label>
        <label class="block"><span class="text-sm text-muted">Statement date</span><input class="field" type="date" bind:value={vform.date} /></label>
        <label class="block"><span class="text-sm text-muted">Balance owed on it ($)</span><input class="field" inputmode="decimal" bind:value={vform.closing} required /></label>
        <label class="block sm:col-span-3"><span class="text-sm text-muted">Its lines, one per line: their invoice number, amount, kind (invoice / credit / payment), date</span><textarea class="field font-mono" rows="6" bind:value={vform.lines} placeholder="CB-9001, 105.00, invoice, 2026-09-01"></textarea></label>
        <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit">Check</button><button class="btn-ghost" type="button" onclick={() => (vform = null)}>Cancel</button></div>
      </form>
    {/if}
    {#if last && last.party_name}<div class="card space-y-1"><p class="font-semibold">{last.party_name} · {last.statement_date}</p>{@render vendorCheck(last)}</div>{/if}
    {#each stm.items as x (x.id)}
      <div class="card space-y-1">
        <p class="flex flex-wrap justify-between gap-2"><span><b>{x.party_name}</b> · {x.statement_date} · {x.lines} lines · {x.by_name}</span><span class={x.status === "agreed" ? "text-ok" : "text-warn"}>{x.status === "agreed" ? "Agreed" : "Differences"}</span></p>
        {@render vendorCheck(x)}
      </div>
    {:else}<p class="text-muted">No vendor statements checked yet.</p>{/each}
  {/if}
</section>

<script>
  // Money and audit reports (P1 step 9). Tills: each till's cash and card against the card terminal's
  // settlement, sales after closing, reconcile (FR-10.01). Loss prevention: per cashier, with flags and the
  // events behind them (FR-10.11). Audit log: who changed what, when, on which device (FR-10.13).
  // Retention: what is kept and for how long (FR-10.09, BR-34). Promotions: each deal's results against the
  // period before (FR-5.12). Loyalty: members, points and what they are worth (FR-7.07). Every table can be exported.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money, toCents } from "../lib/catalogue.js";
  import ExportMenu from "../components/ExportMenu.svelte";

  const day = (off = 0) => { const d = new Date(Date.now() + off * 86400000), p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
  const tabs = [["tills", "Tills", can("sales.view") || can("till.manage")], ["loss", "Loss prevention", can("sales.view") || can("till.manage")],
    ["promos", "Promotions", can("sales.view") || can("promotions.manage")], ["loyalty", "Loyalty", can("sales.view") || can("customers.manage")],
    ["audit", "Audit log", can("events.view")], ["retention", "Retention", can("events.view") || can("settings.manage")]].filter((x) => x[2]);
  let tab = $state(tabs.length ? tabs[0][0] : "");
  let from = $state(day(-6)), to = $state(day());
  let error = $state(""), ok = $state(""), busy = $state(false);
  let rec = $state(null), recon = $state(null), loss = $state(null), detail = $state(null);
  let audit = $state(null), opts = $state(null), f = $state({ actor: "", device: "", table: "", action: "", record: "", page: 1 }), open = $state({});
  let ret = $state(null), promos = $state(null), loy = $state(null), openPromo = $state("");

  const when = (t) => (t ? new Date(String(t).replace(" ", "T")).toLocaleString() : "");
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };

  async function load() {
    error = ""; busy = true;
    if (tab === "tills") { const r = await api("GET", `/api/chedam/reports/tills?from=${from}&to=${to}`); if (r.ok) rec = r.json; else await fail(r); }
    if (tab === "loss") { detail = null; const r = await api("GET", `/api/chedam/reports/loss?from=${from}&to=${to}`); if (r.ok) loss = r.json; else await fail(r); }
    if (tab === "audit") {
      if (!opts) { const o = await api("GET", "/api/chedam/audit/options"); if (o.ok) opts = o.json; }
      const qs = new URLSearchParams({ from, to, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "" && v !== null)) });
      const r = await api("GET", "/api/chedam/audit?" + qs); if (r.ok) audit = r.json; else await fail(r);
    }
    if (tab === "promos") { const r = await api("GET", `/api/chedam/reports/promotions?from=${from}&to=${to}`); if (r.ok) promos = r.json; else await fail(r); }
    if (tab === "loyalty") { const r = await api("GET", `/api/chedam/reports/loyalty?from=${from}&to=${to}`); if (r.ok) loy = r.json; else await fail(r); }
    if (tab === "retention") { const r = await api("GET", "/api/chedam/retention"); if (r.ok) ret = r.json; else await fail(r); }
    busy = false;
  }
  onMount(load);

  async function showDetail(c) {
    const r = await api("GET", `/api/chedam/reports/loss?from=${from}&to=${to}&cashier=${c.cashier}`);
    if (r.ok) detail = r.json; else await fail(r);
  }

  async function reconcile(e) {
    e.preventDefault();
    const c = toCents(recon.amount);
    if (!(c >= 0)) { error = "Enter the card terminal's total for this till (0 if no cards)."; return; }
    const r = await api("POST", `/api/chedam/reports/tills/${recon.id}/reconcile`, { card_settlement_cents: c, settlement_ref: recon.ref, note: recon.note });
    if (!r.ok) return fail(r);
    ok = "Till " + r.json.number + " (Z " + r.json.shift + ") reconciled as batch " + r.json.batch_no + "."; recon = null; load();
  }

  // Change against the period before: "+12%", "new", "" (nothing either time)
  const delta = (now, then) => (!then ? (now ? "new" : "") : (now >= then ? "+" : "−") + Math.round(Math.abs(100 * (now - then) / then)) + "%");
  const TYPES = { pct_off: "% off", amount_off: "$ off", fixed_price: "Sale price", buy_get: "Buy X get Y", multi_price: "X for $Y", mix_match: "Mix and match", spend: "Spend threshold", markdown: "Markdown" };
  const show = (v) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
    <h1 class="text-xl font-bold">Reports</h1>
  </div>
  <div class="flex flex-wrap items-end gap-2">
    {#each tabs as [k, t] (k)}<button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; ok = ""; load(); }}>{t}</button>{/each}
  </div>
  {#if tab !== "retention"}
    <div class="flex flex-wrap items-end gap-2">
      <label class="block"><span class="text-sm text-muted">From</span><input class="field" type="date" bind:value={from} /></label>
      <label class="block"><span class="text-sm text-muted">To</span><input class="field" type="date" bind:value={to} /></label>
      <button class="btn" disabled={busy} onclick={() => { f.page = 1; load(); }}>{busy ? "Loading…" : "Show"}</button>
    </div>
  {/if}
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if tab === "tills" && rec}
    <div class="card flex flex-wrap justify-between gap-2">
      <p>{rec.totals.tills} tills · {rec.totals.sales} sales · {money(rec.totals.total_cents)} · cash over/short {money(rec.totals.cash_variance_cents)} · cards {money(rec.totals.card_cents)} / terminal {money(rec.totals.card_settlement_cents)}
        · <b class={rec.totals.unreconciled ? "text-warn" : "text-ok"}>{rec.totals.unreconciled} to reconcile</b></p>
      <ExportMenu title="Till reconciliation" rows={rec.tills} columns={[{ key: "number", label: "Till" }, { key: "device", label: "Device" }, { key: "opened_at", label: "Opened" }, { key: "closed_at", label: "Closed" },
        { key: "closed_by", label: "Closed by" }, { key: "sales", label: "Sales" }, { key: "total", label: "Total", value: (x) => x.total_cents / 100 },
        { key: "exp", label: "Cash expected", value: (x) => x.expected_cash_cents / 100 }, { key: "cnt", label: "Cash counted", value: (x) => (x.counted_cents === null ? "" : x.counted_cents / 100) },
        { key: "var", label: "Cash over/short", value: (x) => (x.cash_variance_cents === null ? "" : x.cash_variance_cents / 100) }, { key: "card", label: "Cards", value: (x) => x.card_cents / 100 },
        { key: "term", label: "Terminal", value: (x) => (x.card_settlement_cents === null ? "" : x.card_settlement_cents / 100) }, { key: "batch_no", label: "Batch" }, { key: "settlement_ref", label: "Terminal ref" },
        { key: "late_sales", label: "Sales after closing" }, { key: "reconciled_by", label: "Reconciled by" }, { key: "note", label: "Note" }, { key: "flags", label: "Flags", value: (x) => x.flags.join("; ") }]} />
    </div>
    {#each rec.tills as x (x.id)}
      <div class="card space-y-1 {x.flags.length ? 'border-warn' : ''}">
        <div class="flex flex-wrap justify-between gap-2">
          <p class="font-semibold">Till {x.number} · Z {x.shift} · {x.device} · {when(x.opened_at)}{x.closed_at ? " – " + when(x.closed_at) : " (open)"}{x.batch_no ? " · Batch " + x.batch_no : ""}</p>
          <p class="text-sm {x.reconciled_at ? 'text-ok' : 'text-muted'}">{x.reconciled_at ? "Reconciled by " + x.reconciled_by : x.status === "closed" ? "Not reconciled" : "Open"}</p>
        </div>
        <p class="text-sm">{x.sales} sales · {money(x.total_cents)}{x.returns_cents ? " · returns " + money(x.returns_cents) : ""} · opened by {x.opened_by}{x.closed_by ? ", closed by " + x.closed_by : ""}</p>
        <p class="text-sm">Cash: expected {money(x.expected_cash_cents)}{x.counted_cents !== null ? ", counted " + money(x.counted_cents) + " (" + (x.cash_variance_cents === 0 ? "balanced" : (x.cash_variance_cents < 0 ? "short " : "over ") + money(Math.abs(x.cash_variance_cents))) + ")" : ""}
          · Cards: {money(x.card_cents)}{x.card_settlement_cents !== null ? ", terminal " + money(x.card_settlement_cents) + (x.settlement_ref ? " (terminal ref " + x.settlement_ref + ")" : "") : ""}</p>
        {#each x.flags as fl (fl)}<p class="text-sm text-warn">⚠ {fl}</p>{/each}
        {#if x.note}<p class="text-sm text-muted">Note: {x.note}</p>{/if}
        {#if x.status === "closed" && can("till.manage")}
          {#if recon && recon.id === x.id}
            <form class="grid gap-2 sm:grid-cols-2" onsubmit={reconcile}>
              <label class="block"><span class="text-sm text-muted">Card terminal total for this till ($)</span><input class="field" inputmode="decimal" bind:value={recon.amount} /></label>
              <p class="block"><span class="block text-sm text-muted">Batch number</span><span class="flex min-h-12 items-center font-semibold">{x.batch_no || "Given when you reconcile"}</span></p>
              <label class="block"><span class="text-sm text-muted">Terminal's own reference (optional)</span><input class="field" bind:value={recon.ref} maxlength="60" /></label>
              <label class="block"><span class="text-sm text-muted">Note (needed when it does not balance)</span><input class="field" bind:value={recon.note} maxlength="500" /></label>
              <div class="flex gap-2 sm:col-span-2"><button class="btn" type="submit">Reconcile</button><button class="btn-ghost" type="button" onclick={() => (recon = null)}>Cancel</button></div>
            </form>
          {:else}
            <button class="btn-ghost min-h-10 text-sm" onclick={() => (recon = { id: x.id, amount: ((x.card_settlement_cents ?? x.card_cents) / 100).toFixed(2), ref: x.settlement_ref, note: x.note })}>{x.reconciled_at ? "Change" : "Reconcile"}</button>
          {/if}
        {/if}
      </div>
    {/each}
    {#if !rec.tills.length}<p class="text-muted">No tills in these dates.</p>{/if}
  {/if}

  {#if tab === "loss" && loss}
    <div class="card space-y-2">
      <div class="flex flex-wrap justify-between gap-2">
        <p class="text-sm text-muted">Flagged when a cashier's rate is {loss.settings.multiple}× the store's or more, with at least {loss.settings.min_count} events. A flag is a reason to look, not proof.</p>
        <ExportMenu title="Loss prevention" rows={loss.cashiers} columns={[{ key: "name", label: "Cashier" }, { key: "sales", label: "Sales" }, { key: "total", label: "Sales $", value: (x) => x.total_cents / 100 },
          { key: "voided_sales", label: "Voided sales" }, { key: "removed_lines", label: "Removed lines" }, { key: "discount", label: "Discounts $", value: (x) => x.discount_cents / 100 },
          { key: "overrides", label: "Price overrides" }, { key: "no_sales", label: "No-sales" }, { key: "refunds", label: "Refunds" }, { key: "rf", label: "Refunds $", value: (x) => x.refund_cents / 100 },
          { key: "no_receipt_refunds", label: "No-receipt refunds" }, { key: "own_sale_refunds", label: "Refunds on own sales" }, { key: "short_tills", label: "Tills short" },
          { key: "flags", label: "Flags", value: (x) => x.flags.join("; ") }]} />
      </div>
      <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="text-left">{#each ["Cashier", "Sales", "Voids", "Removed lines", "Discounts", "Overrides", "No-sales", "Refunds", "Tills short"] as h (h)}<th class="border-b border-line px-2 py-1">{h}</th>{/each}</tr></thead>
        <tbody>
          {#each loss.cashiers.concat([loss.store]) as c (c.cashier || "store")}
            <tr class="{c.flags.length ? 'bg-warn/5' : ''} {c.cashier ? '' : 'font-semibold'}">
              <td class="px-2 py-1">{#if c.cashier}<button class="underline" onclick={() => showDetail(c)}>{c.name}</button>{:else}{c.name}{/if}</td>
              <td class="px-2">{c.sales} · {money(c.total_cents)}</td>
              <td class="px-2">{c.voided_sales} <span class="text-muted">({c.rates.voids}/100)</span></td>
              <td class="px-2">{c.removed_lines} <span class="text-muted">({c.rates.removed}/100)</span></td>
              <td class="px-2">{money(c.discount_cents)} <span class="text-muted">({c.rates.discount}%)</span></td>
              <td class="px-2">{c.overrides}</td>
              <td class="px-2">{c.no_sales} <span class="text-muted">({c.rates.no_sales}/100)</span></td>
              <td class="px-2">{c.refunds} · {money(c.refund_cents)}{c.no_receipt_refunds ? " (" + c.no_receipt_refunds + " no receipt)" : ""}</td>
              <td class="px-2">{c.short_tills}</td>
            </tr>
            {#each c.flags as fl (fl)}<tr><td></td><td colspan="8" class="px-2 text-warn">⚠ {fl}</td></tr>{/each}
          {/each}
        </tbody>
      </table></div>
    </div>
    {#if detail}
      <div class="card space-y-1">
        <div class="flex flex-wrap justify-between gap-2"><h2 class="font-semibold">{detail.name}: {detail.events.length} events</h2>
          <ExportMenu title={"Loss prevention " + detail.name} rows={detail.events} columns={[{ key: "at", label: "When" }, { key: "kind", label: "What" }, { key: "ref", label: "Receipt" }, { key: "amt", label: "Amount", value: (x) => x.amount_cents / 100 }, { key: "note", label: "Note" }]} /></div>
        {#each detail.events as x, i (i)}<p class="text-sm">{when(x.at)} · <b>{x.kind}</b>{x.ref ? " · " + x.ref : ""}{x.amount_cents ? " · " + money(x.amount_cents) : ""}{x.note ? " · " + x.note : ""}</p>{/each}
      </div>
    {/if}
  {/if}

  {#if tab === "promos" && promos}
    <div class="card space-y-1">
      <div class="flex flex-wrap justify-between gap-2">
        <p>{promos.totals.now.with_deal} of {promos.totals.now.sales} sales had a deal · savings given {money(promos.totals.now.savings_cents)}
          <span class="text-muted">(before: {promos.totals.before.with_deal} sales, {money(promos.totals.before.savings_cents)})</span></p>
        <ExportMenu title="Promotion results" rows={promos.promotions} columns={[{ key: "name", label: "Deal" }, { key: "type", label: "Type", value: (x) => TYPES[x.type] || x.type }, { key: "coupon", label: "Coupon" },
          { key: "t", label: "Times used", value: (x) => x.now.times }, { key: "s", label: "Sales", value: (x) => x.now.sales }, { key: "u", label: "Units", value: (x) => x.now.units },
          { key: "v", label: "Sales $ (before tax)", value: (x) => x.now.sales_cents / 100 }, { key: "sv", label: "Savings $", value: (x) => x.now.savings_cents / 100 },
          ...(promos.show_cost ? [{ key: "m", label: "Margin $", value: (x) => x.now.margin_cents / 100 }, { key: "mp", label: "Margin %", value: (x) => x.now.margin_pct }] : []),
          { key: "bt", label: "Times before", value: (x) => (x.before ? x.before.times : 0) }, { key: "bv", label: "Sales $ before", value: (x) => (x.before ? x.before.sales_cents / 100 : 0) },
          { key: "bs", label: "Savings $ before", value: (x) => (x.before ? x.before.savings_cents / 100 : 0) },
          { key: "lu", label: "Units of its products", value: (x) => (x.lift ? x.lift.now.units : "") }, { key: "lb", label: "Units of its products before", value: (x) => (x.lift ? x.lift.before.units : "") }]} />
      </div>
      <p class="text-sm text-muted">Compared with {promos.before.from} – {promos.before.to}, the same number of days just before. Sales are before tax, after every discount; returns are not taken off.</p>
    </div>
    {#each promos.promotions as x (x.id)}
      <div class="card space-y-1">
        <button class="flex w-full flex-wrap justify-between gap-2 text-left" onclick={() => (openPromo = openPromo === x.id ? "" : x.id)} aria-expanded={openPromo === x.id}>
          <span class="font-semibold">{x.name} <span class="text-sm font-normal text-muted">{TYPES[x.type] || ""}{x.coupon ? " · coupon " + x.coupon : ""}{x.status === "ended" ? " · ended" : ""}</span></span>
          <span>saved customers {money(x.now.savings_cents)} <span class="text-sm text-muted">{delta(x.now.savings_cents, x.before ? x.before.savings_cents : 0)}</span></span>
        </button>
        <p class="text-sm">Used {x.now.times}× on {x.now.sales} sales · {x.now.units} units · sales {money(x.now.sales_cents)}{promos.show_cost ? " · margin " + money(x.now.margin_cents) + " (" + x.now.margin_pct + "%)" : ""}
          <span class="text-muted">· before: {x.before ? x.before.times + "×, " + money(x.before.sales_cents) : "not used"}</span></p>
        {#if x.lift}<p class="text-sm">All sales of its products: {x.lift.now.units} units, {money(x.lift.now.sales_cents)} <span class="text-muted">(before: {x.lift.before.units} units, {money(x.lift.before.sales_cents)}; {delta(x.lift.now.units, x.lift.before.units) || "no change"})</span></p>{/if}
        {#if promos.show_cost && x.now.sales_cents && x.now.margin_cents < 0}<p class="text-sm text-warn">⚠ Sold below cost</p>{/if}
        {#if openPromo === x.id && x.products.length}<p class="text-sm text-muted">Products: {x.products.map((p) => p.name).join(", ")}</p>{/if}
      </div>
    {/each}
    {#if !promos.promotions.length}<p class="text-muted">No deals used in these dates or the period before.</p>{/if}
    {#if promos.coupons.length}<div class="card"><p class="font-semibold">Coupons used</p>{#each promos.coupons as c (c.code)}<p class="text-sm">{c.code}: {c.sales} sales</p>{/each}</div>{/if}
  {/if}

  {#if tab === "loyalty" && loy}
    {#if !loy.program.enabled}<p class="rounded-xl bg-soft px-3 py-2 text-sm">The loyalty programme is off{loy.program.set_by_owner ? "" : " (the owner has not set it yet)"}: customers earn no points.</p>{/if}
    <div class="grid gap-2 sm:grid-cols-4">
      <div class="card"><p class="text-sm text-muted">Members</p><p class="text-2xl font-bold">{loy.members.total}</p><p class="text-sm">{loy.members.new} joined · {loy.members.bought} bought</p></div>
      <div class="card"><p class="text-sm text-muted">Members' share of sales</p><p class="text-2xl font-bold">{loy.sales.member_pct}%</p><p class="text-sm">{loy.sales.members} of {loy.sales.all} sales · {money(loy.sales.member_cents)}</p></div>
      <div class="card"><p class="text-sm text-muted">Average sale</p><p class="text-2xl font-bold">{money(loy.sales.avg_member_cents)}</p><p class="text-sm">members · others {money(loy.sales.avg_other_cents)}</p></div>
      <div class="card"><p class="text-sm text-muted">Points held now</p><p class="text-2xl font-bold">{loy.liability.points}</p><p class="text-sm">worth {money(loy.liability.cents)}{loy.program.points_per_dollar_off ? " (" + loy.program.points_per_dollar_off + " points = $1)" : ""}</p></div>
    </div>
    <div class="card space-y-1 text-sm">
      <p class="font-semibold">Points in these dates</p>
      <p>Earned {loy.points.earned}{loy.points.taken_back ? " · taken back by returns " + loy.points.taken_back : ""} · used {loy.points.used} ({money(loy.points.redeem_cents)} off){loy.points.given_back ? " · given back by returns " + loy.points.given_back : ""}{loy.points.adjusted ? " · adjusted " + loy.points.adjusted : ""}{loy.points.expired ? " · expired " + loy.points.expired : ""}</p>
      <p class="text-muted">"Worth" is what the store would give in discounts if every point held were used: a liability for the accountant.</p>
    </div>
    {#if loy.top}
      <div class="card space-y-1">
        <div class="flex flex-wrap justify-between gap-2"><h2 class="font-semibold">Top customers</h2>
          <ExportMenu title="Top customers" rows={loy.top} columns={[{ key: "first_name", label: "First name" }, { key: "phone", label: "Phone (last 4)" }, { key: "card", label: "Card (last 4)" }, { key: "visits", label: "Visits" },
            { key: "sp", label: "Spent $", value: (x) => x.spent_cents / 100 }, { key: "earned", label: "Points earned" }, { key: "redeemed", label: "Points used" }, { key: "points", label: "Points now" }]} /></div>
        <div class="overflow-x-auto"><table class="w-full text-sm">
          <thead><tr class="text-left">{#each ["Customer", "Visits", "Spent", "Earned", "Used", "Points now"] as h (h)}<th class="border-b border-line px-2 py-1">{h}</th>{/each}</tr></thead>
          <tbody>{#each loy.top as c (c.id)}<tr><td class="px-2 py-1">{c.first_name} <span class="text-muted">{c.phone || c.card}</span></td><td class="px-2">{c.visits}</td><td class="px-2">{money(c.spent_cents)}</td><td class="px-2">{c.earned}</td><td class="px-2">{c.redeemed}</td><td class="px-2">{c.points}</td></tr>{/each}</tbody>
        </table></div>
        {#if !loy.top.length}<p class="text-muted">No member sales in these dates.</p>{/if}
      </div>
    {/if}
  {/if}

  {#if tab === "audit"}
    {#if opts}
      <div class="grid gap-2 sm:grid-cols-5">
        <label class="block"><span class="text-sm text-muted">Who</span><select class="field" bind:value={f.actor}><option value="">Anyone</option><option value="system">Chedam itself</option>{#each opts.people as p (p.actor)}<option value={p.actor}>{p.name}</option>{/each}</select></label>
        <label class="block"><span class="text-sm text-muted">Device</span><select class="field" bind:value={f.device}><option value="">Any</option>{#each opts.devices as d (d.id)}<option value={d.id}>{d.name}</option>{/each}</select></label>
        <label class="block"><span class="text-sm text-muted">What</span><select class="field" bind:value={f.table}><option value="">Everything</option>{#each opts.tables as t (t)}<option value={t}>{t.replace(/_/g, " ")}</option>{/each}</select></label>
        <label class="block"><span class="text-sm text-muted">Action</span><select class="field" bind:value={f.action}><option value="">Any</option><option value="create">Created</option><option value="update">Changed</option><option value="delete">Deleted</option></select></label>
        <label class="block"><span class="text-sm text-muted">Record or text</span><input class="field" bind:value={f.record} placeholder="S-000012, a name…" /></label>
      </div>
    {/if}
    {#if audit}
      <div class="card space-y-1">
        <div class="flex justify-end"><ExportMenu title="Audit log" rows={audit.items} columns={[{ key: "at", label: "When" }, { key: "who", label: "Who" }, { key: "device", label: "Device" }, { key: "action", label: "Action" },
          { key: "table", label: "What" }, { key: "label", label: "Record" }, { key: "record_id", label: "Record id" },
          { key: "changes", label: "Changes", value: (x) => x.fields.map((y) => y.field + ": " + (y.value !== undefined ? show(y.value) : show(y.before) + " → " + show(y.after))).join("; ") }]} /></div>
        {#if !audit.items.length}<p class="text-muted">Nothing matches.</p>{/if}
        {#each audit.items as x (x.id)}
          <div class="border-b border-line py-1 text-sm">
            <button class="w-full text-left" onclick={() => (open[x.id] = !open[x.id])} aria-expanded={!!open[x.id]}>
              {when(x.at)} · <b>{x.who}</b>{x.device ? " on " + x.device : ""} · {{ create: "created", update: "changed", delete: "deleted" }[x.action]} {x.table.replace(/_/g, " ")} <b>{x.label}</b>
              {#if x.action === "update"}<span class="text-muted"> ({x.fields.map((y) => y.field).join(", ")})</span>{/if}
            </button>
            {#if open[x.id]}
              <div class="mt-1 rounded-xl bg-soft p-2 font-mono text-xs">
                {#each x.fields as y (y.field)}<p>{y.field}: {#if y.value !== undefined}{show(y.value)}{:else}<span class="text-bad">{show(y.before)}</span> → <span class="text-ok">{show(y.after)}</span>{/if}</p>{/each}
                <p class="text-muted">record {x.record_id}</p>
              </div>
            {/if}
          </div>
        {/each}
        <div class="flex gap-2 pt-2">
          <button class="btn-ghost" disabled={f.page <= 1} onclick={() => { f.page--; load(); }}>Newer</button>
          <button class="btn-ghost" disabled={!audit.more} onclick={() => { f.page++; load(); }}>Older</button>
        </div>
      </div>
    {/if}
  {/if}

  {#if tab === "retention" && ret}
    <div class="card space-y-2">
      <p>Business records are kept for <b>{ret.years} years</b> (at least {ret.minimum}, as the CRA requires) and cannot be deleted before then, not even from the admin dashboard. In the app, "delete" only marks a record deleted. The audit log is never deleted.</p>
      <ul class="grid gap-1 text-sm sm:grid-cols-2">{#each ret.tables as x (x.table)}<li>{x.label}: {x.years ? x.years + " years" : "never deleted"} · {x.rows} records</li>{/each}</ul>
    </div>
  {/if}
</section>

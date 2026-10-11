<script>
  // Away from the store (P5 step 5; FR-12.05): the owner's summary, read from the cloud drive with what this
  // device got when it was enrolled at the store. No hub and no sign-in: opened at #away (the app works from
  // its cache). Read-only, with the time it was made.
  import { onMount } from "svelte";
  import { enrolment, saveEnrolment, readSummary } from "../lib/remote_read.js";

  let e = $state(enrolment()), sm = $state(null), error = $state(""), busy = $state(false);
  const money = (c) => (c === undefined || c === null ? "—" : (c < 0 ? "−$" : "$") + (Math.abs(c) / 100).toFixed(2));
  const when = (x) => (x ? new Date(String(x).replace(" ", "T")).toLocaleString() : "");
  const ago = (x) => { const m = Math.round((Date.now() - new Date(x).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
  const pct = (a, b) => (b ? Math.round(((a - b) * 100) / b) + "%" : "");

  async function load() {
    if (!e) return;
    busy = true; error = "";
    try {
      sm = await readSummary(e, (r) => { e.read.refresh_token = r; saveEnrolment($state.snapshot(e)); });
      try { localStorage.setItem("chedam.remote.last", JSON.stringify(sm)); } catch { /* private mode */ }
    } catch (err) {
      error = err.message;
      try { sm = sm || JSON.parse(localStorage.getItem("chedam.remote.last") || "null"); } catch { /* none */ }
    }
    busy = false;
  }
  onMount(load);
  function backToApp() { history.replaceState(null, "", location.pathname); location.reload(); }
</script>

<main class="mx-auto w-full max-w-3xl space-y-4 px-4 pt-4 pb-12">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2"><img src="./icons/icon-192.png" alt="" class="h-8 w-8 rounded-lg" /><h1 class="text-xl font-bold">{e && e.business ? e.business : "Chedam"} · away from the store</h1></div>
    <button class="btn-ghost min-h-10 text-sm" onclick={backToApp}>Open Chedam</button>
  </div>
  {#if !e}
    <p class="card">This device is not enrolled. At the store, sign in as the owner and open Home → Cloud drive → <b>Enrol this device</b>.</p>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <button class="btn" disabled={busy} onclick={load}>{busy ? "Loading…" : "Refresh"}</button>
      {#if sm}<p class="text-sm" aria-live="polite">Last updated <b>{when(sm.generated_at)}</b> ({ago(sm.generated_at)})</p>{/if}
    </div>
    {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}{sm ? " Showing the last summary this device read." : ""}</p>{/if}
    {#if sm}
      {#if sm.kpis}
        <div class="grid gap-2 sm:grid-cols-2">
          <div class="card"><p class="text-sm text-muted">Today ({sm.today})</p><p class="text-2xl font-bold">{money(sm.kpis.today.sales_cents)}</p>
            <p class="text-sm">{sm.kpis.today.transactions} sales · same day last week {money(sm.kpis.same_day_last_week.sales_cents)} {pct(sm.kpis.today.sales_cents, sm.kpis.same_day_last_week.sales_cents)}</p></div>
          <div class="card"><p class="text-sm text-muted">This month</p><p class="text-2xl font-bold">{money(sm.kpis.month.sales_cents)}</p>
            <p class="text-sm">Last month, same days {money(sm.kpis.last_month_same_days.sales_cents)} {pct(sm.kpis.month.sales_cents, sm.kpis.last_month_same_days.sales_cents)}{sm.kpis.month.margin_pct !== undefined ? " · margin " + sm.kpis.month.margin_pct + "%" : ""}</p></div>
        </div>
      {/if}
      <div class="card space-y-1">
        <h2 class="font-semibold">Needs attention</h2>
        {#each sm.attention as a (a.kind)}<p class="flex justify-between text-sm"><span>{a.text}</span><b>{a.count}</b></p>{:else}<p class="text-sm text-ok">Nothing waiting.</p>{/each}
        {#each sm.tasks as t (t.id)}<p class="text-sm text-muted">• {t.title}</p>{/each}
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <div class="card space-y-1"><h2 class="font-semibold">Tills open</h2>
          {#each sm.tills as t, i (i)}<p class="text-sm">Till {t.number} · {t.by} · since {when(t.opened_at)}</p>{:else}<p class="text-sm text-muted">None.</p>{/each}</div>
        <div class="card space-y-1"><h2 class="font-semibold">Clocked in</h2>
          {#each sm.clocked_in as c, i (i)}<p class="text-sm">{c.name}{c.on_break ? " (on a break)" : ""} · since {when(c.since)}</p>{:else}<p class="text-sm text-muted">Nobody.</p>{/each}</div>
      </div>
      <div class="card space-y-1"><h2 class="font-semibold">Stock and the hub</h2>
        <p class="text-sm">Out of stock {sm.stock.out_of_stock} · at or below reorder {sm.stock.low_stock} · expired lots {sm.stock.expired_lots} · expiring in 3 days {sm.stock.near_expiry_lots}</p>
        {#if sm.backup}<p class="text-sm">Last good backup: {sm.backup.last_good ? when(sm.backup.last_good) : "none"}{sm.backup.latest_status === "failed" ? " · the latest backup FAILED" : ""}</p>{/if}
        {#if sm.health}<p class="text-sm {sm.health.overall === 'bad' ? 'text-bad' : sm.health.overall === 'warn' ? 'text-warn' : 'text-ok'}">Hub: {sm.health.overall === "ok" ? "all good" : sm.health.problems.join("; ")}</p>{/if}
      </div>
    {/if}
  {/if}
</main>

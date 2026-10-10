<script>
  // Inbox (P2 step 10; FR-2.08-2.10): the end-of-day report, urgent alerts and reports, in the app first;
  // an item still unread at its deadline is emailed once when the owner has connected email (P2-f, not yet).
  // Settings: what I receive; the owner chooses who gets the end-of-day report, when, and the email time.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import { on, refreshBadge } from "../lib/live.svelte.js";

  let items = $state([]), unread = $state(0), connected = $state(false), open = $state(null), error = $state("");
  let cfg = $state(null), people = $state([]), showCfg = $state(false);

  const when = (t) => (t ? new Date(String(t).replace(" ", "T")).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
  const EMAIL = { waiting: "will be emailed if unread", not_connected: "unread at its deadline: email not connected yet", none: "", off: "", sent: "emailed", offline: "" };
  async function load() {
    const r = await api("GET", "/api/chedam/inbox");
    if (r.ok) { items = r.json.items; unread = r.json.unread; connected = r.json.email_connected; } else if (!(await handleRefusal(r))) error = r.message;
  }
  onMount(() => { load(); return on("inbox_items", () => load()); });

  async function openItem(x) {
    open = x;
    if (!x.read) { await api("POST", `/api/chedam/inbox/${x.id}/read`, {}, { quiet: true }); load(); refreshBadge(); }
  }
  async function readAll() { await api("POST", "/api/chedam/inbox/read-all", {}, { quiet: true }); load(); refreshBadge(); }
  async function makeNow() {
    const r = await api("POST", "/api/chedam/inbox/eod", {}, { quiet: true });
    if (!r.ok) { error = r.message; return; }
    error = r.json.made ? "" : "Today's report is already in the inbox.";
    load(); refreshBadge();
  }
  async function loadCfg() {
    showCfg = !showCfg;
    if (!showCfg) return;
    const r = await api("GET", "/api/chedam/inbox/settings");
    if (r.ok) cfg = r.json;
    if (cfg && cfg.eod && !people.length) { const u = await api("GET", "/api/collections/users/records?perPage=200&sort=name&filter=" + encodeURIComponent("status='active' && deleted_at=''")); if (u.ok) people = u.json.items; }
  }
  async function saveCfg(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/inbox/settings", { mine: cfg.mine, eod: cfg.eod || undefined });
    if (!r.ok) { error = r.message; return; }
    cfg = r.json; showCfg = false;
  }
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => (open ? (open = null) : go("home"))}>← {open ? "Inbox" : "Back"}</button>
      <h1 class="text-xl font-bold">{open ? open.title : "Inbox" + (unread ? " (" + unread + ")" : "")}</h1></div>
    {#if !open}<div class="flex flex-wrap gap-2">
      {#if can("sales.view")}<button class="btn-ghost min-h-10 text-sm" onclick={makeNow}>Today's report now</button>{/if}
      {#if unread}<button class="btn-ghost min-h-10 text-sm" onclick={readAll}>Mark all read</button>{/if}
      <button class="btn-ghost min-h-10 text-sm" onclick={loadCfg}>Settings</button></div>{/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-warn/10 px-3 py-2 text-warn">{error}</p>{/if}

  {#if showCfg && cfg && !open}
    <form class="card space-y-3" onsubmit={saveCfg}>
      <h2 class="font-semibold">What I receive</h2>
      {#each cfg.mine as m (m.kind)}
        <div class="flex flex-wrap items-center gap-4"><span class="w-48">{m.label}</span>
          <label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={m.in_app} /> In the app</label>
          <label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={m.email} disabled={!m.in_app} /> Email if unread</label></div>
      {/each}
      {#if !cfg.email.connected}<p class="text-sm text-muted">Email is not connected yet: it needs the owner's Gmail or Outlook connection (coming with the Google/Microsoft set-up). Everything arrives in the app meanwhile.</p>{/if}
      {#if cfg.eod}
        <h2 class="font-semibold">End-of-day report (for the owner and)</h2>
        <fieldset class="grid gap-1 sm:grid-cols-2">{#each people as p (p.id)}<label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-accent" checked={(cfg.eod.recipients || []).includes(p.id)}
          onchange={(e) => (cfg.eod.recipients = e.currentTarget.checked ? [...(cfg.eod.recipients || []), p.id] : cfg.eod.recipients.filter((x) => x !== p.id))} /> {p.name}</label>{/each}</fieldset>
        <div class="grid gap-2 sm:grid-cols-3">
          <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={cfg.eod.enabled} /> Make it every day</label>
          <label class="block"><span class="text-sm text-muted">At (store time)</span><input class="field" type="time" bind:value={cfg.eod.time} /></label>
          <label class="block"><span class="text-sm text-muted">Email it if unread by (next morning)</span><input class="field" type="time" bind:value={cfg.eod.email_by} /></label>
        </div>
      {/if}
      <div class="flex gap-2"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (showCfg = false)}>Cancel</button></div>
    </form>
  {/if}

  {#if open}
    {@const d = open.data}
    <div class="card space-y-2">
      <p class="text-sm text-muted">{open.kind_label} · {when(open.created_at)}{EMAIL[open.email_status] ? " · " + EMAIL[open.email_status] : ""}</p>
      {#if open.kind === "eod_report" && d && d.day}
        <div class="grid gap-2 sm:grid-cols-4">
          <p>Sales<b class="block text-xl">{money(d.sales_cents)}</b><span class="text-xs text-muted">before tax · {money(d.total_cents)} with tax</span></p>
          <p>Sales count<b class="block text-xl">{d.transactions}</b><span class="text-xs text-muted">average {money(d.avg_basket_cents)}</span></p>
          {#if d.margin_pct !== undefined}<p>Margin<b class="block text-xl">{d.margin_pct}%</b><span class="text-xs text-muted">{money(d.margin_cents)}</span></p>{/if}
          <p>Returns<b class="block text-xl">{d.returns}</b><span class="text-xs text-muted">{money(d.refunds_cents)} refunded</span></p>
        </div>
        <p class="text-sm"><b>Payments:</b> {d.payments.map((p) => p.method.replace("_", " ") + " " + money(p.amount_cents) + " (" + p.count + ")").join(" · ") || "none"}</p>
        <p class="text-sm"><b>Discounts:</b> {money(d.discount_cents)} (deals {money(d.promo_savings_cents)}) · voided sales {d.voided} · tax {money(d.tax_cents)}</p>
        <p class="text-sm"><b>Tills:</b> {d.tills.map((x) => "Till " + x.number + (x.status === "open" ? " still open" : x.variance_cents ? (x.variance_cents < 0 ? " short " : " over ") + money(Math.abs(x.variance_cents)) : " balanced")).join(" · ") || "none"}</p>
        {#if d.members}<p class="text-sm"><b>Loyalty:</b> {d.members} member sales · {d.loyalty_earned} points earned · {d.loyalty_redeemed} used</p>{/if}
        {#if d.top.length}<p class="text-sm"><b>Best sellers:</b> {d.top.map((x) => x.name + " " + money(x.sales_cents)).join(" · ")}</p>{/if}
        <p class="text-sm"><b>To look at:</b> {d.open_tasks} open tasks · {d.out_of_stock} out of stock · {d.low_stock} low · {d.expiring_lots} lots expiring</p>
      {:else}
        <p class="whitespace-pre-line">{open.body}</p>
      {/if}
      {#if open.link}<button class="btn-ghost min-h-10 text-sm" onclick={() => go(open.link)}>Open</button>{/if}
    </div>
  {:else}
    {#each items as x (x.id)}
      <button class="card flex w-full items-start justify-between gap-3 text-left {x.read ? '' : 'border-accent'}" onclick={() => openItem(x)}>
        <span class="min-w-0"><span class="block {x.read ? '' : 'font-semibold'}">{x.kind === "alert" ? "⚠ " : x.kind === "eod_report" ? "📊 " : ""}{x.title}</span>
          <span class="block text-sm text-muted">{x.kind_label} · {when(x.created_at)}</span></span>
        {#if !x.read}<span class="mt-1 h-3 w-3 shrink-0 rounded-full bg-accent" aria-label="Unread"></span>{/if}
      </button>
    {:else}<p class="text-muted">Nothing in your inbox. The end-of-day report arrives here every evening.</p>{/each}
    {#if !connected}<p class="text-xs text-muted">Email fallback waits for the owner's Gmail or Outlook connection.</p>{/if}
  {/if}
</section>

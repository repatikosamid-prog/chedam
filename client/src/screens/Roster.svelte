<script>
  // Roster (P4 step 3; FR-9.07). Managers (roster.manage): the week as a grid (people × days), plan a shift by
  // tapping a cell, drafts until Publish (each person is told), copy last week, labour cost against sales per
  // day (totals only), approve or decline swaps. Everyone: the published week, my shifts, offer one to swap
  // (to a colleague or anyone), take a shift offered to me.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, s as session, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";

  let data = $state(null), wk = $state(""), error = $state(""), ok = $state(""), form = $state(null), warn = $state([]), offer = $state(null);
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const plus = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().substring(0, 10); };
  const dayName = (d) => new Date(d + "T12:00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const h = (m) => Math.round(m / 6) / 10 + " h";
  const meId = () => (session.me && session.me.user ? session.me.user.id : "");
  const days = $derived(data ? [0, 1, 2, 3, 4, 5, 6].map((i) => plus(data.week, i)) : []);
  const rows = $derived(data ? (data.manage ? data.people : [...new Map(data.shifts.map((x) => [x.user, { id: x.user, name: x.user_name }])).values()]) : []);

  async function load() {
    error = "";
    const r = await api("GET", "/api/chedam/roster" + (wk ? "?week=" + wk : ""));
    if (r.ok) { data = r.json; wk = r.json.week; } else await fail(r);
  }
  onMount(load);
  const cell = (u, d) => data.shifts.filter((x) => x.user === u && x.day === d);
  const swapOf = (id) => data.swaps.find((x) => x.shift === id);

  function edit(u, d, x) {
    if (!data.manage) return;
    warn = [];
    form = x ? { ...x } : { user: u.id, day: d, start: "09:00", end: "17:00", break_min: 30, position: "", note: "" };
    form.name = x ? x.user_name : u.name;
  }
  async function save(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/roster", { id: form.id, user: form.user, day: form.day, start: form.start, end: form.end, break_min: Number(form.break_min) || 0, position: form.position, note: form.note });
    if (!r.ok) return fail(r);
    warn = r.json.warnings; form = null; load();
  }
  async function remove() {
    if (!confirm("Take this shift off the roster?")) return;
    const r = await api("POST", `/api/chedam/roster/${form.id}/remove`, {});
    if (!r.ok) return fail(r);
    form = null; load();
  }
  async function publish() {
    const r = await api("POST", "/api/chedam/roster/publish", { week: data.week });
    if (!r.ok) return fail(r);
    ok = "Published; " + r.json.notified + " people told."; load();
  }
  async function copyLast() {
    const r = await api("POST", "/api/chedam/roster/copy", { from: plus(data.week, -7), to: data.week });
    if (!r.ok) return fail(r);
    ok = r.json.copied + " shifts copied from last week" + (r.json.skipped ? " (" + r.json.skipped + " skipped: they overlap)" : "") + "."; load();
  }
  async function sendOffer(e) {
    e.preventDefault();
    const r = await api("POST", `/api/chedam/roster/${offer.id}/swap`, { to_user: offer.to, note: offer.note });
    if (!r.ok) return fail(r);
    ok = "Offered."; offer = null; load();
  }
  async function swap(x, action) {
    const r = await api("POST", `/api/chedam/swaps/${x.id}/${action}`, {});
    if (!r.ok) return fail(r);
    ok = { accept: "Taken; a manager approves it.", cancel: "Offer withdrawn.", approve: "Swap approved.", decline: "Swap declined." }[action]; load();
  }
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Roster</h1></div>
    {#if data && data.manage}
      <div class="flex flex-wrap gap-2">
        <button class="btn-ghost min-h-10 text-sm" onclick={copyLast}>Copy last week</button>
        <button class="btn min-h-10 text-sm" disabled={!data.drafts} onclick={publish}>Publish{data.drafts ? " (" + data.drafts + " new or changed)" : ""}</button>
      </div>
    {/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}
  {#each warn as w (w)}<p class="rounded-xl bg-warn/10 px-3 py-2 text-warn">⚠ {w}</p>{/each}

  {#if data}
    <div class="flex items-center gap-2">
      <button class="btn-ghost min-h-10" onclick={() => { wk = plus(data.week, -7); load(); }}>←</button>
      <span>Week of {dayName(data.week)}</span>
      <button class="btn-ghost min-h-10" onclick={() => { wk = plus(data.week, 7); load(); }}>→</button>
    </div>

    {#if form}
      <form class="card grid gap-2 sm:grid-cols-4" onsubmit={save}>
        <h2 class="font-semibold sm:col-span-4">{form.name} · {dayName(form.day)}</h2>
        <label class="block"><span class="text-sm text-muted">From</span><input class="field" type="time" bind:value={form.start} required /></label>
        <label class="block"><span class="text-sm text-muted">To</span><input class="field" type="time" bind:value={form.end} required /></label>
        <label class="block"><span class="text-sm text-muted">Break (min)</span><input class="field" type="number" min="0" max="240" bind:value={form.break_min} /></label>
        <label class="block"><span class="text-sm text-muted">Where</span><input class="field" bind:value={form.position} maxlength="60" placeholder="Till" /></label>
        <label class="block sm:col-span-4"><span class="text-sm text-muted">Note</span><input class="field" bind:value={form.note} maxlength="200" /></label>
        <div class="flex gap-2 sm:col-span-4"><button class="btn" type="submit">Save</button>{#if form.id}<button class="btn-ghost" type="button" onclick={remove}>Remove</button>{/if}<button class="btn-ghost" type="button" onclick={() => (form = null)}>Cancel</button></div>
      </form>
    {/if}

    <div class="overflow-x-auto">
      <table class="w-full min-w-[720px] text-sm">
        <thead><tr><th class="p-1 text-left">Who</th>{#each days as d (d)}<th class="p-1 text-left">{dayName(d)}</th>{/each}</tr></thead>
        <tbody>
          {#each rows as u (u.id)}
            <tr class="border-t border-line {u.id === meId() ? 'bg-accent/5' : ''}">
              <td class="p-1 font-semibold">{u.name}</td>
              {#each days as d (d)}
                <td class="p-1 align-top">
                  {#each cell(u.id, d) as x (x.id)}
                    <button class="mb-1 block w-full rounded-lg border px-1 text-left {x.status === 'draft' ? 'border-dashed border-muted' : x.changed ? 'border-warn' : 'border-accent'}" onclick={() => edit(u, d, x)}>
                      {x.start}-{x.end}{x.position ? " · " + x.position : ""}
                      {#if swapOf(x.id)}<span class="block text-warn">⇄ {swapOf(x.id).status === "accepted" ? swapOf(x.id).taken_name + " takes it" : "offered"}</span>{/if}
                    </button>
                  {/each}
                  {#if data.manage}<button class="w-full rounded-lg text-muted hover:bg-line" aria-label="Add a shift" onclick={() => edit(u, d, null)}>+</button>{/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if data.manage}<p class="text-xs text-muted">Dashed: draft (not seen by staff yet). Orange: changed since published.</p>{/if}

    {#if data.manage && data.labour}
      <div class="card overflow-x-auto">
        <h2 class="font-semibold">Labour against sales</h2>
        <table class="w-full min-w-[560px] text-sm">
          <thead><tr class="text-left"><th>Day</th><th>Planned</th><th>Clocked</th><th>Labour</th><th>Sales</th><th>Labour %</th></tr></thead>
          <tbody>
            {#each data.labour.days as d (d.day)}<tr class="border-t border-line"><td>{dayName(d.day)}</td><td>{h(d.planned_min)}</td><td>{d.clocked_min ? h(d.clocked_min) : ""}</td><td>{money(d.cost_cents)}{d.no_rate ? " +" + d.no_rate + " without a rate" : ""}</td>
              <td>{money(d.sales_cents)}{d.estimate ? " (last week)" : ""}</td><td>{d.labour_pct == null ? "—" : d.labour_pct + "%"}</td></tr>{/each}
            <tr class="border-t border-line font-semibold"><td>Week</td><td>{h(data.labour.total.planned_min)}</td><td>{h(data.labour.total.clocked_min)}</td><td>{money(data.labour.total.cost_cents)}</td><td>{money(data.labour.total.sales_cents)}</td><td>{data.labour.total.labour_pct == null ? "—" : data.labour.total.labour_pct + "%"}</td></tr>
          </tbody>
        </table>
      </div>
    {/if}

    <div class="card space-y-2">
      <h2 class="font-semibold">My shifts</h2>
      {#each data.mine || [] as x (x.id)}
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line text-sm">
          <span>{dayName(x.day)} · {x.start}-{x.end}{x.break_min ? " · break " + x.break_min + " min" : ""}{x.position ? " · " + x.position : ""}{x.note ? " · " + x.note : ""}</span>
          {#if swapOf(x.id)}<span class="text-warn">⇄ {swapOf(x.id).status === "accepted" ? swapOf(x.id).taken_name + " takes it (waiting for a manager)" : "offered" + (swapOf(x.id).to_name ? " to " + swapOf(x.id).to_name : "")}
            <button class="ml-1 underline" onclick={() => swap(swapOf(x.id), "cancel")}>Withdraw</button></span>
          {:else if x.status === "published"}<button class="text-accent underline" onclick={() => (offer = { id: x.id, to: "", note: "" })}>Offer to swap</button>{/if}
        </div>
        {#if offer && offer.id === x.id}
          <form class="flex flex-wrap items-end gap-2" onsubmit={sendOffer}>
            <label class="block"><span class="text-sm text-muted">To</span><select class="field" bind:value={offer.to}><option value="">Anyone</option>{#each rows.filter((u) => u.id !== meId()) as u (u.id)}<option value={u.id}>{u.name}</option>{/each}</select></label>
            <label class="block"><span class="text-sm text-muted">Why</span><input class="field" bind:value={offer.note} maxlength="200" /></label>
            <button class="btn" type="submit">Offer</button><button class="btn-ghost" type="button" onclick={() => (offer = null)}>Cancel</button>
          </form>
        {/if}
      {:else}<p class="text-sm text-muted">No shifts for you this week.</p>{/each}
    </div>

    {#if data.swaps.length}
      <div class="card space-y-2">
        <h2 class="font-semibold">Swaps</h2>
        {#each data.swaps as w (w.id)}
          {@const x = data.shifts.find((s) => s.id === w.shift)}
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line text-sm">
            <span>{w.from_name}: {x ? dayName(x.day) + " " + x.start + "-" + x.end : ""} {w.to_name ? "→ " + w.to_name : "→ anyone"}{w.note ? " · " + w.note : ""}{w.status === "accepted" ? " · " + w.taken_name + " takes it" : ""}</span>
            <span class="flex gap-2">
              {#if w.status === "offered" && w.from_user !== meId() && (!w.to_user || w.to_user === meId())}<button class="btn min-h-10 text-sm" onclick={() => swap(w, "accept")}>Take it</button>{/if}
              {#if w.status === "accepted" && data.manage}<button class="btn min-h-10 text-sm" onclick={() => swap(w, "approve")}>Approve</button><button class="btn-ghost min-h-10 text-sm" onclick={() => swap(w, "decline")}>Decline</button>{/if}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

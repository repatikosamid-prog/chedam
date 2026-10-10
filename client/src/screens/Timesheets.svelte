<script>
  // Time sheets (P4 step 4; FR-9.08). Managers (timeclock.manage): the pay period by person (paid hours,
  // regular, overtime, double, leave taken, flags, status); open one to see its shifts and flags, fix a punch
  // (Time clock → Shifts), approve with a note when something is flagged, reopen with a reason. Everyone:
  // their own time sheet for the period.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import ExportMenu from "../components/ExportMenu.svelte";

  const mgr = can("timeclock.manage");
  const ST = { to_approve: "To approve", approved: "Approved", reopened: "Reopened", paid: "Paid" };
  let tab = $state(mgr ? "all" : "mine"), per = $state(""), data = $state(null), open = $state(null), mine = $state(null), error = $state(""), ok = $state(""), note = $state("");
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const h = (m) => Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0");
  const t = (s) => (s ? new Date(s.replace(" ", "T")).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
  const leaveText = (l) => Object.entries(l || {}).filter(([, v]) => v).map(([k, v]) => k + " " + v + " h").join(", ");

  async function load() {
    error = "";
    if (tab === "mine") { const r = await api("GET", "/api/chedam/me/timesheet" + (per ? "?period=" + per : "")); if (r.ok) { mine = r.json; per = r.json.period.start; } else await fail(r); return; }
    const r = await api("GET", "/api/chedam/timesheets" + (per ? "?period=" + per : ""));
    if (r.ok) { data = r.json; per = r.json.period.start; } else await fail(r);
  }
  onMount(load);
  async function show(p) {
    if (open && open.user === p.user) { open = null; return; }
    const r = await api("GET", `/api/chedam/timesheets/${p.user}?period=${per}`);
    if (r.ok) { open = r.json; note = ""; } else fail(r);
  }
  async function approve() {
    const r = await api("POST", "/api/chedam/timesheets/approve", { user: open.user, period: per, note });
    if (!r.ok) return fail(r);
    ok = open.user_name + ": approved."; open = null; load();
  }
  async function reopen() {
    const reason = prompt("Why is it reopened?");
    if (!reason) return;
    const r = await api("POST", "/api/chedam/timesheets/reopen", { user: open.user, period: per, reason });
    if (!r.ok) return fail(r);
    open = null; load();
  }
  const move = (p) => { per = p.start; open = null; load(); };
</script>

{#snippet sheet(x)}
  <p class="text-sm">Paid <b>{h(x.paid_min)}</b> · regular {h(x.regular_min)}{x.overtime_min ? " · overtime " + h(x.overtime_min) : ""}{x.double_min ? " · double " + h(x.double_min) : ""}{leaveText(x.leave) ? " · leave: " + leaveText(x.leave) : ""}</p>
  {#each x.shifts || [] as s (s.id)}
    <p class="flex flex-wrap justify-between gap-2 border-b border-line text-sm"><span>{s.day} · {t(s.clock_in)}–{s.clock_out ? t(s.clock_out) : "still in"}{s.breaks && s.breaks.length ? " · " + s.breaks.length + " break(s)" : ""}
      {#each s.flags || [] as f (f)}<span class="ml-1 rounded bg-warn/10 px-1 text-warn">{f.replace("_", " ")}</span>{/each}</span><span>{h(s.calc ? s.calc.paid_min : s.paid_min)}</span></p>
  {/each}
  {#each (x.flags || []).filter((f) => !f.shift) as f, i (i)}<p class="text-sm text-warn">⚠ {f.day}: {f.text}</p>{/each}
{/snippet}

<section class="space-y-4">
  <div class="screen-head"><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Time sheets</h1></div>
  {#if mgr}<div class="flex gap-2">{#each [["all", "Everyone"], ["mine", "Mine"]] as [k, l] (k)}<button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; open = null; load(); }}>{l}</button>{/each}</div>{/if}
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if tab === "mine" && mine}
    <div class="flex items-center gap-2"><button class="btn-ghost min-h-10" onclick={() => move(mine.previous)}>←</button><span>{mine.period.start} to {mine.period.end}</span><button class="btn-ghost min-h-10" onclick={() => move(mine.next)}>→</button></div>
    <div class="card space-y-1"><p class="font-semibold">{ST[mine.status]}{mine.approved_by ? " by " + mine.approved_by : ""}</p>{@render sheet(mine)}</div>
  {:else if tab === "all" && data}
    <div class="card flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2"><button class="btn-ghost min-h-10" onclick={() => move(data.previous)}>←</button><span>{data.period.start} to {data.period.end}{data.ended ? "" : " (not over yet)"}</span><button class="btn-ghost min-h-10" onclick={() => move(data.next)}>→</button></div>
      <ExportMenu title="Time sheets" rows={data.people} columns={[{ key: "user_name", label: "Who" }, { key: "status", label: "Status" }, { key: "p", label: "Paid h", value: (x) => Math.round(x.paid_min / 6) / 10 },
        { key: "r", label: "Regular h", value: (x) => Math.round(x.regular_min / 6) / 10 }, { key: "o", label: "Overtime h", value: (x) => Math.round(x.overtime_min / 6) / 10 }, { key: "d", label: "Double h", value: (x) => Math.round(x.double_min / 6) / 10 },
        { key: "f", label: "Flags", value: (x) => (x.flags || []).length }, { key: "approved_by", label: "Approved by" }]} />
    </div>
    {#each data.people as p (p.user)}
      <div class="card space-y-2">
        <button class="flex w-full flex-wrap justify-between gap-2 text-left" onclick={() => show(p)}>
          <span><b>{p.user_name}</b> · {h(p.paid_min)}{p.overtime_min + p.double_min ? " · OT " + h(p.overtime_min + p.double_min) : ""}</span>
          <span class="text-sm {p.status === 'approved' || p.status === 'paid' ? 'text-ok' : 'text-warn'}">{ST[p.status]}{(p.flags || []).length && p.status !== "approved" && p.status !== "paid" ? " · " + p.flags.length + " flagged" : ""}</span>
        </button>
        {#if open && open.user === p.user}
          {@render sheet(open)}
          {#if open.note}<p class="text-sm text-muted">Note: {open.note}</p>{/if}
          {#if open.reopen_reason}<p class="text-sm text-muted">Reopened: {open.reopen_reason}</p>{/if}
          {#if open.status === "to_approve" || open.status === "reopened"}
            <div class="flex flex-wrap items-end gap-2">
              <label class="block grow"><span class="text-sm text-muted">{open.flags.length ? "What you checked (needed)" : "Note"}</span><input class="field" bind:value={note} maxlength="500" /></label>
              <button class="btn" disabled={!data.ended} onclick={approve}>Approve</button>
              <button class="btn-ghost" onclick={() => go("clock")}>Fix punches</button>
            </div>
          {:else if open.status === "approved"}<button class="btn-ghost min-h-10 text-sm" onclick={reopen}>Reopen</button>{/if}
        {/if}
      </div>
    {:else}<p class="text-muted">No hours in this period.</p>{/each}
  {/if}
</section>

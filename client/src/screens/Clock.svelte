<script>
  // Time clock (P4 step 2; FR-9.04-9.06, BR-30-32): clock in and out, breaks; the hub's clock for every time.
  // "Me": my clock on my signed-in device, alerts before a meal break is due or overtime starts, my week.
  // "Someone else": anyone punches on this device with their name and PIN (the device stays signed in as it is).
  // "Shifts" (timeclock.manage): the week by person with regular, overtime and double time, flags (no
  // punch-out, no meal break, short rest, fixed, added), fixes with a reason (the original kept), missed shifts.
  import { onMount, onDestroy } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import ExportMenu from "../components/ExportMenu.svelte";

  const mgr = can("timeclock.manage");
  const FLAG = { no_out: "No punch-out", no_meal: "No meal break", short_rest: "Short rest", edited: "Fixed", added: "Added" };
  let tab = $state("me"), me = $state(null), who = $state([]), error = $state(""), ok = $state(""), busy = $state(false);
  let other = $state({ user: "", pin: "" }), names = $state([]), otherSt = $state(null);
  let week = $state(null), from = $state(""), fix = $state(null), people = $state([]);
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const t = (s) => (s ? new Date(s.replace(" ", "T")).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
  const h = (m) => Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0");
  const loc = (s) => { if (!s) return ""; const d = new Date(s.replace(" ", "T")); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().substring(0, 16); };
  const iso = (v) => (v ? new Date(v).toISOString() : "");

  async function load() {
    error = "";
    const w = await api("GET", "/api/chedam/clock/who", null, { quiet: true });
    who = w.ok ? w.json.items : [];
    if (tab === "me") { const r = await api("GET", "/api/chedam/me/clock", null, { quiet: true }); me = r.ok ? r.json : null; }
    if (tab === "other" && !names.length) { const r = await api("GET", "/api/chedam/auth/pin-users", null, { quiet: true }); names = r.ok ? r.json : []; }
    if (tab === "shifts") {
      const r = await api("GET", "/api/chedam/shifts" + (from ? "?from=" + from + "&to=" + plus(from, 6) : ""));
      if (r.ok) { week = r.json; from = r.json.from; } else await fail(r);
      if (!people.length) { const u = await api("GET", "/api/chedam/auth/pin-users", null, { quiet: true }); people = u.ok ? u.json : []; }
    }
  }
  let timer;
  onMount(() => { load(); timer = setInterval(() => { if (tab !== "shifts" && !busy) load(); }, 30000); });
  onDestroy(() => clearInterval(timer));
  const plus = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().substring(0, 10); };

  async function punch(action) {
    busy = true; ok = ""; error = "";
    const r = await api("POST", "/api/chedam/me/clock", { action });
    busy = false;
    if (!r.ok) return fail(r);
    me = r.json; ok = { in: "Clocked in", break: "On a break", back: "Back from the break", out: "Clocked out" }[action] + " at " + t(r.json.now) + ".";
    load();
  }
  async function punchOther(action) {
    busy = true; ok = ""; error = "";
    const r = await api("POST", "/api/chedam/clock", { user: other.user, pin: other.pin, action });
    busy = false;
    if (!r.ok) { other.pin = ""; return fail(r); }
    otherSt = r.json;
    if (action !== "status") { ok = r.json.name + ": " + { in: "clocked in", break: "on a break", back: "back from the break", out: "clocked out" }[action] + " at " + t(r.json.now) + "."; other = { user: "", pin: "" }; otherSt = null; }
    load();
  }

  function startFix(s) {
    fix = s ? { id: s.id, name: s.user_name, clock_in: loc(s.clock_in), clock_out: loc(s.clock_out), breaks: s.breaks.map((b) => ({ start: loc(b.start), end: loc(b.end) })), reason: "", edits: s.edits, original: s.original }
      : { id: "", user: people[0] ? people[0].id : "", clock_in: "", clock_out: "", breaks: [], reason: "" };
  }
  async function saveFix(e) {
    e.preventDefault();
    const body = { clock_in: iso(fix.clock_in), clock_out: iso(fix.clock_out), breaks: fix.breaks.filter((b) => b.start).map((b) => ({ start: iso(b.start), end: iso(b.end) })), reason: fix.reason };
    if (!fix.id) body.user = fix.user;
    const r = await api("POST", "/api/chedam/shifts" + (fix.id ? "/" + fix.id : ""), body);
    if (!r.ok) return fail(r);
    ok = "Saved."; fix = null; load();
  }
</script>

{#snippet status(st)}
  {#each st.alerts as a (a.kind)}<p role="alert" class="rounded-xl px-3 py-2 {a.level === 'bad' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn'}">⚠ {a.text}</p>{/each}
  <div class="card space-y-1">
    {#if st.open}
      <p class="text-lg"><b>{st.open.status === "on_break" ? "On a break" : "Clocked in"}</b> since {t(st.open.status === "on_break" ? st.open.breaks[st.open.breaks.length - 1].start : st.open.clock_in)}</p>
      <p class="text-sm text-muted">This shift: {h(st.open.calc.paid_min)} paid{st.open.calc.break_min ? " · breaks " + h(st.open.calc.break_min) : ""}</p>
    {:else}<p class="text-lg"><b>Not clocked in</b></p>{/if}
    <p class="text-sm text-muted">Today {h(st.today_min)} · this week {h(st.week.regular_min + st.week.overtime_min + st.week.double_min)}{st.week.overtime_min + st.week.double_min ? " (overtime " + h(st.week.overtime_min + st.week.double_min) + ")" : ""}</p>
  </div>
{/snippet}
{#snippet buttons(st, fn)}
  <div class="grid grid-cols-2 gap-2">
    {#if !st || !st.open}<button class="btn col-span-2 min-h-16 text-lg" disabled={busy} onclick={() => fn("in")}>Clock in</button>
    {:else if st.open.status === "on_break"}<button class="btn col-span-2 min-h-16 text-lg" disabled={busy} onclick={() => fn("back")}>Back from the break</button>
    {:else}<button class="btn-ghost min-h-16 text-lg" disabled={busy} onclick={() => fn("break")}>Start a break</button><button class="btn min-h-16 text-lg" disabled={busy} onclick={() => fn("out")}>Clock out</button>{/if}
  </div>
{/snippet}

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Time clock</h1></div>
    {#if tab === "shifts"}<button class="btn min-h-10 text-sm" onclick={() => startFix(null)}>Add a missed shift</button>{/if}
  </div>
  <div class="flex flex-wrap gap-2">
    {#each [["me", "Me", true], ["other", "Someone else", true], ["shifts", "Shifts", mgr]].filter((x) => x[2]) as [k, l] (k)}
      <button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; fix = null; ok = ""; load(); }}>{l}</button>{/each}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if tab === "me" && me}
    {@render status(me)}
    {@render buttons(me, punch)}
    <div class="card space-y-1">
      <h2 class="font-semibold">My week (from {me.week.from})</h2>
      {#each me.shifts as s (s.id)}<p class="flex justify-between border-b border-line text-sm"><span>{s.day} · {t(s.clock_in)}–{s.clock_out ? t(s.clock_out) : "now"}{s.breaks.length ? " · break " + h(s.calc.break_min) : ""}{s.edits.length ? " · fixed" : ""}</span><span>{h(s.calc.paid_min)}</span></p>
      {:else}<p class="text-sm text-muted">No shifts this week.</p>{/each}
    </div>
  {:else if tab === "other"}
    <form class="card grid gap-2 sm:grid-cols-3" onsubmit={(e) => { e.preventDefault(); punchOther("status"); }}>
      <label class="block sm:col-span-2"><span class="text-sm text-muted">Name</span><select class="field" bind:value={other.user} onchange={() => (otherSt = null)} required><option value="">Choose…</option>{#each names as u (u.id)}<option value={u.id}>{u.name}</option>{/each}</select></label>
      <label class="block"><span class="text-sm text-muted">PIN</span><input class="field" type="password" inputmode="numeric" autocomplete="off" bind:value={other.pin} maxlength="8" required /></label>
      <button class="btn sm:col-span-3" type="submit" disabled={busy}>Next</button>
    </form>
    {#if otherSt}
      <p class="text-lg font-semibold">{otherSt.name}</p>
      {@render status(otherSt)}
      {@render buttons(otherSt, punchOther)}
    {/if}
  {:else if tab === "shifts" && week}
    <div class="card flex flex-wrap items-end justify-between gap-2">
      <div class="flex items-end gap-2">
        <button class="btn-ghost min-h-10" onclick={() => { from = plus(from, -7); load(); }}>←</button>
        <span class="min-h-10 content-center">{week.from} to {week.to}</span>
        <button class="btn-ghost min-h-10" onclick={() => { from = plus(from, 7); load(); }}>→</button>
      </div>
      <ExportMenu title="Shifts" rows={week.people.flatMap((p) => p.shifts)} columns={[{ key: "user_name", label: "Who" }, { key: "day", label: "Day" }, { key: "i", label: "In", value: (s) => t(s.clock_in) }, { key: "o", label: "Out", value: (s) => t(s.clock_out) },
        { key: "b", label: "Break min", value: (s) => s.calc.break_min }, { key: "p", label: "Paid h", value: (s) => Math.round(s.calc.paid_min / 6) / 10 }, { key: "f", label: "Flags", value: (s) => s.flags.map((f) => FLAG[f]).join("; ") }]} />
    </div>
    {#if who.length}<p class="text-sm">On the clock now: {who.map((w) => w.name + (w.on_break ? " (break)" : "") + " since " + t(w.since)).join(" · ")}</p>{/if}
    {#if fix}
      <form class="card grid gap-2 sm:grid-cols-3" onsubmit={saveFix}>
        <h2 class="font-semibold sm:col-span-3">{fix.id ? "Fix " + fix.name + "'s shift" : "A missed shift"}</h2>
        {#if !fix.id}<label class="block sm:col-span-3"><span class="text-sm text-muted">Who</span><select class="field" bind:value={fix.user}>{#each people as u (u.id)}<option value={u.id}>{u.name}</option>{/each}</select></label>{/if}
        <label class="block"><span class="text-sm text-muted">In</span><input class="field" type="datetime-local" bind:value={fix.clock_in} required /></label>
        <label class="block"><span class="text-sm text-muted">Out</span><input class="field" type="datetime-local" bind:value={fix.clock_out} required={!fix.id} /></label>
        <div></div>
        {#each fix.breaks as b, i (i)}
          <label class="block"><span class="text-sm text-muted">Break from</span><input class="field" type="datetime-local" bind:value={b.start} /></label>
          <label class="block"><span class="text-sm text-muted">to</span><input class="field" type="datetime-local" bind:value={b.end} /></label>
          <button class="btn-ghost min-h-10 self-end" type="button" onclick={() => fix.breaks.splice(i, 1)}>Remove</button>
        {/each}
        <button class="btn-ghost min-h-10 sm:col-span-3" type="button" onclick={() => fix.breaks.push({ start: fix.clock_in, end: fix.clock_in })}>+ A break</button>
        <label class="block sm:col-span-3"><span class="text-sm text-muted">Why (kept with the change)</span><input class="field" bind:value={fix.reason} maxlength="300" required /></label>
        {#if fix.original}<p class="text-sm text-muted sm:col-span-3">Punched: {t(fix.original.clock_in)}–{t(fix.original.clock_out)}</p>{/if}
        {#each fix.edits || [] as ed, i (i)}<p class="text-sm text-muted sm:col-span-3">{ed.at.substring(0, 16)} · {ed.by}: {ed.reason}</p>{/each}
        <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (fix = null)}>Cancel</button></div>
      </form>
    {/if}
    {#each week.people as p (p.user)}
      <div class="card space-y-1">
        <p class="flex flex-wrap justify-between gap-2"><b>{p.name}</b><span class="text-sm">{h(p.paid_min)} · regular {h(p.regular_min)}{p.overtime_min ? " · overtime " + h(p.overtime_min) : ""}{p.double_min ? " · double " + h(p.double_min) : ""}{p.overtime_eligible ? "" : " (no overtime)"}</span></p>
        {#each p.shifts as s (s.id)}
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line text-sm">
            <span>{s.day} · {t(s.clock_in)}–{s.clock_out ? t(s.clock_out) : "still in"}{s.breaks.length ? " · break " + h(s.calc.break_min) : ""} · {h(s.calc.paid_min)}
              {#each s.flags as f (f)}<span class="ml-1 rounded px-1 {f === 'no_out' || f === 'no_meal' ? 'bg-bad/10 text-bad' : f === 'short_rest' ? 'bg-warn/10 text-warn' : 'bg-line'}">{FLAG[f]}</span>{/each}</span>
            <button class="text-accent underline" onclick={() => startFix(s)}>Fix</button>
          </div>
        {/each}
      </div>
    {:else}<p class="text-muted">No shifts this week.</p>{/each}
  {/if}
</section>

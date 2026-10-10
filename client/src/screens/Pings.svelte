<script>
  // Send a ping (P2 step 9; FR-2.06, 2.07): to one device, all tills, all phones and tablets, all back-office
  // PCs or everyone; a ready-made text or your own; urgent fills their screen until someone confirms it.
  // Below: pings this device sent, with who answered and their replies (live).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";
  import { on } from "../lib/live.svelte.js";

  let tg = $state(null), sent = $state([]), error = $state(""), ok = $state("");
  let target = $state("till"), text = $state(""), urgent = $state(false), busy = $state(false);

  async function load() {
    const [a, b] = await Promise.all([tg ? null : api("GET", "/api/chedam/pings/targets"), api("GET", "/api/chedam/pings")]);
    if (a) { if (a.ok) tg = a.json; else if (!(await handleRefusal(a))) error = a.message; }
    if (b && b.ok) sent = b.json.sent;
  }
  onMount(() => { load(); return on("pings", () => load()); });

  async function send(t) {
    const body = { target, text: t || text, urgent };
    if (!body.text.trim()) { error = "Choose a ready-made text or write one."; return; }
    busy = true; error = ""; ok = "";
    const r = await api("POST", "/api/chedam/pings", body, { quiet: true });
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    ok = "Sent to " + r.json.to + (urgent ? " (urgent)" : "") + ".";
    text = ""; urgent = false; load();
  }
  async function withdraw(p) { await api("POST", `/api/chedam/pings/${p.id}/withdraw`, {}, { quiet: true }); load(); }
  const when = (t) => new Date(String(t).replace(" ", "T")).toLocaleTimeString([], { timeStyle: "short" });
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
    <h1 class="text-xl font-bold">Ping</h1>
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}
  {#if tg}
    <div class="card space-y-3">
      <label class="block"><span class="font-semibold">To</span>
        <select class="field" bind:value={target}>
          {#each tg.groups.filter((g) => g.count) as g (g.target)}<option value={g.target}>{g.label} ({g.count})</option>{/each}
          <optgroup label="One device">{#each tg.devices as d (d.target)}<option value={d.target}>{d.label}{d.who ? " · " + d.who : ""}{d.online ? "" : " (offline)"}</option>{/each}</optgroup>
        </select></label>
      <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={urgent} /> <span><b>Urgent</b>: fills their screen and sounds until someone confirms; managers get it after 5 minutes</span></label>
      <div class="grid gap-2 sm:grid-cols-2">{#each tg.templates as t (t)}<button class="btn-ghost min-h-12 justify-start text-left" disabled={busy} onclick={() => send(t)}>{t}</button>{/each}</div>
      <form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); send(); }}>
        <input class="field flex-1" bind:value={text} maxlength="300" placeholder="Or write your own" aria-label="Your own text" />
        <button class="btn" type="submit" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  {/if}
  {#if sent.length}
    <div class="card space-y-2">
      <h2 class="font-semibold">Sent from this device (last 12 hours)</h2>
      {#each sent as p (p.id)}
        <div class="border-b border-line pb-2 text-sm">
          <p><b>{p.urgent ? "⚠ " : ""}{p.text}</b> → {p.to} · {when(p.created_at)}{p.escalated ? " · sent to managers" : ""}{p.closed ? " · closed" : ""}</p>
          {#each p.acks as a, i (i)}<p class="text-ok">✓ {a.name || a.device_name}{a.device_name ? " (" + a.device_name + ")" : ""}{a.reply ? ": " + a.reply : ""}</p>{:else}<p class="text-muted">No answer yet</p>{/each}
          {#if !p.closed}<button class="underline" onclick={() => withdraw(p)}>Take back</button>{/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

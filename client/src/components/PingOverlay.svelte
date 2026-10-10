<script>
  // Pings shown over any screen, Sell included, without leaving it (P2 step 9; FR-2.06, BR-42): a normal ping
  // is a banner at the top (reply or close); an urgent one fills the screen and beeps every 5 s until someone
  // confirms it. Hears new pings live; also checks every 30 s.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { on } from "../lib/live.svelte.js";

  const REPLIES = ["On my way", "OK", "Busy, 5 minutes"];
  let open = $state([]), other = $state({});
  let ctx = null, beepT = null;

  async function load() {
    const r = await api("GET", "/api/chedam/pings", null, { quiet: true });
    if (r.ok) open = r.json.open;
  }
  function beep() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25].forEach((t) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
      });
    } catch { /* no sound on this device */ }
  }
  const urgent = $derived(open.filter((p) => p.urgent));
  const normal = $derived(open.filter((p) => !p.urgent));
  $effect(() => {
    clearInterval(beepT);
    if (!urgent.length) return;
    beep();
    beepT = setInterval(beep, 5000);
    return () => clearInterval(beepT);
  });

  onMount(() => {
    load();
    const off = on("pings", (d) => { if (d.record && (d.action === "create" || d.action === "update")) { if (d.action === "create" && !d.record.urgent) beep(); load(); } });
    const t = setInterval(load, 30000);
    return () => { off(); clearInterval(t); clearInterval(beepT); };
  });

  async function ack(p, reply = "") {
    const r = await api("POST", `/api/chedam/pings/${p.id}/ack`, { reply }, { quiet: true });
    if (r.ok) { open = open.filter((x) => x.id !== p.id); other[p.id] = ""; }
    load();
  }
  const ago = (t) => { const m = Math.round((Date.now() - new Date(String(t).replace(" ", "T"))) / 60000); return m < 1 ? "just now" : m + " min ago"; };
</script>

{#if urgent.length}
  {@const p = urgent[0]}
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-bad/90 p-4 text-white" role="alertdialog" aria-modal="true" aria-label="Urgent ping">
    <div class="w-full max-w-lg space-y-4 text-center">
      <p class="text-lg font-semibold">URGENT{p.escalated ? " · nobody answered, sent to managers" : ""}</p>
      <p class="text-4xl font-bold">{p.text}</p>
      <p class="text-lg">{p.from}{p.from_device ? " on " + p.from_device : ""} · {ago(p.created_at)}</p>
      <div class="flex flex-wrap justify-center gap-2">
        <button class="min-h-14 rounded-xl bg-white px-6 text-lg font-bold text-bad" onclick={() => ack(p, "On it")}>I'm on it</button>
        {#each REPLIES as r (r)}<button class="min-h-14 rounded-xl border-2 border-white px-4 text-lg" onclick={() => ack(p, r)}>{r}</button>{/each}
      </div>
      {#if urgent.length > 1}<p>+{urgent.length - 1} more urgent</p>{/if}
    </div>
  </div>
{/if}
{#if normal.length}
  <div class="fixed inset-x-0 top-0 z-[55] mx-auto flex max-w-xl flex-col gap-2 p-2" aria-live="polite">
    {#each normal.slice(0, 3) as p (p.id)}
      <div class="rounded-xl border border-accent bg-card p-3 shadow-lg" role="status">
        <p class="font-semibold">📣 {p.text}</p>
        <p class="text-sm text-muted">{p.from}{p.from_device ? " on " + p.from_device : ""} · {ago(p.created_at)}</p>
        <form class="mt-2 flex flex-wrap gap-1" onsubmit={(e) => { e.preventDefault(); ack(p, other[p.id] || ""); }}>
          {#each REPLIES as r (r)}<button type="button" class="btn-ghost min-h-10 text-sm" onclick={() => ack(p, r)}>{r}</button>{/each}
          <input class="field min-h-10 flex-1 py-1 text-sm" placeholder="Reply…" maxlength="120" bind:value={other[p.id]} aria-label="Reply" />
          <button class="btn min-h-10 text-sm" type="submit">{other[p.id] ? "Send" : "Close"}</button>
        </form>
      </div>
    {/each}
    {#if normal.length > 3}<p class="text-center text-sm">+{normal.length - 3} more pings</p>{/if}
  </div>
{/if}

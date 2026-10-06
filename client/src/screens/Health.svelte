<script>
  // Hub health (FR-12.09): uptime, temperature, power, memory, storage, last backup, restore test,
  // clock, internet, devices online, offline queue, versions, pending updates.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";

  let h = $state(null), error = $state(""), busy = $state(false);
  const ICON = { ok: "✓", warn: "!", bad: "✗", info: "·" };
  const WORD = { ok: "All good", warn: "Needs a look", bad: "Needs attention now" };
  const LINK = { backup: "backups", restore_test: "backups", devices: "devices" };

  async function load(fresh = false) {
    busy = true;
    const r = await api("GET", "/api/chedam/health" + (fresh ? "?fresh=1" : ""));
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    error = ""; h = r.json;
  }
  onMount(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); });
</script>

<section class="space-y-4">
  <div>
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
    <h1 class="text-xl font-bold">Hub health</h1>
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if h}
    <div class="card flex flex-wrap items-center justify-between gap-3 {h.overall === 'bad' ? 'border-bad' : h.overall === 'warn' ? 'border-warn' : 'border-ok'}">
      <p class="text-lg font-bold {h.overall === 'bad' ? 'text-bad' : h.overall === 'warn' ? 'text-warn' : 'text-ok'}">{WORD[h.overall] || "All good"}</p>
      <span class="text-sm text-muted">Checked {new Date(h.checked_at).toLocaleTimeString()}
        <button class="ml-2 min-h-10 underline" disabled={busy} onclick={() => load(true)}>{busy ? "Checking…" : "Check now"}</button></span>
    </div>
    <ul class="card divide-y divide-line p-0">
      {#each h.items as it (it.id)}
        <li class="flex items-start gap-3 px-4 py-3">
          <span class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold
            {it.status === 'bad' ? 'bg-bad/15 text-bad' : it.status === 'warn' ? 'bg-warn/15 text-warn' : it.status === 'ok' ? 'bg-ok/15 text-ok' : 'bg-soft text-muted'}"
            aria-label={it.status}>{ICON[it.status]}</span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap justify-between gap-x-3">
              <span class="font-semibold">{it.label}</span>
              <span class="break-words">{it.value}</span>
            </div>
            {#if it.detail}<p class="text-sm break-words text-muted">{it.detail}</p>{/if}
            {#if LINK[it.id] && (it.status === "bad" || it.status === "warn")}
              <button class="mt-1 min-h-10 text-sm underline" onclick={() => go(LINK[it.id])}>Open {LINK[it.id]}</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {:else if !error}
    <p class="text-muted">Checking the hub…</p>
  {/if}
</section>

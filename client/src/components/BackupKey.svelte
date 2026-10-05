<script>
  // The backup encryption key (NFR-12). Backups on the drive are encrypted; restoring them on a new hub
  // needs this key, so the owner prints it and keeps it with the recovery code.
  import { api } from "../lib/api.js";
  import { handleRefusal } from "../lib/session.svelte.js";

  let { ready = false, ondone } = $props();
  let secret = $state("");
  let kept = $state(false);
  let busy = $state(false), error = $state("");

  async function get(show) {
    busy = true; error = "";
    const r = await api("POST", "/api/chedam/backups/key", { show }, { timeout: 30000 });
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    secret = r.json.secret;
  }
</script>

<div class="space-y-3">
  {#if !secret}
    {#if ready}
      <p>The backup key is made. <button type="button" class="min-h-10 underline" disabled={busy} onclick={() => get(true)}>Show it again</button></p>
    {:else}
      <p>Backups are encrypted, so a lost drive shows nothing. To restore them on a new hub you need the <b>backup key</b>.</p>
      <button type="button" class="btn" disabled={busy} onclick={() => get(false)}>{busy ? "Making the key…" : "Make the backup key"}</button>
    {/if}
  {:else}
    <div class="rounded-xl border-2 border-dashed border-accent p-3 text-center">
      <p class="text-sm font-semibold">Chedam backup key</p>
      <p class="font-mono text-sm break-all" aria-label="Backup key">{secret}</p>
    </div>
    <p class="text-sm">Print it or write it down exactly, and keep it with your recovery code, away from the hub.</p>
    <div class="flex flex-wrap gap-2 print:hidden">
      <button type="button" class="btn-ghost" onclick={() => window.print()}>Print</button>
    </div>
    <label class="flex min-h-12 items-center gap-3 print:hidden">
      <input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={kept} />
      <span>I have printed it or written it down</span>
    </label>
    <button type="button" class="btn print:hidden" disabled={!kept} onclick={() => { secret = ""; ondone && ondone(); }}>Done</button>
  {/if}
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
</div>

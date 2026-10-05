<script>
  // Choose the USB drive for backups (FR-1.14). The hub's root helper lists the drives it can see.
  import { api } from "../lib/api.js";
  import { handleRefusal } from "../lib/session.svelte.js";

  let { current = {}, onchosen } = $props();
  let drives = $state(null);
  let busy = $state(false), error = $state("");

  function gb(n) { return n == null ? "?" : n >= 1e12 ? (n / 1e12).toFixed(1) + " TB" : (n / 1e9).toFixed(1) + " GB"; }

  async function find() {
    busy = true; error = "";
    const r = await api("POST", "/api/chedam/backups/drives", {}, { timeout: 30000 });
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    drives = r.json.drives;
  }

  async function choose(d) {
    const r = await api("POST", "/api/chedam/backups/drive", { uuid: d.uuid, label: d.label || d.model || "USB drive", fstype: d.fstype, size_bytes: d.size_bytes });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    onchosen && onchosen(r.json);
  }
</script>

<div class="space-y-3">
  {#if current && current.uuid}
    <p>Backup drive: <b>{current.label || "USB drive"}</b> <span class="text-sm text-muted">({current.fstype})</span></p>
  {/if}
  <button type="button" class="btn-ghost" disabled={busy} onclick={find}>{busy ? "Looking for drives…" : current && current.uuid ? "Change drive" : "Find USB drives"}</button>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if drives}
    {#if drives.length === 0}
      <p class="rounded-xl bg-soft px-3 py-2">No USB drive found. Plug one into the hub (with an OTG adapter on a Pi Zero), wait a few seconds, then try again.</p>
    {:else}
      <ul class="space-y-2">
        {#each drives as d (d.uuid)}
          <li class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
            <span>
              <b>{d.label || d.model || "USB drive"}</b>
              <span class="block text-sm text-muted">{d.fstype} · {gb(d.size_bytes)}{d.free_bytes != null ? " · " + gb(d.free_bytes) + " free" : ""}</span>
            </span>
            {#if d.supported}
              <button type="button" class="btn min-h-10 text-sm" disabled={current && current.uuid === d.uuid} onclick={() => choose(d)}>
                {current && current.uuid === d.uuid ? "Chosen" : "Use this drive"}
              </button>
            {:else}
              <span class="text-sm text-warn">Format not supported</span>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="text-sm text-muted">Chedam only adds a "Chedam-Backups" folder. It never formats the drive or touches your other files.</p>
    {/if}
  {/if}
</div>

<script>
  // About Chedam (P5 step 7; FR-11.11): the version, and the reference data it uses with each source's licence.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go } from "../lib/session.svelte.js";

  let ref = $state(null), version = $state("");
  onMount(async () => {
    const r = await api("GET", "/api/chedam/reference", null, { quiet: true });
    if (r.ok) { ref = r.json; version = r.json.version || ""; }
  });
</script>

<section class="space-y-4">
  <div class="screen-head"><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("help")}>← Help</button><h1 class="text-xl font-bold">About Chedam</h1></div>
  <div class="card space-y-1">
    <p>Chedam: the store's own system, on the store's own hub. {version ? "Version " + version + "." : ""}</p>
    <p class="text-sm text-muted">The store's data stays on the hub; nothing is sent anywhere unless the owner connects a service (card processor, cloud drive).</p>
  </div>
  {#if ref}
    <div class="card space-y-2">
      <h2 class="font-semibold">Reference data</h2>
      <p class="text-sm text-muted">{ref.note}</p>
      {#each ref.datasets as d (d.id)}<div class="border-t border-line pt-1 text-sm"><p><b>{d.name}</b> · {d.rows} rows · {d.version}</p><p class="text-muted">{d.source}</p><p class="text-muted">Licence: {d.licence}</p></div>{/each}
      {#each ref.online as o (o.id)}<div class="border-t border-line pt-1 text-sm"><p><b>{o.name}</b> (asked online when the hub has internet{o.enabled ? "" : "; switched off"})</p><p class="text-muted">Licence: {o.licence} · {o.url}</p></div>{/each}
    </div>
  {/if}
</section>

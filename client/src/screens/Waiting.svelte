<script>
  import { s, forgetDevice } from "../lib/session.svelte.js";
  const locked = $derived(s.device && s.device.status === "locked");
</script>

<section class="card">
  <h1 class="mb-2 text-xl font-bold">{locked ? "This device is locked" : "Waiting for approval"}</h1>
  <p class="mb-3">
    {#if locked}
      A manager locked it. Ask them to unlock it in the device manager.
    {:else}
      Ask a manager to approve "{s.device ? s.device.name : ""}" in the device manager.
    {/if}
  </p>
  <p class="text-sm text-muted">This screen checks again every few seconds.</p>
  {#if !locked}
    <button class="btn-ghost mt-4" onclick={forgetDevice}>Cancel and use a pairing code instead</button>
  {/if}
</section>

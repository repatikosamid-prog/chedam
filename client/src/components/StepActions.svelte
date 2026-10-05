<script>
  // Bottom of each wizard step: save (the form's submit) or skip (becomes a task).
  let { onskip, busy = false, error = "", saveLabel = "Save and continue", skipLabel = "Skip for now" } = $props();
</script>

{#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
<div class="flex flex-wrap gap-2 pt-2">
  <button class="btn" disabled={busy}>{busy ? "Saving…" : saveLabel}</button>
  <button type="button" class="btn-ghost" disabled={busy} onclick={onskip}>{skipLabel}</button>
</div>

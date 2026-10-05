<script>
  // FR-1.14 backup setup arrives with P0 step 7 (USB drive, schedule, first backup). Until then this step
  // explains and can only be skipped, which puts "choose a backup USB drive" on the task list.
  let { onskip } = $props();
</script>

<div class="card space-y-3">
  <h2 class="text-xl font-bold">Backups</h2>
  <p>Chedam will copy your store's data every night to a USB drive plugged into the hub, and can also keep an encrypted copy in your own cloud drive.</p>
  <p class="rounded-xl bg-soft px-3 py-2">Backup setup comes with the next update. Skip this for now; it goes on your task list so it is not forgotten.</p>
  <button class="btn" onclick={onskip}>Skip for now (add to my tasks)</button>
</div>

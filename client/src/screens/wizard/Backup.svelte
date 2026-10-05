<script>
  // FR-1.14 backup setup in the wizard: choose the USB drive, make and print the backup key, first backup.
  // The hub marks this step done when the first backup is verified.
  import { onMount } from "svelte";
  import { backupStatus, backupNow, size } from "../../lib/backups.js";
  import BackupDrive from "../../components/BackupDrive.svelte";
  import BackupKey from "../../components/BackupKey.svelte";

  let { onsaved, onskip } = $props();
  let st = $state(null);
  let running = $state(false), seconds = $state(0), result = $state(null), error = $state("");

  async function load() { const r = await backupStatus(); if (r.ok) st = r.json; }
  onMount(load);

  async function first() {
    running = true; error = ""; result = null; seconds = 0;
    const r = await backupNow(true, (s) => (seconds = s));
    running = false;
    if (r.ok) result = r.json; else error = r.message;
    load();
  }
</script>

<div class="card space-y-4">
  <h2 class="text-xl font-bold">Backups</h2>
  <p>Every night Chedam copies your store's data, encrypted, to a USB drive plugged into the hub, and checks that the copy can be read back.</p>

  {#if st}
    <section class="space-y-2">
      <h3 class="font-semibold">1. Backup drive</h3>
      <BackupDrive current={st.drive} onchosen={load} />
    </section>

    {#if st.drive && st.drive.uuid}
      <section class="space-y-2">
        <h3 class="font-semibold">2. Backup key</h3>
        <BackupKey ready={st.key_ready} ondone={load} />
      </section>
    {/if}

    {#if st.drive && st.drive.uuid && st.key_ready}
      <section class="space-y-2">
        <h3 class="font-semibold">3. First backup</h3>
        {#if result}
          <p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">✓ First backup made and checked ({size(result.size_bytes)}). Nightly backups run at {st.schedule}.</p>
          <button class="btn" onclick={onsaved}>Continue</button>
        {:else}
          <button class="btn" disabled={running} onclick={first}>{running ? "Backing up… " + seconds + " s" : "Make the first backup now"}</button>
        {/if}
        {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
      </section>
    {/if}
  {:else}
    <p class="text-muted">Loading…</p>
  {/if}

  <button class="btn-ghost" onclick={onskip}>Skip for now (add to my tasks)</button>
</div>

<script>
  // Backups (FR-1.14, NFR-03/04): last good backup, back up now, restore test, drive, key, nightly time.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { s, go, can, handleRefusal } from "../lib/session.svelte.js";
  import { backupStatus, backupNow, size, when } from "../lib/backups.js";
  import BackupDrive from "../components/BackupDrive.svelte";
  import BackupKey from "../components/BackupKey.svelte";

  let st = $state(null), list = $state([]);
  let running = $state(false), seconds = $state(0);
  let testing = $state(false), test = $state(null);
  let schedule = $state("");
  let msg = $state({ text: "", kind: "" });
  const owner = $derived(!!(s.me && s.me.role && s.me.role.code === "owner"));

  async function load() {
    const r = await backupStatus();
    if (!r.ok) { if (!(await handleRefusal(r))) msg = { text: r.message, kind: "bad" }; return; }
    st = r.json;
    if (!schedule) schedule = st.schedule;
    const l = await api("GET", "/api/collections/backups/records?perPage=15&sort=-started_at&filter=" + encodeURIComponent("deleted_at=''"));
    if (l.ok) list = l.json.items;
  }
  onMount(load);

  async function now() {
    running = true; seconds = 0; msg = { text: "", kind: "" };
    const r = await backupNow(false, (x) => (seconds = x));
    running = false;
    msg = r.ok ? { text: "Backup made and checked (" + size(r.json.size_bytes) + ").", kind: "ok" } : { text: r.message, kind: "bad" };
    load();
  }

  async function restoreTest() {
    testing = true; test = null;
    const r = await api("POST", "/api/chedam/backups/test-restore", {}, { timeout: 130000 });
    testing = false;
    if (!r.ok) { if (!(await handleRefusal(r))) msg = { text: r.message, kind: "bad" }; return; }
    test = r.json;
    load();
  }

  async function saveSchedule(e) {
    e.preventDefault();
    const rec = await api("GET", "/api/collections/settings/records?filter=" + encodeURIComponent("key='backup.schedule'"));
    if (!rec.ok || !rec.json.items[0]) return;
    const r = await api("PATCH", "/api/collections/settings/records/" + rec.json.items[0].id, { value: schedule });
    msg = r.ok ? { text: "Nightly backups now run at " + schedule + ".", kind: "ok" } : { text: r.message, kind: "bad" };
    load();
  }

  const STATUS = { verified: "✓ checked", ok: "✓", running: "running…", failed: "failed" };
  const KIND = { scheduled: "Nightly", manual: "Manual", first_backup: "First backup", pre_update: "Before update" };
</script>

<section class="space-y-4">
  <div>
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
    <h1 class="text-xl font-bold">Backups</h1>
  </div>
  {#if msg.text}<p role="status" class="rounded-xl px-3 py-2 {msg.kind === 'bad' ? 'bg-bad/10 text-bad' : 'bg-ok/10 text-ok'}">{msg.text}</p>{/if}

  {#if st}
    <div class="card space-y-2">
      {#if st.last_good}
        <p class="text-lg"><b>Last good backup:</b> {when(st.last_good.finished_at || st.last_good.started_at)}</p>
        <p class="text-sm text-muted">{KIND[st.last_good.kind] || st.last_good.kind} · {size(st.last_good.size_bytes)} · encrypted · drive has {size(st.last_good.free_bytes)} free</p>
      {:else}
        <p class="text-lg font-semibold text-warn">No backup yet.</p>
      {/if}
      {#if st.latest && st.latest.status === "failed"}
        <p class="rounded-xl bg-bad/10 px-3 py-2 text-bad">Latest attempt failed ({when(st.latest.started_at)}): {st.latest.error}</p>
      {/if}
      <p class="text-sm">Nightly at <b>{st.schedule}</b> · kept: 14 days, 8 weeks, 12 months.</p>
      <div class="flex flex-wrap gap-2 pt-1">
        {#if can("backups.run")}
          <button class="btn" disabled={running || !st.drive.uuid || !st.key_ready} onclick={now}>{running ? "Backing up… " + seconds + " s" : "Back up now"}</button>
        {/if}
        {#if can("backups.restore")}
          <button class="btn-ghost" disabled={testing || !st.last_good} onclick={restoreTest}>{testing ? "Testing restore…" : "Test a restore"}</button>
        {/if}
      </div>
      {#if test}
        <p role="status" class="rounded-xl px-3 py-2 {test.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}">
          {test.ok ? "✓ Restore test passed" : "Restore test failed"}: {test.file_name} rebuilt in {test.seconds} s{test.error ? " · " + test.error : ""}.
          Your live data was not touched.
        </p>
      {:else if st.last_restore_test && st.last_restore_test.at}
        <p class="text-sm text-muted">Last restore test: {new Date(st.last_restore_test.at).toLocaleString()} · {st.last_restore_test.ok ? "passed" : "failed"}</p>
      {/if}
    </div>

    {#if can("settings.manage")}
      <details class="card">
        <summary class="min-h-10 cursor-pointer font-semibold">Drive and nightly time</summary>
        <div class="mt-2 space-y-4">
          <BackupDrive current={st.drive} onchosen={load} />
          <form class="flex flex-wrap items-end gap-2" onsubmit={saveSchedule}>
            <div><label for="sched" class="block text-sm font-semibold">Nightly backup time</label>
              <input id="sched" class="field w-36" type="time" bind:value={schedule} required /></div>
            <button class="btn-ghost">Save time</button>
          </form>
        </div>
      </details>
    {/if}

    {#if owner}
      <details class="card">
        <summary class="min-h-10 cursor-pointer font-semibold">Backup key</summary>
        <div class="mt-2"><BackupKey ready={st.key_ready} ondone={load} /></div>
      </details>
    {/if}

    <div class="card">
      <h2 class="mb-2 font-semibold">Recent backups</h2>
      {#if list.length}
        <ul class="divide-y divide-line text-sm">
          {#each list as b (b.id)}
            <li class="flex flex-wrap justify-between gap-2 py-2">
              <span>{when(b.started_at)} · {KIND[b.kind] || b.kind}</span>
              <span class={b.status === "failed" ? "text-bad" : b.status === "verified" ? "text-ok" : ""}>{STATUS[b.status] || b.status}{b.size_bytes ? " · " + size(b.size_bytes) : ""}</span>
              {#if b.error}<span class="w-full text-bad">{b.error}</span>{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-muted">None yet.</p>
      {/if}
    </div>
  {:else}
    <p class="text-muted">Loading…</p>
  {/if}
</section>

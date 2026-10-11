<script>
  // The owner's cloud drive (P5 step 4; FR-12.08, P5-e), cloud.connect (the owner): Google Drive or OneDrive,
  // the app's own folder only. Enter the store's app registration (D2), then sign in with a code typed on
  // google.com/device or microsoft.com/devicelogin. The nightly encrypted backup is copied there; the remote
  // view (step 5) is uploaded there too.
  import { onMount, onDestroy } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";

  let st = $state(null), error = $state(""), ok = $state(""), busy = $state(false), appForm = $state(null);
  let timer = null;
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const when = (x) => (x ? new Date(String(x).replace(" ", "T")).toLocaleString() : "");

  function watch() {
    clearInterval(timer);
    const w = st && st.providers.find((p) => p.link && p.link.status === "waiting");
    if (w) timer = setInterval(() => poll(w.provider), 5000);
  }
  async function load() { const r = await api("GET", "/api/chedam/cloud"); if (!r.ok) return fail(r); st = r.json; watch(); }
  onMount(load);
  onDestroy(() => clearInterval(timer));

  async function post(path, body, msg) {
    error = ""; ok = ""; busy = true;
    const r = await api("POST", path, body, { timeout: 60000 });
    busy = false;
    if (!r.ok) return fail(r);
    st = r.json.status || r.json; if (msg) ok = msg; watch();
    return r.json;
  }
  async function poll(provider) {
    const r = await api("POST", "/api/chedam/cloud/poll", { provider }, { quiet: true });
    if (!r.ok) return;
    st = r.json;
    if (st.connected) { ok = `${st.connected.name} is connected.`; clearInterval(timer); }
    else if (!st.providers.some((p) => p.link && p.link.status === "waiting")) clearInterval(timer);
  }
  async function saveApp(e) {
    e.preventDefault();
    if (await post("/api/chedam/cloud/app", appForm, "App registration saved.")) appForm = null;
  }
  async function uploadNow() {
    const r = await post("/api/chedam/cloud/upload-now", {});
    if (r) ok = r.error ? "" : r.uploaded ? `${r.uploaded} files uploaded.` : "Nothing waiting to upload.";
    if (r && r.error) error = r.error;
  }
</script>

<section class="space-y-4">
  <div class="screen-head"><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Cloud drive</h1></div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}
  <p class="text-sm text-muted">Chedam copies the encrypted nightly backup to your own Google Drive or OneDrive (a folder of its own; it cannot see your other files), and the summary you read away from the store. The hub only sends; nothing on the internet can reach it.</p>

  {#if st && st.connected}
    <div class="card space-y-2">
      <p class="flex flex-wrap justify-between gap-2"><span><b>{st.connected.name}</b> · {st.connected.account}</span><span class="text-ok">Connected</span></p>
      <p class="text-sm text-muted">Since {when(st.connected.connected_at)} ({st.connected.connected_by})</p>
      <p class="text-sm">Last backup copied: {st.connected.last_upload_name ? st.connected.last_upload_name + " · " + when(st.connected.last_upload_at) : "none yet (after the next nightly backup)"}{st.outbox ? ` · ${st.outbox} files waiting` : ""}</p>
      {#if st.connected.last_error}<p class="text-sm text-warn">Last problem: {st.connected.last_error}</p>{/if}
      <div class="flex flex-wrap gap-2"><button class="btn-ghost" disabled={busy} onclick={uploadNow}>Upload now</button>
        <button class="btn-ghost text-bad" disabled={busy} onclick={() => confirm("Disconnect the cloud drive? Backups stay on the USB drive only.") && post("/api/chedam/cloud/disconnect", {}, "Disconnected.")}>Disconnect</button></div>
    </div>
  {/if}

  {#if st}
    {#each st.providers as p (p.provider)}
      {#if !st.connected || st.connected.provider !== p.provider}
        <div class="card space-y-2">
          <h2 class="font-semibold">{p.name}</h2>
          {#if p.link && p.link.status === "waiting"}
            <p>On a phone or computer, open <b>{p.link.verify_url}</b> and type</p>
            <p class="font-mono text-3xl font-bold tracking-widest">{p.link.user_code}</p>
            <p class="text-sm text-muted">Sign in with the store owner's account and allow Chedam. This page notices by itself (the code works until {when(p.link.code_expires)}).</p>
          {:else}
            {#if p.link && p.link.last_error}<p class="text-sm text-warn">{p.link.last_error}</p>{/if}
            <p class="text-sm">App registration: {p.link && p.link.has_app ? "client ID " + p.link.client_id_hint : "not entered yet"}
              <button class="underline" onclick={() => (appForm = { provider: p.provider, client_id: "", client_secret: "" })}>{p.link && p.link.has_app ? "Change" : "Enter"}</button></p>
            {#if appForm && appForm.provider === p.provider}
              <form class="grid gap-2" onsubmit={saveApp}>
                <label class="block"><span class="text-sm text-muted">Client ID ({p.provider === "google" ? "Google Cloud → Credentials → OAuth client 'TVs and limited input devices'" : "Microsoft Entra → App registrations, public client flows on"})</span><input class="field font-mono" bind:value={appForm.client_id} required /></label>
                {#if p.provider === "google"}<label class="block"><span class="text-sm text-muted">Client secret</span><input class="field font-mono" type="password" autocomplete="off" bind:value={appForm.client_secret} required /></label>{/if}
                <div class="flex gap-2"><button class="btn" type="submit" disabled={busy}>Save</button><button class="btn-ghost" type="button" onclick={() => (appForm = null)}>Cancel</button></div>
              </form>
            {/if}
            <button class="btn" disabled={busy || !(p.link && p.link.has_app) || !!st.connected} onclick={() => post("/api/chedam/cloud/connect", { provider: p.provider })}>Connect {p.name}</button>
            {#if st.connected}<p class="text-sm text-muted">Disconnect {st.connected.name} first.</p>{/if}
          {/if}
        </div>
      {/if}
    {/each}
  {/if}
</section>

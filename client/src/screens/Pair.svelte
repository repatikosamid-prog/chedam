<script>
  // Pair this device (FR-1.07): code from a manager (or the QR link ?pair=CODE), or ask to join.
  import { api, save, VERSION } from "../lib/api.js";
  import { refresh, notify, go } from "../lib/session.svelte.js";
  import { TYPES } from "../lib/labels.js";

  let code = $state((new URLSearchParams(location.search).get("pair") || "").toUpperCase());
  let error = $state("");
  let busy = $state(false);
  let askName = $state("");
  let askType = $state("till");
  let askError = $state("");

  function clearUrl() { history.replaceState(null, "", location.pathname); }

  async function pair(e) {
    e.preventDefault();
    busy = true;
    const r = await api("POST", "/api/chedam/devices/pair", { code, app_version: VERSION });
    busy = false;
    if (!r.ok) { error = r.message; return; }
    save("device", { id: r.json.device_id, key: r.json.key });
    save("token", null);
    clearUrl();
    await refresh();
    notify('Paired as "' + r.json.name + '". Pick your name to sign in.', "ok");
  }

  async function ask(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/devices/request", { name: askName, type: askType, app_version: VERSION });
    if (!r.ok) { askError = r.message; return; }
    save("device", { id: r.json.device_id, key: r.json.key });
    clearUrl();
    refresh();
  }
</script>

<section class="space-y-4">
  <div class="card">
    <h1 class="mb-1 text-xl font-bold">Pair this device</h1>
    <p class="mb-3 text-muted">Ask a manager for a pairing code (Device manager → Pair a new device).</p>
    <form onsubmit={pair}>
      <label for="code" class="mb-1 block font-semibold">Pairing code</label>
      <input id="code" class="field font-mono text-lg tracking-widest uppercase" bind:value={code} maxlength="9"
        autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-2345" required />
      {#if error}<p role="alert" class="mt-2 rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
      <button class="btn mt-3 w-full" disabled={busy}>{busy ? "Pairing…" : "Pair"}</button>
    </form>
  </div>

  <details class="card">
    <summary class="min-h-10 cursor-pointer font-semibold">No code? Ask to join</summary>
    <p class="mb-2 text-sm text-muted">The device waits until a manager approves it.</p>
    <form onsubmit={ask}>
      <label for="ask-name" class="mb-1 block font-semibold">Name for this device</label>
      <input id="ask-name" class="field" bind:value={askName} maxlength="80" placeholder="Till 2" required />
      <label for="ask-type" class="mt-3 mb-1 block font-semibold">Type</label>
      <select id="ask-type" class="field" bind:value={askType}>
        {#each Object.entries(TYPES) as [value, label]}<option {value}>{label}</option>{/each}
      </select>
      {#if askError}<p role="alert" class="mt-2 rounded-xl bg-bad/10 px-3 py-2 text-bad">{askError}</p>{/if}
      <button class="btn-ghost mt-3 w-full">Ask to join</button>
    </form>
  </details>

  <p class="text-sm text-muted">
    Owner? You can <button class="underline" onclick={() => go("owner")}>sign in with email and password</button> on any device.
    Certificate warning? Do the <a class="underline" href="/device-setup.html">device setup</a> first.
  </p>
</section>

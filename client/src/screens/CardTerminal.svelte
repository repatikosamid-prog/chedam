<script>
  // Card processor and terminals (P5 step 1; FR-3.21, 3.22; DL-114), payments.connect (the owner).
  // Connect the store's own processor (Square first) with an access token from its developer dashboard: the
  // hub checks it with the processor and keeps it sealed (never shown again). Pick the store's location. Pair
  // each terminal with the code shown here and link it to a till: Card on that till then wakes the terminal.
  import { onMount, onDestroy } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";

  let st = $state(null), devices = $state([]), error = $state(""), ok = $state(""), busy = $state(false);
  let form = $state({ kind: "square", environment: "sandbox", token: "" }), pairForm = $state(null);
  let timer = null;
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const when = (s) => (s ? new Date(s).toLocaleString() : "");

  async function load() {
    const r = await api("GET", "/api/chedam/payproc");
    if (!r.ok) return fail(r);
    st = r.json;
    if (!devices.length) {
      const d = await api("GET", "/api/collections/devices/records?perPage=200&sort=name&filter=" + encodeURIComponent("status='approved' && deleted_at=''"), null, { quiet: true });
      devices = d.ok ? d.json.items || [] : [];
    }
    // A code is waiting: ask the processor every few seconds whether the terminal has signed in
    clearInterval(timer);
    if (st.terminals.some((x) => x.status === "pairing")) timer = setInterval(refreshPairing, 4000);
  }
  onMount(load);
  onDestroy(() => clearInterval(timer));

  async function refreshPairing() {
    for (const x of st.terminals.filter((t) => t.status === "pairing")) {
      const r = await api("POST", `/api/chedam/payproc/terminals/${x.id}/refresh`, {}, { quiet: true });
      if (r.ok && r.json.status !== "pairing") { ok = r.json.status === "paired" ? `${r.json.name} is paired.` : `The code for ${r.json.name} expired; pair it again.`; await load(); return; }
    }
  }
  async function post(path, body, msg) {
    error = ""; ok = ""; busy = true;
    const r = await api("POST", path, body);
    busy = false;
    if (!r.ok) return fail(r);
    if (msg) ok = msg;
    await load();
    return r.json;
  }
  async function connect(e) {
    e.preventDefault();
    const r = await post("/api/chedam/payproc/connect", form, "Connected.");
    if (r) form.token = "";
  }
  async function pair(e) {
    e.preventDefault();
    const r = await post("/api/chedam/payproc/terminals", pairForm);
    if (r) { pairForm = null; ok = `Type the code ${r.code} on the terminal.`; }
  }
  function disconnect() { if (confirm("Disconnect the card processor? Card goes back to the standalone terminal on every till.")) post("/api/chedam/payproc/disconnect", {}, "Disconnected."); }
</script>

<section class="space-y-4">
  <div class="screen-head"><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Card processor</h1></div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if st && !st.processor}
    <form class="card space-y-3" onsubmit={connect}>
      <p>Link the store's own card processor so that <b>Card</b> on a till sends the amount to its terminal. Without it (or with no internet), the cashier keys the amount into the terminal as today.</p>
      <label class="block"><span class="text-sm text-muted">Processor</span><select class="field" bind:value={form.kind}>{#each st.kinds as k (k.kind)}<option value={k.kind}>{k.name}</option>{/each}</select></label>
      <fieldset class="flex flex-wrap gap-3"><legend class="text-sm text-muted">Account</legend>
        <label class="flex min-h-12 items-center gap-2"><input type="radio" bind:group={form.environment} value="sandbox" /> Sandbox (testing)</label>
        <label class="flex min-h-12 items-center gap-2"><input type="radio" bind:group={form.environment} value="production" /> Live</label>
      </fieldset>
      <label class="block"><span class="text-sm text-muted">Access token (Square Developer Dashboard → your application → Credentials)</span><input class="field font-mono" type="password" autocomplete="off" bind:value={form.token} required /></label>
      <p class="text-sm text-muted">The hub checks the token with the processor and keeps it encrypted on the hub. It is never shown again, never sent to the tills and never in exports.</p>
      <button class="btn" type="submit" disabled={busy}>{busy ? "Checking…" : "Connect"}</button>
    </form>
  {:else if st}
    <div class="card space-y-2">
      <p class="flex flex-wrap justify-between gap-2"><span><b>{st.processor.name}</b> · {st.processor.account_name} {st.processor.environment === "sandbox" ? "(sandbox)" : ""}</span><span class="text-ok">Connected</span></p>
      <p class="text-sm text-muted">Connected {when(st.processor.connected_at)} by {st.processor.connected_by}</p>
      {#if st.processor.last_error}<p class="text-sm text-warn">Last problem: {st.processor.last_error}</p>{/if}
      <label class="block"><span class="text-sm text-muted">Store location</span>
        <select class="field" value={st.processor.location_id} onchange={(e) => post("/api/chedam/payproc/location", { location_id: e.currentTarget.value }, "Location saved.")}>
          {#if !st.processor.location_id}<option value="">Choose…</option>{/if}
          {#each st.processor.locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
        </select></label>
      {#if st.linked && st.linked.enabled === false}<p class="text-sm text-warn">Linked card payments are switched off in the settings (payments.linked).</p>{/if}
      <button class="btn-ghost text-bad" onclick={disconnect} disabled={busy}>Disconnect</button>
    </div>

    <div class="card space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="font-semibold">Terminals</h2>
        <button class="btn min-h-10 text-sm" disabled={!st.processor.location_id} onclick={() => (pairForm = { name: "", till_device: "" })}>Pair a terminal</button></div>
      {#if pairForm}
        <form class="grid gap-2 sm:grid-cols-3" onsubmit={pair}>
          <label class="block"><span class="text-sm text-muted">Name</span><input class="field" bind:value={pairForm.name} placeholder="Front till terminal" required /></label>
          <label class="block"><span class="text-sm text-muted">For the till</span><select class="field" bind:value={pairForm.till_device}><option value="">Not yet</option>{#each devices as d (d.id)}<option value={d.id}>{d.name}</option>{/each}</select></label>
          <div class="flex items-end gap-2"><button class="btn" type="submit" disabled={busy}>Get a code</button><button class="btn-ghost" type="button" onclick={() => (pairForm = null)}>Cancel</button></div>
        </form>
      {/if}
      {#each st.terminals as x (x.id)}
        <div class="space-y-1 border-t border-line pt-2">
          <p class="flex flex-wrap justify-between gap-2"><b>{x.name}</b>
            <span class={x.status === "paired" ? "text-ok" : x.status === "expired" ? "text-bad" : "text-warn"}>{x.status === "paired" ? "Paired" : x.status === "expired" ? "Code expired" : "Waiting for the terminal"}</span></p>
          {#if x.status === "pairing"}<p>On the terminal: <b>Sign in → Use a device code</b>, then type <span class="font-mono text-2xl font-bold tracking-widest">{x.code}</span>{x.pair_by ? " before " + when(x.pair_by) : ""}.</p>{/if}
          <div class="flex flex-wrap items-end gap-2">
            <label class="block"><span class="text-sm text-muted">Till</span>
              <select class="field" value={x.till_device} onchange={(e) => post(`/api/chedam/payproc/terminals/${x.id}/assign`, { till_device: e.currentTarget.value }, "Saved.")}>
                <option value="">Not linked to a till</option>{#each devices as d (d.id)}<option value={d.id}>{d.name}</option>{/each}</select></label>
            <button class="btn-ghost min-h-10 text-sm" onclick={() => post(`/api/chedam/payproc/terminals/${x.id}/remove`, {}, "Removed.")}>Remove</button>
          </div>
        </div>
      {:else}<p class="text-muted">No terminals yet.</p>{/each}
    </div>
  {/if}
</section>

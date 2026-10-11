<script>
  // Remote support (P5 step 8; FR-12.10), support.manage (the owner). Let the support person in for a few hours:
  // the hub opens a time-limited login for their key through an outbound tunnel (nothing on the store's network
  // is opened) and ends it by itself at the end time. See the address to give them, their logins, end it now.
  import { onMount, onDestroy } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";

  let st = $state(null), error = $state(""), ok = $state(""), busy = $state(false), hours = $state(2), keyForm = $state(null);
  let timer = null;
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const when = (x) => (x ? new Date(String(x).replace(" ", "T")).toLocaleString() : "");
  async function load(refresh) { const r = await api("GET", "/api/chedam/support" + (refresh ? "?refresh=1" : ""), null, { timeout: 20000 }); if (r.ok) st = r.json; else fail(r); }
  onMount(() => { load(true); timer = setInterval(() => st && st.current && load(true), 30000); });
  onDestroy(() => clearInterval(timer));
  async function post(path, body, msg) {
    error = ""; ok = ""; busy = true;
    const r = await api("POST", path, body, { timeout: 60000 });
    busy = false;
    if (!r.ok) return fail(r);
    st = r.json; if (msg) ok = msg;
  }
  async function saveKey(e) {
    e.preventDefault();
    await post("/api/chedam/support/keys", { add: { name: keyForm.name, key: keyForm.key } }, "Key saved.");
    keyForm = null;
  }
</script>

<section class="space-y-4">
  <div class="screen-head"><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Remote support</h1></div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}
  <p class="text-sm text-muted">Only when you ask for help: support can then sign in to the hub for the hours you choose. The hub connects out; nothing on the store's network is opened. It ends by itself at the end time.</p>

  {#if st}
    {#if st.current}
      <div class="card space-y-2 border-warn">
        <p class="text-lg font-semibold text-warn">Support can sign in until {when(st.current.until)}</p>
        <p class="text-sm">Give support this address: <b class="font-mono">{st.current.host}</b></p>
        <p class="break-all font-mono text-xs">{st.current.command}</p>
        <p class="text-sm">Switched on by {st.current.started_by} · {st.current.logins.length ? st.current.logins.length + " sign-in(s) by support: " + st.current.logins.map((l) => l.line).join(", ") : "support has not signed in yet"}</p>
        <button class="btn" disabled={busy} onclick={() => post("/api/chedam/support/stop", {}, "Support session ended.")}>End now</button>
      </div>
    {:else}
      <div class="card space-y-2">
        <h2 class="font-semibold">Let support in</h2>
        {#if !st.keys.length}<p class="text-sm text-warn">First add the support person's key (they send it to you).</p>{/if}
        <div class="flex flex-wrap items-end gap-2">
          <label class="block"><span class="text-sm text-muted">For</span><select class="field" bind:value={hours}>{#each [1, 2, 4, 8] as h (h)}<option value={h}>{h} {h === 1 ? "hour" : "hours"}</option>{/each}</select></label>
          <button class="btn" disabled={busy || !st.keys.length} onclick={() => post("/api/chedam/support/start", { hours }, "Support session on.")}>{busy ? "Starting…" : "Let support in"}</button>
        </div>
      </div>
    {/if}

    <div class="card space-y-2">
      <h2 class="font-semibold">Who may come in</h2>
      {#each st.keys as k, i (i)}<p class="text-sm"><b>{k.name}</b> · {k.type} …{k.end} {k.comment} <button class="underline" onclick={() => post("/api/chedam/support/keys", { remove: i }, "Key removed.")}>Remove</button></p>{:else}<p class="text-sm text-muted">No keys yet.</p>{/each}
      {#if keyForm}
        <form class="grid gap-2" onsubmit={saveKey}>
          <label class="block"><span class="text-sm text-muted">Whose key</span><input class="field" bind:value={keyForm.name} placeholder="Sreya (Chedam support)" required /></label>
          <label class="block"><span class="text-sm text-muted">Their public SSH key (one line, starts with ssh-ed25519)</span><textarea class="field font-mono text-xs" rows="3" bind:value={keyForm.key} required></textarea></label>
          <div class="flex gap-2"><button class="btn" type="submit" disabled={busy}>Save</button><button class="btn-ghost" type="button" onclick={() => (keyForm = null)}>Cancel</button></div>
        </form>
      {:else}
        <div class="flex flex-wrap gap-2"><button class="btn-ghost min-h-10 text-sm" onclick={() => (keyForm = { name: "", key: "" })}>Add a key</button>
          {#if st.keys.length}<button class="btn-ghost min-h-10 text-sm text-bad" onclick={() => confirm("Remove every key?") && post("/api/chedam/support/keys", { keys: [] }, "Keys removed.")}>Remove all</button>{/if}</div>
      {/if}
    </div>

    {#if st.history.length}
      <div class="card space-y-1 text-sm">
        <h2 class="font-semibold">Past sessions</h2>
        {#each st.history as h (h.id)}<p>{when(h.created_at)} · {h.hours} h · {h.status}{h.started_by ? " · on: " + h.started_by : ""}{h.ended_by ? " · ended by " + h.ended_by : ""}{h.logins.length ? " · " + h.logins.length + " sign-in(s)" : ""}{h.error ? " · " + h.error : ""}</p>{/each}
      </div>
    {/if}
  {/if}
</section>

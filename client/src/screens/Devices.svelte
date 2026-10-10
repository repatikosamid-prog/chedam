<script>
  // Device manager (FR-1.08): status, who is signed in, version; pair (code + QR), approve, lock,
  // unlock, sign out, rename, assign, remove. The hub enforces every rule (BR-33 on assigned people).
  import { onMount } from "svelte";
  import qrcode from "qrcode-generator";
  import { api } from "../lib/api.js";
  import { s, go, can, handleRefusal } from "../lib/session.svelte.js";
  import { TYPES, ago, shortUa } from "../lib/labels.js";

  let list = $state([]);
  let here = $state("");
  let people = $state([]);
  let error = $state("");
  let editing = $state(null);      // { id, name, assigned }
  let newOpen = $state(false);
  let newName = $state("");
  let newType = $state("till");
  let pairing = $state(null);      // { code, url, svg, ends }
  let left = $state(0);
  let hubHost = location.hostname;
  const manage = $derived(can("devices.manage"));
  const ORDER = { pending: 0, approved: 1, locked: 2, revoked: 3 };

  async function load() {
    const r = await api("GET", "/api/chedam/devices");
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    error = "";
    here = r.json.this_device;
    list = r.json.devices.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
  }

  onMount(() => {
    load();
    // The hub's IP, so QR codes also work on Android 9 (no .local names)
    fetch("/hub.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.ip) hubHost = j.ip; }).catch(() => {});
    if (can("users.view")) {
      api("GET", "/api/collections/users/records?perPage=200&sort=name&filter=" + encodeURIComponent("status='active' && deleted_at=''"))
        .then((r) => { if (r.ok) people = r.json.items; });
    }
    const t = setInterval(load, 10000);
    const c = setInterval(() => { if (pairing) left = Math.max(0, Math.round((pairing.ends - Date.now()) / 1000)); }, 1000);
    return () => { clearInterval(t); clearInterval(c); };
  });

  async function act(d, action) {
    if (action === "revoke" && !confirm('Remove "' + d.name + '"? It must be paired again to be used.')) return;
    const r = await api("POST", "/api/chedam/devices/" + d.id + "/" + action);
    if (!r.ok && !(await handleRefusal(r))) error = r.message;
    load();
  }

  // A customer display shows one till's sale (FR-3.14)
  async function linkDisplay(d, till) {
    const r = await api("POST", "/api/chedam/devices/" + d.id + "/display", { till });
    if (!r.ok && !(await handleRefusal(r))) error = r.message;
    load();
  }
  const tills = $derived(list.filter((x) => x.type !== "customer_display" && x.status !== "revoked"));

  async function saveEdit(e) {
    e.preventDefault();
    const d = list.find((x) => x.id === editing.id);
    const body = {};
    if (editing.name !== d.name) body.name = editing.name;
    if (editing.assigned !== (d.assigned_user ? d.assigned_user.id : "")) body.assigned_user = editing.assigned;
    if (Object.keys(body).length) {
      const r = await api("PATCH", "/api/collections/devices/records/" + d.id, body);
      if (!r.ok && !(await handleRefusal(r))) { error = r.message; return; }
    }
    editing = null;
    load();
  }

  async function makeCode(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/devices/pairing-code", { name: newName, type: newType });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    const url = "http://" + hubHost + "/device-setup.html?code=" + r.json.code;
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    pairing = { code: r.json.code, url, svg: qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }),
      ends: new Date(r.json.expires_at.replace(" ", "T")).getTime() };
    left = Math.round((pairing.ends - Date.now()) / 1000);
    newName = "";
    load();
  }
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-center justify-between gap-3">
    <div>
      <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
      <h1 class="text-xl font-bold">Devices</h1>
    </div>
    {#if manage}<button class="btn" onclick={() => { newOpen = true; pairing = null; }}>Pair a new device</button>{/if}
  </div>

  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  {#if newOpen}
    <div class="card">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="font-semibold">Pair a new device</h2>
        <button class="btn-ghost min-h-10 px-3 text-sm" onclick={() => { newOpen = false; pairing = null; }}>Close</button>
      </div>
      {#if !pairing}
        <form onsubmit={makeCode}>
          <label for="nd-name" class="mb-1 block font-semibold">Name</label>
          <input id="nd-name" class="field" bind:value={newName} maxlength="80" placeholder="Till 2" required />
          <label for="nd-type" class="mt-3 mb-1 block font-semibold">Type</label>
          <select id="nd-type" class="field" bind:value={newType}>
            {#each Object.entries(TYPES) as [value, label]}<option {value}>{label}</option>{/each}
          </select>
          <button class="btn mt-3 w-full">Make pairing code</button>
        </form>
      {:else}
        <div class="text-center">
          <p>On the new device, scan this with the camera:</p>
          <div class="mx-auto my-3 max-w-64 rounded-xl bg-white p-3 [&_svg]:h-auto [&_svg]:w-full" role="img" aria-label="Pairing QR code">{@html pairing.svg}</div>
          <p class="text-sm break-all text-muted">{pairing.url}</p>
          <p class="mt-3">Or open Chedam on the device and type the code:</p>
          <p class="font-mono text-3xl font-bold tracking-widest">{pairing.code}</p>
          <p class="text-sm text-muted">{left ? "Works once, for " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0") + " more." : "Expired. Make a new code."}</p>
        </div>
      {/if}
    </div>
  {/if}

  {#each list as d (d.id)}
    {@const byCode = d.status === "pending" && d.paired_via === "code"}
    <article class="card">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="flex items-center gap-2 font-semibold">
          <span class="inline-block h-2.5 w-2.5 rounded-full {d.online ? 'bg-ok' : 'bg-line'}" title={d.online ? "online" : "offline"}></span>
          <span class="sr-only">{d.online ? "Online" : "Offline"}:</span>
          {d.name}{#if d.id === here}<span class="text-sm font-normal text-muted">(this device)</span>{/if}
        </h2>
        <span class="rounded-full border px-2 text-sm font-semibold
          {d.status === 'approved' ? 'text-ok' : d.status === 'pending' ? 'text-warn' : d.status === 'locked' ? 'text-bad' : 'text-muted'}">
          {byCode ? "code not used yet" : d.status}
        </span>
      </div>
      <dl class="my-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt class="text-muted">Type</dt><dd>{TYPES[d.type] || d.type}</dd>
        {#if d.type === "customer_display"}
          <dt class="text-muted">Shows the sale of</dt>
          <dd>{#if manage && d.status !== "revoked"}<select class="field min-h-10 py-1" aria-label={"Till shown on " + d.name} value={d.display_for || ""} onchange={(e) => linkDisplay(d, e.currentTarget.value)}>
              <option value="">No till yet (shows the logo)</option>{#each tills as x (x.id)}<option value={x.id}>{x.name}</option>{/each}</select>
            {:else}{(tills.find((x) => x.id === d.display_for) || {}).name || "no till yet"}{/if}</dd>
        {:else}
          {#if d.displays && d.displays.length}<dt class="text-muted">Customer display</dt><dd>{d.displays.join(", ")}</dd>{/if}
          <dt class="text-muted">Signed in</dt><dd>{d.current_user ? d.current_user.name : "nobody"}</dd>
        {/if}
        <dt class="text-muted">Assigned to</dt><dd>{d.assigned_user ? d.assigned_user.name : "anyone"}</dd>
        <dt class="text-muted">Last seen</dt><dd>{ago(d.last_seen_at)}</dd>
        <dt class="text-muted">App version</dt><dd>{d.app_version || "unknown"}</dd>
        {#if byCode}<dt class="text-muted">Code expires</dt><dd>{new Date(d.pairing_expires_at.replace(" ", "T")).toLocaleTimeString()}</dd>{/if}
        <dt class="text-muted">Browser</dt><dd class="break-all">{shortUa(d.user_agent)}</dd>
      </dl>

      {#if editing && editing.id === d.id}
        <form class="space-y-2" onsubmit={saveEdit}>
          <label for="ed-name-{d.id}" class="block font-semibold">Name</label>
          <input id="ed-name-{d.id}" class="field" bind:value={editing.name} maxlength="80" required />
          {#if people.length}
            <label for="ed-who-{d.id}" class="block font-semibold">Assigned to (only they and the owner can sign in on it)</label>
            <select id="ed-who-{d.id}" class="field" bind:value={editing.assigned}>
              <option value="">Anyone</option>
              {#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
            </select>
          {/if}
          <div class="flex gap-2"><button class="btn">Save</button><button type="button" class="btn-ghost" onclick={() => (editing = null)}>Cancel</button></div>
        </form>
      {:else if manage && d.status !== "revoked"}
        <div class="flex flex-wrap gap-2">
          {#if d.status === "pending" && !byCode}<button class="btn min-h-10 text-sm" onclick={() => act(d, "approve")}>Approve</button>{/if}
          {#if d.status === "approved" && d.id !== here}<button class="btn-ghost min-h-10 text-sm" onclick={() => act(d, "lock")}>Lock</button>{/if}
          {#if d.status === "locked"}<button class="btn min-h-10 text-sm" onclick={() => act(d, "unlock")}>Unlock</button>{/if}
          {#if d.current_user && d.id !== here}<button class="btn-ghost min-h-10 text-sm" onclick={() => act(d, "sign-out")}>Sign out {d.current_user.name}</button>{/if}
          <button class="btn-ghost min-h-10 text-sm" onclick={() => (editing = { id: d.id, name: d.name, assigned: d.assigned_user ? d.assigned_user.id : "" })}>Rename / assign</button>
          {#if d.id !== here}<button class="btn-danger min-h-10 text-sm" onclick={() => act(d, "revoke")}>{byCode ? "Cancel code" : "Remove"}</button>{/if}
        </div>
      {/if}
    </article>
  {:else}
    <p class="text-muted">No devices yet.</p>
  {/each}
  <p class="text-sm text-muted">Updates every 10 seconds. "Online" means the device reached the hub in the last 2 minutes.</p>
</section>

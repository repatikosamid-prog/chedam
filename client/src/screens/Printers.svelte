<script>
  // Receipt printers (FR-1.11): find network printers, add one by address, test print (and drawer),
  // paper width, which device prints where, print when paid, full tax receipt threshold. The preview
  // shows the last sale exactly as the printer prints it, so the layout can be checked without one.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { toCents } from "../lib/catalogue.js";

  let printers = $state([]), devices = $state([]), options = $state(null), optRec = null;
  let error = $state(""), ok = $state(""), busy = $state(""), found = $state(null), edit = $state(null), preview = $state(null);
  const PAPER = [[48, "80 mm (48 characters)"], [42, "80 mm, small font (42)"], [32, "58 mm (32 characters)"]];
  const manage = $derived(can("settings.manage"));

  async function load() {
    const r = await api("GET", "/api/chedam/printers");
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    printers = r.json.printers;
    const o = await api("GET", "/api/collections/settings/records?filter=" + encodeURIComponent("key='printing.receipt'"));
    if (o.ok && o.json.items[0]) { optRec = o.json.items[0]; options = { auto: !!optRec.value.auto_print, full: ((optRec.value.full_receipt_cents || 15000) / 100).toFixed(2) }; }
    if (can("devices.view")) {
      const d = await api("GET", "/api/chedam/devices");
      if (d.ok) devices = d.json.devices.filter((x) => x.status === "approved" || x.status === "locked");
    }
  }
  onMount(load);

  async function save(list, msg) {
    busy = "save"; error = "";
    const r = await api("PUT", "/api/chedam/printers", { printers: list });
    busy = "";
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return false; }
    printers = r.json.printers; ok = msg; edit = null;
    return true;
  }

  async function scan() {
    busy = "scan"; error = ""; found = null;
    const r = await api("POST", "/api/chedam/printers/scan", { port: 9100 }, { timeout: 60000 });
    busy = "";
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    found = r.json.found;
  }

  async function test(p, kick) {
    busy = "test"; error = ""; ok = "";
    const r = await api("POST", "/api/chedam/printers/test", { ...p, kick }, { timeout: 20000 });
    busy = "";
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    if (r.json.printed) ok = "Test page sent to " + p.name + (kick ? " (and the drawer opened)" : "") + ". Check that every line is readable.";
    else error = r.json.error;
  }

  function startEdit(p) { edit = p ? { ...p } : { id: "", name: "Receipt printer", host: "", port: 9100, chars: 48, drawer: true }; }

  async function saveEdit(e) {
    e.preventDefault();
    const list = edit.id ? printers.map((x) => (x.id === edit.id ? edit : x)) : [...printers, edit];
    await save(list, "Printer saved.");
  }

  async function remove(p) {
    if (!confirm("Remove " + p.name + "?")) return;
    await save(printers.filter((x) => x.id !== p.id), "Printer removed.");
  }

  async function assign(d, value) {
    const r = await api("PATCH", "/api/collections/devices/records/" + d.id, { assigned_printer: value });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    ok = d.name + ": " + (value === "none" ? "no printer" : value ? printers.find((p) => p.id === value).name : "the store's printer") + ".";
    d.assigned_printer = value;
  }

  async function saveOptions(e) {
    e.preventDefault();
    const r = await api("PATCH", "/api/collections/settings/records/" + optRec.id, { value: { auto_print: options.auto, full_receipt_cents: toCents(options.full) || 15000 } });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    ok = "Receipt options saved.";
  }

  async function showPreview(chars) {
    const r = await api("GET", "/api/collections/sales/records?perPage=1&sort=-completed_at&filter=" + encodeURIComponent("status='completed'"));
    if (!r.ok || !r.json.items.length) { error = r.ok ? "No sale yet to preview." : r.message; return; }
    const t = await api("GET", "/api/chedam/sales/" + r.json.items[0].id + "/receipt-text?chars=" + chars);
    if (!t.ok) { error = t.message; return; }
    preview = t.json;
  }
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
    <h1 class="text-xl font-bold">Receipt printer</h1>
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  <div class="card space-y-3">
    <h2 class="font-semibold">Printers</h2>
    {#if !printers.length}<p class="text-muted">No printer yet. Receipts print from the till's browser until one is added. Network receipt printers (Ethernet or Wi-Fi, ESC/POS, port 9100) work; the cash drawer plugs into the printer.</p>{/if}
    {#each printers as p (p.id)}
      <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3">
        <div><p class="font-semibold">{p.name}</p><p class="text-sm text-muted">{p.host}:{p.port} · {p.chars} characters · {p.drawer ? "cash drawer" : "no drawer"}</p></div>
        {#if manage}
          <div class="flex flex-wrap gap-2">
            <button class="btn-ghost min-h-10 text-sm" disabled={!!busy} onclick={() => test(p, false)}>Test print</button>
            {#if p.drawer}<button class="btn-ghost min-h-10 text-sm" disabled={!!busy} onclick={() => test(p, true)}>Test with drawer</button>{/if}
            <button class="btn-ghost min-h-10 text-sm" onclick={() => startEdit(p)}>Edit</button>
            <button class="btn-ghost min-h-10 text-sm text-bad" onclick={() => remove(p)}>Remove</button>
          </div>
        {/if}
      </div>
    {/each}
    {#if manage}
      <div class="flex flex-wrap gap-2">
        <button class="btn" disabled={!!busy} onclick={scan}>{busy === "scan" ? "Looking on the network…" : "Find printers"}</button>
        <button class="btn-ghost" onclick={() => startEdit(null)}>Add by address</button>
      </div>
    {/if}
    {#if found}
      {#if !found.length}<p class="text-muted">No printer answered on the store network (port 9100). Check that it is on and connected, then try again or add it by address (printers print their address when you hold the feed button while switching on).</p>
      {:else}
        <ul class="space-y-2">
          {#each found as f (f.host)}
            <li class="flex items-center justify-between gap-2 rounded-xl bg-soft p-2"><span>{f.host}{f.known ? " · " + f.known : ""}</span>
              {#if !f.known}<button class="btn-ghost min-h-10 text-sm" onclick={() => (edit = { id: "", name: "Receipt printer", host: f.host, port: f.port, chars: 48, drawer: true })}>Add</button>{/if}</li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>

  {#if edit}
    <form class="card grid gap-3 sm:grid-cols-2" onsubmit={saveEdit}>
      <h2 class="font-semibold sm:col-span-2">{edit.id ? "Edit printer" : "Add a printer"}</h2>
      <label class="block"><span class="text-sm text-muted">Name</span><input class="field" bind:value={edit.name} maxlength="60" required /></label>
      <label class="block"><span class="text-sm text-muted">Address (IP)</span><input class="field" bind:value={edit.host} placeholder="192.168.1.50" required /></label>
      <label class="block"><span class="text-sm text-muted">Port</span><input class="field" type="number" min="1" max="65535" bind:value={edit.port} /></label>
      <label class="block"><span class="text-sm text-muted">Paper</span>
        <select class="field" bind:value={edit.chars}>{#each PAPER as [v, l] (v)}<option value={v}>{l}</option>{/each}</select></label>
      <label class="flex min-h-12 items-center gap-3 sm:col-span-2"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={edit.drawer} /> A cash drawer is plugged into this printer</label>
      <div class="flex flex-wrap gap-2 sm:col-span-2">
        <button class="btn" type="submit" disabled={!!busy}>Save</button>
        <button class="btn-ghost" type="button" disabled={!!busy || !edit.host} onclick={() => test(edit, false)}>Test print first</button>
        <button class="btn-ghost" type="button" onclick={() => (edit = null)}>Cancel</button>
      </div>
    </form>
  {/if}

  {#if printers.length && devices.length}
    <div class="card space-y-2">
      <h2 class="font-semibold">Which device prints where</h2>
      <p class="text-sm text-muted">With one printer, every till uses it. Choose "No printer" for phones and devices away from the counter.</p>
      {#each devices as d (d.id)}
        <label class="flex flex-wrap items-center justify-between gap-2"><span>{d.name}</span>
          <select class="field max-w-xs" disabled={!can("devices.manage")} value={d.assigned_printer || ""} onchange={(e) => assign(d, e.currentTarget.value)}>
            <option value="">{printers.length === 1 ? "The store's printer" : "Choose…"}</option>
            {#each printers as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
            <option value="none">No printer</option>
          </select></label>
      {/each}
    </div>
  {/if}

  {#if options && manage}
    <form class="card grid gap-3 sm:grid-cols-2" onsubmit={saveOptions}>
      <h2 class="font-semibold sm:col-span-2">Receipts</h2>
      <label class="flex min-h-12 items-center gap-3 sm:col-span-2"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={options.auto} /> Print the receipt as soon as a sale is paid</label>
      <label class="block"><span class="text-sm text-muted">Offer the customer's name on the receipt from ($)</span><input class="field" inputmode="decimal" bind:value={options.full} /></label>
      <p class="text-sm text-muted sm:col-span-2">Receipts always show the GST/HST and PST numbers and the tax by type. For larger sales a business customer may ask for their name on the receipt (full GST/HST receipt, $150 and up by default).</p>
      <div class="sm:col-span-2"><button class="btn" type="submit">Save</button></div>
    </form>
  {/if}

  <div class="card space-y-2">
    <h2 class="font-semibold">Preview</h2>
    <p class="text-sm text-muted">The last sale, exactly as the printer prints it.</p>
    <div class="flex flex-wrap gap-2">{#each PAPER as [v, l] (v)}<button class="btn-ghost min-h-10 text-sm" onclick={() => showPreview(v)}>{l}</button>{/each}</div>
    {#if preview}<pre class="overflow-x-auto rounded-xl bg-white p-3 font-mono text-xs leading-tight text-black">{preview.text}</pre>{/if}
  </div>
</section>

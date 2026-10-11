<script>
  // Importing other records (P5 step 6; FR-11.01, 11.03-11.08): customers, vendors and clients, opening stock,
  // open bills and invoices, staff. 1 file -> 2 columns (a template recognised from the column names, the
  // store's own or a built-in one for Square, Shopify, Lightspeed, Clover, Loyverse, QuickBooks, Xero, Wave,
  // Zoho; else suggestions) -> 3 check on the hub (errors, warnings, exclude) -> 4 import in one transaction.
  // The file stays in this browser until step 4.
  import { api } from "../lib/api.js";
  import { can, handleRefusal } from "../lib/session.svelte.js";
  import { profile } from "../lib/import/profile.js";
  import { TARGETS, FIELDS, detect, suggestFor, toRecord } from "../lib/import/targets.js";

  let { onDone = () => {} } = $props();
  const PERM = { customers: "customers.manage", parties: "parties.manage", opening_stock: "stock.receive", open_bills: "finance.manage", staff: "hr.manage" };
  const allowed = TARGETS.filter(([k]) => k !== "products" && can(PERM[k]));
  let target = $state(allowed.length ? allowed[0][0] : ""), step = $state(1), error = $state(""), busy = $state(""), note = $state("");
  let file = $state(null), read = $state(null), tableIx = $state(0), header = $state(0), reader = null;
  let profs = $state([]), mapping = $state({}), conf = $state({}), found = $state(null), saved = $state([]);
  let opts = $state({ consent: false, kind: "vendor", role: "staff", on_existing: "skip", day_first: false });
  let rows = $state([]), checked = $state(null), excluded = $state({}), job = $state(null), tplName = $state("");

  const table = $derived(read ? read.tables[tableIx] : null);
  const head = $derived(table ? (table.rows[header] || []).map(String) : []);
  const body = $derived(table ? table.rows.slice(header + 1).filter((r) => r.some((c) => c !== "")) : []);
  const fields = $derived(FIELDS[target] || []);

  function reset() { step = 1; read = null; file = null; rows = []; checked = null; excluded = {}; job = null; error = ""; note = ""; found = null; }
  async function loadSaved() {
    const r = await api("GET", `/api/chedam/import-templates/${target}`, null, { quiet: true });
    saved = r.ok ? r.json.items : [];
  }
  async function pick(e) {
    error = ""; read = null;
    const f = e.currentTarget.files[0];
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) { error = "The file is larger than 30 MB."; return; }
    busy = "read";
    try {
      file = f;
      reader = reader || (await import("../lib/import/read.js"));
      read = await reader.readBytes(f.name, new Uint8Array(await f.arrayBuffer()));
      if (!read.tables.length || !read.tables[0].rows.length) { error = "No table found in this file."; read = null; }
      else { tableIx = 0; header = reader.headerRow(read.tables[0].rows); }
    } catch (err) { error = "This file could not be read: " + err.message; read = null; }
    busy = "";
  }
  async function toColumns() {
    if (body.length > 2000) { error = "This table has " + body.length + " rows; up to 2000 at a time. Split the file."; return; }
    await loadSaved();
    profs = profile(head, body);
    found = detect(head, target, saved);
    if (found) { mapping = { ...found.mapping }; conf = {}; }
    else { const s = suggestFor(profs, target); conf = s; mapping = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.field])); }
    error = ""; step = 2;
  }
  async function check() {
    const missing = fields.filter((f) => f[4] && !Object.values(mapping).includes(f[0]) && !(f[0] === "first_name" && Object.values(mapping).includes("full_name")));
    if (missing.length) { error = "Choose the column for: " + missing.map((f) => f[1]).join(", ") + "."; return; }
    const m = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
    rows = body.map((r, i) => ({ ...toRecord(r, m, target, opts), line: header + 2 + i }));
    busy = "check"; error = "";
    const r = await api("POST", `/api/chedam/imports/${target}/check`, { rows, options: { ...opts } }, { timeout: 120000 });
    busy = "";
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    checked = r.json; step = 3;
  }
  async function commit() {
    const n = checked.results.filter((x) => !excluded[x.line] && x.action !== "skip" && !x.errors.length).length;
    if (!confirm(`Import ${n} records now? It is all or nothing.`)) return;
    busy = "commit"; error = "";
    const r = await api("POST", `/api/chedam/imports/${target}/commit`, { file_name: file.name, rows, options: { ...opts },
      exclude: Object.keys(excluded).filter((k) => excluded[k]).map(Number), mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v).map(([k, v]) => [head[k], v])) }, { timeout: 300000 });
    busy = "";
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    job = r.json; step = 4; onDone();
  }
  async function saveTemplate() {
    const columns = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v).map(([k, v]) => [head[k], v]));
    const r = await api("POST", "/api/chedam/import-templates", { target, name: tplName, columns });
    if (!r.ok) { error = r.message; return; }
    saved = r.json.items; note = `Saved as "${tplName}": files with these columns are mapped by themselves next time.`; tplName = "";
  }
  const status = (x) => excluded[x.line] ? ["Excluded", "text-muted"] : x.errors.length ? ["Error", "text-bad"] : x.action === "skip" ? ["Already there: skip", "text-muted"] : x.action === "update" ? ["Update", "text-accent"] : ["New", "text-ok"];
</script>

{#if allowed.length}
<div class="card space-y-3">
  <h2 class="font-semibold">Import other records · step {step} of 4</h2>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if note}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{note}</p>{/if}

  {#if step === 1}
    <label class="block max-w-md"><span class="text-sm text-muted">What is in the file</span>
      <select class="field" bind:value={target} onchange={reset}>{#each allowed as [k, l] (k)}<option value={k}>{l}</option>{/each}</select></label>
    {#if target === "customers"}<p class="text-sm text-muted">Members are found at the till by phone or card. Only first names are kept.</p>{/if}
    {#if target === "opening_stock"}<p class="text-sm text-muted">For products already in Chedam with no stock yet (import the products first). Each becomes a receiving "Opening stock" at its cost.</p>{/if}
    {#if target === "open_bills"}<p class="text-sm text-muted">What the store still owes each vendor, and what each client owes it, as of the day Chedam starts (one "Opening balance" line each, no tax). Import the vendors and clients first.</p>{/if}
    {#if target === "staff"}<p class="text-sm text-muted">Each person gets their name at sign-in and an employee record; they choose their PIN when you pair their device. The owner is not imported.</p>{/if}
    <input class="field" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,.json,.parquet,.zip" onchange={pick} aria-label="Choose the file" />
    {#if busy === "read"}<p class="text-muted">Reading…</p>{/if}
    {#if read && table}
      <p class="text-sm">{file.name} · {body.length} rows</p>
      <div class="flex flex-wrap gap-3">
        {#if read.tables.length > 1}<label class="block"><span class="text-sm text-muted">Table</span>
          <select class="field" bind:value={tableIx} onchange={() => (header = reader.headerRow(read.tables[tableIx].rows))}>{#each read.tables as t, i (i)}<option value={i}>{t.name} ({t.rows.length} rows)</option>{/each}</select></label>{/if}
        <label class="block"><span class="text-sm text-muted">Column names are on row</span><input class="field w-24" type="number" min="1" max="20" value={header + 1} oninput={(e) => (header = Math.max(0, Number(e.currentTarget.value) - 1))} /></label>
      </div>
      <button class="btn" onclick={toColumns}>Next: columns</button>
    {/if}
  {/if}

  {#if step === 2}
    {#if found}<p class="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">These columns look like {found.template.saved ? "your template" : "an export from"} <b>{found.template.name}</b>: mapped by themselves. Check them.</p>
    {:else}<p class="text-sm text-muted">Each column and the field it goes to, suggested from the column names. Check the ones marked medium or low.</p>{/if}
    <div class="space-y-2">
      {#each profs as p (p.index)}
        <div class="grid gap-2 rounded-xl border border-line p-2 sm:grid-cols-[1fr_1fr_14rem] sm:items-center">
          <div><p class="font-semibold">{p.name}</p><p class="text-xs text-muted">{p.type} · {p.empty_pct}% empty</p></div>
          <p class="truncate text-sm text-muted">{p.examples.join(" · ")}</p>
          <div class="flex items-center gap-2">
            <select class="field" bind:value={mapping[p.index]} aria-label={"Field for " + p.name}>
              <option value="">— not imported —</option>{#each fields as [f, label] (f)}<option value={f}>{label}</option>{/each}</select>
            {#if conf[p.index] && mapping[p.index] === conf[p.index].field}<span class="rounded px-1 text-xs {conf[p.index].confidence === 'high' ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}">{conf[p.index].confidence}</span>{/if}
          </div>
        </div>
      {/each}
    </div>
    <div class="grid gap-1 sm:grid-cols-2">
      {#if target === "customers"}<label class="flex min-h-10 items-center gap-3 sm:col-span-2"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={opts.consent} /> These customers agreed to the store's loyalty program in the old system</label>{/if}
      {#if target === "parties"}<label class="flex items-center gap-3"><span>Rows without a kind are</span><select class="field max-w-40" bind:value={opts.kind}><option value="vendor">vendors</option><option value="client">clients</option><option value="both">both</option></select></label>
        <label class="flex items-center gap-3"><span>Already in Chedam:</span><select class="field max-w-48" bind:value={opts.on_existing}><option value="skip">leave as they are</option><option value="update">update from the file</option></select></label>{/if}
      {#if target === "open_bills"}<label class="flex items-center gap-3"><span>Rows without a kind are</span><select class="field max-w-48" bind:value={opts.kind}><option value="bill">bills (owed to vendors)</option><option value="invoice">invoices (clients owe)</option></select></label>{/if}
      {#if target === "staff"}<label class="flex items-center gap-3"><span>Rows without a role are</span><select class="field max-w-40" bind:value={opts.role}><option value="staff">staff</option><option value="cashier">cashiers</option><option value="manager">managers</option></select></label>{/if}
      {#if fields.some((f) => f[3] === "date")}<label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={opts.day_first} /> Dates are day first (25/12/2026)</label>{/if}
    </div>
    <div class="flex flex-wrap items-end gap-2">
      <label class="block"><span class="text-sm text-muted">Save this mapping as a template</span><input class="field" bind:value={tplName} placeholder="e.g. Our supplier sheet" /></label>
      <button class="btn-ghost min-h-10 text-sm" disabled={!tplName.trim()} onclick={saveTemplate}>Save template</button>
    </div>
    <div class="flex gap-2"><button class="btn-ghost" onclick={() => (step = 1)}>Back</button><button class="btn" disabled={busy === "check"} onclick={check}>{busy === "check" ? "Checking…" : "Next: check"}</button></div>
  {/if}

  {#if step === 3 && checked}
    <p class="text-sm">New: <b>{checked.summary.create}</b> · update: <b>{checked.summary.update}</b> · already there: {checked.summary.skip} · errors: <b class={checked.summary.errors ? "text-bad" : ""}>{checked.summary.errors}</b> · warnings: {checked.summary.warnings}</p>
    <div class="max-h-[28rem] space-y-1 overflow-y-auto">
      {#each checked.results.slice(0, 400) as x (x.line)}
        {@const st = status(x)}
        <div class="rounded-xl border border-line p-2 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-2"><p><span class="text-muted">Line {x.line}</span> · <b>{x.label || "(no name)"}</b> <span class="ml-1 font-semibold {st[1]}">{st[0]}</span></p>
            <label class="flex items-center gap-1"><input type="checkbox" checked={!!excluded[x.line]} onchange={(e) => (excluded[x.line] = e.currentTarget.checked)} /> Exclude</label></div>
          {#each x.errors as m (m)}<p class="text-bad">✗ {m}</p>{/each}
          {#each x.warnings as m (m)}<p class="text-muted">⚠ {m}</p>{/each}
        </div>
      {/each}
    </div>
    <div class="flex flex-wrap gap-2">
      <button class="btn-ghost" onclick={() => (step = 2)}>Back</button>
      <button class="btn" disabled={busy === "commit" || checked.results.some((x) => x.errors.length && !excluded[x.line])} onclick={commit}>{busy === "commit" ? "Importing…" : "Import"}</button>
    </div>
    {#if checked.results.some((x) => x.errors.length && !excluded[x.line])}<p class="text-sm text-bad">Fix the file or exclude the rows with errors first.</p>{/if}
  {/if}

  {#if step === 4 && job}
    {#if job.status === "completed"}<p class="text-lg font-semibold text-ok">Imported in {job.seconds} s</p><p>{job.created} new · {job.updated} updated · {job.skipped} left as they were · {job.excluded} excluded</p>
    {:else}<p class="text-lg font-semibold text-bad">Nothing was imported</p><p>{job.error}</p><button class="btn-ghost" onclick={() => (step = 3)}>Back to the check</button>{/if}
    <button class="btn" onclick={reset}>Import another file</button>
  {/if}
</div>
{/if}

<script>
  // Import and export (P1 step 8; FR-11.01-11.07, 11.09, NFR-22). Products import in five steps, all in this
  // browser until the last: 1 file (type, encoding, delimiter, header row detected) -> 2 columns (profile and
  // suggested fields with confidence) -> 3 values (categories and tax values matched to the store's; options)
  // -> 4 check on the hub (create / update / skip, errors, Draft reasons, warnings; fix, bulk-fix, exclude)
  // -> 5 import in one transaction, with the job log. The owner's full business export (CSV + JSON + dictionary).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, s, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import { profile } from "../lib/import/profile.js";
  import { FIELDS, suggest } from "../lib/import/map.js";
  import { toRow, cents } from "../lib/import/transform.js";
  import { fullExport } from "../lib/export.js";

  let step = $state(1);
  let file = $state(null), read = $state(null), tableIx = $state(0), header = $state(0);
  let profs = $state([]), mapping = $state({}), conf = $state({});
  let cats = $state([]), classes = $state([]);
  let catMap = $state({}), taxMap = $state({});
  let opts = $state({ split_names: true, price_includes_tax: false, on_existing: "skip", create_categories: true, labels: true, scale_ack: false });
  let rows = $state([]), checked = $state(null), excluded = $state({}), filter = $state("all"), editing = $state(null), bulk = $state(null);
  let reader = null;                            // ../lib/import/read.js, loaded with the first file (SheetJS, Papa Parse, hyparquet)
  const headerRow = (rows) => (reader ? reader.headerRow(rows) : 0);
  let job = $state(null), jobs = $state([]), error = $state(""), busy = $state(""), progress = $state("");

  const table = $derived(read ? read.tables[tableIx] : null);
  const head = $derived(table ? table.rows[header] || [] : []);
  const body = $derived(table ? table.rows.slice(header + 1).filter((r) => r.some((c) => c !== "")) : []);
  const fileCats = $derived([...new Set(rows.map((r) => r.category).filter(Boolean))]);
  const fileTax = $derived([...new Set(rows.map((r) => r.tax || ""))]);
  const anyKg = $derived(rows.some((r) => r.base_unit !== "each"));

  async function loadRefs() {
    const [c, t, j] = await Promise.all([
      api("GET", "/api/collections/categories/records?perPage=500&sort=name&filter=" + encodeURIComponent("deleted_at=''")),
      api("GET", "/api/collections/tax_classes/records?perPage=100&sort=name&filter=" + encodeURIComponent("deleted_at=''")),
      api("GET", "/api/chedam/imports"),
    ]);
    if (c.ok) cats = c.json.items;
    if (t.ok) classes = t.json.items;
    if (j.ok) jobs = j.json.jobs;
  }
  onMount(loadRefs);

  // ---- 1 File
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
      else { tableIx = 0; header = headerRow(read.tables[0].rows); }
    } catch (err) { error = "This file could not be read: " + err.message; read = null; }
    busy = "";
  }
  function toColumns() {
    if (body.length > 2000) { error = "This table has " + body.length + " rows; up to 2000 at a time. Split the file."; return; }
    profs = profile(head, body);
    const sug = suggest(profs);
    mapping = Object.fromEntries(Object.entries(sug).map(([k, v]) => [k, v.field]));
    conf = sug;
    error = ""; step = 2;
  }

  // ---- 2 Columns -> rows
  function toValues() {
    if (!Object.values(mapping).includes("name")) { error = "Choose the column with the product names."; return; }
    const m = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
    rows = body.map((r, i) => ({ ...toRow(r, m, opts), line: header + 2 + i }));
    const known = Object.fromEntries(cats.map((c) => [c.name.toLowerCase(), c.id]));
    catMap = Object.fromEntries(fileCats.map((n) => [n, catMap[n] ?? known[n.toLowerCase()] ?? ""]));
    taxMap = Object.fromEntries(fileTax.map((v) => [v, taxMap[v] ?? guessTax(v)]));
    error = ""; step = 3;
  }
  // "GST", "Y", "taxable" ... -> a class whose name or code fits; else empty (the person chooses)
  function guessTax(v) {
    const t = String(v).toLowerCase().trim();
    const by = (re) => (classes.find((c) => re.test((c.name + " " + c.code).toLowerCase())) || {}).id || "";
    if (!t) return "";
    if (/exempt/.test(t)) return by(/exempt/);
    if (/^(n|no|non|0|false|none)$|zero/.test(t)) return by(/zero/);
    if (/gst.*pst|pst.*gst|^y|^yes|^oui|^true|taxable|standard|^1$/.test(t)) return by(/standard|taxable|gst.*pst/);
    if (/^gst$|gst only|5 ?%/.test(t)) return by(/gst only|gst-only|prepared|^gst/);
    return by(new RegExp(t.replace(/[^a-z0-9]/g, ".?")));
  }

  // ---- 3 Values -> 4 check
  function payloadRows() {
    return rows.map((r) => ({ ...r, tax_class: taxMap[r.tax || ""] || "", category: r.category && catMap[r.category] ? (cats.find((c) => c.id === catMap[r.category]) || {}).name || r.category : r.category }));
  }
  async function check() {
    busy = "check"; error = "";
    const r = await api("POST", "/api/chedam/imports/check", { rows: payloadRows(), options: { ...opts } }, { timeout: 120000 });
    busy = "";
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    checked = r.json; step = 4;
  }
  const shown = $derived(!checked ? [] : checked.results.map((x, i) => ({ ...x, i, row: rows[i] })).filter((x) =>
    filter === "all" ? true : filter === "errors" ? x.errors.length : filter === "drafts" ? !x.errors.length && x.drafts.length && x.action !== "skip"
      : filter === "warnings" ? x.warnings.length : filter === "skip" ? x.action === "skip" : filter === "excluded" ? excluded[x.line] : true));
  function statusOf(x) {
    if (excluded[x.line]) return ["Excluded", "text-muted"];
    if (x.errors.length) return ["Error", "text-bad"];
    if (x.action === "skip") return ["Already there: skip", "text-muted"];
    if (x.action === "update") return ["Update", "text-accent"];
    if (x.drafts.length) return ["New, as a Draft", "text-warn"];
    return ["New", "text-ok"];
  }
  function saveEdit() {
    const r = rows[editing.i];
    r.name = editing.name; r.category = editing.category; r.barcode = editing.barcode; r.plu = editing.plu;
    r.price_cents = cents(editing.price); r.cost_cents = cents(editing.cost);
    if (r.category && !(r.category in catMap)) catMap[r.category] = (cats.find((c) => c.name.toLowerCase() === r.category.toLowerCase()) || {}).id || "";
    editing = null; check();
  }
  function applyBulk() {
    shown.forEach((x) => {
      const r = rows[x.i];
      if (bulk.field === "category") { r.category = bulk.value; if (!(bulk.value in catMap)) catMap[bulk.value] = (cats.find((c) => c.name === bulk.value) || {}).id || ""; }
      if (bulk.field === "tax") r.tax = bulk.value;
      if (bulk.field === "base_unit") r.base_unit = bulk.value;
      if (bulk.field === "exclude") excluded[x.line] = true;
    });
    if (bulk.field === "tax" && !(bulk.value in taxMap)) taxMap[bulk.value] = guessTax(bulk.value);
    bulk = null; check();
  }

  // ---- 5 Import
  async function commit() {
    if (!confirm("Import " + (checked.summary.create + checked.summary.update - Object.keys(excluded).length) + " products now? It is all or nothing.")) return;
    busy = "commit"; error = "";
    const r = await api("POST", "/api/chedam/imports", { file_name: file.name + (read.tables.length > 1 ? " / " + table.name : ""), rows: payloadRows(),
      exclude: Object.keys(excluded).filter((k) => excluded[k]).map(Number), options: { ...opts },
      mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v).map(([k, v]) => [head[k], v])) }, { timeout: 300000 });
    busy = "";
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    job = r.json; step = 5; loadRefs();
  }
  function restart() { step = 1; read = null; file = null; rows = []; checked = null; excluded = {}; job = null; error = ""; }

  async function exportAll() {
    busy = "export"; error = ""; progress = "";
    try { const r = await fullExport(api, (t) => (progress = t)); progress = "Done: " + r.tables + " tables, " + r.rows + " rows, " + Math.round(r.bytes / 1024) + " KB."; }
    catch (e) { error = "Export failed: " + e.message; progress = ""; }
    busy = "";
  }
  const fieldLabel = (f) => (FIELDS.find((x) => x[0] === f) || [f, f])[1];
</script>

<section class="space-y-4">
  <div>
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
    <h1 class="text-xl font-bold">Import and export</h1>
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  {#if can("catalogue.edit")}
    <div class="card space-y-3">
      <h2 class="font-semibold">Import products · step {step} of 5</h2>
      <ol class="flex flex-wrap gap-2 text-sm">{#each ["File", "Columns", "Values", "Check", "Import"] as t, i (t)}<li class="rounded-lg px-2 py-0.5 {step === i + 1 ? 'bg-accent text-accent-ink' : step > i + 1 ? 'bg-ok/10 text-ok' : 'bg-soft text-muted'}">{i + 1}. {t}</li>{/each}</ol>

      {#if step === 1}
        <p class="text-sm text-muted">CSV, TSV or text, Excel (.xlsx, .xls, .ods), JSON, Parquet, or a zip of these. Exports from Square, Shopify, Lightspeed, Clover, Loyverse or QuickBooks work as they are. Up to 2000 products at a time. The file stays on this computer until step 5.</p>
        <input class="field" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,.json,.parquet,.zip" onchange={pick} aria-label="Choose the file" />
        {#if busy === "read"}<p class="text-muted">Reading…</p>{/if}
        {#if read && table}
          <p class="text-sm">{file.name}: {read.kind === "text" ? "text, " + read.encoding + ", separated by " + (read.delimiter === "\t" ? "tabs" : "'" + read.delimiter + "'") : read.kind}{read.tables.length > 1 ? ", " + read.tables.length + " tables" : ""} · {body.length} rows</p>
          <div class="flex flex-wrap gap-3">
            {#if read.tables.length > 1}<label class="block"><span class="text-sm text-muted">Table</span>
              <select class="field" bind:value={tableIx} onchange={() => (header = headerRow(read.tables[tableIx].rows))}>{#each read.tables as t, i (i)}<option value={i}>{t.name} ({t.rows.length} rows)</option>{/each}</select></label>{/if}
            <label class="block"><span class="text-sm text-muted">Column names are on row</span><input class="field w-24" type="number" min="1" max="20" value={header + 1} oninput={(e) => (header = Math.max(0, Number(e.currentTarget.value) - 1))} /></label>
          </div>
          <div class="overflow-x-auto"><table class="text-sm">
            <thead><tr>{#each head as h, i (i)}<th class="border-b border-line px-2 text-left">{h}</th>{/each}</tr></thead>
            <tbody>{#each body.slice(0, 5) as r, i (i)}<tr>{#each head as _, k (k)}<td class="px-2 whitespace-nowrap">{r[k]}</td>{/each}</tr>{/each}</tbody>
          </table></div>
          <button class="btn" onclick={toColumns}>Next: columns</button>
        {/if}
      {/if}

      {#if step === 2}
        <p class="text-sm text-muted">Each column of the file and the product field it goes to. Suggestions come from the column names and the values; check the ones marked medium or low.</p>
        <div class="space-y-2">
          {#each profs as p (p.index)}
            <div class="grid gap-2 rounded-xl border border-line p-2 sm:grid-cols-[1fr_1fr_14rem] sm:items-center">
              <div><p class="font-semibold">{p.name}</p><p class="text-xs text-muted">{p.type} · {p.empty_pct}% empty · {p.distinct} different</p></div>
              <p class="truncate text-sm text-muted">{p.examples.join(" · ")}</p>
              <div class="flex items-center gap-2">
                <select class="field" bind:value={mapping[p.index]} aria-label={"Field for " + p.name}>
                  <option value="">— not imported —</option>
                  {#each FIELDS as [f, label] (f)}<option value={f}>{label}</option>{/each}
                </select>
                {#if conf[p.index] && mapping[p.index] === conf[p.index].field}<span class="whitespace-nowrap rounded px-1 text-xs {conf[p.index].confidence === 'high' ? 'bg-ok/10 text-ok' : conf[p.index].confidence === 'medium' ? 'bg-warn/10 text-warn' : 'bg-bad/10 text-bad'}" title={conf[p.index].why}>{conf[p.index].confidence}</span>{/if}
              </div>
            </div>
          {/each}
        </div>
        <label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={opts.split_names} /> Split "English / Français" names into the French name</label>
        <div class="flex gap-2"><button class="btn-ghost" onclick={() => (step = 1)}>Back</button><button class="btn" onclick={toValues}>Next: values</button></div>
      {/if}

      {#if step === 3}
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="space-y-2">
            <h3 class="font-semibold">Categories in the file</h3>
            {#if !fileCats.length}<p class="text-sm text-muted">None: the products will be Drafts until they get a category.</p>{/if}
            {#each fileCats as n (n)}
              <label class="flex items-center justify-between gap-2"><span>{n} <span class="text-xs text-muted">({rows.filter((r) => r.category === n).length})</span></span>
                <select class="field max-w-56" bind:value={catMap[n]}><option value="">{opts.create_categories ? "New category" : "Leave out"}</option>{#each cats as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select></label>
            {/each}
            <label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={opts.create_categories} /> Create the categories that do not exist</label>
          </div>
          <div class="space-y-2">
            <h3 class="font-semibold">Tax in the file</h3>
            {#each fileTax as v (v)}
              <label class="flex items-center justify-between gap-2"><span>{v || "(empty)"} <span class="text-xs text-muted">({rows.filter((r) => (r.tax || "") === v).length})</span></span>
                <select class="field max-w-56" bind:value={taxMap[v]}><option value="">Decide later (Draft)</option>{#each classes as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select></label>
            {/each}
            <p class="text-xs text-muted">Tax classes are pending the accountant's review (Q1).</p>
          </div>
        </div>
        <div class="grid gap-1 sm:grid-cols-2">
          <label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={opts.price_includes_tax} /> Prices in the file include tax (take it out)</label>
          <label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={opts.labels} /> Put the new products on the label batch</label>
          {#if anyKg}<label class="flex min-h-10 items-center gap-3 sm:col-span-2"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={opts.scale_ack} /> Products sold by weight are weighed on a Measurement Canada approved scale</label>{/if}
          <label class="flex items-center gap-3 sm:col-span-2"><span>Products already in Chedam (same barcode, PLU or name):</span>
            <select class="field max-w-64" bind:value={opts.on_existing}><option value="skip">Leave them as they are</option><option value="update">Update them from the file</option></select></label>
        </div>
        <div class="flex gap-2"><button class="btn-ghost" onclick={() => (step = 2)}>Back</button><button class="btn" disabled={busy === "check"} onclick={check}>{busy === "check" ? "Checking…" : "Next: check"}</button></div>
      {/if}

      {#if step === 4 && checked}
        <div class="flex flex-wrap gap-2 text-sm">
          {#each [["all", "All " + checked.summary.rows], ["errors", "Errors " + checked.summary.errors], ["drafts", "Drafts " + checked.summary.drafts], ["warnings", "Warnings " + checked.summary.warnings], ["skip", "Already there " + checked.summary.skip], ["excluded", "Excluded " + Object.values(excluded).filter(Boolean).length]] as [k, t] (k)}
            <button class="min-h-10 rounded-xl px-3 {filter === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => (filter = k)}>{t}</button>
          {/each}
        </div>
        <p class="text-sm">New: <b>{checked.summary.create}</b> · update: <b>{checked.summary.update}</b> · already there: {checked.summary.skip} · errors: <b class={checked.summary.errors ? "text-bad" : ""}>{checked.summary.errors}</b>. Rows with errors must be fixed or excluded; Drafts are imported and finished later in Products.</p>
        {#if checked.gaps.categories.length}<p class="text-sm text-warn">Categories not in Chedam: {checked.gaps.categories.map((g) => g.name + " (" + g.rows + ")").join(", ")}{opts.create_categories ? ": they will be created." : "."}</p>{/if}
        <div class="flex flex-wrap gap-2">
          <button class="btn-ghost min-h-10 text-sm" onclick={() => (bulk = { field: "category", value: "" })}>Set for the {shown.length} rows shown…</button>
        </div>
        {#if bulk}
          <div class="flex flex-wrap items-end gap-2 rounded-xl border border-accent p-2">
            <label class="block"><span class="text-sm text-muted">Field</span><select class="field" bind:value={bulk.field}><option value="category">Category</option><option value="tax">Tax value</option><option value="base_unit">Sold by</option><option value="exclude">Exclude them</option></select></label>
            {#if bulk.field === "base_unit"}<label class="block"><span class="text-sm text-muted">Value</span><select class="field" bind:value={bulk.value}><option value="each">each</option><option value="kg">kg</option><option value="lb">lb</option></select></label>
            {:else if bulk.field !== "exclude"}<label class="block"><span class="text-sm text-muted">Value</span><input class="field" bind:value={bulk.value} list="bulk-values" /></label>
              <datalist id="bulk-values">{#each bulk.field === "category" ? cats.map((c) => c.name) : fileTax as v (v)}<option value={v}></option>{/each}</datalist>{/if}
            <button class="btn" onclick={applyBulk}>Apply to {shown.length} rows</button><button class="btn-ghost" onclick={() => (bulk = null)}>Cancel</button>
          </div>
        {/if}
        <div class="max-h-[32rem] space-y-1 overflow-y-auto">
          {#each shown.slice(0, 300) as x (x.line)}
            {@const st = statusOf(x)}
            <div class="rounded-xl border border-line p-2 text-sm">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p><span class="text-muted">Line {x.line}</span> · <b>{x.name || "(no name)"}</b> · {x.row.price_cents !== null ? money(x.row.price_cents) : "no price"}{x.row.barcode ? " · " + x.row.barcode : ""} <span class="ml-1 font-semibold {st[1]}">{st[0]}</span></p>
                <div class="flex gap-2">
                  <button class="underline" onclick={() => (editing = { i: x.i, name: x.row.name, category: x.row.category, barcode: x.row.barcode, plu: x.row.plu, price: x.row.price_cents !== null ? (x.row.price_cents / 100).toFixed(2) : "", cost: x.row.cost_cents !== null ? (x.row.cost_cents / 100).toFixed(2) : "" })}>Fix</button>
                  <label class="flex items-center gap-1"><input type="checkbox" checked={!!excluded[x.line]} onchange={(e) => (excluded[x.line] = e.currentTarget.checked)} /> Exclude</label>
                </div>
              </div>
              {#each x.errors as m (m)}<p class="text-bad">✗ {m}</p>{/each}
              {#if x.action !== "skip"}{#each x.drafts as m (m)}<p class="text-warn">Draft: {m}</p>{/each}{/if}
              {#each x.warnings.concat(x.row.notes || []) as m (m)}<p class="text-muted">⚠ {m}</p>{/each}
              {#if editing && editing.i === x.i}
                <div class="mt-2 grid gap-2 sm:grid-cols-3">
                  <label class="block sm:col-span-3"><span class="text-xs text-muted">Name</span><input class="field" bind:value={editing.name} /></label>
                  <label class="block"><span class="text-xs text-muted">Category</span><input class="field" bind:value={editing.category} /></label>
                  <label class="block"><span class="text-xs text-muted">Price ($)</span><input class="field" inputmode="decimal" bind:value={editing.price} /></label>
                  <label class="block"><span class="text-xs text-muted">Cost ($)</span><input class="field" inputmode="decimal" bind:value={editing.cost} /></label>
                  <label class="block"><span class="text-xs text-muted">Barcode</span><input class="field" bind:value={editing.barcode} /></label>
                  <label class="block"><span class="text-xs text-muted">PLU</span><input class="field" bind:value={editing.plu} /></label>
                  <div class="flex items-end gap-2"><button class="btn" onclick={saveEdit}>Save and check again</button><button class="btn-ghost" onclick={() => (editing = null)}>Cancel</button></div>
                </div>
              {/if}
            </div>
          {/each}
          {#if shown.length > 300}<p class="text-sm text-muted">Showing 300 of {shown.length}; use the filters.</p>{/if}
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="btn-ghost" onclick={() => (step = 3)}>Back</button>
          <button class="btn-ghost" disabled={busy === "check"} onclick={check}>Check again</button>
          <button class="btn" disabled={busy === "commit" || checked.results.some((x) => x.errors.length && !excluded[x.line])} onclick={commit}>{busy === "commit" ? "Importing…" : "Import"}</button>
        </div>
        {#if checked.results.some((x) => x.errors.length && !excluded[x.line])}<p class="text-sm text-bad">Fix or exclude the rows with errors first.</p>{/if}
      {/if}

      {#if step === 5 && job}
        <div class="space-y-2">
          {#if job.status === "completed"}
            <p class="text-lg font-semibold text-ok">Imported in {job.seconds} s</p>
            <p>{job.created} new ({job.drafts} as Drafts) · {job.updated} updated · {job.skipped} left as they were · {job.excluded} excluded{job.categories_created ? " · " + job.categories_created + " categories created" : ""}</p>
            {#if job.drafts}<button class="btn-ghost" onclick={() => { s.productFilter = "draft"; go("products"); }}>Finish the {job.drafts} Drafts in Products</button>{/if}
          {:else}
            <p class="text-lg font-semibold text-bad">Nothing was imported</p>
            <p>{job.error}</p>
            <button class="btn-ghost" onclick={() => (step = 4)}>Back to the check</button>
          {/if}
          <button class="btn" onclick={restart}>Import another file</button>
        </div>
      {/if}
    </div>

    <div class="card space-y-2">
      <h2 class="font-semibold">Import log</h2>
      {#if !jobs.length}<p class="text-sm text-muted">No imports yet.</p>{/if}
      {#each jobs as j (j.id)}
        <p class="text-sm"><b class={j.status === "failed" ? "text-bad" : ""}>{j.status === "failed" ? "Failed" : "Done"}</b> · {new Date(j.created_at.replace(" ", "T")).toLocaleString()} · {j.file_name} · {j.rows} rows
          {#if j.status === "completed"} · {j.created} new ({j.drafts} Drafts), {j.updated} updated, {j.skipped} skipped, {j.excluded} excluded{:else} · {j.error}{/if}</p>
      {/each}
    </div>
  {/if}

  {#if can("data.export")}
    <div class="card space-y-2">
      <h2 class="font-semibold">Full business export</h2>
      <p class="text-sm text-muted">Everything in Chedam, yours to keep or take elsewhere: every table as CSV and JSON, with a data dictionary that says what each field is (money in cents). Passwords, PINs and device keys are never included.</p>
      <button class="btn" disabled={busy === "export"} onclick={exportAll}>{busy === "export" ? "Exporting…" : "Download everything (zip)"}</button>
      {#if progress}<p class="text-sm text-muted">{progress}</p>{/if}
    </div>
  {/if}
</section>

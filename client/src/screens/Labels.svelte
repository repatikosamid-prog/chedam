<script>
  // Shelf labels (P1 step 7; FR-5.13-5.16, BR-25). To print: the batch (new prices and new products come by
  // themselves; add by scan, category or search), how many of each, layout, template, start position on a
  // partly used sheet -> an exact-size PDF; "Printed fine" takes them off the batch. Printed: the last 10
  // batches to print again. Layouts: sheets and rolls, alignment test page, printer offset. Templates:
  // what a label shows.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import { perPage, fits, slotBox } from "../lib/labels/geometry.js";
  import { unitPrice } from "../lib/labels/unitprice.js";
  import Scanner from "../components/Scanner.svelte";

  const REASON = { price_change: "new price", new_product: "new product", manual: "added", promotion: "promotion", markdown: "markdown" };
  const BASIS = [["auto", "per 100 g / 100 mL"], ["kg", "per kg / L"]];
  const FIELDS = [["name", "Name"], ["name_fr", "French name"], ["price", "Price"], ["unit_price", "Unit price"], ["barcode", "Barcode"],
    ["plu", "PLU (instead of the barcode)"], ["origin", "Country of origin"], ["logo", "Store logo"]];
  let tab = $state("batch");
  let items = $state([]), layouts = $state([]), templates = $state([]), cats = $state([]), recent = $state([]);
  let layoutId = $state(""), templateId = $state(""), start = $state(1);
  let code = $state(""), qtyAdd = $state(1), cat = $state(""), q = $state(""), hits = $state([]);
  let error = $state(""), ok = $state(""), busy = $state(false), scanning = $state(false);
  let made = $state(null), pdfUrl = $state(""), editL = $state(null), editT = $state(null);

  const layout = $derived(layouts.find((l) => l.id === layoutId));
  const template = $derived(templates.find((t) => t.id === templateId));
  const total = $derived(items.reduce((a, x) => a + x.qty, 0));
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.status === 0 ? "Labels need the hub." : r.message; };

  async function loadBatch() {
    const r = await api("GET", "/api/chedam/labels/batch");
    if (!r.ok) return fail(r);
    items = r.json.items;
  }
  async function loadSetup() {
    const [l, t, c] = await Promise.all([
      api("GET", "/api/collections/label_layouts/records?perPage=100&sort=sort,name&filter=" + encodeURIComponent("deleted_at=''")),
      api("GET", "/api/collections/label_templates/records?perPage=100&sort=sort,name&filter=" + encodeURIComponent("deleted_at=''")),
      api("GET", "/api/collections/categories/records?perPage=200&sort=sort,name&filter=" + encodeURIComponent("deleted_at=''")),
    ]);
    if (!l.ok) return fail(l);
    layouts = l.json.items; templates = t.ok ? t.json.items : []; cats = c.ok ? c.json.items : [];
    try { const saved = JSON.parse(localStorage.getItem("chedam.labels") || "{}"); layoutId = saved.layout || ""; templateId = saved.template || ""; } catch { /* none */ }
    if (!layouts.some((x) => x.id === layoutId)) layoutId = layouts[0] ? layouts[0].id : "";
    if (!templates.some((x) => x.id === templateId)) templateId = (templates.find((x) => x.is_default) || templates[0] || {}).id || "";
  }
  async function loadRecent() {
    const r = await api("GET", "/api/chedam/labels/batches");
    if (r.ok) recent = r.json.batches;
  }
  onMount(() => { loadBatch(); loadSetup(); loadRecent(); });
  $effect(() => { try { localStorage.setItem("chedam.labels", JSON.stringify({ layout: layoutId, template: templateId })); } catch { /* private mode */ } });
  $effect(() => { if (layout && start > perPage(layout)) start = 1; });

  async function add(body) {
    error = ""; ok = "";
    const r = await api("POST", "/api/chedam/labels/batch", body);
    if (!r.ok) return fail(r);
    items = r.json.items;
    ok = r.json.added + (r.json.added === 1 ? " label line added." : " label lines added.");
  }
  function addCode(e) { if (e) e.preventDefault(); if (code.trim()) { add({ code: code.trim(), qty: Number(qtyAdd) || 1 }); code = ""; } }
  function onCode(c) { scanning = false; code = c; addCode(); }

  let sTimer;
  function search() {
    clearTimeout(sTimer);
    sTimer = setTimeout(async () => {
      const t = q.trim();
      if (t.length < 2) { hits = []; return; }
      const r = await api("GET", "/api/collections/products/records?perPage=15&sort=name&filter=" + encodeURIComponent(`name~'${t.replace(/'/g, "")}' && status='active' && deleted_at=''`));
      if (!r.ok) return;
      const ids = r.json.items.map((p) => p.id);
      if (!ids.length) { hits = []; return; }
      const u = await api("GET", "/api/collections/selling_units/records?perPage=100&filter=" + encodeURIComponent("(" + ids.map((id) => `product='${id}'`).join(" || ") + ") && sell_at_pos=true && deleted_at=''"));
      hits = r.json.items.flatMap((p) => (u.ok ? u.json.items : []).filter((x) => x.product === p.id).map((x) => ({ product: p, unit: x })));
    }, 250);
  }

  async function setQty(x, v) {
    const r = await api("POST", "/api/chedam/labels/batch/" + x.id, { qty: Number(v) });
    if (!r.ok) return fail(r);
    items = r.json.items;
  }

  // The store's logo for labels that show it (as a data URL for the PDF).
  async function logo() {
    if (!template || !(template.fields || {}).logo) return null;
    const r = await api("GET", "/api/collections/business/records?perPage=1");
    const b = r.ok && r.json.items[0];
    if (!b || !b.logo) return null;
    try {
      const blob = await (await fetch("/api/files/business/" + b.id + "/" + b.logo)).blob();
      return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
    } catch { return null; }
  }

  async function showPdf(batch) {
    const { labelsPdf } = await import("../lib/labels/pdf.js");
    const doc = await labelsPdf(batch, { logo: await logo() });
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(doc.output("blob"));
    window.open(pdfUrl, "_blank");
  }

  async function makePdf() {
    error = ""; ok = ""; busy = true;
    const r = await api("POST", "/api/chedam/labels/batches", { items: items.map((x) => ({ id: x.id, qty: x.qty })), layout: layoutId, template: templateId, start: Number(start) });
    if (!r.ok) { busy = false; return fail(r); }
    made = r.json;
    try { await showPdf(made); } catch (e) { error = "The PDF could not be made: " + e.message; }
    busy = false;
  }

  async function printedFine() {
    const r = await api("POST", "/api/chedam/labels/batches/" + made.id + "/confirm", {});
    if (!r.ok) return fail(r);
    ok = r.json.done + " label lines done." + (r.json.kept ? " " + r.json.kept + " changed meanwhile (a new price) and stay to print again." : "");
    made = null; loadBatch(); loadRecent();
  }

  async function reprint(b, from) {
    error = "";
    try { await showPdf({ ...b, start: Number(from) || 1 }); } catch (e) { error = "The PDF could not be made: " + e.message; }
  }

  async function alignment(l) {
    const { alignmentPdf } = await import("../lib/labels/pdf.js");
    const doc = await alignmentPdf(l);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(doc.output("blob"));
    window.open(pdfUrl, "_blank");
  }

  // ---- Layouts and templates
  const NUM = ["page_w_mm", "page_h_mm", "cols", "rows", "label_w_mm", "label_h_mm", "margin_top_mm", "margin_left_mm", "gap_x_mm", "gap_y_mm", "offset_x_mm", "offset_y_mm"];
  const editFit = $derived(editL ? fits(Object.fromEntries(Object.entries(editL).map(([k, v]) => [k, NUM.includes(k) ? Number(v) || 0 : v]))) : "");
  async function saveLayout(e) {
    e.preventDefault();
    const body = { ...editL };
    NUM.forEach((k) => (body[k] = Number(body[k]) || 0));
    const chk = await api("POST", "/api/chedam/labels/layouts/check", body);
    if (!chk.ok) return fail(chk);
    const data = { name: body.name, paper: body.paper, cut_lines: !!body.cut_lines, ...Object.fromEntries(NUM.map((k) => [k, body[k]])) };
    const r = body.id && !body.copy ? await api("PATCH", "/api/collections/label_layouts/records/" + body.id, data)
      : await api("POST", "/api/collections/label_layouts/records", { ...data, preset: false, sort: 100 });
    if (!r.ok) return fail(r);
    ok = "Layout saved."; editL = null; loadSetup();
  }
  async function saveTemplate(e) {
    e.preventDefault();
    const data = { name: editT.name, fields: editT.fields };
    const r = editT.id ? await api("PATCH", "/api/collections/label_templates/records/" + editT.id, data)
      : await api("POST", "/api/collections/label_templates/records", { ...data, is_default: false, sort: 100 });
    if (!r.ok) return fail(r);
    ok = "Template saved."; editT = null; loadSetup();
  }

  // Small drawing of the sheet: the cells, and the start position.
  function sheet(l) {
    if (!l) return [];
    return Array.from({ length: perPage(l) }, (_, i) => slotBox(l, i));
  }
</script>

<section class="space-y-4">
  <div>
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
    <h1 class="text-xl font-bold">Labels</h1>
  </div>
  <div class="flex flex-wrap gap-2" role="tablist">
    {#each [["batch", "To print (" + total + ")"], ["printed", "Printed"], ["layouts", "Layouts"], ["templates", "Templates"]] as [k, t] (k)}
      <button role="tab" aria-selected={tab === k} class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; error = ""; ok = ""; }}>{t}</button>
    {/each}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if tab === "batch"}
    <div class="card space-y-3">
      <form class="flex flex-wrap gap-2" onsubmit={addCode}>
        <input class="field min-w-0 flex-1" bind:value={code} placeholder="Scan or type a barcode / PLU" aria-label="Product code" autocomplete="off" />
        <input class="field w-20" type="number" min="1" max="999" bind:value={qtyAdd} aria-label="How many labels" />
        <button class="btn-ghost" type="button" onclick={() => (scanning = true)} aria-label="Scan with the camera">📷</button>
        <button class="btn" type="submit">Add</button>
      </form>
      {#if scanning}<Scanner {onCode} onClose={() => (scanning = false)} />{/if}
      <div class="grid gap-2 sm:grid-cols-2">
        <div class="flex gap-2">
          <select class="field" bind:value={cat} aria-label="Category"><option value="">A whole category…</option>{#each cats as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select>
          <button class="btn-ghost" disabled={!cat} onclick={() => add({ category: cat })}>Add</button>
        </div>
        <input class="field" bind:value={q} oninput={search} placeholder="Search products by name" aria-label="Search products" />
      </div>
      {#if hits.length}
        <ul class="space-y-1">{#each hits as h (h.unit.id)}
          <li class="flex items-center justify-between gap-2 rounded-xl bg-soft px-3 py-1"><span>{h.product.name} · {h.unit.name} · {money(h.unit.price_cents)}</span>
            <button class="btn-ghost min-h-10 text-sm" onclick={() => add({ items: [{ selling_unit: h.unit.id, qty: 1 }] })}>Add</button></li>
        {/each}</ul>
      {/if}
    </div>

    <div class="card space-y-2">
      {#if !items.length}<p class="text-muted">Nothing waiting. New prices and new products appear here by themselves.</p>{/if}
      {#each items as x (x.id)}
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
          <div class="min-w-0">
            <p class="font-semibold">{x.name} <span class="font-normal text-muted">· {x.unit_name}</span></p>
            <p class="text-sm text-muted">{money(x.price_cents)}{x.kind === "weight" ? "/" + x.base_unit : ""}{#if unitPrice(x)} · {money(unitPrice(x).cents)} / {unitPrice(x).per}{/if}
              {#each x.reasons as r (r)}<span class="ml-1 rounded bg-accent/10 px-1 text-xs text-accent">{REASON[r] || r}</span>{/each}</p>
          </div>
          <div class="flex items-center gap-2">
            <input class="field w-20" type="number" min="1" max="999" value={x.qty} onchange={(e) => setQty(x, e.currentTarget.value)} aria-label={"Labels for " + x.name} />
            <button class="btn-ghost min-h-10 text-sm text-bad" onclick={() => setQty(x, 0)}>Remove</button>
          </div>
        </div>
      {/each}
    </div>

    {#if items.length}
      <div class="card space-y-3">
        <h2 class="font-semibold">Print {total} {total === 1 ? "label" : "labels"}</h2>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="block"><span class="text-sm text-muted">Sheet or roll</span>
            <select class="field" bind:value={layoutId}>{#each layouts as l (l.id)}<option value={l.id}>{l.name}</option>{/each}</select></label>
          <label class="block"><span class="text-sm text-muted">Template</span>
            <select class="field" bind:value={templateId}>{#each templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}</select></label>
        </div>
        {#if layout && perPage(layout) > 1}
          <div>
            <p class="text-sm text-muted">Start at position {start} (tap the first free label on a used sheet)</p>
            <svg viewBox="0 0 {layout.page_w_mm} {layout.page_h_mm}" class="mt-1 h-56 rounded border border-line bg-white" role="group" aria-label="Start position">
              {#each sheet(layout) as c (c.slot)}
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="1" class="cursor-pointer" fill={c.slot < start ? "#ddd" : c.slot === Number(start) ? "#0b5394" : "#fff"} stroke="#888" stroke-width="0.4"
                  role="button" tabindex="0" aria-label={"Position " + c.slot} onclick={() => (start = c.slot)} onkeydown={(e) => e.key === "Enter" && (start = c.slot)} />
              {/each}
            </svg>
          </div>
        {/if}
        <p class="text-sm text-muted">The PDF is the exact size of the sheet: print it at <b>100% / Actual size</b>, never "Fit to page".</p>
        <div class="flex flex-wrap gap-2">
          <button class="btn" disabled={busy || !layoutId || !templateId} onclick={makePdf}>{busy ? "Making the PDF…" : "Make the PDF"}</button>
          {#if layout}<button class="btn-ghost" onclick={() => alignment(layout)}>Alignment test page</button>{/if}
        </div>
        {#if made}
          <div class="space-y-2 rounded-xl border border-accent p-3">
            <p>Batch {made.number}: {made.labels} labels. {#if pdfUrl}<a class="underline" href={pdfUrl} target="_blank" rel="noopener">Open the PDF again</a> · <a class="underline" href={pdfUrl} download={"labels-" + made.number + ".pdf"}>Download</a>{/if}</p>
            <p class="text-sm">Did they print well?</p>
            <div class="flex flex-wrap gap-2">
              <button class="btn" onclick={printedFine}>Printed fine</button>
              <button class="btn-ghost" onclick={() => (made = null)}>Not right: keep them to print again</button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {/if}

  {#if tab === "printed"}
    <div class="card space-y-2">
      {#if !recent.length}<p class="text-muted">No printed batches yet.</p>{/if}
      {#each recent as b (b.id)}
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
          <div><p class="font-semibold">Batch {b.number} · {b.labels} labels · {new Date(b.printed_at.replace(" ", "T")).toLocaleString()}</p>
            <p class="text-sm text-muted">{b.names.join(", ")}{b.items.length > b.names.length ? "…" : ""} · {b.layout.name}</p></div>
          <button class="btn-ghost min-h-10 text-sm" onclick={() => reprint(b, 1)}>Print again</button>
        </div>
      {/each}
      <p class="text-sm text-muted">A reprint uses the prices printed then. For today's prices, add the products to the batch again.</p>
    </div>
  {/if}

  {#if tab === "layouts"}
    <div class="card space-y-2">
      {#each layouts as l (l.id)}
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
          <div><p class="font-semibold">{l.name}</p><p class="text-sm text-muted">{l.cols} × {l.rows} · {l.label_w_mm} × {l.label_h_mm} mm{l.cut_lines ? " · cut lines" : ""}{l.offset_x_mm || l.offset_y_mm ? " · offset " + l.offset_x_mm + "/" + l.offset_y_mm + " mm" : ""}</p></div>
          <div class="flex gap-2">
            <button class="btn-ghost min-h-10 text-sm" onclick={() => alignment(l)}>Alignment page</button>
            <button class="btn-ghost min-h-10 text-sm" onclick={() => (editL = { ...l })}>{l.preset ? "Adjust" : "Edit"}</button>
            <button class="btn-ghost min-h-10 text-sm" onclick={() => (editL = { ...l, id: l.id, copy: true, name: l.name + " (copy)" })}>Copy</button>
          </div>
        </div>
      {/each}
      <button class="btn-ghost" onclick={() => (editL = { name: "My labels", paper: "letter", page_w_mm: 215.9, page_h_mm: 279.4, cols: 3, rows: 10, label_w_mm: 66.7, label_h_mm: 25.4,
        margin_top_mm: 12.7, margin_left_mm: 4.8, gap_x_mm: 3.2, gap_y_mm: 0, cut_lines: false, offset_x_mm: 0, offset_y_mm: 0 })}>New layout</button>
      <p class="text-sm text-muted">Print the alignment page on plain paper and hold it over a label sheet. If everything is off by the same amount, set the printer offset.</p>
    </div>
    {#if editL}
      <form class="card grid gap-3 sm:grid-cols-3" onsubmit={saveLayout}>
        <label class="block sm:col-span-2"><span class="text-sm text-muted">Name</span><input class="field" bind:value={editL.name} maxlength="80" required /></label>
        <label class="block"><span class="text-sm text-muted">Paper</span>
          <select class="field" bind:value={editL.paper} onchange={() => { if (editL.paper === "letter") { editL.page_w_mm = 215.9; editL.page_h_mm = 279.4; } else if (editL.paper === "a4") { editL.page_w_mm = 210; editL.page_h_mm = 297; } }}>
            <option value="letter">Letter</option><option value="a4">A4</option><option value="roll">Roll (one label a page)</option><option value="custom">Custom</option></select></label>
        {#each [["page_w_mm", "Page width (mm)"], ["page_h_mm", "Page height (mm)"], ["cols", "Columns"], ["rows", "Rows"], ["label_w_mm", "Label width (mm)"], ["label_h_mm", "Label height (mm)"],
          ["margin_top_mm", "Top margin (mm)"], ["margin_left_mm", "Left margin (mm)"], ["gap_x_mm", "Gap between columns (mm)"], ["gap_y_mm", "Gap between rows (mm)"],
          ["offset_x_mm", "Printer offset right (mm, − = left)"], ["offset_y_mm", "Printer offset down (mm, − = up)"]] as [k, t] (k)}
          <label class="block"><span class="text-sm text-muted">{t}</span><input class="field" type="number" step="0.01" bind:value={editL[k]} /></label>
        {/each}
        <label class="flex min-h-12 items-center gap-3 sm:col-span-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={editL.cut_lines} /> Plain paper: print cut lines</label>
        {#if editFit}<p class="text-sm text-bad sm:col-span-3">{editFit}</p>{/if}
        <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit" disabled={!!editFit}>Save</button><button class="btn-ghost" type="button" onclick={() => (editL = null)}>Cancel</button></div>
      </form>
    {/if}
  {/if}

  {#if tab === "templates"}
    <div class="card space-y-2">
      {#each templates as t (t.id)}
        <div class="flex items-center justify-between gap-2 border-b border-line pb-2">
          <div><p class="font-semibold">{t.name}{t.is_default ? " (default)" : ""}</p>
            <p class="text-sm text-muted">{FIELDS.filter(([k]) => (t.fields || {})[k]).map(([, n]) => n).join(", ")}</p></div>
          <button class="btn-ghost min-h-10 text-sm" onclick={() => (editT = { id: t.id, name: t.name, fields: { unit_price_basis: "auto", ...(t.fields || {}) } })}>Edit</button>
        </div>
      {/each}
      <button class="btn-ghost" onclick={() => (editT = { name: "My template", fields: { name: true, price: true, unit_price: true, unit_price_basis: "auto", barcode: true, plu: true } })}>New template</button>
      <p class="text-sm text-muted">Promotion prices and the struck regular price come with promotions (later phase).</p>
    </div>
    {#if editT}
      <form class="card space-y-3" onsubmit={saveTemplate}>
        <label class="block"><span class="text-sm text-muted">Name</span><input class="field" bind:value={editT.name} maxlength="80" required /></label>
        <div class="grid gap-1 sm:grid-cols-2">
          {#each FIELDS as [k, n] (k)}<label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={editT.fields[k]} /> {n}</label>{/each}
        </div>
        <label class="block max-w-xs"><span class="text-sm text-muted">Unit price</span>
          <select class="field" bind:value={editT.fields.unit_price_basis}>{#each BASIS as [v, t] (v)}<option value={v}>{t}</option>{/each}</select></label>
        <div class="flex gap-2"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (editT = null)}>Cancel</button></div>
      </form>
    {/if}
  {/if}
</section>

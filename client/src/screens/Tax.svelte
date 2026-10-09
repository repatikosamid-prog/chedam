<script>
  // Tax tables (FR-4.01, 4.02, 12.03; DL-68): tax classes and which taxes they charge, rates with the
  // dates they apply. A new rate switches on by itself at its start date. Everyone may look; changes
  // need tax.manage. Everything stays "pending accountant review" until open question Q1 is answered.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";

  const edit = can("tax.manage");
  let types = $state([]), rates = $state([]), classes = $state([]), province = $state("BC");
  let error = $state(""), ok = $state("");
  let newRate = $state(null), newClass = $state(null);

  const TREAT = { taxable: "Taxable", zero_rated: "Zero-rated (0%)", exempt: "Exempt" };
  const typeOf = (id) => types.find((t) => t.id === id) || { code: "?", name: "?" };
  const day = (d) => (d ? d.substring(0, 10) : "");
  const now = new Date().toISOString().replace("T", " ");
  const current = (r) => r.effective_from <= now && (!r.effective_to || r.effective_to > now);

  async function load() {
    const q = (col, sort) => api("GET", `/api/collections/${col}/records?perPage=500&sort=${sort}&filter=` + encodeURIComponent("deleted_at=''"));
    const [t, r, c, p] = await Promise.all([q("tax_types", "sort"), q("tax_rates", "-effective_from"), q("tax_classes", "sort"),
      api("GET", "/api/collections/settings/records?filter=" + encodeURIComponent("key='store.province'"))]);
    if (!t.ok) { if (!(await handleRefusal(t))) error = t.message; return; }
    types = t.json.items; rates = r.ok ? r.json.items : []; classes = c.ok ? c.json.items : [];
    if (p.ok && p.json.items[0]) province = p.json.items[0].value;
  }
  onMount(load);

  // What a class charges today in this store's province.
  function charges(c) {
    if (c.treatment !== "taxable") return c.treatment === "zero_rated" ? "0%" : "No tax";
    return (c.tax_types || []).map((id) => {
      const r = rates.find((x) => x.tax_type === id && (x.province === "" || x.province === province) && current(x));
      return typeOf(id).code + " " + (r ? r.rate + "%" : "(no rate here)");
    }).join(" + ");
  }

  async function addRate(e) {
    e.preventDefault();
    error = ""; ok = "";
    const body = { tax_type: newRate.tax_type, province: newRate.province.toUpperCase(), rate: Number(newRate.rate),
      effective_from: newRate.from + " 00:00:00.000Z", source: newRate.source, pending_review: true };
    if (newRate.to) body.effective_to = newRate.to + " 00:00:00.000Z";
    const r = await api("POST", "/api/collections/tax_rates/records", body);
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    ok = "Rate added. It applies from " + newRate.from + ".";
    newRate = null;
    load();
  }

  async function endRate(r) {
    const to = prompt("Last day this rate applies is the day before (YYYY-MM-DD):", new Date().toISOString().substring(0, 10));
    if (!to) return;
    const res = await api("PATCH", "/api/collections/tax_rates/records/" + r.id, { effective_to: to + " 00:00:00.000Z" });
    if (!res.ok) { if (!(await handleRefusal(res))) error = res.message; return; }
    load();
  }

  async function addClass(e) {
    e.preventDefault();
    error = ""; ok = "";
    const code = newClass.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").substring(0, 40) || "custom";
    const r = await api("POST", "/api/collections/tax_classes/records", { code, name: newClass.name, treatment: newClass.treatment,
      tax_types: newClass.treatment === "taxable" ? newClass.types : [], description: newClass.description, sort: classes.length + 1 });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    ok = "Tax class added.";
    newClass = null;
    load();
  }
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("products")}>← Products</button>
    <h1 class="text-xl font-bold">Tax</h1>
    <p class="text-muted">Province: {province}</p>
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if rates.some((r) => r.pending_review) || classes.some((c) => c.pending_review)}
    <div class="card border-warn">
      <p><b class="text-warn">Pending accountant review.</b> These rates and classes follow general knowledge of BC rules and are being confirmed by an accountant before Chedam is used for real sales.</p>
    </div>
  {/if}

  <div class="card">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold">Tax classes</h2>
      {#if edit && !newClass}<button class="btn-ghost min-h-10 text-sm" onclick={() => (newClass = { name: "", treatment: "taxable", types: [], description: "" })}>Add class</button>{/if}
    </div>
    {#if newClass}
      <form class="mb-3 grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2" onsubmit={addClass}>
        <label class="block"><span class="text-sm text-muted">Name</span><input class="field" bind:value={newClass.name} maxlength="80" required /></label>
        <label class="block"><span class="text-sm text-muted">Treatment</span>
          <select class="field" bind:value={newClass.treatment}>{#each Object.entries(TREAT) as [k, v] (k)}<option value={k}>{v}</option>{/each}</select></label>
        {#if newClass.treatment === "taxable"}
          <fieldset class="sm:col-span-2"><legend class="text-sm text-muted">Taxes charged</legend>
            {#each types as t (t.id)}<label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" value={t.id} bind:group={newClass.types} /> {t.code} · {t.name}</label>{/each}
          </fieldset>
        {/if}
        <label class="block sm:col-span-2"><span class="text-sm text-muted">Used for</span><input class="field" bind:value={newClass.description} maxlength="300" /></label>
        <div class="flex gap-2 sm:col-span-2"><button class="btn" type="submit">Add</button><button class="btn-ghost" type="button" onclick={() => (newClass = null)}>Cancel</button></div>
      </form>
    {/if}
    <ul class="divide-y divide-line">
      {#each classes as c (c.id)}
        <li class="flex flex-wrap items-center justify-between gap-2 py-2">
          <span><b>{c.name}</b>{c.is_custom ? " (custom)" : ""}<span class="block text-sm text-muted">{c.description}</span></span>
          <span class="font-semibold">{charges(c)}</span>
        </li>
      {/each}
    </ul>
  </div>

  <div class="card">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold">Rates</h2>
      {#if edit && !newRate}<button class="btn-ghost min-h-10 text-sm" onclick={() => (newRate = { tax_type: types[0]?.id || "", province, rate: "", from: "", to: "", source: "" })}>Add rate</button>{/if}
    </div>
    {#if newRate}
      <form class="mb-3 grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2" onsubmit={addRate}>
        <label class="block"><span class="text-sm text-muted">Tax</span>
          <select class="field" bind:value={newRate.tax_type}>{#each types as t (t.id)}<option value={t.id}>{t.code} · {t.name}</option>{/each}</select></label>
        <label class="block"><span class="text-sm text-muted">Province (empty = everywhere, federal)</span><input class="field uppercase" bind:value={newRate.province} maxlength="2" /></label>
        <label class="block"><span class="text-sm text-muted">Rate (%)</span><input class="field" type="number" min="0" max="100" step="0.001" bind:value={newRate.rate} required /></label>
        <label class="block"><span class="text-sm text-muted">Applies from</span><input class="field" type="date" bind:value={newRate.from} required /></label>
        <label class="block"><span class="text-sm text-muted">Until (optional)</span><input class="field" type="date" bind:value={newRate.to} /></label>
        <label class="block"><span class="text-sm text-muted">Source (law, notice)</span><input class="field" bind:value={newRate.source} maxlength="200" /></label>
        <div class="flex gap-2 sm:col-span-2"><button class="btn" type="submit">Add</button><button class="btn-ghost" type="button" onclick={() => (newRate = null)}>Cancel</button></div>
      </form>
    {/if}
    <ul class="divide-y divide-line">
      {#each rates as r (r.id)}
        <li class="flex flex-wrap items-center justify-between gap-2 py-2">
          <span>
            <b>{typeOf(r.tax_type).code} {r.rate}%</b> · {r.province || "federal"}
            <span class="block text-sm text-muted">from {day(r.effective_from)}{r.effective_to ? " until " + day(r.effective_to) : ""}{r.source ? " · " + r.source : ""}</span>
          </span>
          <span class="flex items-center gap-2">
            <span class="text-sm {current(r) ? 'text-ok' : 'text-muted'}">{current(r) ? "in use" : r.effective_from > now ? "upcoming" : "ended"}</span>
            {#if edit && !r.effective_to}<button class="btn-ghost min-h-10 text-sm" onclick={() => endRate(r)}>Set end</button>{/if}
          </span>
        </li>
      {/each}
    </ul>
  </div>
</section>

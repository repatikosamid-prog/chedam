<script>
  // Customers and loyalty (P2 step 3; FR-7.01-7.05, 7.08). Find a customer (phone or card; managers also by
  // first name); their points, history and purchases. Managers: edit, adjust points with a reason, link a
  // new card or block a lost one, merge two records, give the customer their data (BC PIPA), delete on
  // request. The owner sets the programme (FR-7.03): until then there are no points. Cards: make numbers
  // and print them on a label sheet.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal, s } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import { download } from "../lib/export.js";

  let q = $state(""), results = $state([]), cur = $state(null), error = $state(""), msg = $state("");
  let prog = $state(null), progEdit = $state(null), cats = $state([]);
  let edit = $state(null), adj = $state(null), merge = $state(null), cardNo = $state("");
  let cards = $state(null), layouts = $state([]), layoutId = $state(""), cardCount = $state(30);

  const TYPE = { earn: "Earned", redeem: "Used", reverse_earn: "Taken back (return)", return_redeem: "Given back (return)", adjust: "Adjusted", move_in: "Moved in", move_out: "Moved out", expire: "Expired" };
  const when = (v) => (v ? new Date(String(v).replace(" ", "T")).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

  async function loadProgram() {
    const r = await api("GET", "/api/chedam/loyalty/program");
    if (r.ok) prog = r.json;
  }
  onMount(async () => {
    loadProgram();
    const c = await api("GET", "/api/collections/categories/records?perPage=500&sort=sort,name&filter=" + encodeURIComponent("deleted_at=''"));
    if (c.ok) cats = c.json.items;
  });

  async function search(e) {
    e && e.preventDefault();
    error = ""; msg = ""; cur = null;
    const r = await api("GET", "/api/chedam/customers/find?q=" + encodeURIComponent(q.trim()));
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    results = r.json.results.filter((x) => x.id);
    if (!results.length) msg = r.json.results.some((x) => x.new_card) ? "A new card, not given to anyone yet. Join the customer at the till." : "No customer found.";
  }

  async function open(id) {
    error = ""; edit = null; adj = null; merge = null;
    const r = await api("GET", "/api/chedam/customers/" + id);
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    cur = r.json;
  }

  async function post(path, body, after) {
    error = "";
    const r = await api("POST", path, body);
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return null; }
    if (after) await after(r.json);
    return r.json;
  }

  const saveEdit = (e) => { e.preventDefault(); post("/api/chedam/customers/" + cur.id, { first_name: edit.first_name, phone: edit.phone, notes: edit.notes }, () => open(cur.id)); };
  const saveAdj = (e) => { e.preventDefault(); post(`/api/chedam/customers/${cur.id}/adjust`, { points: Number(adj.points), note: adj.note }, () => open(cur.id)); };
  const linkCard = () => post("/api/chedam/customers/" + cur.id, { card: cardNo.trim() }, () => { cardNo = ""; open(cur.id); });
  const block = () => { if (confirm("Block card " + cur.card + "? The points stay with " + cur.first_name + ".")) post("/api/chedam/loyalty/cards/block", { number: cur.card }, () => open(cur.id)); };
  async function doMerge(e) {
    e.preventDefault();
    if (!confirm("Move " + cur.first_name + "'s points into " + merge.into.first_name + " and delete this record?")) return;
    await post(`/api/chedam/customers/${cur.id}/move`, { into: merge.into.id }, (j) => open(j.id));
  }
  async function findMergeTarget() {
    const r = await api("GET", "/api/chedam/customers/find?q=" + encodeURIComponent(merge.q.trim()));
    merge.found = r.ok ? r.json.results.filter((x) => x.id && x.id !== cur.id) : [];
  }
  async function giveData() {
    const r = await api("GET", `/api/chedam/customers/${cur.id}/data`);
    if (!r.ok) { error = r.message; return; }
    download("customer-data-" + cur.id + ".json", new Blob([JSON.stringify(r.json, null, 2)], { type: "application/json" }));
  }
  async function erase() {
    if (!confirm("Delete " + cur.first_name + "'s details for good (their request)? Name, phone and notes are removed, cards blocked, points gone. Sales stay without their name.")) return;
    await post(`/api/chedam/customers/${cur.id}/erase`, { confirm: true }, () => { cur = null; results = []; msg = "Deleted."; });
  }

  // ---- Programme (owner)
  function startProg() {
    const p = (prog && prog.program) || {};
    progEdit = { enabled: !!p.enabled, points_per_dollar: p.points_per_dollar ?? 1, points_per_dollar_off: p.points_per_dollar_off ?? 100, min_redeem: p.min_redeem ?? 500,
      earn_on_promotions: p.earn_on_promotions !== false, exclude_categories: [...(p.exclude_categories || [])], expiry_months: p.expiry_months || 0 };
  }
  const saveProg = (e) => { e.preventDefault(); post("/api/chedam/loyalty/program", progEdit, () => { progEdit = null; loadProgram(); }); };

  // ---- Cards (FR-7.05): numbers made on the hub, printed on a label sheet with the store's name and a barcode
  async function startCards() {
    error = ""; cards = { numbers: [] };
    const r = await api("GET", "/api/collections/label_layouts/records?perPage=100&sort=name&filter=" + encodeURIComponent("deleted_at=''"));
    if (r.ok) { layouts = r.json.items; layoutId = (layouts.find((l) => l.is_default) || layouts[0] || {}).id || ""; }
  }
  async function makeCards() {
    const j = await post("/api/chedam/loyalty/cards", { count: Number(cardCount) });
    if (!j) return;
    cards = j;
    await printCards();
  }
  async function printCards() {
    const layout = layouts.find((l) => l.id === layoutId);
    if (!layout) { error = "Choose a label layout (Labels → Layouts)."; return; }
    const { labelsPdf } = await import("../lib/labels/pdf.js");
    const store = (s.brand && s.brand.name) || "Loyalty";
    const doc = await labelsPdf({ layout, start: 1, template: { fields: { name: true, barcode: true, price: false } },
      items: cards.numbers.map((n) => ({ name: store + " loyalty card", barcode: n, price_cents: 0, kind: "single", qty: 1 })) }, {});
    download("loyalty-cards-" + cards.batch + ".pdf", doc.output("blob"));
  }
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => (cur ? (cur = null) : go("home"))}>← {cur ? "Customers" : "Back"}</button>
    <h1 class="text-xl font-bold">{cur ? cur.first_name : "Customers and loyalty"}</h1>
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if msg}<p role="status" class="rounded-xl bg-soft px-3 py-2">{msg}</p>{/if}

  {#if !cur}
    {#if prog && !prog.active}
      <p class="rounded-xl bg-warn/10 px-3 py-2 text-warn">The loyalty programme is off: customers can join, but earn no points until the owner sets it up.</p>
    {/if}
    <form class="card flex gap-2" onsubmit={search}>
      <label class="sr-only" for="cq">Phone, card or first name</label>
      <input id="cq" class="field" bind:value={q} placeholder={can("customers.manage") ? "Phone, card number or first name" : "Phone or card number"} autocomplete="off" />
      <button class="btn" type="submit">Find</button>
    </form>
    {#if results.length}
      <div class="card"><ul class="divide-y divide-line">
        {#each results as c (c.id)}<li><button class="flex min-h-12 w-full items-center justify-between gap-2 py-2 text-left" onclick={() => open(c.id)}><span><b>{c.first_name}</b> <span class="text-sm text-muted">{c.phone}{c.card ? " · card " + c.card : ""}</span></span><span>{c.points} points</span></button></li>{/each}
      </ul></div>
    {/if}

    {#if prog}
      <div class="card space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-semibold">Loyalty programme</h2>
          {#if can("loyalty.manage") && !progEdit}<button class="btn-ghost min-h-10 text-sm" onclick={startProg}>{prog.active ? "Change" : "Set it up"}</button>{/if}
        </div>
        {#if prog.active}
          <p class="text-sm">{prog.active.points_per_dollar} point{prog.active.points_per_dollar === 1 ? "" : "s"} per $1 spent (after discounts, before tax) · {prog.active.points_per_dollar_off} points = $1 off · at least {prog.active.min_redeem} points at a time
            {prog.active.earn_on_promotions ? "" : " · no points on items with a deal"}{prog.active.exclude_categories.length ? " · no points on " + prog.active.exclude_categories.map((id) => (cats.find((c) => c.id === id) || { name: "?" }).name).join(", ") : ""}</p>
        {:else}<p class="text-sm text-muted">{can("loyalty.manage") ? "You decide how many points customers earn and what they are worth." : "The owner sets it up."}</p>{/if}
        {#if progEdit}
          <form class="space-y-2" onsubmit={saveProg}>
            <label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={progEdit.enabled} /> On</label>
            <div class="grid gap-3 sm:grid-cols-3">
              <label class="block"><span class="text-sm text-muted">Points per $1 spent</span><input class="field" type="number" min="0" step="0.5" bind:value={progEdit.points_per_dollar} /></label>
              <label class="block"><span class="text-sm text-muted">Points for $1 off</span><input class="field" type="number" min="1" step="1" bind:value={progEdit.points_per_dollar_off} /></label>
              <label class="block"><span class="text-sm text-muted">Fewest points to use at once</span><input class="field" type="number" min="0" step="1" bind:value={progEdit.min_redeem} /></label>
            </div>
            <p class="text-sm text-muted">Example: {progEdit.points_per_dollar} per $1 and {progEdit.points_per_dollar_off} for $1 off gives back {progEdit.points_per_dollar_off ? Math.round((progEdit.points_per_dollar / progEdit.points_per_dollar_off) * 10000) / 100 : 0}% of what customers spend.</p>
            <label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={progEdit.earn_on_promotions} /> Points also on items with a deal</label>
            <p class="text-sm text-muted">No points on these categories:</p>
            <div class="flex flex-wrap gap-2">{#each cats as c (c.id)}
              <label class="flex min-h-10 items-center gap-2 rounded-xl border px-2 {progEdit.exclude_categories.includes(c.id) ? 'border-bad bg-bad/10' : 'border-line'}">
                <input type="checkbox" checked={progEdit.exclude_categories.includes(c.id)} onchange={(e) => (progEdit.exclude_categories = e.currentTarget.checked ? [...progEdit.exclude_categories, c.id] : progEdit.exclude_categories.filter((x) => x !== c.id))} /> {c.name}</label>{/each}</div>
            <div class="flex gap-2"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (progEdit = null)}>Cancel</button></div>
          </form>
        {/if}
      </div>
    {/if}

    {#if can("customers.manage")}
      <div class="card space-y-2">
        <h2 class="font-semibold">Loyalty cards</h2>
        <p class="text-sm text-muted">Card numbers made by Chedam, printed on a label sheet (store name and barcode). Give a card at the till: scanning a new card starts joining.</p>
        {#if !cards}<button class="btn-ghost min-h-10 text-sm" onclick={startCards}>Make cards</button>
        {:else}
          <div class="flex flex-wrap items-end gap-2">
            <label class="block"><span class="text-sm text-muted">How many</span><input class="field w-28" type="number" min="1" max="500" bind:value={cardCount} /></label>
            <label class="block"><span class="text-sm text-muted">Label sheet</span><select class="field" bind:value={layoutId}>{#each layouts as l (l.id)}<option value={l.id}>{l.name}</option>{/each}</select></label>
            <button class="btn" onclick={makeCards}>Make and print</button>
            {#if cards.numbers.length}<button class="btn-ghost" onclick={printCards}>Print these {cards.numbers.length} again</button>{/if}
          </div>
          {#if cards.numbers.length}<p class="text-sm">Made {cards.numbers.length} cards: {cards.numbers[0]} to {cards.numbers.at(-1)}</p>{/if}
        {/if}
      </div>
    {/if}
  {:else}
    <div class="card space-y-1">
      <p class="text-2xl font-bold">{cur.points} points</p>
      <p class="text-sm text-muted">{cur.phone_full || cur.phone}{cur.card ? " · card " + cur.card : " · no card"} · {cur.visits} {cur.visits === 1 ? "visit" : "visits"} · {money(cur.spent_cents)} spent{cur.last_visit_at ? " · last " + when(cur.last_visit_at) : ""}</p>
      {#if cur.notes}<p class="text-sm">Note: {cur.notes}</p>{/if}
      {#if cur.agreed_at}<p class="text-xs text-muted">Agreed {when(cur.agreed_at)}</p>{/if}
    </div>
    <div class="flex flex-wrap gap-2">
      {#if can("customers.manage")}
        <button class="btn-ghost min-h-10 text-sm" onclick={() => (edit = { first_name: cur.first_name, phone: cur.phone_full || "", notes: cur.notes || "" })}>Edit</button>
        <button class="btn-ghost min-h-10 text-sm" onclick={() => (adj = { points: "", note: "" })}>Adjust points</button>
        <button class="btn-ghost min-h-10 text-sm" onclick={() => (merge = { q: "", found: [], into: null })}>Merge into another</button>
        <button class="btn-ghost min-h-10 text-sm" onclick={giveData}>Their data (download)</button>
        <button class="btn-ghost min-h-10 text-sm text-bad" onclick={erase}>Delete on request</button>
      {/if}
      {#if cur.card}<button class="btn-ghost min-h-10 text-sm" onclick={block}>Card lost: block it</button>{/if}
    </div>
    {#if edit}
      <form class="card grid gap-2 sm:grid-cols-2" onsubmit={saveEdit}>
        <label class="block"><span class="text-sm text-muted">First name</span><input class="field" bind:value={edit.first_name} maxlength="60" /></label>
        <label class="block"><span class="text-sm text-muted">Phone</span><input class="field" bind:value={edit.phone} inputmode="tel" /></label>
        <label class="block sm:col-span-2"><span class="text-sm text-muted">Note (staff only)</span><input class="field" bind:value={edit.notes} maxlength="500" /></label>
        <div class="flex gap-2"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (edit = null)}>Cancel</button></div>
      </form>
    {/if}
    {#if adj}
      <form class="card grid gap-2 sm:grid-cols-2" onsubmit={saveAdj}>
        <label class="block"><span class="text-sm text-muted">Points (minus to take off)</span><input class="field" type="number" step="1" bind:value={adj.points} /></label>
        <label class="block"><span class="text-sm text-muted">Reason</span><input class="field" bind:value={adj.note} maxlength="200" /></label>
        <div class="flex gap-2"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (adj = null)}>Cancel</button></div>
      </form>
    {/if}
    {#if merge}
      <form class="card space-y-2" onsubmit={doMerge}>
        <p class="text-sm">Two records for one person: find the one to keep.</p>
        <div class="flex gap-2"><input class="field" bind:value={merge.q} placeholder="Phone, card or first name" /><button class="btn-ghost" type="button" onclick={findMergeTarget}>Find</button></div>
        {#each merge.found as m (m.id)}<label class="flex min-h-10 items-center gap-2"><input type="radio" name="into" onchange={() => (merge.into = m)} /> {m.first_name} {m.phone} · {m.points} points</label>{/each}
        <div class="flex gap-2"><button class="btn" type="submit" disabled={!merge.into}>Move the points and delete this record</button><button class="btn-ghost" type="button" onclick={() => (merge = null)}>Cancel</button></div>
      </form>
    {/if}
    {#if can("customers.view") && !cur.card}
      <div class="card flex flex-wrap items-end gap-2">
        <label class="block"><span class="text-sm text-muted">Give a new card (scan it)</span><input class="field" bind:value={cardNo} inputmode="numeric" /></label>
        <button class="btn-ghost" disabled={!cardNo.trim()} onclick={linkCard}>Link card</button>
      </div>
    {/if}
    <div class="card">
      <h2 class="mb-1 font-semibold">Points</h2>
      <ul class="divide-y divide-line text-sm">{#each cur.ledger as l, i (i)}<li class="flex justify-between gap-2 py-1"><span>{when(l.at)} · {TYPE[l.type] || l.type}{l.note ? " · " + l.note : ""}</span><span class={l.points < 0 ? "text-bad" : "text-ok"}>{l.points > 0 ? "+" : ""}{l.points} → {l.balance_after}</span></li>{:else}<li class="py-1 text-muted">None yet.</li>{/each}</ul>
    </div>
    <div class="card">
      <h2 class="mb-1 font-semibold">Purchases</h2>
      <ul class="divide-y divide-line text-sm">{#each cur.sales as x (x.id)}<li class="flex justify-between gap-2 py-1"><span>{x.number} · {when(x.at)}</span><span>{money(x.total_cents)}{x.earned ? " · +" + x.earned : ""}{x.redeemed ? " · −" + x.redeemed : ""}</span></li>{:else}<li class="py-1 text-muted">None yet.</li>{/each}</ul>
    </div>
  {/if}
</section>

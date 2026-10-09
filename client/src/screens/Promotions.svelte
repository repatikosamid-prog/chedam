<script>
  // Promotions and scheduled prices (P2 step 1; FR-5.06-5.10, BR-20, 25). A promotion: what kind of deal,
  // which products or categories (and exclusions), when (dates, days, hours: time-based), a coupon code
  // if it needs one, limits, whether it stacks, labels. The preview shows each product's regular and
  // promo price, and with costs.view the cost and new margin, below cost in red. Saved as a draft or
  // switched on; "End now" stops it (labels go back to the regular price). Scheduled prices: a new price
  // for a product from a date, to a date.
  import { onMount } from "svelte";
  import { api, apiAll } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money, toCents } from "../lib/catalogue.js";

  const KINDS = [
    ["pct_off", "% off", "A percentage off each item"],
    ["amount_off", "$ off", "An amount off each item (per kg/lb when weighed)"],
    ["fixed_price", "Sale price", "Each item at a set price"],
    ["buy_get", "Buy X, get Y", "Buy some, get more free or cheaper"],
    ["multi_price", "X for $Y", "A number of one product for a price (3 for $5)"],
    ["mix_match", "Mix and match", "Any items from a group for a price"],
    ["spend", "Spend and save", "Spend an amount, get % or $ off"],
  ];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let list = $state([]), scheduled = $state([]), products = $state([]), units = $state([]), cats = $state([]);
  let error = $state(""), draft = $state(null), preview = $state(null), busy = $state(false), q = $state(""), exQ = $state("");
  let sched = $state(null), schedQ = $state("");

  async function load() {
    const r = await api("GET", "/api/chedam/promotions");
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    list = r.json.promotions; scheduled = r.json.scheduled;
  }
  onMount(async () => {
    load();
    const [p, u, c] = await Promise.all([
      apiAll("/api/collections/products/records?sort=name&fields=id,name,category,status&filter=" + encodeURIComponent("deleted_at='' && status='active'")),
      apiAll("/api/collections/selling_units/records?sort=sort&fields=id,product,name,price_cents&filter=" + encodeURIComponent("deleted_at='' && sell_at_pos=true")),
      api("GET", "/api/collections/categories/records?perPage=500&sort=sort,name&filter=" + encodeURIComponent("deleted_at=''")),
    ]);
    if (p.ok) products = p.json.items;
    if (u.ok) units = u.json.items;
    if (c.ok) cats = c.json.items;
  });

  const pname = (id) => (products.find((p) => p.id === id) || { name: "(removed)" }).name;
  const cname = (id) => (cats.find((c) => c.id === id) || { name: "(removed)" }).name;
  // Stored times (UTC) <-> the browser's local date-time field
  const toLocal = (v) => { if (!v) return ""; const d = new Date(String(v).replace(" ", "T")); const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()); };
  const fromLocal = (v) => (v ? new Date(v).toISOString() : "");
  const when = (v) => (v ? new Date(String(v).replace(" ", "T")).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
  const dollars = (c) => (c ? (c / 100).toFixed(2) : "");

  function statusOf(p) {
    if (p.status === "ended") return ["Ended", "text-muted"];
    if (p.status === "draft") return ["Draft", "text-warn"];
    if (p.in_force) return ["On now", "text-ok"];
    if (p.ends_at && p.ends_at < new Date().toISOString().replace("T", " ")) return ["Over", "text-muted"];
    return [p.starts_at ? "Starts " + when(p.starts_at) : "Not now (days or hours)", "text-accent"];
  }

  function start(p, copy) {
    error = ""; preview = null; q = ""; exQ = "";
    const d = p ? { ...p, products: [...p.products], categories: [...p.categories], exclude: [...p.exclude], days: [...(p.days || [])] } : null;
    draft = d ? { ...d, id: copy ? "" : d.id, name: copy ? d.name + " (copy)" : d.name, status: copy ? "draft" : d.status,
      amount: dollars(d.amount_cents), price: dollars(d.price_cents), threshold: dollars(d.threshold_cents),
      starts: copy ? "" : toLocal(d.starts_at), ends: copy ? "" : toLocal(d.ends_at), timed: !!(d.hours_from || (d.days || []).length), coupon: !!d.coupon_code }
      : { id: "", name: "", type: "pct_off", status: "draft", pct: 10, amount: "", price: "", buy_qty: 2, get_qty: 1, reward: "free", threshold: "",
        products: [], categories: [], exclude: [], starts: "", ends: "", days: [], hours_from: "", hours_to: "", coupon_code: "", stackable: false,
        per_transaction: 0, max_uses: 0, labels: true, note: "", timed: false, coupon: false };
  }

  function body(status) {
    const d = draft;
    return { id: d.id || undefined, name: d.name.trim(), type: d.type, status, pct: Number(d.pct) || 0, amount_cents: toCents(d.amount) || 0,
      price_cents: toCents(d.price) || 0, buy_qty: Number(d.buy_qty) || 0, get_qty: Number(d.get_qty) || 0, reward: d.reward, threshold_cents: toCents(d.threshold) || 0,
      products: d.products, categories: d.categories, exclude: d.exclude, starts_at: fromLocal(d.starts), ends_at: fromLocal(d.ends),
      days: d.timed ? d.days : [], hours_from: d.timed ? d.hours_from : "", hours_to: d.timed ? d.hours_to : "", coupon_code: d.coupon ? d.coupon_code : "",
      stackable: d.stackable, per_transaction: Number(d.per_transaction) || 0, max_uses: Number(d.max_uses) || 0, labels: d.labels, note: d.note };
  }

  async function showPreview() {
    const r = await api("POST", "/api/chedam/promotions/preview", body("active"));
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    preview = r.json;
  }

  async function save(status) {
    error = ""; busy = true;
    const r = await api("POST", "/api/chedam/promotions", body(status));
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    draft = null; preview = null; load();
  }

  async function endNow(p) {
    if (!confirm("End '" + p.name + "' now? Prices go back to regular and the labels are queued.")) return;
    const r = await api("POST", `/api/chedam/promotions/${p.id}/end`, {});
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    load();
  }

  const pick = (field, id) => { if (!draft[field].includes(id)) draft[field] = [...draft[field], id]; };
  const unpick = (field, id) => (draft[field] = draft[field].filter((x) => x !== id));
  const found = (text, taken) => (text.trim().length < 2 ? [] : products.filter((p) => p.name.toLowerCase().includes(text.trim().toLowerCase()) && !taken.includes(p.id)).slice(0, 8));
  const toggleDay = (d) => (draft.days = draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort());

  // ---- Scheduled prices
  function startSched() { error = ""; schedQ = ""; sched = { product: "", selling_unit: "", price: "", starts: "", ends: "", note: "" }; }
  async function saveSched(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/scheduled-prices", { selling_unit: sched.selling_unit, price_cents: toCents(sched.price), starts_at: fromLocal(sched.starts), ends_at: fromLocal(sched.ends), note: sched.note });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    sched = null; load();
  }
  async function removeSched(x) {
    if (!confirm("Remove the scheduled price for " + x.product_name + "?")) return;
    const r = await api("POST", "/api/chedam/scheduled-prices", { id: x.id, remove: true });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    load();
  }

  const groups = $derived([
    ["On now", list.filter((p) => p.status === "active" && p.in_force)],
    ["Coming or not now", list.filter((p) => p.status === "active" && !p.in_force)],
    ["Drafts", list.filter((p) => p.status === "draft")],
    ["Ended", list.filter((p) => p.status === "ended").slice(0, 20)],
  ]);
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-3">
    <div>
      <button class="mb-1 min-h-10 text-sm underline" onclick={() => (draft ? (draft = null) : go("home"))}>← {draft ? "Promotions" : "Back"}</button>
      <h1 class="text-xl font-bold">{draft ? (draft.id ? "Change promotion" : "New promotion") : "Promotions"}</h1>
    </div>
    {#if !draft && can("promotions.manage")}<div class="flex gap-2"><button class="btn" onclick={() => start(null)}>New promotion</button></div>{/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  {#if draft}
    <div class="card space-y-4">
      <label class="block"><span class="text-sm text-muted">Name (customers see it on the receipt)</span><input class="field" bind:value={draft.name} maxlength="80" placeholder="e.g. Snack week" /></label>
      <fieldset>
        <legend class="mb-1 text-sm text-muted">Kind of deal</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each KINDS as [k, label, what] (k)}
            <label class="flex min-h-12 cursor-pointer items-start gap-2 rounded-xl border p-2 {draft.type === k ? 'border-accent bg-soft' : 'border-line'}">
              <input type="radio" class="mt-1" name="kind" value={k} bind:group={draft.type} /><span><b>{label}</b><span class="block text-sm text-muted">{what}</span></span></label>
          {/each}
        </div>
      </fieldset>

      <div class="grid gap-3 sm:grid-cols-3">
        {#if draft.type === "pct_off" || ((draft.type === "buy_get" || draft.type === "spend") && draft.reward === "pct")}
          <label class="block"><span class="text-sm text-muted">Percent off</span><input class="field" type="number" min="0.5" max="100" step="0.5" bind:value={draft.pct} /></label>
        {/if}
        {#if draft.type === "amount_off" || ((draft.type === "buy_get" || draft.type === "spend") && draft.reward === "amount")}
          <label class="block"><span class="text-sm text-muted">Amount off ($)</span><input class="field" inputmode="decimal" bind:value={draft.amount} /></label>
        {/if}
        {#if draft.type === "fixed_price" || draft.type === "multi_price" || draft.type === "mix_match"}
          <label class="block"><span class="text-sm text-muted">{draft.type === "fixed_price" ? "Sale price each ($)" : "Price for the group ($)"}</span><input class="field" inputmode="decimal" bind:value={draft.price} /></label>
        {/if}
        {#if draft.type === "buy_get" || draft.type === "multi_price" || draft.type === "mix_match"}
          <label class="block"><span class="text-sm text-muted">{draft.type === "buy_get" ? "Buy" : "How many items"}</span><input class="field" type="number" min="1" step="1" bind:value={draft.buy_qty} /></label>
        {/if}
        {#if draft.type === "buy_get"}
          <label class="block"><span class="text-sm text-muted">Get</span><input class="field" type="number" min="1" step="1" bind:value={draft.get_qty} /></label>
          <label class="block"><span class="text-sm text-muted">They are</span><select class="field" bind:value={draft.reward}><option value="free">Free</option><option value="pct">% off</option><option value="amount">$ off each</option></select></label>
        {/if}
        {#if draft.type === "spend"}
          <label class="block"><span class="text-sm text-muted">Spend at least ($)</span><input class="field" inputmode="decimal" bind:value={draft.threshold} /></label>
          <label class="block"><span class="text-sm text-muted">Get</span><select class="field" bind:value={draft.reward}><option value="pct">% off</option><option value="amount">$ off</option></select></label>
        {/if}
      </div>

      <div class="space-y-2">
        <p class="text-sm text-muted">{draft.type === "spend" ? "Which items count (none chosen: the whole sale)" : "Which products or categories"}</p>
        <div class="flex flex-wrap gap-2">
          {#each cats as c (c.id)}
            <label class="flex min-h-10 items-center gap-2 rounded-xl border px-2 {draft.categories.includes(c.id) ? 'border-accent bg-soft' : 'border-line'}">
              <input type="checkbox" checked={draft.categories.includes(c.id)} onchange={(e) => (e.currentTarget.checked ? pick("categories", c.id) : unpick("categories", c.id))} /> {c.name}</label>
          {/each}
        </div>
        <input class="field" bind:value={q} placeholder="Add a product: type its name" aria-label="Add a product" />
        {#each found(q, draft.products) as p (p.id)}<button class="btn-ghost mr-2 min-h-10 text-sm" onclick={() => { pick("products", p.id); q = ""; }}>+ {p.name}</button>{/each}
        <div class="flex flex-wrap gap-2">{#each draft.products as id (id)}<span class="rounded-lg bg-soft px-2 py-1 text-sm">{pname(id)} <button class="ml-1 text-bad" aria-label={"Remove " + pname(id)} onclick={() => unpick("products", id)}>✕</button></span>{/each}</div>
        {#if draft.categories.length || draft.type === "spend"}
          <input class="field" bind:value={exQ} placeholder="Leave out a product: type its name" aria-label="Leave out a product" />
          {#each found(exQ, draft.exclude) as p (p.id)}<button class="btn-ghost mr-2 min-h-10 text-sm" onclick={() => { pick("exclude", p.id); exQ = ""; }}>− {p.name}</button>{/each}
          <div class="flex flex-wrap gap-2">{#each draft.exclude as id (id)}<span class="rounded-lg bg-bad/10 px-2 py-1 text-sm text-bad">Not: {pname(id)} <button class="ml-1" aria-label={"Put back " + pname(id)} onclick={() => unpick("exclude", id)}>✕</button></span>{/each}</div>
        {/if}
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block"><span class="text-sm text-muted">Starts (empty: when switched on)</span><input class="field" type="datetime-local" bind:value={draft.starts} /></label>
        <label class="block"><span class="text-sm text-muted">Ends (empty: until ended)</span><input class="field" type="datetime-local" bind:value={draft.ends} /></label>
      </div>
      <label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={draft.timed} /> Only on some days or hours (e.g. happy hour)</label>
      {#if draft.timed}
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-wrap gap-1">{#each DAYS as d, i (d)}<button type="button" class="h-10 min-w-12 rounded-lg border {draft.days.includes(i) ? 'border-accent bg-accent text-accent-ink' : 'border-line'}" onclick={() => toggleDay(i)}>{d}</button>{/each}</div>
          <label class="block"><span class="text-sm text-muted">From</span><input class="field" type="time" bind:value={draft.hours_from} /></label>
          <label class="block"><span class="text-sm text-muted">To</span><input class="field" type="time" bind:value={draft.hours_to} /></label>
        </div>
        <p class="text-xs text-muted">No day chosen: every day. Hours may pass midnight (22:00 to 02:00).</p>
      {/if}
      <label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={draft.coupon} /> Only with a coupon code (the cashier enters it)</label>
      {#if draft.coupon}<input class="field max-w-xs uppercase" bind:value={draft.coupon_code} maxlength="30" placeholder="e.g. SAVE10" aria-label="Coupon code" />{/if}
      <div class="grid gap-3 sm:grid-cols-3">
        <label class="block"><span class="text-sm text-muted">Most times in one sale (0: no limit)</span><input class="field" type="number" min="0" step="1" bind:value={draft.per_transaction} /></label>
        <label class="block"><span class="text-sm text-muted">Most times in total (0: no limit)</span><input class="field" type="number" min="0" step="1" bind:value={draft.max_uses} /></label>
        <label class="flex min-h-12 items-center gap-3 self-end"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={draft.stackable} /> Adds to other deals</label>
      </div>
      <label class="flex min-h-10 items-center gap-3"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={draft.labels} /> Shelf labels when it starts and ends</label>
      <label class="block"><span class="text-sm text-muted">Note (staff only)</span><input class="field" bind:value={draft.note} maxlength="500" /></label>

      <div class="flex flex-wrap gap-2">
        <button class="btn-ghost" onclick={showPreview}>Preview prices</button>
        <button class="btn-ghost" disabled={busy} onclick={() => save("draft")}>Save as draft</button>
        <button class="btn" disabled={busy} onclick={() => save("active")}>{draft.status === "active" ? "Save" : "Switch on"}</button>
        <button class="btn-ghost" onclick={() => { draft = null; preview = null; }}>Cancel</button>
      </div>
      {#if preview}
        <div class="overflow-x-auto">
          <p class="mb-1 font-semibold">{preview.text}{preview.below_cost ? " · " + preview.below_cost + " below cost" : ""}</p>
          <table class="w-full text-sm">
            <thead><tr class="text-left"><th class="py-1">Product</th><th>Regular</th><th>With the deal</th>{#if preview.rows.some((x) => x.cost_cents !== undefined)}<th>Cost</th><th>Margin</th>{/if}</tr></thead>
            <tbody>{#each preview.rows as x (x.product + x.unit)}<tr class="border-t border-line {x.below_cost ? 'text-bad' : ''}">
              <td class="py-1">{x.name}{x.unit && x.unit !== "Single" ? " (" + x.unit + ")" : ""}</td><td>{money(x.regular_cents)}</td><td>{x.promo_cents === null ? "in the group deal" : money(x.promo_cents)}</td>
              {#if x.cost_cents !== undefined}<td>{money(x.cost_cents)}</td><td>{x.margin_pct === null ? "" : x.margin_pct + "%"}{x.below_cost ? " · below cost" : ""}</td>{/if}</tr>
            {:else}<tr><td class="py-1 text-muted" colspan="5">Choose products or categories.</td></tr>{/each}</tbody>
          </table>
        </div>
      {/if}
    </div>
  {:else}
    {#each groups as [title, items] (title)}
      {#if items.length}
        <div class="card">
          <h2 class="mb-2 font-semibold">{title}</h2>
          <ul class="divide-y divide-line">
            {#each items as p (p.id)}
              {@const st = statusOf(p)}
              <li class="flex flex-wrap items-center justify-between gap-2 py-2">
                <div class="min-w-0">
                  <p><b>{p.name}</b> · {p.text}{p.coupon_code ? " · coupon " + p.coupon_code : ""} <span class="ml-1 text-sm font-semibold {st[1]}">{st[0]}</span></p>
                  <p class="text-sm text-muted">{[...p.categories.map(cname), ...p.products.map(pname)].join(", ") || "Whole sale"}{p.exclude.length ? " · not " + p.exclude.map(pname).join(", ") : ""}
                    {p.ends_at ? " · until " + when(p.ends_at) : ""}{p.hours_from ? " · " + p.hours_from + "-" + p.hours_to : ""}{(p.days || []).length ? " · " + p.days.map((d) => DAYS[d]).join(" ") : ""} · used {p.uses}{p.max_uses ? " of " + p.max_uses : ""}</p>
                </div>
                {#if can("promotions.manage")}
                  <div class="flex gap-2">
                    {#if p.status !== "ended"}<button class="btn-ghost min-h-10 text-sm" onclick={() => start(p)}>Change</button>{/if}
                    <button class="btn-ghost min-h-10 text-sm" onclick={() => start(p, true)}>Copy</button>
                    {#if p.status === "active"}<button class="btn-ghost min-h-10 text-sm text-bad" onclick={() => endNow(p)}>End now</button>{/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/each}
    {#if !list.length}<p class="text-muted">No promotions yet.</p>{/if}

    <div class="card space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">Scheduled prices</h2>
        {#if can("promotions.manage") && !sched}<button class="btn-ghost min-h-10 text-sm" onclick={startSched}>New scheduled price</button>{/if}
      </div>
      <p class="text-sm text-muted">A new regular price from a date (and back on another date), for example a supplier price rise. Labels are queued when it starts and ends.</p>
      {#if sched}
        <form class="grid gap-2 rounded-xl border border-accent p-3 sm:grid-cols-2" onsubmit={saveSched}>
          <label class="block sm:col-span-2"><span class="text-sm text-muted">Product</span><input class="field" bind:value={schedQ} placeholder="Type its name" /></label>
          {#if !sched.product}{#each found(schedQ, []) as p (p.id)}<button type="button" class="btn-ghost min-h-10 text-sm" onclick={() => { sched.product = p.id; schedQ = p.name; const u = units.filter((x) => x.product === p.id); sched.selling_unit = u.length ? u[0].id : ""; }}>{p.name}</button>{/each}{/if}
          {#if sched.product}
            <label class="block"><span class="text-sm text-muted">Unit</span><select class="field" bind:value={sched.selling_unit}>{#each units.filter((x) => x.product === sched.product) as u (u.id)}<option value={u.id}>{u.name} (now {money(u.price_cents)})</option>{/each}</select></label>
            <label class="block"><span class="text-sm text-muted">New price ($)</span><input class="field" inputmode="decimal" bind:value={sched.price} required /></label>
            <label class="block"><span class="text-sm text-muted">From</span><input class="field" type="datetime-local" bind:value={sched.starts} required /></label>
            <label class="block"><span class="text-sm text-muted">Until (empty: no end)</span><input class="field" type="datetime-local" bind:value={sched.ends} /></label>
            <label class="block sm:col-span-2"><span class="text-sm text-muted">Note</span><input class="field" bind:value={sched.note} maxlength="200" /></label>
          {/if}
          <div class="flex gap-2 sm:col-span-2"><button class="btn" type="submit" disabled={!sched.selling_unit}>Save</button><button class="btn-ghost" type="button" onclick={() => (sched = null)}>Cancel</button></div>
        </form>
      {/if}
      <ul class="divide-y divide-line text-sm">
        {#each scheduled as x (x.id)}
          <li class="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><b>{x.product_name}</b>{x.unit_name && x.unit_name !== "Single" ? " (" + x.unit_name + ")" : ""} · {money(x.price_cents)} from {when(x.starts_at)}{x.ends_at ? " until " + when(x.ends_at) : ""}{x.note ? " · " + x.note : ""}</span>
            {#if can("promotions.manage")}<button class="btn-ghost min-h-10 text-sm text-bad" onclick={() => removeSched(x)}>Remove</button>{/if}
          </li>
        {:else}<li class="py-2 text-muted">None.</li>{/each}
      </ul>
    </div>
  {/if}
</section>

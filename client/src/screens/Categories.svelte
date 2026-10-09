<script>
  // Categories (FR-5.01, FR-4.07): name, colour on the till grid, order, shown on the till, return
  // window and non-returnable. Removing hides a category (soft delete); its products keep it.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";

  const edit = can("catalogue.edit");
  let list = $state([]), counts = $state({}), error = $state(""), ok = $state("");
  let draft = $state(null);   // the category being added or edited

  async function load() {
    const r = await api("GET", "/api/collections/categories/records?perPage=500&sort=sort,name&filter=" + encodeURIComponent("deleted_at=''"));
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    list = r.json.items;
    const next = {};
    await Promise.all(list.map(async (c) => {
      const n = await api("GET", "/api/collections/products/records?perPage=1&fields=id&filter=" + encodeURIComponent(`category='${c.id}' && deleted_at='' && status!='archived'`));
      next[c.id] = n.ok ? n.json.totalItems : 0;
    }));
    counts = next;
  }
  onMount(load);

  function start(c) {
    error = ""; ok = "";
    draft = c ? { ...c } : { id: "", name: "", colour: "#3f8f3a", sort: (list.at(-1)?.sort || 0) + 1, pos_visible: true, return_window_days: 0, non_returnable: false };
  }

  async function save(e) {
    e.preventDefault();
    const body = { name: draft.name.trim(), colour: draft.colour, sort: Number(draft.sort) || 0, pos_visible: draft.pos_visible,
      return_window_days: Number(draft.return_window_days) || 0, non_returnable: draft.non_returnable };
    if (!body.name) { error = "Enter a name."; return; }
    const r = draft.id ? await api("PATCH", "/api/collections/categories/records/" + draft.id, body)
      : await api("POST", "/api/collections/categories/records", body);
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    ok = "Saved.";
    draft = null;
    load();
  }

  async function remove(c) {
    if (counts[c.id]) { error = "'" + c.name + "' still has " + counts[c.id] + " products. Move them to another category first."; return; }
    if (!confirm("Remove the category '" + c.name + "'?")) return;
    const r = await api("PATCH", "/api/collections/categories/records/" + c.id, { deleted_at: new Date().toISOString() });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    draft = null;
    load();
  }
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-3">
    <div>
      <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("products")}>← Products</button>
      <h1 class="text-xl font-bold">Categories</h1>
    </div>
    {#if edit && !draft}<button class="btn" onclick={() => start(null)}>Add category</button>{/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if draft}
    <form class="card grid gap-3 sm:grid-cols-2" onsubmit={save}>
      <h2 class="font-semibold sm:col-span-2">{draft.id ? "Edit " + draft.name : "New category"}</h2>
      <label class="block"><span class="text-sm text-muted">Name</span><input class="field" bind:value={draft.name} maxlength="80" required /></label>
      <label class="block"><span class="text-sm text-muted">Colour on the till</span>
        <input class="field h-12 p-1" type="color" bind:value={draft.colour} /></label>
      <label class="block"><span class="text-sm text-muted">Order</span><input class="field" type="number" step="1" bind:value={draft.sort} /></label>
      <label class="block"><span class="text-sm text-muted">Return window (days, 0 = store default)</span>
        <input class="field" type="number" min="0" max="3650" step="1" bind:value={draft.return_window_days} disabled={draft.non_returnable} /></label>
      <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={draft.pos_visible} /> Shown on the till</label>
      <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={draft.non_returnable} /> Cannot be returned</label>
      <div class="flex flex-wrap gap-2 sm:col-span-2">
        <button class="btn" type="submit">Save</button>
        <button class="btn-ghost" type="button" onclick={() => (draft = null)}>Cancel</button>
        {#if draft.id}<button class="btn-ghost text-bad" type="button" onclick={() => remove(draft)}>Remove</button>{/if}
      </div>
    </form>
  {/if}

  <div class="card">
    {#if list.length}
      <ul class="divide-y divide-line">
        {#each list as c (c.id)}
          <li class="flex min-h-14 items-center justify-between gap-3 py-2">
            <span class="flex min-w-0 items-center gap-3">
              <span class="h-6 w-6 shrink-0 rounded-md border border-line" style="background:{c.colour || 'transparent'}" aria-hidden="true"></span>
              <span class="min-w-0">
                <span class="block truncate font-semibold">{c.name}</span>
                <span class="block text-sm text-muted">{counts[c.id] ?? "…"} {counts[c.id] === 1 ? "product" : "products"}{c.pos_visible ? "" : " · hidden on the till"}{c.non_returnable ? " · no returns" : c.return_window_days ? " · returns " + c.return_window_days + " days" : ""}</span>
              </span>
            </span>
            {#if edit}<button class="btn-ghost min-h-10 text-sm" onclick={() => start(c)}>Edit</button>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-muted">No categories yet.</p>
    {/if}
  </div>
</section>

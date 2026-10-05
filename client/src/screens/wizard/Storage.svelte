<script>
  // FR-1.05 storage areas with temperature ranges (shelf, cooler, freezer, dry store).
  import { onMount } from "svelte";
  import { api } from "../../lib/api.js";
  import { handleRefusal } from "../../lib/session.svelte.js";
  import StepActions from "../../components/StepActions.svelte";

  let { onsaved, onskip } = $props();
  const KINDS = { shelf: "Shelf", cooler: "Cooler", freezer: "Freezer", dry_store: "Dry store", other: "Other" };
  const USUAL = [["Shelf", "shelf", null, null], ["Cooler", "cooler", 0, 4], ["Freezer", "freezer", -25, -15], ["Dry store", "dry_store", 10, 25]];
  let areas = $state([]);
  let f = $state({ name: "", kind: "cooler", min: "", max: "" });
  let busy = $state(false), error = $state("");

  async function load() {
    const r = await api("GET", "/api/collections/storage_areas/records?perPage=100&sort=sort,name&filter=" + encodeURIComponent("deleted_at=''"));
    if (r.ok) areas = r.json.items;
    else handleRefusal(r);
  }
  onMount(load);

  // No range (shelf, room temperature) is saved as 0 to 0: PocketBase number fields have no "empty".
  async function create(name, kind, min, max, sort) {
    const r = await api("POST", "/api/collections/storage_areas/records",
      { name, kind, temp_min_c: min === "" || min === null ? 0 : Number(min), temp_max_c: max === "" || max === null ? 0 : Number(max), active: true, sort });
    if (!r.ok && !(await handleRefusal(r))) error = r.message;
    return r.ok;
  }

  async function addUsual() {
    busy = true; error = "";
    for (const [i, [n, k, mi, ma]] of USUAL.entries()) if (!areas.some((a) => a.name === n)) await create(n, k, mi, ma, i + 1);
    busy = false;
    load();
  }

  async function add(e) {
    e.preventDefault();
    if (f.min !== "" && f.max !== "" && Number(f.min) > Number(f.max)) { error = "The lowest temperature must be below the highest."; return; }
    busy = true; error = "";
    if (await create(f.name.trim(), f.kind, f.min, f.max, areas.length + 1)) f = { name: "", kind: f.kind, min: "", max: "" };
    busy = false;
    load();
  }

  async function toggle(a) {
    await api("PATCH", "/api/collections/storage_areas/records/" + a.id, { active: !a.active });
    load();
  }

  function range(a) {
    if (!a.temp_min_c && !a.temp_max_c) return "room temperature";
    return a.temp_min_c + " to " + a.temp_max_c + " °C";
  }
</script>

<div class="card space-y-4">
  <h2 class="text-xl font-bold">Storage areas</h2>
  <p>Where you keep stock. Coolers and freezers get temperature ranges, used later for food-safety checks.</p>

  {#if areas.length === 0}
    <button class="btn-ghost" disabled={busy} onclick={addUsual}>Add the usual four (shelf, cooler, freezer, dry store)</button>
  {:else}
    <ul class="divide-y divide-line rounded-xl border border-line">
      {#each areas as a (a.id)}
        <li class="flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-2 {a.active ? '' : 'opacity-60'}">
          <span><b>{a.name}</b> <span class="text-sm text-muted">· {KINDS[a.kind] || a.kind} · {range(a)}</span></span>
          <button class="min-h-10 text-sm underline" onclick={() => toggle(a)}>{a.active ? "Not used" : "Use again"}</button>
        </li>
      {/each}
    </ul>
  {/if}

  <form class="space-y-3 rounded-xl border border-dashed border-line p-3" onsubmit={add}>
    <h3 class="font-semibold">Add an area</h3>
    <div class="grid gap-3 sm:grid-cols-4">
      <div class="sm:col-span-2"><label for="s-name" class="block text-sm font-semibold">Name</label><input id="s-name" class="field" bind:value={f.name} maxlength="80" placeholder="Back cooler" required /></div>
      <div class="sm:col-span-2"><label for="s-kind" class="block text-sm font-semibold">Kind</label>
        <select id="s-kind" class="field" bind:value={f.kind}>{#each Object.entries(KINDS) as [v, l]}<option value={v}>{l}</option>{/each}</select></div>
      <div class="sm:col-span-2"><label for="s-min" class="block text-sm font-semibold">Lowest °C</label><input id="s-min" class="field" type="number" step="0.5" bind:value={f.min} /></div>
      <div class="sm:col-span-2"><label for="s-max" class="block text-sm font-semibold">Highest °C</label><input id="s-max" class="field" type="number" step="0.5" bind:value={f.max} /></div>
    </div>
    {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
    <button class="btn-ghost" disabled={busy}>Add area</button>
  </form>

  <form onsubmit={(e) => { e.preventDefault(); onsaved(); }}>
    <StepActions {onskip} saveLabel="Done with storage" />
  </form>
</div>

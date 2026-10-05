<script>
  // FR-1.06: the shop-type preset ticks the usual features; the owner changes any. Switching a feature
  // off hides it but never deletes its data. Core features are always on; "later" ones are not ready.
  import { onMount } from "svelte";
  import { api } from "../../lib/api.js";
  import { handleRefusal } from "../../lib/session.svelte.js";
  import StepActions from "../../components/StepActions.svelte";

  let { business, onsaved, onskip } = $props();
  let modules = $state([]);
  let presets = $state({});
  let on = $state({});
  let busy = $state(false), error = $state("");

  onMount(async () => {
    const [m, p] = await Promise.all([
      api("GET", "/api/collections/modules/records?perPage=100&sort=sort"),
      api("GET", "/api/collections/settings/records?filter=" + encodeURIComponent("key='shop_presets'")),
    ]);
    if (!m.ok) { handleRefusal(m); return; }
    modules = m.json.items;
    presets = p.ok && p.json.items[0] ? p.json.items[0].value : {};
    const anyOn = modules.some((x) => x.kind === "switchable" && x.enabled);
    on = Object.fromEntries(modules.map((x) => [x.id, x.enabled]));
    if (!anyOn) usePreset();
  });

  function usePreset() {
    const list = presets[business.shop_type || "grocery"] || [];
    modules.forEach((x) => { if (x.kind === "switchable") on[x.id] = list.includes(x.module); });
  }

  async function save(e) {
    e.preventDefault();
    busy = true; error = "";
    for (const x of modules) {
      if (x.kind !== "switchable" || !!on[x.id] === !!x.enabled) continue;
      const r = await api("PATCH", "/api/collections/modules/records/" + x.id, { enabled: !!on[x.id] });
      if (!r.ok) { busy = false; if (!(await handleRefusal(r))) error = x.label + ": " + r.message; return; }
    }
    busy = false;
    onsaved();
  }
</script>

<form class="card space-y-4" onsubmit={save}>
  <h2 class="text-xl font-bold">Features</h2>
  <p>
    Ticked for a <b>{(business.shop_type || "grocery").replace("_", " ")}</b> store.
    Change anything; switching a feature off only hides it.
    <button type="button" class="ml-1 min-h-10 underline" onclick={usePreset}>Use the suggestion again</button>
  </p>
  <ul class="grid gap-2 sm:grid-cols-2">
    {#each modules as x (x.id)}
      <li>
        <label class="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3 py-2 {x.kind === 'later' ? 'opacity-60' : ''}">
          <input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={on[x.id]} disabled={x.kind !== "switchable"} />
          <span>{x.label}
            {#if x.kind === "core"}<span class="block text-xs text-muted">Always on</span>{/if}
            {#if x.kind === "later"}<span class="block text-xs text-muted">Not available yet</span>{/if}
          </span>
        </label>
      </li>
    {/each}
  </ul>
  <StepActions {onskip} {busy} {error} />
</form>

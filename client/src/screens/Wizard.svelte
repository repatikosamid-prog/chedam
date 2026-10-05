<script>
  // Setup wizard (FR-1.01-1.06, 1.13, 1.15). Resumes at the first step not done. Each step is saved
  // ("done") or skipped (the hub turns a skipped step into a task). Any step can be opened again to
  // edit; nothing is ever deleted.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal, notify } from "../lib/session.svelte.js";
  import Business from "./wizard/Business.svelte";
  import Branding from "./wizard/Branding.svelte";
  import People from "./wizard/People.svelte";
  import Storage from "./wizard/Storage.svelte";
  import Modules from "./wizard/Modules.svelte";
  import References from "./wizard/References.svelte";
  import Backup from "./wizard/Backup.svelte";

  const LABELS = {
    language: "Language", time: "Clock", owner: "Owner account", business: "Business profile",
    branding: "Logo and receipt", people: "Your team", storage: "Storage areas", modules: "Features",
    references: "References (optional)", backup: "Backups",
  };
  const VIEWS = { business: Business, branding: Branding, people: People, storage: Storage, modules: Modules, references: References, backup: Backup };

  let steps = $state([]);
  let current = $state("");
  let biz = $state(null);
  let error = $state("");
  let complete = $state(false);

  async function loadBusiness() {
    const r = await api("GET", "/api/collections/business/records?perPage=1&filter=" + encodeURIComponent("deleted_at=''"));
    if (r.ok) biz = r.json.items[0] || null;
    else if (!(await handleRefusal(r))) error = r.message;
  }

  async function load() {
    const r = await api("GET", "/api/chedam/setup/status");
    if (!r.ok || !r.json.steps) { error = r.message || "Only the owner runs the setup wizard."; return; }
    steps = r.json.steps;
    complete = !!r.json.completed_at;
    await loadBusiness();
    if (!current) current = (steps.find((x) => VIEWS[x.id] && x.status !== "done") || {}).id || "";
  }

  onMount(load);

  async function mark(status) {
    const r = await api("POST", "/api/chedam/setup/step", { step: current, status });
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    steps = r.json.steps;
    complete = !!r.json.completed_at;
    if (status === "skipped") notify('Skipped "' + LABELS[current] + '". It is on your task list for later.');
    else notify("");
    await loadBusiness();
    const order = steps.map((x) => x.id);
    const after = steps.slice(order.indexOf(current) + 1).find((x) => VIEWS[x.id] && x.status !== "done");
    const before = steps.find((x) => VIEWS[x.id] && x.status !== "done" && x.status !== "skipped");
    current = (after || before || {}).id || "";
    window.scrollTo(0, 0);
  }

  const View = $derived(VIEWS[current]);
  const doneCount = $derived(steps.filter((x) => x.status === "done").length);
</script>

<section class="space-y-4">
  <div class="flex flex-wrap items-end justify-between gap-2">
    <div>
      <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Home</button>
      <h1 class="text-2xl font-bold">Set up your store</h1>
      <p class="text-muted">{doneCount} of {steps.length} steps done{complete ? " · setup complete" : ""}</p>
    </div>
  </div>

  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  <nav aria-label="Setup steps">
    <ol class="flex flex-wrap gap-2">
      {#each steps as st (st.id)}
        <li>
          <button class="min-h-10 rounded-full border px-3 text-sm
            {st.id === current ? 'border-accent bg-accent text-accent-ink' : st.status === 'done' ? 'border-ok text-ok' : st.status === 'skipped' ? 'border-warn text-warn' : 'border-line'}"
            disabled={!VIEWS[st.id]} aria-current={st.id === current ? "step" : undefined}
            onclick={() => { current = st.id; notify(""); }}>
            {st.status === "done" ? "✓ " : st.status === "skipped" ? "↷ " : ""}{LABELS[st.id]}
          </button>
        </li>
      {/each}
    </ol>
  </nav>

  {#if View && biz}
    {#key current}
      <View business={biz} onsaved={() => mark("done")} onskip={() => mark("skipped")} />
    {/key}
  {:else if steps.length && !current}
    <div class="card space-y-3">
      <h2 class="text-xl font-bold">{complete ? "All done" : "Nearly there"}</h2>
      {#if complete}
        <p>Your store is set up. You can come back here any time to change something.</p>
      {:else}
        <p>Skipped steps are on your task list. Tap a step above to finish it now.</p>
      {/if}
      <button class="btn" onclick={() => go("home")}>Go to the home screen</button>
    </div>
  {/if}
</section>

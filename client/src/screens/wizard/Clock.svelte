<script>
  import { onMount, untrack } from "svelte";
  // FR-1.01 hub date/time check: the hub's clock against this device's, and the store time zone. All
  // times are stored in UTC and shown in the store time zone (BR-30).
  import { api } from "../../lib/api.js";
  import { handleRefusal } from "../../lib/session.svelte.js";
  import StepActions from "../../components/StepActions.svelte";

  let { business: current, onsaved, onskip } = $props();
  const business = untrack(() => current);
  const ZONES = ["America/Vancouver", "America/Edmonton", "America/Regina", "America/Winnipeg", "America/Toronto",
    "America/Halifax", "America/St_Johns", "America/Whitehorse", "America/Yellowknife", "America/Iqaluit"];
  let zone = $state(business.time_zone || "America/Vancouver");
  let hubTime = $state(null), offset = $state(0), busy = $state(false), error = $state("");

  onMount(async () => {
    const t0 = Date.now();
    const r = await api("GET", "/api/chedam/status");
    if (r.ok) { hubTime = new Date(r.json.hub_time); offset = hubTime.getTime() - (t0 + Date.now()) / 2; }
  });

  const show = (d) => d.toLocaleString("en-CA", { timeZone: zone, dateStyle: "full", timeStyle: "medium" });
  const off = $derived(Math.abs(offset) < 120000);

  async function save(e) {
    e.preventDefault();
    busy = true; error = "";
    const r = await api("PATCH", "/api/collections/business/records/" + business.id, { time_zone: zone });
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    onsaved();
  }
</script>

<form class="card space-y-3" onsubmit={save}>
  <h2 class="text-xl font-bold">Clock</h2>
  <label class="block"><span class="text-sm text-muted">Store time zone</span>
    <select class="field" bind:value={zone}>{#each ZONES as z (z)}<option value={z}>{z.replace("America/", "").replace("_", " ")}</option>{/each}</select></label>
  {#if hubTime}
    <p><b>Hub time:</b> {show(hubTime)}</p>
    <p class={off ? "text-ok" : "font-semibold text-bad"}>
      {off ? "✓ This device and the hub agree (within 2 minutes)." : "The hub and this device differ by " + Math.round(Math.abs(offset) / 60000) + " minutes. Check the hub's clock on the Hub health page before selling."}
    </p>
  {:else}<p class="text-muted">Reading the hub's clock…</p>{/if}
  <p class="text-sm text-muted">Is the date and time above right for your store? Receipts, expiry dates and reports use it.</p>
  <StepActions {onskip} {busy} {error} saveLabel="The time is right: save" />
</form>

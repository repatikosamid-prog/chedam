<script>
  import { untrack } from "svelte";
  // FR-1.01 language. The interface is English for now (multi-language is out of scope, Section 3);
  // the choice is saved so receipts and later translations can follow it.
  import { api } from "../../lib/api.js";
  import { handleRefusal } from "../../lib/session.svelte.js";
  import StepActions from "../../components/StepActions.svelte";

  let { business: current, onsaved, onskip } = $props();
  const business = untrack(() => current);
  let language = $state(business.language || "en");
  let busy = $state(false), error = $state("");

  async function save(e) {
    e.preventDefault();
    busy = true; error = "";
    const r = await api("PATCH", "/api/collections/business/records/" + business.id, { language });
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    onsaved();
  }
</script>

<form class="card space-y-3" onsubmit={save}>
  <h2 class="text-xl font-bold">Language</h2>
  <label class="block"><span class="text-sm text-muted">Language of the store</span>
    <select class="field" bind:value={language}>
      <option value="en">English</option>
      <option value="en-CA">English (Canada)</option>
    </select></label>
  <p class="text-sm text-muted">Screens are in English for now. Products can have a French name for labels (bilingual labels).</p>
  <StepActions {onskip} {busy} {error} />
</form>

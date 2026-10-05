<script>
  import { untrack } from "svelte";
  // FR-1.13 optional external references. Names and reference numbers only: never bank account
  // numbers, card details or passwords.
  import { api } from "../../lib/api.js";
  import { handleRefusal } from "../../lib/session.svelte.js";
  import StepActions from "../../components/StepActions.svelte";

  let { business: current, onsaved, onskip } = $props();
  // The form starts from the saved values once (the step is re-created each time it opens)
  const business = untrack(() => current);
  const FIELDS = [
    ["bank_name", "Bank (name and branch)", "text"],
    ["processor", "Card payment processor", "text"],
    ["merchant_id", "Processor merchant ID", "text"],
    ["cra_payroll_account", "CRA payroll account (RP) number", "text"],
    ["cbsa_importer_number", "CBSA importer number (RM)", "text"],
    ["accountant_name", "Accountant name or firm", "text"],
    ["accountant_email", "Accountant email", "email"],
    ["accountant_phone", "Accountant phone", "tel"],
  ];
  const r0 = business.external_refs || {};
  let f = $state(Object.fromEntries(FIELDS.map(([k]) => [k, r0[k] || ""])));
  let busy = $state(false), error = $state("");

  async function save(e) {
    e.preventDefault();
    busy = true; error = "";
    const refs = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v));
    const r = await api("PATCH", "/api/collections/business/records/" + business.id, { external_refs: refs });
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    onsaved();
  }
</script>

<form class="card space-y-3" onsubmit={save}>
  <h2 class="text-xl font-bold">References (optional)</h2>
  <p>Handy for reports and for your accountant. <b>Never</b> enter bank account numbers, card numbers or passwords here.</p>
  <div class="grid gap-3 sm:grid-cols-2">
    {#each FIELDS as [k, label, type]}
      <div><label for="x-{k}" class="block text-sm font-semibold">{label}</label><input id="x-{k}" class="field" {type} bind:value={f[k]} maxlength="120" autocomplete="off" /></div>
    {/each}
  </div>
  <StepActions {onskip} {busy} {error} />
</form>

<script>
  // Staff discount (FR-5.20): the staff member buying for themselves picks their name and enters their own
  // PIN on the till; the hub gives a one-time staff approval (5 minutes) that only unlocks the staff
  // discount. Wrong PINs count toward their lockout.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import PinPad from "./PinPad.svelte";

  let { pct = 0, onDone, onCancel } = $props();
  let people = $state([]), who = $state(null), error = $state(""), busy = $state(false), pad = $state(null);

  onMount(async () => {
    const r = await api("GET", "/api/chedam/auth/pin-users");
    if (r.ok) people = r.json;
  });

  async function submit(pin) {
    busy = true; error = "";
    const r = await api("POST", "/api/chedam/sales/approvals", { user: who.id, pin, permission: "staff" }, { quiet: true });
    busy = false;
    if (!r.ok) { error = r.message; pad && pad.clear(true); return; }
    onDone({ approval: r.json.approval, name: r.json.by });
  }
</script>

<div class="card space-y-3 border-accent" role="dialog" aria-label="Staff sale">
  <h2 class="font-semibold">Staff sale{pct ? ": " + pct + "% off" : ""}</h2>
  <p class="text-sm text-muted">The staff member buying chooses their name and enters their own PIN. Recorded on the sale.</p>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if !who}
    <div class="flex flex-wrap gap-2">{#each people as p (p.id)}<button class="btn-ghost" onclick={() => (who = p)}>{p.name}</button>{/each}</div>
  {:else}
    <p>{who.name}: enter your PIN</p>
    <PinPad bind:this={pad} onsubmit={submit} {busy} />
  {/if}
  <button class="btn-ghost" onclick={onCancel}>Cancel</button>
</div>

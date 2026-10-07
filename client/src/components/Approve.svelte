<script>
  // Manager approval on the till (BR-18, DL-81): pick the manager, they enter their PIN; the hub gives
  // a one-time approval for 5 minutes. Wrong PINs count toward that manager's lockout.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import PinPad from "./PinPad.svelte";

  let { what = [], permission = "sales.approve", onApproved, onCancel } = $props();
  let people = $state([]), who = $state(null), error = $state(""), busy = $state(false);
  let pad = $state(null);

  onMount(async () => {
    const r = await api("GET", "/api/chedam/auth/pin-users");
    if (r.ok) people = r.json.filter((p) => /owner|manager/i.test(p.role));
  });

  async function submit(pin) {
    busy = true; error = "";
    const r = await api("POST", "/api/chedam/sales/approvals", { user: who.id, pin, permission });
    busy = false;
    if (!r.ok) { error = r.message; pad && pad.clear(true); return; }
    onApproved(r.json);
  }
</script>

<div class="card space-y-3 border-warn" role="dialog" aria-label="Manager approval">
  <h2 class="font-semibold">Manager approval needed</h2>
  {#if what.length}<ul class="list-disc pl-5 text-sm">{#each what as w, i (i)}<li>{w}</li>{/each}</ul>{/if}
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if !who}
    <div class="flex flex-wrap gap-2">
      {#each people as p (p.id)}<button class="btn-ghost" onclick={() => (who = p)}>{p.name}</button>{/each}
      {#if !people.length}<p class="text-muted">No manager can sign in on this device.</p>{/if}
    </div>
  {:else}
    <p>{who.name}: enter your PIN</p>
    <PinPad bind:this={pad} onsubmit={submit} {busy} />
  {/if}
  <button class="btn-ghost" onclick={onCancel}>Cancel</button>
</div>

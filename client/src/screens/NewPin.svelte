<script>
  // Choose your own PIN: required after signing in with a temporary PIN from a manager (forgot-PIN flow;
  // the hub refuses everything else until this is done), or by choice from My settings.
  import { api } from "../lib/api.js";
  import { s, signOut, notify, refresh, go } from "../lib/session.svelte.js";
  import PinPad from "../components/PinPad.svelte";

  let pad = $state();
  let first = $state("");
  let error = $state("");
  let busy = $state(false);
  const forced = $derived(!!(s.me && s.me.user.pin_must_change));

  async function submit(pin) {
    if (!first) { first = pin; error = ""; pad.clear(); return; }
    if (pin !== first) { first = ""; error = "The two PINs were different. Start again."; pad.clear(true); return; }
    busy = true;
    const r = await api("POST", "/api/chedam/users/" + s.me.user.id + "/pin", { pin });
    busy = false;
    first = "";
    if (!r.ok) { error = r.message; pad.clear(true); return; }
    s.me = null;
    notify("Your new PIN is set.", "ok");
    refresh();
  }
</script>

{#if s.me}
  <section class="card text-center">
    <h1 class="text-xl font-bold">{forced ? "Choose your own PIN" : "Change my PIN"}</h1>
    <p class="mx-auto max-w-80 text-muted">
      {#if forced}You signed in with a temporary PIN.{/if}
      {first ? "Enter the new PIN again to confirm." : "Enter a new PIN (4 to 6 digits, not 1234 or 1111)."}
    </p>
    {#if error}<p role="alert" class="mx-auto mt-2 max-w-72 rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
    <PinPad bind:this={pad} onsubmit={submit} {busy} label={first ? "Confirm new PIN" : "New PIN"} />
    {#if forced}
      <button class="btn-ghost mt-4" onclick={() => signOut()}>Cancel and sign out</button>
    {:else}
      <button class="btn-ghost mt-4" onclick={() => go("home")}>Cancel</button>
    {/if}
  </section>
{/if}

<script>
  // Sign-in step 2: PIN for the person picked on the name list.
  import { api } from "../lib/api.js";
  import { s, go, signedIn, handleRefusal } from "../lib/session.svelte.js";
  import { initials } from "../lib/labels.js";
  import PinPad from "../components/PinPad.svelte";

  let pad = $state();
  let error = $state("");
  let busy = $state(false);

  async function submit(pin) {
    busy = true;
    const r = await api("POST", "/api/chedam/auth/pin", { user: s.picked.id, pin });
    busy = false;
    if (r.ok) { s.picked = null; return signedIn(r.json); }
    pad.clear(true);
    if (r.status === 403 && /pair/i.test(r.message)) return handleRefusal(r);
    error = r.status === 0 ? "The hub is not answering. Check the Wi-Fi and try again." : r.message;
  }
</script>

{#if s.picked}
  <section class="card text-center">
    <span class="mx-auto mb-1 grid h-12 w-12 place-items-center rounded-full bg-soft text-lg font-bold text-accent" aria-hidden="true">{initials(s.picked.name)}</span>
    <h1 class="text-xl font-bold">{s.picked.name}</h1>
    <p class="text-muted">Enter your PIN</p>
    {#if error}<p role="alert" class="mx-auto mt-2 max-w-72 rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
    <PinPad bind:this={pad} onsubmit={submit} {busy} />
    <button class="btn-ghost mt-4" onclick={() => { s.picked = null; go("names"); }}>Not you? Back to names</button>
  </section>
{/if}

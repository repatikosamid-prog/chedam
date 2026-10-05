<script>
  // Sign-in step 1: pick your name (DL-28). Only on a paired device; an assigned device lists its person and the owner.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { s, go, handleRefusal } from "../lib/session.svelte.js";
  import { initials } from "../lib/labels.js";
  import { net } from "../lib/connectivity.svelte.js";

  let people = $state(null);
  let error = $state("");
  let showForgot = $state(false);

  async function loadNames() {
    const r = await api("GET", "/api/chedam/auth/pin-users");
    if (r.ok) { people = r.json; error = ""; return; }
    if (await handleRefusal(r)) return;
    error = r.status === 0 ? "The hub is not answering, so the name list cannot load. Check the Wi-Fi." : r.message;
  }
  onMount(loadNames);
  // Hub back after an outage: try again
  $effect(() => { if (net.hub === "ok" && error) loadNames(); });

  function pick(p) {
    s.picked = p;
    go("pin");
  }
</script>

<section>
  <h1 class="mb-3 text-xl font-bold">Who are you?</h1>
  {#if error}
    <p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>
  {:else if people === null}
    <p class="text-muted">Loading names…</p>
  {:else if people.length === 0}
    <p class="text-muted">Nobody has a PIN yet. The owner sets PINs in the setup wizard.</p>
  {:else}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
      {#each people as p (p.id)}
        <button class="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-card p-3 text-center"
          onclick={() => pick(p)}>
          <span class="grid h-10 w-10 place-items-center rounded-full bg-soft font-bold text-accent" aria-hidden="true">{initials(p.name)}</span>
          <span class="font-semibold">{p.name}</span>
          <span class="text-sm text-muted">{p.role}</span>
        </button>
      {/each}
    </div>
  {/if}

  <p class="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
    <button class="min-h-10 underline" onclick={() => go("owner")}>Owner: sign in with email and password</button>
    <button class="min-h-10 underline" aria-expanded={showForgot} onclick={() => (showForgot = !showForgot)}>Forgot your PIN?</button>
  </p>
  {#if showForgot}
    <div class="mt-2 rounded-xl bg-soft px-3 py-2">
      Ask a manager to give you a <b>temporary PIN</b>. Sign in with it once, then choose your own new PIN.
      The owner can also sign in with email and password, or with the printed recovery code.
    </div>
  {/if}
</section>

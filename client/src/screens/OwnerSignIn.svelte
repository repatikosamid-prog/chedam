<script>
  // FR-1.09: the owner signs in with email and password on any device, paired or not.
  import { api, load } from "../lib/api.js";
  import { go, signedIn } from "../lib/session.svelte.js";

  let email = $state("");
  let password = $state("");
  let error = $state("");
  let busy = $state(false);

  async function submit(e) {
    e.preventDefault();
    busy = true;
    const r = await api("POST", "/api/collections/users/auth-with-password", { identity: email, password });
    busy = false;
    password = "";
    if (!r.ok) { error = r.status === 400 ? "Wrong email or password." : r.message; return; }
    signedIn(r.json);
  }
</script>

<section class="card">
  <h1 class="mb-3 text-xl font-bold">Owner sign-in</h1>
  <form onsubmit={submit}>
    <label for="ow-email" class="mb-1 block font-semibold">Email</label>
    <input id="ow-email" class="field" type="email" bind:value={email} autocomplete="username" required />
    <label for="ow-pw" class="mt-3 mb-1 block font-semibold">Password</label>
    <input id="ow-pw" class="field" type="password" bind:value={password} autocomplete="current-password" required />
    {#if error}<p role="alert" class="mt-2 rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
    <button class="btn mt-4 w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
  </form>
  <button class="btn-ghost mt-3" onclick={() => go(load("device") ? "names" : "pair")}>Back</button>
</section>

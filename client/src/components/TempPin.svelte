<script>
  // Forgot PIN (Sreya, 2026-10-05): a manager gives someone a temporary PIN; at their next sign-in
  // they must choose their own. The hub decides who may do this for whom (BR-33).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { s, handleRefusal } from "../lib/session.svelte.js";

  let people = $state([]);
  let who = $state("");
  let pin = $state("");
  let msg = $state({ text: "", kind: "" });

  onMount(async () => {
    const r = await api("GET", "/api/collections/users/records?perPage=200&sort=name&filter=" + encodeURIComponent("status='active' && deleted_at=''"));
    if (r.ok) people = r.json.items.filter((p) => p.id !== s.me.user.id);
    else handleRefusal(r);
  });

  async function submit(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/users/" + who + "/pin", { pin });
    if (!r.ok) { msg = { text: r.message, kind: "bad" }; return; }
    const name = (people.find((p) => p.id === who) || {}).name;
    msg = { text: "Temporary PIN set for " + name + ". Tell them in person. It works for 24 hours, then they choose their own.", kind: "ok" };
    pin = ""; who = "";
  }
</script>

<details class="card">
  <summary class="min-h-10 cursor-pointer font-semibold">Someone forgot their PIN</summary>
  <form class="mt-2" onsubmit={submit}>
    <label for="tp-who" class="mb-1 block font-semibold">Person</label>
    <select id="tp-who" class="field" bind:value={who} required>
      <option value="" disabled>Choose…</option>
      {#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
    <label for="tp-pin" class="mt-3 mb-1 block font-semibold">Temporary PIN</label>
    <input id="tp-pin" class="field" bind:value={pin} inputmode="numeric" pattern="[0-9]{'{'}4,6{'}'}" maxlength="6" autocomplete="off" required />
    {#if msg.text}<p role="status" class="mt-2 rounded-xl px-3 py-2 {msg.kind === 'bad' ? 'bg-bad/10 text-bad' : 'bg-ok/10 text-ok'}">{msg.text}</p>{/if}
    <button class="btn mt-3">Set temporary PIN</button>
  </form>
</details>

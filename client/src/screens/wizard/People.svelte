<script>
  // FR-1.04 managers and staff: name, role, first PIN, contact. The PIN set here is temporary: each
  // person chooses their own at their first sign-in (DL-39). Pay details come with HR and Payroll.
  import { onMount } from "svelte";
  import { api } from "../../lib/api.js";
  import { s, handleRefusal } from "../../lib/session.svelte.js";
  import StepActions from "../../components/StepActions.svelte";

  let { onsaved, onskip } = $props();
  let people = $state([]);
  let roles = $state([]);
  let f = $state({ name: "", role: "", pin: "", phone: "", email: "" });
  let busy = $state(false), error = $state(""), added = $state("");

  async function load() {
    const [u, r] = await Promise.all([
      api("GET", "/api/collections/users/records?perPage=200&sort=name&expand=role&filter=" + encodeURIComponent("deleted_at=''")),
      api("GET", "/api/collections/roles/records?perPage=50&sort=-level"),
    ]);
    if (u.ok) people = u.json.items;
    if (r.ok) {
      roles = r.json.items.filter((x) => x.code !== "owner");
      if (!f.role) f.role = (roles.find((x) => x.code === "cashier") || roles[0] || {}).id;
    }
  }
  onMount(load);

  async function add(e) {
    e.preventDefault();
    busy = true; error = ""; added = "";
    const body = { name: f.name.trim(), role: f.role, phone: f.phone, status: "active", language: "en" };
    if (f.email) body.email = f.email;
    const r = await api("POST", "/api/collections/users/records", body);
    if (!r.ok) { busy = false; if (!(await handleRefusal(r))) error = r.message; return; }
    const p = await api("POST", "/api/chedam/users/" + r.json.id + "/pin", { pin: f.pin });
    busy = false;
    if (!p.ok) { error = "Added " + body.name + ", but the PIN was not accepted: " + p.message + " Set it later with \"Someone forgot their PIN\"."; }
    else added = body.name + " added. Tell them their first PIN in person; they choose their own when they first sign in.";
    f = { name: "", role: f.role, pin: "", phone: "", email: "" };
    load();
  }

  function finish(e) { e.preventDefault(); onsaved(); }
</script>

<div class="card space-y-4">
  <h2 class="text-xl font-bold">Your team</h2>
  <p>Add the people who work in the store. You can add more later.</p>

  <ul class="divide-y divide-line rounded-xl border border-line">
    {#each people as p (p.id)}
      <li class="flex min-h-12 items-center justify-between gap-3 px-3 py-2">
        <span class="font-semibold">{p.name}{p.id === s.me.user.id ? " (you)" : ""}</span>
        <span class="text-sm text-muted">{p.expand && p.expand.role ? p.expand.role.name : ""}{p.status !== "active" ? " · " + p.status : ""}</span>
      </li>
    {/each}
  </ul>

  <form class="space-y-3 rounded-xl border border-dashed border-line p-3" onsubmit={add}>
    <h3 class="font-semibold">Add a person</h3>
    <div class="grid gap-3 sm:grid-cols-2">
      <div><label for="p-name" class="block text-sm font-semibold">Name</label><input id="p-name" class="field" bind:value={f.name} maxlength="120" required /></div>
      <div><label for="p-role" class="block text-sm font-semibold">Role</label>
        <select id="p-role" class="field" bind:value={f.role}>{#each roles as r (r.id)}<option value={r.id}>{r.name}</option>{/each}</select></div>
      <div><label for="p-pin" class="block text-sm font-semibold">First PIN (4 to 6 digits)</label>
        <input id="p-pin" class="field" inputmode="numeric" bind:value={f.pin} maxlength="6" autocomplete="off" required /></div>
      <div><label for="p-phone" class="block text-sm font-semibold">Phone (optional)</label><input id="p-phone" class="field" type="tel" bind:value={f.phone} maxlength="40" /></div>
      <div class="sm:col-span-2"><label for="p-email" class="block text-sm font-semibold">Email (optional)</label><input id="p-email" class="field" type="email" bind:value={f.email} /></div>
    </div>
    {#if added}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{added}</p>{/if}
    {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
    <button class="btn-ghost" disabled={busy}>{busy ? "Adding…" : "Add person"}</button>
    <p class="text-sm text-muted">Pay details come later with the HR and Payroll feature.</p>
  </form>

  <form onsubmit={finish}>
    <StepActions {onskip} saveLabel="Done with the team" />
  </form>
</div>

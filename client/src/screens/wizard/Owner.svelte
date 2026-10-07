<script>
  // FR-1.03 owner account: name and email, password, PIN and the printed recovery code. A PIN works
  // only on paired devices; the owner can always sign in with email and password (FR-1.09).
  import { api, load } from "../../lib/api.js";
  import { s, go, handleRefusal } from "../../lib/session.svelte.js";
  import StepActions from "../../components/StepActions.svelte";

  let { onsaved, onskip } = $props();
  let name = $state(s.me ? s.me.user.name : ""), email = $state("");
  let oldPw = $state(""), newPw = $state(""), busy = $state(false), error = $state(""), ok = $state("");
  const paired = !!load("device");

  (async () => {
    const r = await api("GET", "/api/collections/users/records/" + s.me.user.id);
    if (r.ok) { email = r.json.email || ""; name = r.json.name; }
  })();

  async function save(e) {
    e.preventDefault();
    busy = true; error = ""; ok = "";
    const body = { name: name.trim() };
    if (email.trim()) body.email = email.trim();
    if (newPw) {
      if (newPw.length < 10) { busy = false; error = "Use at least 10 characters for the password."; return; }
      Object.assign(body, { oldPassword: oldPw, password: newPw, passwordConfirm: newPw });
    }
    const r = await api("PATCH", "/api/collections/users/records/" + s.me.user.id, body);
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.status === 400 && newPw ? "Check the current password. " + r.message : r.message; return; }
    if (newPw) { error = ""; ok = "Password changed: sign in again with the new one."; }
    s.me.user.name = name.trim();
    onsaved();
  }

  async function recovery() {
    if (!confirm("Make a new recovery code? The old one stops working.")) return;
    const r = await api("POST", "/api/chedam/owner/recovery-code");
    if (r.ok) { s.recoveryCode = r.json.code; go("recovery"); } else handleRefusal(r);
  }
</script>

<form class="card space-y-3" onsubmit={save}>
  <h2 class="text-xl font-bold">Owner account</h2>
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}
  <div class="grid gap-3 sm:grid-cols-2">
    <label class="block"><span class="text-sm text-muted">Your name</span><input class="field" bind:value={name} maxlength="120" required /></label>
    <label class="block"><span class="text-sm text-muted">Email (to sign in with your password)</span><input class="field" type="email" bind:value={email} autocomplete="username" /></label>
  </div>
  <details>
    <summary class="min-h-10 cursor-pointer font-semibold">Change your password</summary>
    <div class="mt-2 grid gap-3 sm:grid-cols-2">
      <label class="block"><span class="text-sm text-muted">Current password</span><input class="field" type="password" bind:value={oldPw} autocomplete="current-password" /></label>
      <label class="block"><span class="text-sm text-muted">New password (10+ characters)</span><input class="field" type="password" bind:value={newPw} autocomplete="new-password" /></label>
    </div>
  </details>
  <div class="rounded-xl bg-soft px-3 py-2 text-sm">
    <p><b>PIN:</b> you sign in on paired tills and phones with your name and PIN.
      {#if paired}<button type="button" class="underline" onclick={() => go("newpin")}>Change my PIN</button>
      {:else}Pair this device first to set or change your PIN here.{/if}</p>
    <p class="mt-1"><b>Recovery code:</b> printed once at setup; it opens your account if you forget your password.
      <button type="button" class="underline" onclick={recovery}>Print a new recovery code</button></p>
  </div>
  <StepActions {onskip} {busy} {error} />
</form>

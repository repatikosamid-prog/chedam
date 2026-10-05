<script>
  // Signed-in shell. Modules switched on for this store appear as tiles; their screens arrive in later
  // phases. P0 has the device manager. My settings: large text, high contrast (NFR-16/17), change PIN.
  import { onMount } from "svelte";
  import { api, load } from "../lib/api.js";
  import { s, go, can, signOut, applyPrefs, handleRefusal } from "../lib/session.svelte.js";
  import TempPin from "../components/TempPin.svelte";

  let modules = $state([]);
  let tasks = $state([]);
  let setupLeft = $state(0);
  let newCode = $state("");
  let installEvent = $state(null);
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;

  onMount(async () => {
    const r = await api("GET", "/api/collections/modules/records?perPage=100&sort=sort&filter=" + encodeURIComponent("enabled=true"));
    if (r.ok) modules = r.json.items;
    else handleRefusal(r);
    if (can("tasks.view")) {
      const t = await api("GET", "/api/collections/tasks/records?perPage=20&sort=-created_at&filter=" + encodeURIComponent("status='open' && deleted_at=''"));
      if (t.ok) tasks = t.json.items;
    }
    if (can("setup.run")) {
      const st = await api("GET", "/api/chedam/setup/status");
      if (st.ok && st.json.steps) setupLeft = st.json.steps.filter((x) => x.status !== "done").length;
    }
    const onPrompt = (e) => { e.preventDefault(); installEvent = e; };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  });

  async function setPref(field, value) {
    const r = await api("PATCH", "/api/collections/users/records/" + s.me.user.id, { [field]: value });
    if (r.ok) { s.me.user[field] = value; applyPrefs(s.me.user); }
    else handleRefusal(r);
  }

  async function recoveryCode() {
    if (!confirm("Make a new recovery code? The old one stops working.")) return;
    const r = await api("POST", "/api/chedam/owner/recovery-code");
    if (r.ok) { s.recoveryCode = r.json.code; go("recovery"); }
    else handleRefusal(r);
  }

  async function install() {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
  }
</script>

{#if s.me}
<section class="space-y-4">
  <div class="card flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold">Hello, {s.me.user.name}</h1>
      <p class="text-muted">{s.me.role ? s.me.role.name : ""}{s.device ? " · on " + s.device.name : " · on a browser that is not paired"}</p>
    </div>
    <button class="btn-ghost" onclick={() => signOut()}>Sign out</button>
  </div>

  {#if can("setup.run") && setupLeft > 0}
    <div class="card flex flex-wrap items-center justify-between gap-3 border-accent">
      <div>
        <h2 class="font-semibold">Finish setting up your store</h2>
        <p class="text-muted">{setupLeft} {setupLeft === 1 ? "step" : "steps"} left</p>
      </div>
      <button class="btn" onclick={() => go("wizard")}>Continue setup</button>
    </div>
  {/if}

  {#if tasks.length}
    <div class="card">
      <h2 class="mb-2 font-semibold">Tasks</h2>
      <ul class="divide-y divide-line">
        {#each tasks as t (t.id)}
          <li class="flex min-h-12 items-center justify-between gap-3 py-2">
            <span>{t.title}</span>
            {#if t.kind === "setup_incomplete" && can("setup.run")}<button class="btn-ghost min-h-10 text-sm" onclick={() => go("wizard")}>Do it</button>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div>
    <h2 class="mb-2 font-semibold">Your store</h2>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
      {#if can("setup.run")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("wizard")}>
          <span class="font-semibold">Store setup</span>
          <span class="text-sm text-muted">Profile, logo, team, features</span>
        </button>
      {/if}
      {#if can("backups.view")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("backups")}>
          <span class="font-semibold">Backups</span>
          <span class="text-sm text-muted">Last backup, back up now</span>
        </button>
      {/if}
      {#if can("devices.view")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("devices")}>
          <span class="font-semibold">Devices</span>
          <span class="text-sm text-muted">Pair, lock, sign out</span>
        </button>
      {/if}
      {#each modules as m (m.id)}
        <div class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-dashed border-line p-3" aria-disabled="true">
          <span class="font-semibold">{m.label}</span>
          <span class="text-sm text-muted">Coming in a later phase</span>
        </div>
      {/each}
    </div>
  </div>

  {#if can("users.manage")}<TempPin />{/if}

  <details class="card">
    <summary class="min-h-10 cursor-pointer font-semibold">My settings</summary>
    <div class="mt-2 space-y-3">
      <label class="flex min-h-12 items-center justify-between gap-3">
        <span>Large text</span>
        <input type="checkbox" class="h-6 w-6 accent-accent" checked={s.me.user.large_text} onchange={(e) => setPref("large_text", e.currentTarget.checked)} />
      </label>
      <label class="flex min-h-12 items-center justify-between gap-3">
        <span>High contrast</span>
        <input type="checkbox" class="h-6 w-6 accent-accent" checked={s.me.user.high_contrast} onchange={(e) => setPref("high_contrast", e.currentTarget.checked)} />
      </label>
      {#if load("device")}
        <button class="btn-ghost" onclick={() => go("newpin")}>Change my PIN</button>
      {/if}
      {#if s.me.role && s.me.role.code === "owner"}
        <button class="btn-ghost" onclick={recoveryCode}>Print a new recovery code</button>
      {/if}
    </div>
  </details>

  {#if !standalone}
    <div class="card">
      <h2 class="mb-1 font-semibold">Install Chedam on this device</h2>
      {#if installEvent}
        <p class="mb-3 text-muted">Opens like an app and starts even when the hub is briefly unreachable.</p>
        <button class="btn" onclick={install}>Install</button>
      {:else if ios}
        <p class="text-muted">In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>.</p>
      {:else}
        <p class="text-muted">Use the browser menu: <b>Install app</b> or <b>Add to Home screen</b>.</p>
      {/if}
    </div>
  {/if}
</section>
{/if}

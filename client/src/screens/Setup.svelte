<script>
  // First start of a new store (FR-1.01, 1.03): language, setup code from the hub's screen, clock check,
  // owner account. The hub then creates the business and the owner, and pairs this device (DL-44).
  import { api, VERSION } from "../lib/api.js";
  import { setupStarted } from "../lib/session.svelte.js";
  import { net, checkNow } from "../lib/connectivity.svelte.js";
  import { TYPES } from "../lib/labels.js";

  let part = $state(1);           // 1 welcome + code, 2 clock, 3 owner
  let language = $state("en");
  let code = $state("");
  let name = $state(""), email = $state(""), password = $state(""), password2 = $state("");
  let pin = $state(""), pin2 = $state("");
  let deviceName = $state(/iPhone|Android/.test(navigator.userAgent) ? "Owner's phone" : "Owner's computer");
  let deviceType = $state(/iPhone|Android/.test(navigator.userAgent) ? "phone" : "back_office_pc");
  let error = $state("");
  let busy = $state(false);

  const now = new Date();
  const deviceTime = $derived(now.toLocaleString());

  function next(e) {
    e.preventDefault();
    error = "";
    if (part === 1 && !/^[A-Za-z2-9]{4}-?[A-Za-z2-9]{4}$/.test(code.trim())) { error = "The setup code looks like ABCD-2345."; return; }
    if (part === 1) checkNow();
    part++;
  }

  async function start(e) {
    e.preventDefault();
    error = "";
    if (password !== password2) { error = "The two passwords are different."; return; }
    if (pin !== pin2) { error = "The two PINs are different."; return; }
    busy = true;
    const r = await api("POST", "/api/chedam/setup/start", {
      code, language, device_name: deviceName, device_type: deviceType, app_version: VERSION,
      owner: { name, email, password, pin },
    });
    busy = false;
    password = password2 = pin = pin2 = "";
    if (!r.ok) {
      error = r.message;
      if (/setup code/i.test(r.message)) part = 1;
      return;
    }
    setupStarted(r.json);
  }
</script>

<section class="space-y-4">
  <div>
    <p class="text-sm font-semibold text-accent">Set up your store · {part} of 3</p>
    <h1 class="text-2xl font-bold">
      {part === 1 ? "Welcome to Chedam" : part === 2 ? "Check the clock" : "Your owner account"}
    </h1>
  </div>

  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  {#if part === 1}
    <form class="card space-y-3" onsubmit={next}>
      <p>This hub is new. Let's set up your store. It takes about 10 minutes, and you can skip anything and finish it later.</p>
      <label for="lang" class="block font-semibold">Language</label>
      <select id="lang" class="field" bind:value={language}>
        <option value="en">English</option>
        <option value="fr" disabled>Français (coming later)</option>
      </select>
      <label for="code" class="block font-semibold">Setup code</label>
      <p class="text-sm text-muted">It is shown on the hub's screen (or ask whoever installed the hub).</p>
      <input id="code" class="field font-mono text-lg tracking-widest uppercase" bind:value={code} maxlength="9"
        autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-2345" required />
      <button class="btn w-full">Next</button>
    </form>
  {:else if part === 2}
    <form class="card space-y-3" onsubmit={next}>
      <p>Sales, receipts and reports use the time, so the hub's clock must be right.</p>
      <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt class="text-muted">This device</dt><dd>{deviceTime}</dd>
        <dt class="text-muted">Difference to the hub</dt>
        <dd>
          {#if net.hub !== "ok"}checking…
          {:else if Math.abs(net.skewMin) < 2}<span class="font-semibold text-ok">OK (under 2 minutes)</span>
          {:else}<span class="font-semibold text-bad">{Math.abs(net.skewMin)} minutes</span>{/if}
        </dd>
      </dl>
      {#if net.hub === "ok" && Math.abs(net.skewMin) >= 2}
        <p class="rounded-xl bg-warn/10 px-3 py-2">
          If this device shows the right time, the hub's clock is wrong. Connect the hub to the internet for a minute
          (it sets its clock by itself), or ask whoever installed it. You can continue and fix it later.
        </p>
      {/if}
      <button class="btn w-full">Next</button>
      <button type="button" class="btn-ghost w-full" onclick={() => (part = 1)}>Back</button>
    </form>
  {:else}
    <form class="card space-y-3" onsubmit={start}>
      <p>The owner can do everything and can sign in on any device with email and password.</p>
      <label for="o-name" class="block font-semibold">Your name</label>
      <input id="o-name" class="field" bind:value={name} autocomplete="name" maxlength="120" required />
      <label for="o-email" class="block font-semibold">Email</label>
      <input id="o-email" class="field" type="email" bind:value={email} autocomplete="email" required />
      <label for="o-pw" class="block font-semibold">Password (at least 10 characters)</label>
      <input id="o-pw" class="field" type="password" bind:value={password} autocomplete="new-password" minlength="10" required />
      <label for="o-pw2" class="block font-semibold">Password again</label>
      <input id="o-pw2" class="field" type="password" bind:value={password2} autocomplete="new-password" minlength="10" required />
      <label for="o-pin" class="block font-semibold">PIN for the till (4 to 6 digits)</label>
      <input id="o-pin" class="field" type="password" inputmode="numeric" bind:value={pin} maxlength="6" autocomplete="off" required />
      <label for="o-pin2" class="block font-semibold">PIN again</label>
      <input id="o-pin2" class="field" type="password" inputmode="numeric" bind:value={pin2} maxlength="6" autocomplete="off" required />
      <details>
        <summary class="min-h-10 cursor-pointer font-semibold">This device: {deviceName}</summary>
        <label for="d-name" class="mt-2 block font-semibold">Device name</label>
        <input id="d-name" class="field" bind:value={deviceName} maxlength="80" required />
        <label for="d-type" class="mt-2 block font-semibold">Type</label>
        <select id="d-type" class="field" bind:value={deviceType}>
          {#each Object.entries(TYPES) as [value, label]}<option {value}>{label}</option>{/each}
        </select>
      </details>
      <button class="btn w-full" disabled={busy}>{busy ? "Setting up…" : "Create the owner account"}</button>
      <button type="button" class="btn-ghost w-full" onclick={() => (part = 2)}>Back</button>
    </form>
  {/if}
</section>

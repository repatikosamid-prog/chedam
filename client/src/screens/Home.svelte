<script>
  import { live } from "../lib/live.svelte.js";
  // Signed-in shell. Modules switched on for this store appear as tiles; their screens arrive in later
  // phases. P0 has the device manager; P1 adds products, categories and tax. My settings: large text, high contrast (NFR-16/17), change PIN.
  import { onMount } from "svelte";
  import { api, load } from "../lib/api.js";
  import { s, go, can, signOut, applyPrefs, handleRefusal } from "../lib/session.svelte.js";
  import TempPin from "../components/TempPin.svelte";

  let modules = $state([]);
  let tasks = $state([]);
  let setupLeft = $state(0);
  let health = $state(null);
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
    if (can("health.view")) {
      const h = await api("GET", "/api/chedam/health");
      if (h.ok) health = h.json;
    }
    if (can("setup.run")) {
      const st = await api("GET", "/api/chedam/setup/status");
      if (st.ok && st.json.steps) setupLeft = st.json.steps.filter((x) => x.status !== "done").length;
    }
    const onPrompt = (e) => { e.preventDefault(); installEvent = e; };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  });

  // Pairing starts a fresh sign-in on this device (one person per device, DL-36).
  async function pairHere() {
    await signOut("");
    go("pair");
  }

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
    {#if s.brand && s.brand.logo}<img src={s.brand.logo} alt={s.brand.name} class="max-h-16 max-w-40 object-contain" onerror={(e) => (e.currentTarget.style.display = "none")} />{/if}
    <div class="mr-auto">
      <h1 class="text-xl font-bold">Hello, {s.me.user.name}</h1>
      <p class="text-muted">{s.me.role ? s.me.role.name : ""}{s.device ? " · on " + s.device.name : " · on a browser that is not paired"}</p>
    </div>
    <button class="btn-ghost" onclick={() => signOut()}>Sign out</button>
  </div>

  {#if !s.device}
    <div class="card flex flex-wrap items-center justify-between gap-3 border-warn">
      <div>
        <h2 class="font-semibold">This browser is not paired</h2>
        <p class="text-sm">You are signed in as the owner with your password, which works anywhere. Selling, the till and
          signing in with a PIN need a paired device. Pairing is remembered per address: use the same address
          (e.g. https://chedam.local) every time on this device.</p>
      </div>
      <button class="btn" onclick={pairHere}>Pair this browser</button>
    </div>
  {/if}

  {#if health && health.overall === "bad"}
    <div class="card flex flex-wrap items-center justify-between gap-3 border-bad">
      <div>
        <h2 class="font-semibold text-bad">The hub needs attention</h2>
        <p class="text-sm">{health.items.filter((i) => i.status === "bad").map((i) => i.label + ": " + i.value).join(" · ")}</p>
      </div>
      <button class="btn-ghost" onclick={() => go("health")}>Hub health</button>
    </div>
  {/if}

  {#if can("setup.run") && setupLeft > 0}
    <div class="card flex flex-wrap items-center justify-between gap-3 border-accent">
      <div>
        <h2 class="font-semibold">Finish setting up your store</h2>
        <p class="text-muted">{setupLeft} {setupLeft === 1 ? "step" : "steps"} left</p>
      </div>
      <button class="btn" onclick={() => go("wizard")}>Continue setup</button>
    </div>
  {/if}

  {#if live.toAck}
    <button class="w-full rounded-xl border border-warn bg-warn/10 px-3 py-2 text-left" onclick={() => go("messages")}>📌 <b>{live.toAck} announcement{live.toAck === 1 ? "" : "s"}</b> to read and confirm</button>
  {/if}
  {#if tasks.length}
    <div class="card">
      <h2 class="mb-2 font-semibold">Tasks</h2>
      <ul class="divide-y divide-line">
        {#each tasks as t (t.id)}
          <li class="flex min-h-12 items-center justify-between gap-3 py-2">
            <span>{t.title}</span>
            {#if t.kind === "setup_incomplete" && can("setup.run")}<button class="btn-ghost min-h-10 text-sm" onclick={() => go("wizard")}>Do it</button>{/if}
            {#if t.kind === "stock_approval" && can("stock.approve")}<button class="btn-ghost min-h-10 text-sm" onclick={() => go("approvals")}>Review</button>{/if}
            {#if t.kind === "till_variance" && can("till.manage")}<button class="btn-ghost min-h-10 text-sm" onclick={() => go("sales")}>Sales</button>{/if}
            {#if t.kind === "draft_products"}<button class="btn-ghost min-h-10 text-sm" onclick={() => { s.productFilter = "draft"; go("products"); }}>Show</button>{/if}
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
      {#if can("sales.sell")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-accent p-3 text-left text-accent-ink" onclick={() => go("sell")}>
          <span class="font-semibold">Sell</span>
          <span class="text-sm opacity-90">Till, payments, receipts</span>
        </button>
      {/if}
      <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("products")}>
        <span class="font-semibold">Products</span>
        <span class="text-sm text-muted">{can("catalogue.edit") ? "Add and edit products, packs, prices" : "Look up products and prices"}</span>
      </button>
      <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("stock")}>
        <span class="font-semibold">Stock</span>
        <span class="text-sm text-muted">{can("stock.receive") ? "Add stock by phone, counts, damage" : "What is in stock"}</span>
      </button>
      {#if can("health.view")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("health")}>
          <span class="font-semibold">Hub health {health ? (health.overall === "bad" ? "✗" : health.overall === "warn" ? "!" : "✓") : ""}</span>
          <span class="text-sm text-muted">Temperature, storage, clock, backups</span>
        </button>
      {/if}
      {#if can("updates.view")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("updates")}>
          <span class="font-semibold">Updates</span>
          <span class="text-sm text-muted">Check and install</span>
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
      {#if can("settings.manage")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("printers")}>
          <span class="font-semibold">Receipt printer</span>
          <span class="text-sm text-muted">Find, test, cash drawer, preview</span>
        </button>
      {/if}
      <!-- Modules whose screens are built have their own tiles above (Sell, Products, Stock). -->
      <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("roster")}>
        <span class="font-semibold">Roster</span>
        <span class="text-sm text-muted">The week's shifts, swaps</span>
      </button>
      <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("clock")}>
        <span class="font-semibold">Time clock</span>
        <span class="text-sm text-muted">Clock in and out, breaks, shifts</span>
      </button>
      <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("people")}>
        <span class="font-semibold">People</span>
        <span class="text-sm text-muted">Staff records, leave; my record</span>
      </button>
      {#if can("stock.approve") || can("purchasing.manage")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("recalls")}>
          <span class="font-semibold">Recalls</span>
          <span class="text-sm text-muted">Trace lots, who bought them, block and write off</span>
        </button>
      {/if}
      {#if can("sales.sell")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("delivery")}>
          <span class="font-semibold">Delivery orders</span>
          <span class="text-sm text-muted">Uber Eats, DoorDash, SkipTheDishes orders</span>
        </button>
      {/if}
      {#if can("sales.sell")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("orders")}>
          <span class="font-semibold">Customer orders</span>
          <span class="text-sm text-muted">Layaways, special orders, quotes</span>
        </button>
      {/if}
      <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("expenses")}>
        <span class="font-semibold">Expenses</span>
        <span class="text-sm text-muted">Claim what you paid; approve; petty cash</span>
      </button>
      {#if can("purchasing.view")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("buying")}>
          <span class="font-semibold">Buying</span>
          <span class="text-sm text-muted">Purchase orders, bills, vendor prices</span>
        </button>
      {/if}
      {#if can("parties.view")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("parties")}>
          <span class="font-semibold">Vendors and clients</span>
          <span class="text-sm text-muted">Contacts, terms, communication log, exchange rates</span>
        </button>
      {/if}
      <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("messages")}>
        <span class="font-semibold">Messages{live.unread ? " (" + live.unread + ")" : ""}</span>
        <span class="text-sm text-muted">Everyone, groups, one-to-one, announcements</span>
      </button>
      {#if can("tasks.view")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("team")}>
          <span class="font-semibold">Tasks and checklists</span>
          <span class="text-sm text-muted">Tasks, opening and closing, handover notes{can("documents.manage") ? ", licences" : ""}</span>
        </button>
      {/if}
      <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("dashboard")}>
        <span class="font-semibold">Dashboard</span>
        <span class="text-sm text-muted">{can("sales.view") ? "What needs attention, today, this month, stock" : "What needs attention, stock"}</span>
      </button>
      {#if can("sales.view") || can("till.manage") || can("events.view") || can("promotions.manage") || can("customers.manage")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("reports")}>
          <span class="font-semibold">Reports</span>
          <span class="text-sm text-muted">Tills, insights, loss prevention, promotions, loyalty, audit log</span>
        </button>
      {/if}
      {#if can("catalogue.edit") || can("data.export")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("data")}>
          <span class="font-semibold">Import and export</span>
          <span class="text-sm text-muted">Product file import, full data export</span>
        </button>
      {/if}
      {#if can("labels.manage") && modules.some((m) => m.module === "labels")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("labels")}>
          <span class="font-semibold">Labels</span>
          <span class="text-sm text-muted">Shelf labels: new prices, print, reprint</span>
        </button>
      {/if}
      {#if (can("promotions.manage") || can("sales.view")) && modules.some((m) => m.module === "promotions")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("promotions")}>
          <span class="font-semibold">Promotions</span>
          <span class="text-sm text-muted">Deals, coupons, scheduled prices</span>
        </button>
      {/if}
      {#if can("customers.view") && modules.some((m) => m.module === "customers_loyalty")}
        <button class="flex min-h-20 flex-col items-start justify-center rounded-2xl border border-accent bg-card p-3 text-left" onclick={() => go("customers")}>
          <span class="font-semibold">Customers</span>
          <span class="text-sm text-muted">Loyalty points, cards, programme</span>
        </button>
      {/if}
      {#each modules.filter((m) => !["sell", "stock", "labels", "promotions", "customers_loyalty"].includes(m.module)) as m (m.id)}
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

<script>
  import { onMount } from "svelte";
  import { s, refresh, signOut, notify, can } from "./lib/session.svelte.js";
  import { startMonitor, net } from "./lib/connectivity.svelte.js";
  import { startOffline, syncQueue, off } from "./lib/offline.svelte.js";
  import { load } from "./lib/api.js";
  import { watchIdle } from "./lib/idle.js";
  import ConnectivityBar from "./components/ConnectivityBar.svelte";
  import Pair from "./screens/Pair.svelte";
  import Waiting from "./screens/Waiting.svelte";
  import Names from "./screens/Names.svelte";
  import Pin from "./screens/Pin.svelte";
  import NewPin from "./screens/NewPin.svelte";
  import OwnerSignIn from "./screens/OwnerSignIn.svelte";
  import Home from "./screens/Home.svelte";
  import Devices from "./screens/Devices.svelte";
  import Printers from "./screens/Printers.svelte";
  import Returns from "./screens/Returns.svelte";
  import Labels from "./screens/Labels.svelte";
  import Setup from "./screens/Setup.svelte";
  import Recovery from "./screens/Recovery.svelte";
  import Wizard from "./screens/Wizard.svelte";
  import Backups from "./screens/Backups.svelte";
  import Health from "./screens/Health.svelte";
  import Updates from "./screens/Updates.svelte";
  import Products from "./screens/Products.svelte";
  import ProductEdit from "./screens/ProductEdit.svelte";
  import Categories from "./screens/Categories.svelte";
  import Tax from "./screens/Tax.svelte";
  import Stock from "./screens/Stock.svelte";
  import StockItem from "./screens/StockItem.svelte";
  import Receive from "./screens/Receive.svelte";
  import Counts from "./screens/Counts.svelte";
  import Approvals from "./screens/Approvals.svelte";
  import Shrink from "./screens/Shrink.svelte";
  import Sell from "./screens/Sell.svelte";
  import Till from "./screens/Till.svelte";
  import Sales from "./screens/Sales.svelte";

  onMount(() => {
    startMonitor();
    refresh();
    // Offline sales upload by themselves whenever the hub answers (FR-3.16).
    startOffline(() => !!s.me && can("sales.sell"), () => net.hub === "ok");
    // Re-check now and then, so a sign-out, lock or removal from the device manager shows here.
    const busyScreens = ["pin", "owner", "setup", "recovery", "wizard", "newpin", "product", "categories", "tax", "stockitem", "receive", "counts", "sell", "till", "sales", "returns"];
    const poll = setInterval(() => { if (!busyScreens.includes(s.screen)) refresh(); }, 30000);
    const stop = watchIdle(() => s.autoLockMin, () => !!s.me,
      () => signOut("Locked after " + s.autoLockMin + " minutes without use. Pick your name to continue."));
    const onHash = () => { if (s.me) refresh(); };
    window.addEventListener("hashchange", onHash);
    return () => { clearInterval(poll); stop(); window.removeEventListener("hashchange", onHash); };
  });

  // When the hub answers again after an outage, pick up where we were (session, device status).
  let wasDown = false;
  $effect(() => {
    if (net.hub === "down") wasDown = true;
    else if (net.hub === "ok" && wasDown) { wasDown = false; refresh(); if (off.pending) syncQueue(); }
  });

  // While waiting for approval or unlock, check more often.
  $effect(() => {
    if (s.screen !== "wait") return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  });
</script>

<div class="print:hidden"><ConnectivityBar /></div>

<main class="mx-auto w-full {s.screen === 'sell' ? 'max-w-6xl' : 'max-w-3xl'} px-4 pt-4 pb-12">
  <header class="mb-4 flex items-center justify-between gap-3 print:hidden">
    <div class="flex items-center gap-2">
      <img src="./icons/icon-192.png" alt="" class="h-8 w-8 rounded-lg" />
      <span class="text-lg font-bold">Chedam</span>
    </div>
    {#if s.device}
      <span class="truncate text-sm text-muted">{s.device.name}</span>
    {:else if s.me && !load("device")}
      <span class="text-sm text-muted">Not a paired device</span>
    {/if}
  </header>

  {#if s.notice.text}
    <div role="status" class="mb-4 flex items-start justify-between gap-3 rounded-xl px-3 py-2
      {s.notice.kind === 'bad' ? 'bg-bad/10 text-bad' : s.notice.kind === 'ok' ? 'bg-ok/10 text-ok' : 'bg-soft'}">
      <span>{s.notice.text}</span>
      <button class="min-h-8 px-2 text-sm underline" onclick={() => notify("")}>Close</button>
    </div>
  {/if}

  {#if s.screen === "boot"}
    <p class="text-muted">Starting…</p>
  {:else if s.screen === "pair"}<Pair />
  {:else if s.screen === "wait"}<Waiting />
  {:else if s.screen === "names"}<Names />
  {:else if s.screen === "pin"}<Pin />
  {:else if s.screen === "newpin"}<NewPin />
  {:else if s.screen === "owner"}<OwnerSignIn />
  {:else if s.screen === "home"}<Home />
  {:else if s.screen === "devices"}<Devices />
  {:else if s.screen === "printers"}<Printers />
  {:else if s.screen === "returns"}<Returns />
  {:else if s.screen === "labels"}<Labels />
  {:else if s.screen === "setup"}<Setup />
  {:else if s.screen === "recovery"}<Recovery />
  {:else if s.screen === "wizard"}<Wizard />
  {:else if s.screen === "backups"}<Backups />
  {:else if s.screen === "health"}<Health />
  {:else if s.screen === "updates"}<Updates />
  {:else if s.screen === "products"}<Products />
  {:else if s.screen === "product"}{#key s.productId}<ProductEdit />{/key}
  {:else if s.screen === "categories"}<Categories />
  {:else if s.screen === "tax"}<Tax />
  {:else if s.screen === "stock"}<Stock />
  {:else if s.screen === "stockitem"}{#key s.stockProductId}<StockItem />{/key}
  {:else if s.screen === "receive"}<Receive />
  {:else if s.screen === "counts"}<Counts />
  {:else if s.screen === "approvals"}<Approvals />
  {:else if s.screen === "shrink"}<Shrink />
  {:else if s.screen === "sell"}<Sell />
  {:else if s.screen === "till"}<Till />
  {:else if s.screen === "sales"}<Sales />
  {/if}
</main>

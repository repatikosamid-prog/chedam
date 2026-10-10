<script>
  import { onMount } from "svelte";
  import { s, refresh, signOut, notify, can, go, loadBrand } from "./lib/session.svelte.js";
  import { startMonitor, net } from "./lib/connectivity.svelte.js";
  import { startOffline, syncQueue, off } from "./lib/offline.svelte.js";
  import { load } from "./lib/api.js";
  import { watchIdle } from "./lib/idle.js";
  import ConnectivityBar from "./components/ConnectivityBar.svelte";
  import Toast from "./components/Toast.svelte";
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
  import ImportExport from "./screens/ImportExport.svelte";
  import Reports from "./screens/Reports.svelte";
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
  import Promotions from "./screens/Promotions.svelte";
  import Customers from "./screens/Customers.svelte";
  import Display from "./screens/Display.svelte";
  import Feedback from "./screens/Feedback.svelte";
  import Dashboard from "./screens/Dashboard.svelte";
  import Team from "./screens/Team.svelte";
  import Messages from "./screens/Messages.svelte";
  import Pings from "./screens/Pings.svelte";
  import Inbox from "./screens/Inbox.svelte";
  import Help from "./screens/Help.svelte";
  import People from "./screens/People.svelte";
  import Recalls from "./screens/Recalls.svelte";
  import Delivery from "./screens/Delivery.svelte";
  import Orders from "./screens/Orders.svelte";
  import Expenses from "./screens/Expenses.svelte";
  import Buying from "./screens/Buying.svelte";
  import Parties from "./screens/Parties.svelte";
  import PingOverlay from "./components/PingOverlay.svelte";
  import { live, startLive, stopLive } from "./lib/live.svelte.js";

  // A customer display window opened from Sell on this till (a second monitor): no sign-in, fed by the till.
  const localDisplay = location.hash === "#customer-display";
  // The receipt's feedback link (P3 step 10): a page anyone on the store's Wi-Fi can open, no sign-in
  const feedbackLink = location.hash.startsWith("#feedback/") ? location.hash.substring(10) : "";

  onMount(() => {
    if (localDisplay || feedbackLink) return;
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

  // The store's name and logo (DL-115), once someone is signed in.
  let brandFor = "";
  $effect(() => { const id = s.me && s.me.user ? s.me.user.id : ""; if (id && id !== brandFor) { brandFor = id; loadBrand(); } });

  // The top bar stays at the top while the page scrolls; each screen's own header row (Back, title and its
  // buttons, class "screen-head") stays right under it (app.css). Its height goes in --app-top.
  function trackHeight(node) {
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--app-top", node.offsetHeight + "px"));
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  }
  const signedIn = $derived(!!s.me && !["boot", "pair", "wait", "names", "pin", "newpin", "owner", "setup", "recovery"].includes(s.screen));
  let logoOk = $state(true);

  // Live messages and announcements while someone is signed in (P2-e)
  $effect(() => { if (s.me && s.me.user && !localDisplay && !feedbackLink) startLive(); else stopLive(); });

  // While waiting for approval or unlock, check more often.
  $effect(() => {
    if (s.screen !== "wait") return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  });
</script>

{#if feedbackLink}
<Feedback link={feedbackLink} />
{:else if s.screen === "kiosk"}
<Feedback />
{:else if localDisplay || s.screen === "display"}
<Display local={localDisplay} />
{:else}
<div class="app-top sticky top-0 z-40 bg-bg print:hidden" use:trackHeight>
  <ConnectivityBar />
  <header class="mx-auto flex w-full {s.screen === 'sell' ? 'max-w-6xl' : 'max-w-3xl'} items-center justify-between gap-3 px-4 py-1">
    <div class="flex min-w-0 items-center gap-2">
      {#if signedIn}
        <button class="flex min-h-12 items-center gap-2 rounded-xl pr-2" onclick={() => go("home")} aria-label="Home" title="Home">
          <img src="./icons/icon-192.png" alt="" class="h-8 w-8 rounded-lg" />
          <span class="text-lg font-bold">Chedam</span>
        </button>
      {:else}
        <img src="./icons/icon-192.png" alt="" class="h-8 w-8 rounded-lg" />
        <span class="text-lg font-bold">Chedam</span>
      {/if}
      {#if signedIn && s.brand && s.brand.logo && logoOk}
        <img src={s.brand.logo} alt={s.brand.name} class="h-8 max-w-28 object-contain" onerror={() => (logoOk = false)} />
      {/if}
    </div>
    {#if signedIn}
      <button class="flex min-h-12 shrink-0 items-center rounded-xl px-2 text-lg font-bold" onclick={() => { s.helpFor = s.screen; go("help"); }} aria-label="Help for this screen" title="Help">?</button>
      <button class="relative flex min-h-12 shrink-0 items-center gap-1 rounded-xl px-2" onclick={() => go("inbox")} aria-label={"Inbox" + (live.inbox ? ", " + live.inbox + " unread" : "")} title="Inbox">
        <span aria-hidden="true" class="text-xl">📥</span>{#if live.inbox}<span class="rounded-full bg-accent px-1.5 text-xs font-bold text-accent-ink">{live.inbox}</span>{/if}</button>
      <button class="flex min-h-12 shrink-0 items-center rounded-xl px-2 text-xl" onclick={() => go("pings")} aria-label="Ping another device" title="Ping"><span aria-hidden="true">📣</span></button>
      <button class="relative flex min-h-12 shrink-0 items-center gap-1 rounded-xl px-2 {live.toAck ? 'text-warn' : ''}" onclick={() => go("messages")}
        aria-label={"Messages" + (live.unread ? ", " + live.unread + " unread" : "") + (live.toAck ? ", announcements to confirm" : "")} title="Messages">
        <span aria-hidden="true" class="text-xl">💬</span>
        {#if live.unread || live.toAck}<span class="rounded-full px-1.5 text-xs font-bold {live.mentioned || live.toAck ? 'bg-warn text-white' : 'bg-accent text-accent-ink'}">{live.toAck ? "📌" : ""}{live.unread || ""}</span>{/if}
      </button>
    {/if}
    {#if s.device}
      <span class="truncate text-sm text-muted">{s.device.name}</span>
    {:else if s.me && !load("device")}
      <span class="text-sm text-muted">Not a paired device</span>
    {/if}
  </header>
</div>
<Toast />
{#if signedIn && s.device}<PingOverlay />{/if}

<main class="mx-auto w-full {s.screen === 'sell' ? 'max-w-6xl' : 'max-w-3xl'} px-4 pt-2 pb-12">

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
  {:else if s.screen === "data"}<ImportExport />
  {:else if s.screen === "reports"}<Reports />
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
  {:else if s.screen === "promotions"}<Promotions />
  {:else if s.screen === "customers"}<Customers />
  {:else if s.screen === "dashboard"}<Dashboard />
  {:else if s.screen === "team"}<Team />
  {:else if s.screen === "messages"}<Messages />
  {:else if s.screen === "pings"}<Pings />
  {:else if s.screen === "inbox"}<Inbox />
  {:else if s.screen === "parties"}<Parties />
  {:else if s.screen === "buying"}<Buying />
  {:else if s.screen === "expenses"}<Expenses />
  {:else if s.screen === "orders"}<Orders />
  {:else if s.screen === "delivery"}<Delivery />
  {:else if s.screen === "recalls"}<Recalls />
  {:else if s.screen === "people"}<People />
  {:else if s.screen === "help"}{#key s.helpFor}<Help />{/key}
  {/if}
</main>
{/if}

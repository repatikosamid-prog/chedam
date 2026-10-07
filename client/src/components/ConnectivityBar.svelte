<script>
  // FR-12.01: Offline / Online (router) / Online (hotspot), plus "hub not reachable" and a clock warning.
  import { net, checkNow } from "../lib/connectivity.svelte.js";
  import { off } from "../lib/offline.svelte.js";

  const n = (k) => (k ? k + (k === 1 ? " sale" : " sales") : "") + (off.tills ? (k ? " and " : "") + "the till opening" : "");
  const look = $derived(
    net.hub === "down" ? { text: "Hub not reachable. Selling on this device only" + (off.pending || off.tills ? " · " + n(off.pending) + " waiting to upload" : "") + ".", cls: "bg-warn text-bg", dot: "bg-bg" }
    : off.pending || off.tills ? { text: off.syncing ? "Uploading " + n(off.pending) + "…" : n(off.pending) + " made offline, waiting to upload", cls: "bg-warn/20 text-ink", dot: "bg-warn" }
    : net.hub === "checking" ? { text: "Checking the connection…", cls: "bg-soft text-ink", dot: "bg-muted" }
    : net.internet === "router" ? { text: "Online (router)", cls: "bg-soft text-ink", dot: "bg-ok" }
    : net.internet === "hotspot" ? { text: "Online (hotspot)", cls: "bg-soft text-ink", dot: "bg-warn" }
    : { text: "Offline. Store network only; internet services wait.", cls: "bg-soft text-ink", dot: "bg-muted" }
  );
</script>

<div class="sticky top-0 z-10 {look.cls}" role="status" aria-live="polite">
  <div class="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-1.5 text-sm">
    <span class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full {look.dot}" aria-hidden="true"></span>
      {look.text}
    </span>
    <button class="min-h-8 rounded-lg px-2 underline" onclick={checkNow} disabled={net.busy}>{net.busy ? "Checking…" : "Check"}</button>
  </div>
  {#if net.untrusted}
    <div class="bg-warn px-4 py-1.5 text-center text-sm text-bg" role="alert">
      This device does not trust the hub's certificate yet, so offline mode and the camera will not work.
      <a class="font-semibold underline" href={"http://" + location.hostname + "/device-setup.html"}>Install the certificate</a>
    </div>
  {/if}
  {#if net.hub === "ok" && Math.abs(net.skewMin) >= 2}
    <div class="bg-warn px-4 py-1 text-center text-sm text-bg">
      This device's clock is {Math.abs(net.skewMin)} min {net.skewMin > 0 ? "ahead of" : "behind"} the hub. Please correct it.
    </div>
  {/if}
</div>

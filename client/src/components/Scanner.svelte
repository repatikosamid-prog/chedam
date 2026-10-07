<script>
  // Camera scanner (FR-6.02): back camera, torch when the phone has one, continuous mode for the bulk
  // grid (FR-6.04: the same code is not repeated within 1.5 s). Typing or a USB scanner works too.
  import { onMount } from "svelte";
  import { makeReader, cameraProblem } from "../lib/scan.js";

  let { onCode, onClose, continuous = false } = $props();
  let video = $state(null);
  let problem = $state(""), torch = $state(false), torchOk = $state(false), engine = $state(""), last = $state("");
  let typed = $state("");
  let stream = null, track = null, stopped = false;

  onMount(() => {
    start();
    return stop;
  });

  async function start() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error("no camera API"), { name: window.isSecureContext ? "NotFoundError" : "SecurityError" });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      track = stream.getVideoTracks()[0];
      try { torchOk = !!(track.getCapabilities && track.getCapabilities().torch); } catch { torchOk = false; }
      video.srcObject = stream;
      await video.play();
      const reader = await makeReader();
      engine = reader.kind;
      let seen = "", seenAt = 0;
      const loop = async () => {
        if (stopped) return;
        let code = "";
        try { code = await reader.read(video); } catch { code = ""; }
        if (code && (code !== seen || Date.now() - seenAt > 1500)) {
          seen = code; seenAt = Date.now(); last = code;
          if (navigator.vibrate) navigator.vibrate(60);
          onCode(code);
          if (!continuous) { close(); return; }
        }
        setTimeout(loop, 120);
      };
      loop();
    } catch (err) {
      problem = cameraProblem(err);
    }
  }

  function stop() {
    stopped = true;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function close() { stop(); onClose && onClose(); }

  async function toggleTorch() {
    torch = !torch;
    try { await track.applyConstraints({ advanced: [{ torch }] }); } catch { torchOk = false; }
  }

  function submitTyped(e) {
    e.preventDefault();
    const c = typed.trim();
    if (!c) return;
    typed = "";
    last = c;
    onCode(c);
    if (!continuous) close();
  }
</script>

<div class="card space-y-3 border-accent" role="dialog" aria-label="Scan a barcode">
  {#if problem}
    <p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{problem}</p>
  {:else}
    <div class="relative overflow-hidden rounded-xl bg-black">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} class="block max-h-[50vh] w-full object-cover" playsinline muted></video>
      <div class="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" aria-hidden="true"></div>
    </div>
    <p class="text-sm text-muted">Point the camera at the barcode{engine ? " · " + engine : ""}{last ? " · last: " + last : ""}</p>
  {/if}
  <form class="flex gap-2" onsubmit={submitTyped}>
    <label class="sr-only" for="typed-code">Type a barcode or PLU</label>
    <input id="typed-code" class="field" bind:value={typed} inputmode="numeric" autocomplete="off" placeholder="Type or USB-scan a code" />
    <button class="btn-ghost" type="submit">Add</button>
  </form>
  <div class="flex flex-wrap gap-2">
    {#if torchOk}<button type="button" class="btn-ghost" onclick={toggleTorch}>{torch ? "Torch off" : "Torch on"}</button>{/if}
    <button type="button" class="btn-ghost" onclick={close}>{continuous ? "Done scanning" : "Close"}</button>
  </div>
</div>

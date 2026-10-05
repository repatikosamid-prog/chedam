<script>
  // On-screen PIN pad (also takes digits, Backspace and Enter from a keyboard). 4-6 digits.
  let { onsubmit, busy = false, label = "PIN" } = $props();
  let pin = $state("");
  let shaking = $state(false);

  export function clear(shake = false) {
    pin = "";
    if (shake) { shaking = false; requestAnimationFrame(() => (shaking = true)); }
  }

  function press(k) {
    if (busy) return;
    if (k === "back") pin = pin.slice(0, -1);
    else if (k === "ok") { if (pin.length >= 4) onsubmit(pin); }
    else if (pin.length < 6) pin += k;
  }

  function onkeydown(e) {
    if (e.target && e.target.tagName === "INPUT") return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") press("back");
    else if (e.key === "Enter") press("ok");
  }

  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "ok"];
</script>

<svelte:window {onkeydown} />

<div class="flex justify-center gap-3 py-4" role="img" aria-label="{label}: {pin.length} of up to 6 digits entered">
  {#each Array(Math.max(4, pin.length)) as _, i}
    <span class="h-4 w-4 rounded-full border-2 {i < pin.length ? 'border-ink bg-ink' : 'border-muted'}"></span>
  {/each}
</div>

<div class="mx-auto grid max-w-72 grid-cols-3 gap-3 {shaking ? 'shake' : ''}" onanimationend={() => (shaking = false)}>
  {#each KEYS as k}
    {#if k === "ok"}
      <button type="button" class="btn min-h-16 text-base" disabled={busy || pin.length < 4} onclick={() => press(k)}>OK</button>
    {:else if k === "back"}
      <button type="button" class="min-h-16 rounded-xl border border-line bg-card text-2xl" aria-label="Delete last digit" onclick={() => press(k)}>⌫</button>
    {:else}
      <button type="button" class="min-h-16 rounded-xl border border-line bg-card text-2xl font-semibold" onclick={() => press(k)}>{k}</button>
    {/if}
  {/each}
</div>

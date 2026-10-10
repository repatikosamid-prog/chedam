<script>
  // Customer feedback (P3 step 10, FR-7.09): stars and a comment. kiosk: a tablet paired as a kiosk (nobody signs
  // in), thanks then ready for the next person; link: the receipt's link ("#feedback/<sale>-<code>"), once.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";

  let { link = "" } = $props();
  let question = $state("How was your visit today?"), store = $state(""), rating = $state(0), comment = $state(""), done = $state(""), error = $state(""), busy = $state(false);
  onMount(async () => {
    const r = await api("GET", "/api/chedam/feedback/question", null, { quiet: true });
    if (r.ok) { question = r.json.question; store = r.json.store; }
  });
  async function send() {
    if (!rating) { error = "Tap the stars first."; return; }
    busy = true; error = "";
    const [sale, code] = link ? link.split("-") : ["", ""];
    const r = await api("POST", "/api/chedam/feedback", { rating, comment, sale: sale || undefined, code: code || undefined }, { quiet: true });
    busy = false;
    if (!r.ok) { error = r.message; return; }
    done = "Thank you!";
    if (!link) setTimeout(() => { done = ""; rating = 0; comment = ""; }, 4000);
  }
</script>

<div class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 overflow-auto bg-bg p-6 text-center text-ink">
  {#if store}<p class="text-2xl font-bold">{store}</p>{/if}
  {#if done}
    <p class="text-5xl font-bold">{done}</p>
    <p class="text-xl text-muted">{link ? "You can close this page." : "We read every comment."}</p>
  {:else}
    <p class="text-3xl font-semibold">{question}</p>
    <div class="flex gap-2" role="radiogroup" aria-label="Stars">
      {#each [1, 2, 3, 4, 5] as n (n)}<button class="text-6xl {n <= rating ? 'text-warn' : 'text-line'}" role="radio" aria-checked={rating === n} aria-label={n + " star" + (n > 1 ? "s" : "")} onclick={() => (rating = n)}>★</button>{/each}
    </div>
    <textarea class="field max-w-xl text-lg" rows="3" maxlength="1000" bind:value={comment} placeholder="Anything to tell us? (optional, no names please)" aria-label="Comment"></textarea>
    {#if error}<p role="alert" class="text-bad">{error}</p>{/if}
    <button class="btn min-h-14 px-10 text-xl" disabled={busy} onclick={send}>Send</button>
  {/if}
</div>

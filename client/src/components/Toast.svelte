<script>
  // The pop-up from lib/toast.svelte.js, bottom centre, above everything.
  import { t } from "../lib/toast.svelte.js";
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 print:hidden" role="status" aria-live="polite">
  {#if t.text}
    {#key t.n}
      <p class="pointer-events-auto rounded-xl px-4 py-2 font-semibold text-white shadow-lg {t.kind === 'bad' ? 'bg-bad' : 'bg-ok'}">{t.text}</p>
    {/key}
  {/if}
</div>

<script>
  // FR-1.03: the owner's recovery code is shown once, to print or write down. It replaces a forgotten
  // password and PIN, and works once.
  import { s, go } from "../lib/session.svelte.js";
  let kept = $state(false);
  const next = s.me && s.me.permissions && s.me.permissions["setup.run"] ? "wizard" : "home";
</script>

<section class="card space-y-3 text-center print:border-0">
  <h1 class="text-2xl font-bold">Your recovery code</h1>
  <p class="mx-auto max-w-md">
    If you ever forget your password and PIN, this code lets you back in. It is shown <b>only now</b> and works once.
    Print it or write it down, and keep it somewhere safe, away from the till.
  </p>
  <p class="font-mono text-2xl font-bold tracking-wider break-all sm:text-3xl" aria-label="Recovery code">{s.recoveryCode}</p>
  {#if s.me}<p class="text-sm text-muted">Store owner: {s.me.user.name}</p>{/if}
  <div class="print:hidden space-y-3">
    <button class="btn-ghost" onclick={() => window.print()}>Print</button>
    <label class="mx-auto flex min-h-12 max-w-md items-center justify-center gap-3">
      <input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={kept} />
      <span>I have printed it or written it down</span>
    </label>
    <button class="btn w-full" disabled={!kept} onclick={() => { s.recoveryCode = ""; go(next); }}>Continue</button>
  </div>
</section>

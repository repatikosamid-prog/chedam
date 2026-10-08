<script>
  // "Export" on a list (FR-11.09): the rows as shown, to CSV, Excel or PDF.
  // columns: [{key, label, value?(row)}]; rows: the list as shown (after filters).
  import { exportList } from "../lib/export.js";

  let { title, columns, rows } = $props();
  let open = $state(false), busy = $state(false), error = $state("");

  async function go(format) {
    busy = true; error = "";
    try { await exportList(title, columns, rows, format); open = false; } catch (e) { error = e.message; }
    busy = false;
  }
</script>

<div class="relative inline-block">
  <button class="btn-ghost min-h-10 text-sm" disabled={!rows.length || busy} onclick={() => (open = !open)} aria-expanded={open}>{busy ? "Exporting…" : "Export"}</button>
  {#if open}
    <div class="absolute right-0 z-20 mt-1 flex flex-col rounded-xl border border-line bg-card p-1 shadow">
      {#each [["csv", "CSV"], ["xlsx", "Excel"], ["pdf", "PDF"]] as [f, t] (f)}
        <button class="min-h-10 rounded-lg px-4 text-left hover:bg-soft" onclick={() => go(f)}>{t} ({rows.length} rows)</button>
      {/each}
    </div>
  {/if}
  {#if error}<p class="text-sm text-bad">{error}</p>{/if}
</div>

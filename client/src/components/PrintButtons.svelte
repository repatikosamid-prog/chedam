<script>
  // Receipt printing (FR-3.13) on the store's network printer through the hub; the browser's print is the
  // fallback (sale not on the hub yet, no printer, printer not answering). auto: print once the sale is
  // paid, opening the drawer for cash. From the store's threshold the buyer's name can be added for a
  // full GST/HST receipt (NFR-14). Reprints are marked COPY and counted on the hub.
  import { onMount } from "svelte";
  import { money } from "../lib/catalogue.js";
  import { pr, loadPrinter, printSale } from "../lib/printer.svelte.js";

  let { sale, auto = false, local = false, reprint = false } = $props();
  let msg = $state(""), bad = $state(false), busy = $state(false), printed = $state(0), buyer = $state(null);

  const hubPrint = $derived(!local && !!pr.mine);
  const full = $derived(hubPrint && sale.total_cents >= (pr.options.full_receipt_cents || 15000));

  async function print(body) {
    busy = true;
    const r = await printSale(sale.id, { reprint: reprint || printed > 0, ...body });
    busy = false;
    bad = !r.printed;
    msg = r.printed ? "Printed on " + r.printer + (r.copy ? " (copy " + r.copy + ")" : "") + (r.drawer ? " · drawer opened" : "") : r.error;
    if (r.printed) printed++;
  }

  onMount(async () => {
    if (local) return;
    await loadPrinter();
    if (auto && pr.mine && pr.options.auto_print) {
      const cash = (sale.payments || []).some((p) => (p.method === "cash" || p.method === "usd_cash") && p.status === "approved");
      print({ kick: cash });
    }
  });
</script>

<div class="space-y-2 print:hidden">
  <div class="flex flex-wrap justify-center gap-2">
    {#if hubPrint}<button class="btn-ghost" disabled={busy} onclick={() => print({})}>{busy ? "Printing…" : reprint || printed ? "Reprint" : "Print receipt"}</button>{/if}
    <button class="btn-ghost" onclick={() => window.print()}>{hubPrint ? "Print on this device" : reprint ? "Reprint" : "Print receipt"}</button>
    {#if full && buyer === null}<button class="btn-ghost" onclick={() => (buyer = "")}>Full tax receipt (name)</button>{/if}
  </div>
  {#if buyer !== null}
    <form class="flex flex-wrap items-end justify-center gap-2" onsubmit={(e) => { e.preventDefault(); print({ buyer }); buyer = null; }}>
      <label class="block text-left"><span class="text-sm text-muted">Customer's name (sales of {money(pr.options.full_receipt_cents)} or more)</span>
        <input class="field" bind:value={buyer} maxlength="80" required /></label>
      <button class="btn" type="submit" disabled={busy}>Print</button>
      <button class="btn-ghost" type="button" onclick={() => (buyer = null)}>Cancel</button>
    </form>
  {/if}
  {#if msg}<p class="rounded-xl px-3 py-2 text-sm {bad ? 'bg-bad/10 text-bad' : 'bg-ok/10 text-ok'}" role="status">{msg}</p>{/if}
</div>

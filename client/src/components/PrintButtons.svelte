<script>
  // Receipt printing (FR-3.13) on the store's network printer through the hub; the browser's print is the
  // fallback (sale not on the hub yet, no printer, printer not answering). auto: print once the sale is
  // paid, opening the drawer for cash. From the store's threshold the buyer's name can be added for a
  // full GST/HST receipt (NFR-14). Reprints are marked COPY and counted on the hub. kind "return": a
  // return slip (the drawer opens for a cash refund).
  // Reprints need a manager (security): a manager's PIN on the till, unless the person signed in may
  // approve. A browser reprint is checked and counted on the hub too. Offline receipts (local) are
  // printed by this device only. "Save as PDF" (DL-116) gives the same receipt as the printer's, as a PDF to keep
  // or print anywhere; a second copy counts as a reprint.
  import { onMount } from "svelte";
  import { money } from "../lib/catalogue.js";
  import { api } from "../lib/api.js";
  import { download } from "../lib/export.js";
  import { can } from "../lib/session.svelte.js";
  import { pr, loadPrinter, printSale, printReturn } from "../lib/printer.svelte.js";
  import Approve from "./Approve.svelte";

  let { sale, auto = false, local = false, reprint = false, kind = "sale" } = $props();
  let msg = $state(""), bad = $state(false), busy = $state(false), printed = $state(0), buyer = $state(null);
  let localPrinted = $state(0), need = $state(null);            // need: {where: "hub"|"device", body} waiting for a manager
  const again = $derived(reprint || printed > 0 || localPrinted > 0);

  // A reprint without approval rights asks a manager first.
  function ask(where, body = {}) {
    if (again && !local && !can("sales.approve")) { need = { where, body }; return; }
    go(where, body);
  }

  async function go(where, body, approval) {
    need = null;
    if (where === "hub") return print({ ...body, approval });
    let copy = 0;
    if (again && !local) {
      const r = await api("POST", `/api/chedam/${kind === "return" ? "returns" : "sales"}/${sale.id}/reprint`, { approval }, { quiet: true });
      if (!r.ok) { bad = true; msg = r.message; return; }
      copy = r.json.copy;
    }
    localPrinted++;
    if (where === "pdf") return savePdf(copy);
    window.print();
  }

  async function savePdf(copy) {
    try {
      const { receiptPdf } = await import("../lib/receipt_pdf.js");
      const doc = await receiptPdf(sale, { kind, copy });
      download((kind === "return" ? "return-" : "receipt-") + (sale.number || sale.id) + (copy ? "-copy" + copy : "") + ".pdf", doc.output("blob"));
      bad = false; msg = "Saved as PDF" + (copy ? " (copy " + copy + ")" : "") + ".";
    } catch (e) { bad = true; msg = "The PDF could not be made: " + e.message; }
  }

  const hubPrint = $derived(!local && !!pr.mine);
  const full = $derived(kind === "sale" && hubPrint && sale.total_cents >= (pr.options.full_receipt_cents || 15000));

  async function print(body) {
    busy = true;
    const r = await (kind === "return" ? printReturn : printSale)(sale.id, { reprint: again, ...body });
    busy = false;
    bad = !r.printed;
    msg = r.printed ? "Printed on " + r.printer + (r.copy ? " (copy " + r.copy + ")" : "") + (r.drawer ? " · drawer opened" : "") : r.error;
    if (r.printed) printed++;
  }

  onMount(async () => {
    if (local) return;
    await loadPrinter();
    if (auto && pr.mine && pr.options.auto_print) {
      const cash = kind === "return" ? (sale.refunds || []).some((x) => x.method === "cash")
        : (sale.payments || []).some((p) => (p.method === "cash" || p.method === "usd_cash") && p.status === "approved");
      print({ kick: cash });
    }
  });
</script>

<div class="space-y-2 print:hidden">
  <div class="flex flex-wrap justify-center gap-2">
    {#if hubPrint}<button class="btn-ghost" disabled={busy} onclick={() => ask("hub")}>{busy ? "Printing…" : again ? "Reprint" : kind === "return" ? "Print return slip" : "Print receipt"}</button>{/if}
    <button class="btn-ghost" onclick={() => ask("device")}>{hubPrint ? (again ? "Reprint on this device" : "Print on this device") : again ? "Reprint" : "Print receipt"}</button>
    <button class="btn-ghost" onclick={() => ask("pdf")}>Save as PDF</button>
    {#if full && buyer === null}<button class="btn-ghost" onclick={() => (buyer = "")}>Full tax receipt (name)</button>{/if}
  </div>
  {#if need}
    <Approve what={["Reprint " + (sale.number || "this receipt")]} onApproved={(a) => go(need.where, need.body, a.approval)} onCancel={() => (need = null)} />
  {/if}
  {#if buyer !== null}
    <form class="flex flex-wrap items-end justify-center gap-2" onsubmit={(e) => { e.preventDefault(); ask("hub", { buyer }); buyer = null; }}>
      <label class="block text-left"><span class="text-sm text-muted">Customer's name (sales of {money(pr.options.full_receipt_cents)} or more)</span>
        <input class="field" bind:value={buyer} maxlength="80" required /></label>
      <button class="btn" type="submit" disabled={busy}>Print</button>
      <button class="btn-ghost" type="button" onclick={() => (buyer = null)}>Cancel</button>
    </form>
  {/if}
  {#if msg}<p class="rounded-xl px-3 py-2 text-sm {bad ? 'bg-bad/10 text-bad' : 'bg-ok/10 text-ok'}" role="status">{msg}</p>{/if}
</div>

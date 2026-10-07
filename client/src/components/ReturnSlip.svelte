<script>
  // Return slip on screen and for the browser's print (the network printer prints the same from the hub,
  // lib/receipt_layout.js returnReceipt): what came back, tax refunded by type, how it was refunded,
  // store credit code.
  import { money } from "../lib/catalogue.js";
  import { METHOD } from "../lib/till.js";

  let { ret } = $props();
  const b = $derived(ret.business || {});
  const when = $derived(ret.completed_at ? new Date(ret.completed_at.replace(" ", "T")).toLocaleString() : "");
  const qtyText = (q) => (Number.isInteger(q) ? q : q.toFixed(3));
</script>

<div class="receipt mx-auto max-w-sm rounded-xl border border-line bg-white p-4 font-mono text-sm text-black">
  <div class="text-center">
    <p class="font-bold">{b.name}</p>
    {#if b.header}<p class="whitespace-pre-line">{b.header}</p>{/if}
    {#if b.gst_number}<p>GST/HST Reg. No. {b.gst_number}</p>{/if}
    {#if b.pst_number}<p>PST No. {b.pst_number}</p>{/if}
    <p class="mt-2 text-base font-bold">{ret.exchange_number ? "EXCHANGE" : "RETURN"}</p>
  </div>
  <p class="mt-2 flex justify-between"><span>{ret.number}</span><span>{when}</span></p>
  <p>{ret.sale_number ? "Original sale " + ret.sale_number : "No receipt"}</p>
  {#if ret.cashier}<p>Served by {ret.cashier}</p>{/if}
  <hr class="my-2 border-dashed border-black" />
  {#each ret.lines as l (l.id)}
    <p class="flex justify-between gap-2"><span>{l.name}</span><span>-{money(l.net_cents)}</span></p>
    {#if l.qty !== 1}<p class="pl-2 text-xs">{qtyText(l.qty)} returned</p>{/if}
    {#if l.deposit_cents}<p class="flex justify-between pl-2 text-xs"><span>Deposit/fee</span><span>-{money(l.deposit_cents)}</span></p>{/if}
  {/each}
  <hr class="my-2 border-dashed border-black" />
  {#each ret.taxes as x (x.code + x.rate)}<p class="flex justify-between"><span>{x.label} {x.rate}%</span><span>-{money(x.tax_cents)}</span></p>{/each}
  {#if ret.fee_cents}<p class="flex justify-between"><span>Restocking fee</span><span>{money(ret.fee_cents)}</span></p>{/if}
  <p class="flex justify-between text-base font-bold"><span>Refund</span><span>{money(ret.refund_cents)}</span></p>
  <hr class="my-2 border-dashed border-black" />
  {#each ret.refunds as x, i (i)}
    <p class="flex justify-between"><span>{x.method === "exchange" ? "Exchange credit (" + x.reference + ")" : x.method === "store_credit" ? "Store credit " + x.reference : METHOD[x.method] + (x.last4 ? " ****" + x.last4 : "")}</span><span>{money(x.amount_cents)}</span></p>
  {/each}
  {#if ret.rounding_cents}<p class="flex justify-between text-xs"><span>Cash rounding</span><span>{ret.rounding_cents > 0 ? "+" : ""}{money(ret.rounding_cents)}</span></p>{/if}
  {#each ret.refunds.filter((x) => x.method === "store_credit") as x (x.reference)}
    <p class="mt-2 border border-black py-1 text-center font-bold">STORE CREDIT {money(x.amount_cents)}<br />{x.reference}</p>
  {/each}
  {#if b.footer}<p class="mt-2 whitespace-pre-line text-center">{b.footer}</p>{/if}
  <p class="mt-2 text-center tracking-widest">{ret.number}</p>
</div>

<style>
  @media print { .receipt { border: none; max-width: 80mm; padding: 0; } }
</style>

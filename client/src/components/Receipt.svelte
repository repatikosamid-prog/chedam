<script>
  // Receipt (FR-3.13) on screen and for the browser's print; the network printer prints the same
  // content from the hub (hub/pb_hooks/lib/receipt_layout.js):
  // store header, GST/PST numbers, lines with discounts, taxes per type, deposits, cash rounding,
  // payments, change, savings. Training sales say so on every copy (FR-3.12).
  import { money } from "../lib/catalogue.js";
  import { METHOD } from "../lib/till.js";

  let { sale } = $props();
  const b = $derived(sale.business || {});
  const when = $derived(sale.completed_at ? new Date(sale.completed_at.replace(" ", "T")).toLocaleString() : "");
  const lines = $derived(sale.lines.filter((l) => !l.voided));
  const qtyText = (l) => (Number.isInteger(l.qty) ? l.qty : l.qty.toFixed(3));
</script>

<div class="receipt mx-auto max-w-sm rounded-xl border border-line bg-white p-4 font-mono text-sm text-black">
  {#if sale.training}<p class="mb-2 border border-black py-1 text-center font-bold">TRAINING · NOT A SALE</p>{/if}
  {#if sale.offline}<p class="mb-2 text-center text-xs">Offline receipt {sale.offline_ref}{sale.number && sale.number !== sale.offline_ref ? " · recorded as " + sale.number : ""}</p>{/if}
  {#if sale.status === "voided"}<p class="mb-2 border border-black py-1 text-center font-bold">VOIDED{sale.void_reason ? ": " + sale.void_reason : ""}</p>{/if}
  <div class="text-center">
    <p class="font-bold">{b.name}</p>
    {#if b.header}<p class="whitespace-pre-line">{b.header}</p>{:else if b.address && b.address.line1}<p>{b.address.line1}, {b.address.city}</p>{/if}
    {#if b.phone}<p>{b.phone}</p>{/if}
    {#if b.gst_number}<p>GST/HST Reg. No. {b.gst_number}</p>{/if}
    {#if b.pst_number}<p>PST No. {b.pst_number}</p>{/if}
  </div>
  <p class="mt-2 flex justify-between"><span>{sale.number}</span><span>{when}</span></p>
  {#if sale.cashier}<p>Served by {sale.cashier}</p>{/if}
  <hr class="my-2 border-dashed border-black" />
  {#each lines as l (l.id || l.line_no)}
    <div>
      <p class="flex justify-between gap-2"><span>{l.name}</span><span>{money(l.gross_cents)}</span></p>
      {#if l.qty !== 1 || l.price_cents !== l.regular_price_cents}<p class="pl-2 text-xs">{qtyText(l)} × {money(l.price_cents)}{l.price_cents !== l.regular_price_cents ? " (was " + money(l.regular_price_cents) + ")" : ""}</p>{/if}
      {#if l.promo_cents}<p class="flex justify-between pl-2 text-xs"><span>{l.promo_label || "Promotion"}</span><span>-{money(l.promo_cents)}</span></p>{/if}
      {#if l.staff_cents}<p class="flex justify-between pl-2 text-xs"><span>Staff discount</span><span>-{money(l.staff_cents)}</span></p>{/if}
      {#if l.line_discount_cents - (l.promo_cents || 0) - (l.staff_cents || 0) > 0}<p class="flex justify-between pl-2 text-xs"><span>Discount{l.discount_label ? " " + l.discount_label : ""}</span><span>-{money(l.line_discount_cents - (l.promo_cents || 0) - (l.staff_cents || 0))}</span></p>{/if}
      {#if l.deposit_cents}<p class="flex justify-between pl-2 text-xs"><span>Deposit/fee</span><span>{money(l.deposit_cents)}</span></p>{/if}
    </div>
  {/each}
  <hr class="my-2 border-dashed border-black" />
  <p class="flex justify-between"><span>Subtotal</span><span>{money(sale.subtotal_cents)}</span></p>
  {#if sale.staff_discount_cents}<p class="text-xs">Staff purchase: {sale.staff_name} ({money(sale.staff_discount_cents)} off)</p>{/if}
  {#if sale.loyalty_redeem_cents}<p class="flex justify-between"><span>Points used ({sale.loyalty_redeemed})</span><span>-{money(sale.loyalty_redeem_cents)}</span></p>{/if}
  {#if sale.discount_cents - lines.reduce((a, l) => a + l.line_discount_cents, 0) - (sale.loyalty_redeem_cents || 0) > 0}
    <p class="flex justify-between"><span>Sale discount{sale.cart_discount_label ? " " + sale.cart_discount_label : ""}</span><span>-{money(sale.discount_cents - lines.reduce((a, l) => a + l.line_discount_cents, 0) - (sale.loyalty_redeem_cents || 0))}</span></p>
  {/if}
  {#if sale.deposit_cents}<p class="flex justify-between"><span>Deposits and fees</span><span>{money(sale.deposit_cents)}</span></p>{/if}
  {#each sale.taxes as x (x.code + x.rate)}
    <p class="flex justify-between"><span>{x.label} {x.rate}%{sale.tax_mode === "tax_included" ? " (included)" : ""}</span><span>{money(x.tax_cents)}</span></p>
  {/each}
  {#if sale.exempt}<p class="text-xs">Tax exempt: {sale.exempt.label} · {sale.exempt.reference}</p>{/if}
  <p class="flex justify-between text-base font-bold"><span>Total</span><span>{money(sale.total_cents)}</span></p>
  {#if sale.rounding_cents}
    <p class="flex justify-between text-xs"><span>Cash rounding</span><span>{sale.rounding_cents > 0 ? "+" : ""}{money(sale.rounding_cents)}</span></p>
    <p class="flex justify-between font-bold"><span>Total in cash</span><span>{money(sale.total_cents + sale.rounding_cents)}</span></p>
  {/if}
  <hr class="my-2 border-dashed border-black" />
  {#each sale.payments as p, i (i)}
    <p class="flex justify-between"><span>{METHOD[p.method]}{p.last4 ? " ****" + p.last4 : ""}{p.currency === "USD" ? " (US " + money(p.tendered_cents) + ")" : ""}{p.status !== "approved" ? " · " + p.status : ""}</span>
      <span>{p.status === "approved" ? money(p.method === "cash" ? p.tendered_cents : p.amount_cents) : ""}</span></p>
  {/each}
  {#if sale.change_cents}<p class="flex justify-between font-bold"><span>Change</span><span>{money(sale.change_cents)}</span></p>{/if}
  {#if sale.savings_cents > 0}<p class="mt-2 text-center">You saved {money(sale.savings_cents)}</p>{/if}
  {#if sale.customer && (sale.loyalty_earned || sale.loyalty_redeemed || sale.loyalty_balance)}
    <hr class="my-2 border-dashed border-black" />
    <p class="font-bold">Loyalty: {sale.customer_name || "member"}</p>
    {#if sale.loyalty_earned}<p class="flex justify-between"><span>Points earned</span><span>{sale.loyalty_earned}</span></p>{/if}
    {#if sale.loyalty_redeemed}<p class="flex justify-between"><span>Points used</span><span>-{sale.loyalty_redeemed}</span></p>{/if}
    <p class="flex justify-between"><span>Points balance</span><span>{sale.loyalty_balance || 0}</span></p>
  {/if}
  {#if b.footer}<p class="mt-2 whitespace-pre-line text-center">{b.footer}</p>{/if}
  <p class="mt-2 text-center tracking-widest">{sale.number}</p>
</div>

<style>
  @media print {
    .receipt { border: none; max-width: 80mm; padding: 0; }
  }
</style>

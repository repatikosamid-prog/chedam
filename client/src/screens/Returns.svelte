<script>
  // Returns and exchanges (P1 step 6; FR-4.07-4.11, 4.13, 4.14; BR-17, BR-23). Find the sale by its receipt
  // (scan the barcode or type the number), or by date, amount or card's last 4; or take it without a
  // receipt (manager's PIN, store credit at the lowest recent price). Choose what comes back and where
  // each item goes; the hub works out the refund (price paid after discounts + original tax). Refund in
  // cash, to the card on the terminal, or as store credit; or exchange for new items on the Sell screen.
  // Returns need the hub.
  import { onMount } from "svelte";
  import { api, isHubDown } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money, newId } from "../lib/catalogue.js";
  import { startExchange } from "../lib/exchange.svelte.js";
  import Scanner from "../components/Scanner.svelte";
  import Approve from "../components/Approve.svelte";
  import RefundChooser from "../components/RefundChooser.svelte";
  import ReturnSlip from "../components/ReturnSlip.svelte";
  import PrintButtons from "../components/PrintButtons.svelte";

  const DISPO = [["restock", "Back to stock"], ["damaged", "Damaged"], ["vendor", "Return to vendor"], ["dispose", "Dispose"]];
  let step = $state("find");                   // find | items | refund | done
  let number = $state(""), date = $state(""), amount = $state(""), last4 = $state(""), found = $state(null);
  let sale = $state(null);                     // /returns/sale/{id} (null: no receipt)
  let noReceipt = $state(false), nrLines = $state([]), nrCode = $state("");
  let qty = $state({}), dispo = $state({}), reason = $state(""), fee = $state(false), feePct = $state(0);
  let quote = $state(null), approval = $state(""), asking = $state(false);
  let error = $state(""), busy = $state(false), scanning = $state(false), done = $state(null);
  let returnId = newId();
  let qTimer;

  onMount(async () => {
    const r = await api("GET", "/api/collections/settings/records?filter=" + encodeURIComponent("key='returns.restocking_fee_pct'"));
    if (r.ok && r.json.items[0]) feePct = Number(r.json.items[0].value) || 0;
  });

  async function search(e) {
    if (e) e.preventDefault();
    error = ""; found = null;
    const q = number.trim() ? "number=" + encodeURIComponent(number.trim())
      : [date && "date=" + date, amount && "amount_cents=" + Math.round(Number(amount) * 100), last4 && "last4=" + last4].filter(Boolean).join("&");
    if (!q) { error = "Scan the receipt, or enter its number, or a date, amount or card's last 4 digits."; return; }
    const r = await api("GET", "/api/chedam/returns/find?" + q);
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.status === 0 ? "Returns need the hub. Check that it is on." : r.message; return; }
    found = r.json.sales;
    if (found.length === 1 && number.trim()) open(found[0].id);
    else if (!found.length) error = "No sale found.";
  }

  async function open(id) {
    const r = await api("GET", "/api/chedam/returns/sale/" + id);
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    sale = r.json; noReceipt = false; qty = {}; dispo = {}; quote = null; approval = ""; step = "items";
    if (sale.status_note) error = sale.status_note;
  }

  function startNoReceipt() { sale = null; noReceipt = true; nrLines = []; quote = null; approval = ""; step = "items"; }

  async function addProduct(e) {
    if (e) e.preventDefault();
    const c = nrCode.trim();
    if (!c) return;
    const r = await api("GET", "/api/chedam/catalogue/lookup?code=" + encodeURIComponent(c));
    nrCode = "";
    if (!r.ok || !r.json.matches.length) { error = "No product with code " + c + "."; return; }
    const m = r.json.matches[0];
    nrLines = [...nrLines, { key: newId(), product: m.product.id, selling_unit: m.unit.id, name: m.product.name + " (" + m.unit.name + ")", qty: 1, weighed: m.unit.kind === "weight", disposition: "restock" }];
    requote();
  }

  function onCode(c) { scanning = false; if (step === "find") { number = c; search(); } else { nrCode = c; addProduct(); } }

  function body() {
    if (noReceipt) return { lines: nrLines.map((l) => ({ product: l.product, selling_unit: l.selling_unit, qty: Number(l.qty), disposition: l.disposition })),
      reason, restocking_fee: fee, approval: approval || undefined };
    return { sale: sale.id, lines: sale.lines.filter((l) => Number(qty[l.id]) > 0).map((l) => ({ sale_line: l.id, qty: Number(qty[l.id]), disposition: dispo[l.id] || "restock" })),
      reason, restocking_fee: fee, approval: approval || undefined };
  }

  function requote() {
    clearTimeout(qTimer);
    qTimer = setTimeout(async () => {
      const b = body();
      if (!b.lines.length) { quote = null; return; }
      const r = await api("POST", "/api/chedam/returns/quote", b);
      if (!r.ok) { error = r.message; quote = null; return; }
      error = ""; quote = r.json;
    }, 250);
  }

  function toRefund() {
    if (!quote) return;
    if (quote.needs_approval.length && !approval) { asking = true; return; }
    step = "refund";
  }

  function exchange() {
    if (!quote) return;
    if (quote.needs_approval.length && !approval) { asking = true; return; }
    startExchange({ id: returnId, body: body(), credit_cents: quote.refund_cents, receipt: !noReceipt, card_max_cents: sale ? sale.card_refundable_cents : 0,
      label: sale ? sale.number : "no receipt" });
    go("sell");
  }

  async function finish(refunds) {
    busy = true; error = "";
    const r = await api("POST", "/api/chedam/returns", { id: returnId, ...body(), refunds, expected_refund_cents: quote.refund_cents, device_time: new Date().toISOString() }, { timeout: 20000 });
    busy = false;
    if (!r.ok) {
      if (await handleRefusal(r)) return;
      error = r.status === 0 ? "The hub did not answer. Check the return list before trying again." : r.message;
      if (r.json && r.json.data && r.json.data.quote) quote = r.json.data.quote;
      step = "items";
      return;
    }
    done = r.json.return; step = "done";
  }

  function again() { step = "find"; sale = null; found = null; number = ""; done = null; quote = null; approval = ""; reason = ""; fee = false; returnId = newId(); error = ""; }
  const qtyStep = (l) => (l.weighed ? "0.001" : "1");
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-center justify-between gap-2">
    <div>
      <button class="mb-1 min-h-10 text-sm underline" onclick={() => (step === "find" || step === "done" ? go("sell") : (step = step === "refund" ? "items" : "find"))}>← {step === "find" || step === "done" ? "Sell" : "Back"}</button>
      <h1 class="text-xl font-bold">Return or exchange</h1>
    </div>
  </div>
  {#if isHubDown()}<p class="rounded-xl bg-warn/10 px-3 py-2 text-warn">Returns need the hub. Check that it is on and the Wi-Fi works.</p>{/if}
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  {#if step === "find"}
    <form class="card space-y-3" onsubmit={search}>
      <h2 class="font-semibold">Find the sale</h2>
      <div class="flex gap-2">
        <input class="field" bind:value={number} placeholder="Scan the receipt or type its number (S-000012)" autocomplete="off" aria-label="Receipt number" />
        <button class="btn-ghost" type="button" onclick={() => (scanning = true)} aria-label="Scan with the camera">📷</button>
      </div>
      <p class="text-sm text-muted">No receipt number? Search by any of these:</p>
      <div class="grid gap-2 sm:grid-cols-3">
        <label class="block"><span class="text-sm text-muted">Date</span><input class="field" type="date" bind:value={date} /></label>
        <label class="block"><span class="text-sm text-muted">Total ($)</span><input class="field" inputmode="decimal" bind:value={amount} /></label>
        <label class="block"><span class="text-sm text-muted">Card last 4</span><input class="field" inputmode="numeric" maxlength="4" bind:value={last4} /></label>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn" type="submit">Find</button>
        <button class="btn-ghost" type="button" onclick={startNoReceipt}>No receipt</button>
      </div>
    </form>
    {#if scanning}<Scanner {onCode} onClose={() => (scanning = false)} />{/if}
    {#if found && found.length}
      <ul class="space-y-2">
        {#each found as f (f.id)}
          <li><button class="card flex w-full items-center justify-between text-left" onclick={() => open(f.id)}>
            <span><b>{f.number}</b>{f.offline_ref ? " (" + f.offline_ref + ")" : ""}<span class="block text-sm text-muted">{new Date(f.completed_at.replace(" ", "T")).toLocaleString()} · {f.cashier}</span></span>
            <span>{money(f.total_cents + f.rounding_cents)}{f.status === "voided" ? " · voided" : ""}</span></button></li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#if step === "items"}
    <div class="card space-y-3">
      {#if sale}
        <h2 class="font-semibold">{sale.number} · {new Date(sale.completed_at.replace(" ", "T")).toLocaleDateString()} ({sale.days_ago} days ago) · {money(sale.total_cents + sale.rounding_cents)}</h2>
        {#if sale.returns.length}<p class="text-sm text-muted">Already returned: {sale.returns.map((r) => r.number + " " + money(r.refund_cents)).join(", ")}</p>{/if}
        {#each sale.lines as l (l.id)}
          <div class="grid gap-2 rounded-xl border border-line p-2 sm:grid-cols-[1fr_7rem_10rem] sm:items-end">
            <div><p class="font-semibold">{l.name}</p>
              <p class="text-sm text-muted">{l.qty} sold{l.returned_qty ? ", " + l.returned_qty + " returned" : ""} · paid {money(l.net_cents)}{l.deposit_cents ? " + deposit " + money(l.deposit_cents) : ""}</p>
              {#if l.non_returnable}<p class="text-sm text-warn">Non-returnable: manager's PIN</p>{/if}
              {#if l.outside_window}<p class="text-sm text-warn">Past {l.window_days} days: manager's PIN</p>{/if}</div>
            <label class="block"><span class="text-sm text-muted">Returning (max {l.returnable_qty})</span>
              <input class="field" type="number" min="0" max={l.returnable_qty} step={qtyStep(l)} disabled={!l.returnable_qty} bind:value={qty[l.id]} oninput={requote} /></label>
            <label class="block"><span class="text-sm text-muted">Goes</span>
              <select class="field" bind:value={dispo[l.id]} onchange={requote}>{#each DISPO as [v, t] (v)}<option value={v}>{t}</option>{/each}</select></label>
          </div>
        {/each}
      {:else}
        <h2 class="font-semibold">No receipt</h2>
        <p class="text-sm text-muted">A manager approves it. The customer gets store credit at the lowest price of the last 30 days.</p>
        <form class="flex gap-2" onsubmit={addProduct}>
          <input class="field" bind:value={nrCode} placeholder="Scan or type the product's barcode / PLU" aria-label="Product code" />
          <button class="btn-ghost" type="button" onclick={() => (scanning = true)} aria-label="Scan with the camera">📷</button>
          <button class="btn" type="submit">Add</button>
        </form>
        {#if scanning}<Scanner {onCode} onClose={() => (scanning = false)} />{/if}
        {#each nrLines as l, i (l.key)}
          <div class="grid gap-2 rounded-xl border border-line p-2 sm:grid-cols-[1fr_7rem_10rem_auto] sm:items-end">
            <p class="font-semibold">{l.name}</p>
            <label class="block"><span class="text-sm text-muted">{l.weighed ? "Weight" : "Quantity"}</span><input class="field" type="number" min="0" step={l.weighed ? "0.001" : "1"} bind:value={l.qty} oninput={requote} /></label>
            <label class="block"><span class="text-sm text-muted">Goes</span><select class="field" bind:value={l.disposition} onchange={requote}>{#each DISPO as [v, t] (v)}<option value={v}>{t}</option>{/each}</select></label>
            <button class="btn-ghost min-h-10 text-sm text-bad" onclick={() => { nrLines = nrLines.filter((_, k) => k !== i); requote(); }}>Remove</button>
          </div>
        {/each}
      {/if}
      <label class="block"><span class="text-sm text-muted">Reason (optional)</span><input class="field" bind:value={reason} maxlength="300" placeholder="e.g. wrong size, faulty, changed mind" /></label>
      {#if feePct > 0}<label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={fee} onchange={requote} /> Restocking fee ({feePct}% of items going back to stock)</label>{/if}
    </div>

    {#if quote}
      <div class="card space-y-1">
        <p class="flex justify-between"><span>Goods (price paid after discounts)</span><span>{money(quote.net_cents)}</span></p>
        {#if quote.deposit_cents}<p class="flex justify-between"><span>Deposits and fees</span><span>{money(quote.deposit_cents)}</span></p>{/if}
        {#each quote.taxes as x (x.code + x.rate)}<p class="flex justify-between"><span>{x.label} {x.rate}%</span><span>{money(x.tax_cents)}</span></p>{/each}
        {#if quote.fee_cents}<p class="flex justify-between"><span>Restocking fee</span><span>−{money(quote.fee_cents)}</span></p>{/if}
        <p class="flex justify-between text-xl font-bold"><span>Refund</span><span>{money(quote.refund_cents)}</span></p>
        {#if quote.needs_approval.length && !approval}<p class="text-sm text-warn">Manager's PIN: {quote.needs_approval.join("; ")}.</p>{/if}
        {#if approval}<p class="text-sm text-ok">Approved.</p>{/if}
        <div class="flex flex-wrap gap-2 pt-2">
          <button class="btn" disabled={isHubDown()} onclick={toRefund}>Refund</button>
          {#if can("sales.sell")}<button class="btn-ghost" disabled={isHubDown()} onclick={exchange}>Exchange for new items</button>{/if}
        </div>
      </div>
      {#if asking}
        <Approve what={quote.needs_approval} onApproved={(a) => { approval = a.approval; asking = false; }} onCancel={() => (asking = false)} />
      {/if}
    {/if}
  {/if}

  {#if step === "refund" && quote}
    <div class="card space-y-3">
      <h2 class="font-semibold">Refund {money(quote.refund_cents)}</h2>
      <RefundChooser total={quote.refund_cents} receipt={!noReceipt} cardMax={sale ? sale.card_refundable_cents : 0} {busy} onDone={finish} />
    </div>
  {/if}

  {#if step === "done" && done}
    <div class="grid gap-4 lg:grid-cols-[1fr_auto]">
      <div class="card space-y-3 text-center">
        <p class="text-muted">{done.number} · refund</p>
        <p class="text-5xl font-bold tabular-nums">{money(done.paid_cents)}</p>
        {#each done.refunds as x, i (i)}<p>{x.method === "store_credit" ? "Store credit code " + x.reference : x.method === "card" ? "Back to the card" + (x.last4 ? " ****" + x.last4 : "") : "Cash"}: {money(x.amount_cents)}</p>{/each}
        <div class="flex flex-wrap justify-center gap-2 print:hidden">
          <button class="btn" onclick={again}>Next return</button>
          <button class="btn-ghost" onclick={() => go("sell")}>Sell</button>
        </div>
        {#key done.id}<PrintButtons sale={done} kind="return" auto={true} />{/key}
      </div>
      <ReturnSlip ret={done} />
    </div>
  {/if}
</section>

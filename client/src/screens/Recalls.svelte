<script>
  // Recalls (P3 step 10, FR-6.15): find a product's lots (all, some lot codes, or expiring between dates), see
  // where each came from, which sales took it, when and to which members (to call them back); recall them:
  // the lots are never sold again and what is left is written off (or a task asks someone to pull it).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import ExportMenu from "../components/ExportMenu.svelte";

  let q = $state(""), hits = $state([]), product = $state(null), codes = $state(""), from = $state(""), to = $state(""), tr = $state(null), list = $state([]), error = $state(""), ok = $state("");
  let reason = $state(""), source = $state("");
  const when = (t) => (t ? new Date(String(t).replace(" ", "T")).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  async function load() { const r = await api("GET", "/api/chedam/recalls"); if (r.ok) list = r.json.items; else fail(r); }
  onMount(load);
  async function find() {
    const t = q.trim().replace(/'/g, "");
    if (!t) { hits = []; return; }
    const r = await api("GET", "/api/collections/products/records?perPage=8&fields=id,name&filter=" + encodeURIComponent(`deleted_at='' && name~'${t}'`), null, { quiet: true });
    hits = r.ok ? r.json.items : [];
  }
  async function traceIt() {
    error = ""; ok = "";
    const r = await api("GET", `/api/chedam/recalls/trace?product=${product.id}&lot_codes=${encodeURIComponent(codes)}&expiry_from=${from}&expiry_to=${to}`);
    if (r.ok) tr = r.json; else fail(r);
  }
  async function recallIt() {
    if (!confirm("Recall these " + tr.lots.length + " lot(s)? They are never sold again and what is left is written off.")) return;
    const r = await api("POST", "/api/chedam/recalls", { product: product.id, lot_codes: codes, expiry_from: from, expiry_to: to, reason, source });
    if (!r.ok) return fail(r);
    ok = r.json.recall.number + ": " + r.json.lots + " lot(s) blocked; " + r.json.written_off.filter((x) => x.movement).length + " written off" + (r.json.written_off.some((x) => x.task) ? ", the rest are tasks to pull from the shelf" : "") + ".";
    traceIt(); load();
  }
  const rows = $derived(tr ? tr.lots.flatMap((l) => (l.sales.length ? l.sales : [{}]).map((x) => ({ lot: l.lot_code, expiry: l.expiry, received: l.received_at, left: l.left, sale: x.number || "", at: x.at || "", qty: x.qty || "", member: x.member || "" }))) : []);
</script>

<section class="space-y-4">
  <div class="screen-head"><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Recalls</h1></div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}
  <div class="card space-y-2">
    {#if product}<p class="font-semibold">{product.name} <button class="text-sm underline" onclick={() => { product = null; tr = null; }}>change</button></p>
    {:else}<input class="field" bind:value={q} oninput={find} placeholder="Which product?" aria-label="Product" />
      <div class="flex flex-wrap gap-1">{#each hits as p (p.id)}<button class="btn-ghost min-h-8 text-sm" onclick={() => { product = p; hits = []; }}>{p.name}</button>{/each}</div>{/if}
    <div class="grid gap-2 sm:grid-cols-3">
      <label class="block"><span class="text-sm text-muted">Lot codes (comma; empty = all)</span><input class="field" bind:value={codes} /></label>
      <label class="block"><span class="text-sm text-muted">Expiring from</span><input class="field" type="date" bind:value={from} /></label>
      <label class="block"><span class="text-sm text-muted">to</span><input class="field" type="date" bind:value={to} /></label>
    </div>
    <button class="btn" disabled={!product} onclick={traceIt}>Trace</button>
  </div>
  {#if tr}
    <div class="card space-y-1">
      <div class="flex flex-wrap justify-between gap-2"><p class="font-semibold">{tr.lots.length} lot(s) · {tr.sold} sold · {tr.left} left</p>
        <ExportMenu title={"Recall trace " + tr.product.name} rows={rows} columns={[{ key: "lot", label: "Lot" }, { key: "expiry", label: "Expiry" }, { key: "received", label: "Received" }, { key: "left", label: "Left" }, { key: "sale", label: "Sale" }, { key: "at", label: "Sold" }, { key: "qty", label: "Qty" }, { key: "member", label: "Member" }]} /></div>
      {#each tr.lots as l (l.id)}
        <div class="border-t border-line pt-1 text-sm">
          <p><b>{l.lot_code || "(no lot code)"}</b>{l.expiry ? " · expires " + l.expiry : ""} · received {when(l.received_at)} ({l.how}) · {l.received_qty} in, {l.sold} sold, {l.left} left{l.recalled ? " · RECALLED" : ""}</p>
          {#each l.sales as x (x.sale)}<p class="pl-4">{when(x.at)} · {x.number} · {x.qty}{x.member ? " · " + x.member : ""}</p>{/each}
        </div>
      {/each}
      {#if tr.members.length}<p class="text-sm"><b>Members to call:</b> {tr.members.map((m) => m.name).join(", ")}</p>{/if}
      {#if can("stock.approve") && tr.lots.some((l) => !l.recalled)}
        <div class="grid gap-2 border-t border-line pt-2 sm:grid-cols-2">
          <label class="block"><span class="text-sm text-muted">Why (the recall notice)</span><input class="field" bind:value={reason} maxlength="500" /></label>
          <label class="block"><span class="text-sm text-muted">Source (e.g. CFIA notice no.)</span><input class="field" bind:value={source} maxlength="200" /></label>
          <button class="btn-danger" disabled={!reason.trim()} onclick={recallIt}>Recall these lots</button>
        </div>
      {/if}
    </div>
  {/if}
  {#each list as r (r.id)}<p class="card text-sm"><b>{r.number}</b> · {r.product_name} · {r.lots} lot(s) · {r.reason}{r.source ? " · " + r.source : ""} · {r.by} · {when(r.at)}</p>{/each}
</section>

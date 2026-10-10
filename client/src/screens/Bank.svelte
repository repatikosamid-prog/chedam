<script>
  // Bank (P4 step 6; FR-10.02, 10.03), bank.manage (the accountant; the owner). Accounts with Chedam's balance
  // and what is unmatched; import a statement (CSV, OFX, QFX) read on this device and sent to the hub; lines
  // matched by themselves or by hand (the possible matches are offered), a category, or ignored with a note;
  // cash deposits from the tills (in transit until on the statement); reconcile to the statement's balance.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import ExportMenu from "../components/ExportMenu.svelte";

  const KIND = { bill_payment: "Vendor payment", invoice_payment: "Client payment", expense: "Expense paid back", payroll: "Payroll", pay: "Pay", deposit: "Cash deposit", card_batch: "Card sales", category: "Category" };
  let data = $state(null), acc = $state(""), lines = $state([]), status = $state("unmatched"), error = $state(""), ok = $state("");
  let accForm = $state(null), imp = $state(null), dep = $state(null), tills = $state([]), open = $state(null), cands = $state([]), pick = $state([]), cat = $state(""), note = $state(""), rec = $state(null), recOut = $state(null);
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const today = () => new Date().toISOString().substring(0, 10);
  const account = $derived(data ? data.accounts.find((a) => a.id === acc) : null);

  async function load() {
    error = "";
    const r = await api("GET", "/api/chedam/bank");
    if (!r.ok) return fail(r);
    data = r.json;
    if (!acc && data.accounts.length) acc = data.accounts[0].id;
    if (acc) loadLines();
  }
  async function loadLines() { const r = await api("GET", `/api/chedam/bank/lines?account=${acc}` + (status ? "&status=" + status : "")); lines = r.ok ? r.json.items : []; }
  onMount(load);

  async function saveAcc(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/bank/accounts", { ...accForm, opening_balance_cents: Math.round(Number(accForm.opening || 0) * 100) });
    if (!r.ok) return fail(r);
    acc = r.json.id; accForm = null; load();
  }
  async function doImport(e) {
    e.preventDefault();
    if (!imp.file) return;
    const text = await imp.file.text();
    const r = await api("POST", "/api/chedam/bank/import", { account: acc, filename: imp.file.name, text, date_format: imp.fmt }, { timeout: 60000 });
    if (!r.ok) return fail(r);
    ok = `${r.json.added} lines added (${r.json.first_day} to ${r.json.last_day}), ${r.json.duplicates} already there, ${r.json.matched} matched.`; imp = null; load();
  }
  async function startDep() {
    const r = await api("GET", "/api/chedam/bank/tills");
    tills = r.ok ? r.json.items.filter((x) => !x.deposit) : [];
    dep = { day: today(), amount: "", tills: [], note: "" };
  }
  async function saveDep(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/bank/deposits", { account: acc, day: dep.day, amount_cents: Math.round(Number(dep.amount) * 100), tills: dep.tills, note: dep.note });
    if (!r.ok) return fail(r);
    ok = r.json.number + " recorded; it is matched when it shows on the statement."; dep = null; load();
  }
  const tillSum = () => tills.filter((x) => dep.tills.includes(x.id)).reduce((a, x) => a + x.counted_cents - x.float_cents, 0);
  async function show(l) {
    if (open && open.id === l.id) { open = null; return; }
    open = l; pick = []; cat = ""; note = ""; cands = [];
    if (l.status === "unmatched") { const r = await api("GET", `/api/chedam/bank/lines/${l.id}/candidates`); cands = r.ok ? r.json.items : []; if (cands.length && cands[0].exact) pick = [cands[0].kind + "|" + cands[0].id]; }
  }
  async function matchIt(body) {
    const r = await api("POST", `/api/chedam/bank/lines/${open.id}/match`, body);
    if (!r.ok) return fail(r);
    open = null; load();
  }
  function matchPicked() {
    const kinds = [...new Set(pick.map((p) => p.split("|")[0]))];
    if (kinds.length !== 1) { error = "Choose records of one kind."; return; }
    matchIt({ kind: kinds[0], refs: pick.map((p) => p.split("|")[1]) });
  }
  async function unmatch(l) { const r = await api("POST", `/api/chedam/bank/lines/${l.id}/unmatch`, {}); if (r.ok) { open = null; load(); } else fail(r); }
  async function reconcile(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/bank/reconcile", { account: acc, to: rec.to, statement_balance_cents: Math.round(Number(rec.balance) * 100) });
    if (r.ok) { recOut = r.json; if (r.json.reconciled) load(); } else fail(r);
  }
  async function cancelDep(d) { const r = await api("POST", `/api/chedam/bank/deposits/${d.id}/cancel`, {}); if (r.ok) load(); else fail(r); }
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Bank</h1></div>
    <button class="btn-ghost min-h-10 text-sm" onclick={() => (accForm = { name: "", institution: "", last4: "", kind: "chequing", opening: "", opening_date: today() })}>Add an account</button>
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if accForm}
    <form class="card grid gap-2 sm:grid-cols-3" onsubmit={saveAcc}>
      <label class="block"><span class="text-sm text-muted">Name</span><input class="field" bind:value={accForm.name} required maxlength="80" placeholder="RBC Business chequing" /></label>
      <label class="block"><span class="text-sm text-muted">Bank</span><input class="field" bind:value={accForm.institution} maxlength="80" /></label>
      <label class="block"><span class="text-sm text-muted">Last 4 digits</span><input class="field" inputmode="numeric" bind:value={accForm.last4} maxlength="4" /></label>
      <label class="block"><span class="text-sm text-muted">Kind</span><select class="field" bind:value={accForm.kind}><option value="chequing">Chequing</option><option value="savings">Savings</option><option value="credit_card">Credit card</option></select></label>
      <label class="block"><span class="text-sm text-muted">Opening balance ($)</span><input class="field" inputmode="decimal" bind:value={accForm.opening} /></label>
      <label class="block"><span class="text-sm text-muted">On</span><input class="field" type="date" bind:value={accForm.opening_date} /></label>
      <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (accForm = null)}>Cancel</button></div>
    </form>
  {/if}

  {#if data}
    <div class="flex flex-wrap gap-2">
      {#each data.accounts as a (a.id)}
        <button class="card min-w-48 text-left {a.id === acc ? 'border-accent' : ''}" onclick={() => { acc = a.id; open = null; recOut = null; loadLines(); }}>
          <p class="font-semibold">{a.name}{a.last4 ? " ••" + a.last4 : ""}</p>
          <p class="text-lg">{money(a.balance_cents)}</p>
          <p class="text-xs text-muted">{a.last_day ? "to " + a.last_day : "no lines yet"}{a.unmatched ? " · " + a.unmatched + " to match" : ""}{a.reconciled_to ? " · reconciled to " + a.reconciled_to : ""}</p>
        </button>
      {:else}<p class="text-muted">Add the store's bank account first.</p>{/each}
    </div>

    {#if account}
      <div class="flex flex-wrap gap-2">
        <button class="btn min-h-10 text-sm" onclick={() => (imp = { file: null, fmt: "mdy" })}>Import a statement</button>
        <button class="btn-ghost min-h-10 text-sm" onclick={startDep}>Cash deposit</button>
        <button class="btn-ghost min-h-10 text-sm" onclick={() => { rec = { to: account.last_day || today(), balance: "" }; recOut = null; }}>Reconcile</button>
      </div>
      {#if imp}
        <form class="card flex flex-wrap items-end gap-2" onsubmit={doImport}>
          <label class="btn-ghost flex min-h-12 cursor-pointer items-center">📄 {imp.file ? imp.file.name : "Choose the CSV, OFX or QFX file"}<input class="sr-only" type="file" accept=".csv,.ofx,.qfx,.txt" onchange={(e) => (imp.file = e.currentTarget.files[0])} /></label>
          <label class="block"><span class="text-sm text-muted">Dates like 03/04/2026 are</span><select class="field" bind:value={imp.fmt}><option value="mdy">month/day</option><option value="dmy">day/month</option></select></label>
          <button class="btn" type="submit" disabled={!imp.file}>Import</button><button class="btn-ghost" type="button" onclick={() => (imp = null)}>Cancel</button>
        </form>
      {/if}
      {#if dep}
        <form class="card grid gap-2 sm:grid-cols-3" onsubmit={saveDep}>
          <label class="block"><span class="text-sm text-muted">Day</span><input class="field" type="date" bind:value={dep.day} /></label>
          <label class="block"><span class="text-sm text-muted">Amount ($)</span><input class="field" inputmode="decimal" bind:value={dep.amount} required /></label>
          <label class="block"><span class="text-sm text-muted">Note</span><input class="field" bind:value={dep.note} maxlength="300" /></label>
          {#if tills.length}<div class="sm:col-span-3"><p class="text-sm text-muted">From closed tills (counted less the float):</p>
            {#each tills as x (x.id)}<label class="mr-3 inline-flex items-center gap-1 text-sm"><input type="checkbox" value={x.id} bind:group={dep.tills} /> Till {x.number} {x.closed_at.substring(0, 10)} {money(x.counted_cents - x.float_cents)}</label>{/each}
            {#if dep.tills.length}<button class="ml-2 text-sm text-accent underline" type="button" onclick={() => (dep.amount = (tillSum() / 100).toFixed(2))}>Use {money(tillSum())}</button>{/if}</div>{/if}
          <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit">Record</button><button class="btn-ghost" type="button" onclick={() => (dep = null)}>Cancel</button></div>
        </form>
      {/if}
      {#if rec}
        <form class="card flex flex-wrap items-end gap-2" onsubmit={reconcile}>
          <label class="block"><span class="text-sm text-muted">Statement ends</span><input class="field" type="date" bind:value={rec.to} required /></label>
          <label class="block"><span class="text-sm text-muted">Its closing balance ($)</span><input class="field" inputmode="decimal" bind:value={rec.balance} required /></label>
          <button class="btn" type="submit">Check</button><button class="btn-ghost" type="button" onclick={() => { rec = null; recOut = null; }}>Close</button>
          {#if recOut}<p class="w-full {recOut.reconciled ? 'text-ok' : 'text-warn'}">{recOut.reconciled ? "Reconciled to " + recOut.to + "." : "Chedam has " + money(recOut.chedam_balance_cents) + ": difference " + money(recOut.difference_cents) + (recOut.unmatched ? "; " + recOut.unmatched + " lines still to match" : "") + "."}</p>{/if}
        </form>
      {/if}

      {#each data.deposits.filter((d) => d.account === acc && d.status === "in_transit") as d (d.id)}
        <p class="text-sm text-warn">{d.number} · {d.day} · {money(d.amount_cents)} in transit {d.note ? "· " + d.note : ""} <button class="ml-1 underline" onclick={() => cancelDep(d)}>Cancel</button></p>
      {/each}

      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex gap-2">{#each [["unmatched", "To match"], ["matched", "Matched"], ["ignored", "Ignored"], ["", "All"]] as [k, l] (k)}<button class="min-h-10 rounded-xl px-3 {status === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { status = k; open = null; loadLines(); }}>{l}</button>{/each}</div>
        <ExportMenu title={"Bank " + account.name} rows={lines} columns={[{ key: "day", label: "Day" }, { key: "description", label: "Description" }, { key: "a", label: "Amount", value: (l) => l.amount_cents / 100 }, { key: "status", label: "Status" },
          { key: "k", label: "Matched to", value: (l) => (l.match_kind === "category" ? l.category : l.match_refs.map((x) => x.label).join("; ")) }, { key: "f", label: "Fee", value: (l) => l.fee_cents / 100 }, { key: "note", label: "Note" }]} />
      </div>
      {#each lines as l (l.id)}
        <div class="card space-y-2">
          <button class="flex w-full flex-wrap justify-between gap-2 text-left" onclick={() => show(l)}>
            <span>{l.day} · {l.description}</span>
            <span><b class={l.amount_cents < 0 ? "text-bad" : "text-ok"}>{money(l.amount_cents)}</b> <span class="text-sm text-muted">{l.status === "matched" ? (l.match_kind === "category" ? l.category : KIND[l.match_kind]) + (l.auto ? " (auto)" : "") : l.status === "ignored" ? "Ignored" : ""}</span></span>
          </button>
          {#if open && open.id === l.id}
            {#if l.status === "unmatched"}
              {#each cands as x (x.kind + x.id)}<label class="flex items-center gap-2 text-sm"><input type="checkbox" value={x.kind + "|" + x.id} bind:group={pick} /> {KIND[x.kind]}: {x.label} · {x.day} · {money(x.amount_cents)}{x.exact ? " ✓" : ""}</label>
              {:else}<p class="text-sm text-muted">No Chedam record has this amount near this day.</p>{/each}
              {#if cands.length}<button class="btn min-h-10 text-sm" disabled={!pick.length} onclick={matchPicked}>Match</button>{/if}
              <div class="flex flex-wrap items-end gap-2">
                <label class="block"><span class="text-sm text-muted">Or a category</span><select class="field" bind:value={cat}><option value="">Choose…</option>{#each data.categories as c (c)}<option value={c}>{c}</option>{/each}</select></label>
                <label class="block"><span class="text-sm text-muted">Note</span><input class="field" bind:value={note} maxlength="300" /></label>
                <button class="btn-ghost min-h-10 text-sm" disabled={!cat} onclick={() => matchIt({ kind: "category", category: cat, note })}>Save</button>
                <button class="btn-ghost min-h-10 text-sm" disabled={!note} onclick={() => matchIt({ kind: "ignore", note })}>Ignore</button>
              </div>
            {:else}
              {#each l.match_refs as x (x.id)}<p class="text-sm">{KIND[x.kind]}: {x.label} · {money(x.amount_cents)}</p>{/each}
              {#if l.fee_cents}<p class="text-sm">Processor fee: {money(l.fee_cents)}</p>{/if}
              {#if l.note}<p class="text-sm text-muted">{l.note}</p>{/if}
              <p class="text-sm text-muted">By {l.matched_by}</p>
              <button class="btn-ghost min-h-10 text-sm" onclick={() => unmatch(l)}>Unmatch</button>
            {/if}
          {/if}
        </div>
      {:else}<p class="text-muted">Nothing here.</p>{/each}
    {/if}
  {/if}
</section>

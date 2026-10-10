<script>
  // The books (P4 step 8; FR-10.06, P4-d, BR-34), books.manage (the accountant; the owner). The journal is
  // made from Chedam's records by fixed rules: Trial balance (activity in the period, balance at its end),
  // Journal (the entries, by account), Chart (rename, renumber, map to the accountant's own codes), Months
  // (close after the month ends, in order, seeing what is still open first; only the owner reopens), Exports
  // (step 10, FR-10.12: journal, sales, payroll, expenses, bank as QuickBooks or Xero CSV files).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal, s as session } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import ExportMenu from "../components/ExportMenu.svelte";

  const TYPE = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", cogs: "Cost of sales", expense: "Expenses" };
  let tab = $state("trial"), error = $state(""), ok = $state(""), exp = $state({ kind: "journal", format: "quickbooks", dates: "iso" });
  const today = () => new Date().toISOString().substring(0, 10);
  let from = $state(today().substring(0, 8) + "01"), to = $state(today()), trial = $state(null), jr = $state(null), account = $state(""), chart = $state([]), edit = $state(null), months = $state([]), pending = $state(null);
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const isOwner = () => !!(session.me && session.me.role && session.me.role.code === "owner");

  async function load() {
    error = "";
    if (!chart.length || tab === "chart") { const r = await api("GET", "/api/chedam/books/accounts"); if (r.ok) chart = r.json.items; else return fail(r); }
    if (tab === "trial") { const r = await api("GET", `/api/chedam/books/trial?from=${from}&to=${to}`); if (r.ok) trial = r.json; else await fail(r); }
    if (tab === "journal") { const r = await api("GET", `/api/chedam/books/journal?from=${from}&to=${to}` + (account ? "&account=" + encodeURIComponent(account) : "")); if (r.ok) jr = r.json; else await fail(r); }
    if (tab === "months") { const r = await api("GET", "/api/chedam/books/periods"); if (r.ok) months = r.json.items; else await fail(r); }
  }
  onMount(load);
  async function saveAcc(e) {
    e.preventDefault();
    const r = await api("POST", `/api/chedam/books/accounts/${edit.id}`, { name: edit.name, code: edit.code, external_code: edit.external_code, note: edit.note });
    if (!r.ok) return fail(r);
    edit = null; load();
  }
  async function close(m, confirm) {
    const r = await api("POST", "/api/chedam/books/periods/close", { month: m, confirm: !!confirm });
    if (!r.ok) return fail(r);
    if (!r.json.closed) { pending = r.json; return; }
    pending = null; ok = m + " is closed."; load();
  }
  async function reopen(m) {
    const reason = prompt("Why is " + m + " reopened?");
    if (!reason) return;
    const r = await api("POST", "/api/chedam/books/periods/reopen", { month: m, reason });
    if (!r.ok) return fail(r);
    ok = m + " is open again."; load();
  }
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function exportIt() {
    error = ""; ok = "";
    const r = await api("GET", `/api/chedam/exports/accountant?kind=${exp.kind}&from=${from}&to=${to}&format=${exp.format}&dates=${exp.dates}`, null, { timeout: 60000 });
    if (!r.ok) return fail(r);
    download(r.json.filename, r.json.csv);
    if (r.json.register) download(r.json.register.filename, r.json.register.csv);
    ok = r.json.filename + ": " + r.json.rows + (exp.kind === "journal" || exp.kind === "sales" || exp.kind === "payroll" ? " journals" : " rows") + (r.json.register ? "; and the payroll register (" + r.json.register.rows + " pay stubs)" : "") + ".";
  }
  const groups = $derived(trial ? Object.keys(TYPE).map((k) => ({ type: k, rows: trial.rows.filter((r) => r.type === k) })).filter((g) => g.rows.length) : []);
</script>

<section class="space-y-4">
  <div class="screen-head"><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Books</h1></div>
  <div class="flex flex-wrap gap-2">{#each [["trial", "Trial balance"], ["journal", "Journal"], ["chart", "Chart of accounts"], ["months", "Months"], ["exports", "Exports"]] as [k, l] (k)}<button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; pending = null; load(); }}>{l}</button>{/each}</div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if tab === "trial" || tab === "journal" || tab === "exports"}
    <div class="card flex flex-wrap items-end gap-2">
      <label class="block"><span class="text-sm text-muted">From</span><input class="field" type="date" bind:value={from} /></label>
      <label class="block"><span class="text-sm text-muted">To</span><input class="field" type="date" bind:value={to} /></label>
      {#if tab === "journal"}<label class="block"><span class="text-sm text-muted">Account</span><select class="field" bind:value={account}><option value="">All</option>{#each chart as a (a.id)}<option value={a.key}>{a.code} {a.name}</option>{/each}</select></label>{/if}
      {#if tab !== "exports"}<button class="btn-ghost min-h-10" onclick={load}>Show</button>{/if}
      {#if tab === "trial" && trial}<ExportMenu title={"Trial balance " + trial.to} rows={trial.rows} columns={[{ key: "code", label: "Code" }, { key: "external_code", label: "Your code" }, { key: "name", label: "Account" }, { key: "type", label: "Type" },
        { key: "d", label: "Debits in period", value: (r) => r.period_dr / 100 }, { key: "c", label: "Credits in period", value: (r) => r.period_cr / 100 }, { key: "b", label: "Balance", value: (r) => r.balance_cents / 100 }]} />{/if}
      {#if tab === "journal" && jr}<ExportMenu title={"Journal " + jr.from + " to " + jr.to} rows={jr.items.flatMap((e) => e.lines.map((l) => ({ day: e.day, memo: e.memo, source: e.source, ...l })))} columns={[{ key: "day", label: "Day" }, { key: "source", label: "Source" }, { key: "memo", label: "Memo" },
        { key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "d", label: "Debit", value: (l) => l.dr / 100 }, { key: "c", label: "Credit", value: (l) => l.cr / 100 }]} />{/if}
    </div>
  {/if}

  {#if tab === "trial" && trial}
    <p class={trial.balanced ? "text-ok" : "text-bad"}>{trial.balanced ? "Balanced" : "Not balanced"}: debits {money(trial.total_dr)} · credits {money(trial.total_cr)} (balances on {trial.to})</p>
    {#each groups as g (g.type)}
      <div class="card overflow-x-auto">
        <h2 class="font-semibold">{TYPE[g.type]}</h2>
        <table class="w-full min-w-[520px] text-sm">
          <thead><tr class="text-left text-muted"><th>Account</th><th class="text-right">Debits</th><th class="text-right">Credits</th><th class="text-right">Balance</th></tr></thead>
          <tbody>{#each g.rows as r (r.key)}<tr class="border-t border-line"><td><button class="text-left underline" onclick={() => { account = r.key; tab = "journal"; load(); }}>{r.code} {r.name}</button></td>
            <td class="text-right">{r.period_dr ? money(r.period_dr) : ""}</td><td class="text-right">{r.period_cr ? money(r.period_cr) : ""}</td><td class="text-right">{money(r.balance_cents)}</td></tr>{/each}</tbody>
        </table>
      </div>
    {/each}
  {:else if tab === "journal" && jr}
    {#if jr.more}<p class="text-sm text-warn">Showing the first 2000 entries; choose a shorter period or an account.</p>{/if}
    {#each jr.items as e, i (i)}
      <div class="card text-sm">
        <p class="flex justify-between"><span><b>{e.day}</b> · {e.memo}</span><span class="text-muted">{e.source}</span></p>
        {#each e.lines as l, k (k)}<p class="flex justify-between {l.cr ? 'pl-6' : ''}"><span>{l.code} {l.name}</span><span>{l.dr ? money(l.dr) : ""}{l.cr ? "(" + money(l.cr) + ")" : ""}</span></p>{/each}
      </div>
    {:else}<p class="text-muted">No entries in this period.</p>{/each}
  {:else if tab === "chart"}
    <p class="text-sm text-muted">Chedam posts to these accounts by fixed rules. Rename or renumber them, and give your own code (QuickBooks, Xero) for the exports.</p>
    {#each Object.keys(TYPE) as ty (ty)}
      <div class="card space-y-1">
        <h2 class="font-semibold">{TYPE[ty]}</h2>
        {#each chart.filter((a) => a.type === ty) as a (a.id)}
          {#if edit && edit.id === a.id}
            <form class="grid gap-2 sm:grid-cols-4" onsubmit={saveAcc}>
              <input class="field" bind:value={edit.code} maxlength="20" aria-label="Code" />
              <input class="field sm:col-span-2" bind:value={edit.name} maxlength="120" aria-label="Name" />
              <input class="field" bind:value={edit.external_code} maxlength="40" placeholder="Your code" aria-label="Your code" />
              <div class="flex gap-2 sm:col-span-4"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (edit = null)}>Cancel</button></div>
            </form>
          {:else}
            <button class="flex w-full justify-between border-b border-line text-left text-sm" onclick={() => (edit = { ...a })}><span>{a.code} {a.name}</span><span class="text-muted">{a.external_code}</span></button>
          {/if}
        {/each}
      </div>
    {/each}
  {:else if tab === "exports"}
    <div class="card grid gap-2 sm:grid-cols-3">
      <label class="block"><span class="text-sm text-muted">What</span><select class="field" bind:value={exp.kind}>
        <option value="journal">General journal (everything)</option><option value="sales">Sales journal (one a day)</option><option value="payroll">Payroll journal and register</option>
        <option value="expenses">Expense claims</option><option value="bank">Bank reconciliation</option></select></label>
      <label class="block"><span class="text-sm text-muted">For</span><select class="field" bind:value={exp.format}><option value="quickbooks">QuickBooks Online</option><option value="xero">Xero</option></select></label>
      <label class="block"><span class="text-sm text-muted">Dates</span><select class="field" bind:value={exp.dates}><option value="iso">2026-10-31</option><option value="dmy">31/10/2026</option><option value="mdy">10/31/2026</option></select></label>
      <p class="text-sm text-muted sm:col-span-3">Accounts go out by your code (Chart of accounts) when set. Sales, returns and stock come as one journal a day.</p>
      <button class="btn sm:col-span-3" onclick={exportIt}>Download the CSV</button>
    </div>
  {:else if tab === "months"}
    {#if pending}
      <div class="card space-y-1 border-warn">
        <p class="font-semibold">Before closing {pending.month}:</p>
        {#each pending.warnings as w (w)}<p class="text-sm text-warn">⚠ {w}</p>{/each}
        <div class="flex gap-2"><button class="btn min-h-10 text-sm" onclick={() => close(pending.month, true)}>Close it anyway</button><button class="btn-ghost min-h-10 text-sm" onclick={() => (pending = null)}>Not yet</button></div>
      </div>
    {/if}
    {#each months as m (m.month)}
      <div class="card flex flex-wrap items-center justify-between gap-2">
        <span><b>{m.month}</b> · <span class={m.status === "closed" ? "text-ok" : "text-muted"}>{m.status === "closed" ? "Closed by " + m.closed_by : m.ended ? "Open" : "Current month"}</span>{m.reopen_reason && m.status === "open" ? " · reopened: " + m.reopen_reason : ""}</span>
        {#if m.status === "open" && m.ended}<button class="btn min-h-10 text-sm" onclick={() => close(m.month)}>Close</button>
        {:else if m.status === "closed" && isOwner()}<button class="btn-ghost min-h-10 text-sm" onclick={() => reopen(m.month)}>Reopen</button>{/if}
      </div>
    {/each}
    <p class="text-sm text-muted">A closed month refuses bills, payments, expenses, payroll, bank lines and deposits dated in it.</p>
  {/if}
</section>

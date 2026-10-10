<script>
  // Payroll (P4 step 5; FR-9.11-9.13, P4-c), payroll.manage (the accountant; the owner). Runs: a new run for
  // a pay period that has ended (people whose time sheet is not approved are listed as waiting); each line's
  // hours and earnings worked out by Chedam; the deductions are ENTERED from the CRA payroll calculator (PDOC)
  // or the accountant, never calculated; finalise (pay stubs to each person), record the payment.
  // T4: the year's boxes per employee. ROE: the data for someone who left.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import ExportMenu from "../components/ExportMenu.svelte";

  const ST = { draft: "Draft", finalized: "Finalised, to pay", paid: "Paid", cancelled: "Cancelled" };
  const PAID = { direct_deposit: "Direct deposit", e_transfer: "E-transfer", cheque: "Cheque", cash: "Cash" };
  const ENTER = [["stat_cents", "Stat holiday pay"], ["other_earnings_cents", "Other earnings"], ["cpp_cents", "CPP"], ["cpp2_cents", "CPP2"], ["ei_cents", "EI"], ["tax_cents", "Income tax"], ["other_deductions_cents", "Other deductions"]];
  let tab = $state("runs"), list = $state(null), run = $state(null), error = $state(""), ok = $state(""), form = $state(null), edit = $state(null), pay = $state(null);
  let year = $state(String(new Date().getFullYear())), t4 = $state(null), emps = $state([]), roe = $state(null), roeEmp = $state("");
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const h = (m) => Math.round(m / 6) / 10;
  const today = () => new Date().toISOString().substring(0, 10);

  async function load() {
    error = "";
    if (tab === "runs") { const r = await api("GET", "/api/chedam/payroll"); if (r.ok) list = r.json; else await fail(r); }
    if (tab === "t4") { const r = await api("GET", "/api/chedam/payroll/t4?year=" + year); if (r.ok) t4 = r.json; else await fail(r); }
    if (tab === "roe" && !emps.length) { const r = await api("GET", "/api/chedam/payroll"); if (r.ok) emps = r.json.employees; else await fail(r); }
  }
  onMount(load);
  async function open(id) { const r = await api("GET", "/api/chedam/payroll/" + id); if (r.ok) { run = r.json; edit = null; } else fail(r); }
  async function create(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/payroll", { period: form.period, pay_date: form.pay_date, note: form.note });
    if (!r.ok) return fail(r);
    form = null; run = r.json; load();
  }
  function startEdit(l) { edit = { id: l.id, note: l.note }; ENTER.forEach(([k]) => (edit[k] = l[k] || l.deductions_entered ? (l[k] / 100).toFixed(2) : "")); }
  async function saveLine(e) {
    e.preventDefault();
    const b = { note: edit.note };
    ENTER.forEach(([k]) => { if (edit[k] !== "") b[k] = Math.round(Number(edit[k]) * 100); });
    const r = await api("POST", `/api/chedam/payroll/${run.id}/lines/${edit.id}`, b);
    if (!r.ok) return fail(r);
    run = r.json; edit = null;
  }
  async function act(action, body) {
    if (action === "finalize" && !confirm("Finalise? Pay stubs go to each person and nothing can be changed.")) return;
    if (action === "cancel" && !confirm("Cancel this draft payroll?")) return;
    const r = await api("POST", `/api/chedam/payroll/${run.id}/${action}`, body || {});
    if (!r.ok) return fail(r);
    run = action === "cancel" ? null : r.json; pay = null; ok = { finalize: "Finalised; pay stubs sent.", paid: "Payment recorded.", cancel: "Cancelled." }[action]; load();
  }
  async function loadRoe() { if (!roeEmp) return; const r = await api("GET", "/api/chedam/payroll/roe/" + roeEmp); if (r.ok) roe = r.json; else { roe = null; fail(r); } }
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => (run ? (run = null) : go("home"))}>← Back</button><h1 class="text-xl font-bold">Payroll{run ? " " + run.number : ""}</h1></div>
    {#if tab === "runs" && !run && list}<button class="btn min-h-10 text-sm" onclick={() => (form = { period: list.last_period.start, pay_date: today(), note: "" })}>New payroll</button>{/if}
  </div>
  {#if !run}<div class="flex flex-wrap gap-2">{#each [["runs", "Pay runs"], ["t4", "T4"], ["roe", "ROE"]] as [k, l] (k)}<button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; load(); }}>{l}</button>{/each}</div>{/if}
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if form}
    <form class="card grid gap-2 sm:grid-cols-3" onsubmit={create}>
      <label class="block"><span class="text-sm text-muted">A day in the pay period</span><input class="field" type="date" bind:value={form.period} required /></label>
      <label class="block"><span class="text-sm text-muted">Pay date</span><input class="field" type="date" bind:value={form.pay_date} required /></label>
      <label class="block"><span class="text-sm text-muted">Note</span><input class="field" bind:value={form.note} maxlength="500" /></label>
      <p class="text-sm text-muted sm:col-span-3">Hourly people are paid from their approved time sheet; salaried people get their salary for the period.</p>
      <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit">Make the payroll</button><button class="btn-ghost" type="button" onclick={() => (form = null)}>Cancel</button></div>
    </form>
  {/if}

  {#if run}
    <div class="card space-y-1">
      <p><b>{run.period_start} to {run.period_end}</b> · paid on {run.pay_date} · <span class={run.status === "paid" ? "text-ok" : "text-warn"}>{ST[run.status]}</span>{run.paid_method ? " · " + PAID[run.paid_method] + (run.paid_ref ? " " + run.paid_ref : "") : ""}</p>
      <p class="text-sm">Gross {money(run.gross_cents)} · deductions {money(run.deductions_cents)} · reimbursements {money(run.reimbursements_cents)} · <b>net {money(run.net_cents)}</b> · employer's CPP and EI {money(run.employer_cents)}</p>
      {#each run.waiting || [] as w (w.user)}<p class="text-sm text-warn">⚠ {w.legal_name}: hours not approved yet (time sheet {w.status.replace("_", " ")}); not in this payroll</p>{/each}
      <div class="flex flex-wrap gap-2 pt-1">
        {#if run.status === "draft"}<button class="btn min-h-10 text-sm" onclick={() => act("finalize")}>Finalise</button><button class="btn-ghost min-h-10 text-sm" onclick={() => act("cancel")}>Cancel the draft</button>{/if}
        {#if run.status === "finalized"}<button class="btn min-h-10 text-sm" onclick={() => (pay = { method: "direct_deposit", reference: "", day: run.pay_date })}>Record the payment</button>{/if}
        <ExportMenu title={"Payroll " + run.number} rows={run.lines} columns={[{ key: "legal_name", label: "Employee" }, { key: "pay_type", label: "Pay" }, { key: "rh", label: "Regular h", value: (l) => h(l.regular_min) }, { key: "oh", label: "Overtime h", value: (l) => h(l.overtime_min + l.double_min) },
          { key: "g", label: "Gross", value: (l) => l.gross_cents / 100 }, { key: "v", label: "Vacation pay", value: (l) => l.vacation_pay_cents / 100 }, { key: "cpp", label: "CPP", value: (l) => (l.cpp_cents + l.cpp2_cents) / 100 }, { key: "ei", label: "EI", value: (l) => l.ei_cents / 100 },
          { key: "tax", label: "Income tax", value: (l) => l.tax_cents / 100 }, { key: "re", label: "Reimbursed", value: (l) => l.reimbursements_cents / 100 }, { key: "n", label: "Net", value: (l) => l.net_cents / 100 }]} />
      </div>
      {#if pay}
        <form class="flex flex-wrap items-end gap-2" onsubmit={(e) => { e.preventDefault(); act("paid", pay); }}>
          <label class="block"><span class="text-sm text-muted">How</span><select class="field" bind:value={pay.method}>{#each Object.entries(PAID) as [k, l] (k)}<option value={k}>{l}</option>{/each}</select></label>
          <label class="block"><span class="text-sm text-muted">Reference</span><input class="field" bind:value={pay.reference} maxlength="80" /></label>
          <label class="block"><span class="text-sm text-muted">Day</span><input class="field" type="date" bind:value={pay.day} /></label>
          <button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (pay = null)}>Cancel</button>
        </form>
      {/if}
    </div>
    {#each run.lines as l (l.id)}
      <div class="card space-y-1 {run.status === 'draft' && !l.deductions_entered ? 'border-warn' : ''}">
        <p class="flex flex-wrap justify-between gap-2"><b>{l.legal_name}</b><span>gross {money(l.gross_cents)} · <b>net {money(l.net_cents)}</b></span></p>
        <p class="text-sm text-muted">
          {#if l.pay_type === "salary"}Salary {money(l.salary_cents)}{l.unpaid_cents ? " · unpaid " + h(l.unpaid_min) + " h −" + money(l.unpaid_cents) : ""}
          {:else}{h(l.regular_min)} h × {money(l.rate_cents)} = {money(l.regular_cents)}{l.sick_cents ? " · sick " + h(l.sick_min) + " h " + money(l.sick_cents) : ""} · vacation pay {l.vacation_pct}% {money(l.vacation_pay_cents)}{/if}
          {l.overtime_cents ? " · overtime " + h(l.overtime_min) + " h " + money(l.overtime_cents) : ""}{l.double_cents ? " · double " + h(l.double_min) + " h " + money(l.double_cents) : ""}{l.stat_cents ? " · stat " + money(l.stat_cents) : ""}{l.other_earnings_cents ? " · other " + money(l.other_earnings_cents) : ""}
        </p>
        <p class="text-sm">{l.deductions_entered ? "CPP " + money(l.cpp_cents + l.cpp2_cents) + " · EI " + money(l.ei_cents) + " · tax " + money(l.tax_cents) + (l.other_deductions_cents ? " · other " + money(l.other_deductions_cents) : "") : "Deductions not entered yet"}{l.reimbursements_cents ? " · paid back " + money(l.reimbursements_cents) + " (" + l.reimbursed.join(", ") + ")" : ""}</p>
        {#if run.status === "draft"}
          {#if edit && edit.id === l.id}
            <form class="grid gap-2 sm:grid-cols-4" onsubmit={saveLine}>
              {#each ENTER as [k, lab] (k)}<label class="block"><span class="text-sm text-muted">{lab} ($)</span><input class="field" inputmode="decimal" bind:value={edit[k]} /></label>{/each}
              <label class="block"><span class="text-sm text-muted">Note</span><input class="field" bind:value={edit.note} maxlength="300" /></label>
              <p class="text-sm text-muted sm:col-span-4">From the CRA payroll calculator (PDOC) for gross {money(l.gross_cents)}; enter 0 when there is none.</p>
              <div class="flex gap-2 sm:col-span-4"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (edit = null)}>Cancel</button></div>
            </form>
          {:else}<button class="text-sm text-accent underline" onclick={() => startEdit(l)}>Enter deductions and extras</button>{/if}
        {/if}
      </div>
    {/each}
  {:else if tab === "runs" && list}
    {#each list.waiting as w (w.user)}<p class="text-sm text-warn">⚠ {list.last_period.start} to {list.last_period.end}: {w.legal_name}'s time sheet is not approved yet</p>{/each}
    {#each list.items as x (x.id)}
      <button class="card flex w-full flex-wrap justify-between gap-2 text-left" onclick={() => open(x.id)}>
        <span><b>{x.number}</b> · {x.period_start} to {x.period_end} · pay date {x.pay_date}</span>
        <span>net {money(x.net_cents)} · <span class={x.status === "paid" ? "text-ok" : x.status === "cancelled" ? "text-muted" : "text-warn"}>{ST[x.status]}</span></span>
      </button>
    {:else}<p class="text-muted">No payroll yet.</p>{/each}
  {:else if tab === "t4" && t4}
    <div class="card flex flex-wrap items-end justify-between gap-2">
      <label class="block"><span class="text-sm text-muted">Year (by pay date)</span><input class="field w-28" inputmode="numeric" bind:value={year} onchange={load} /></label>
      <ExportMenu title={"T4 " + t4.year} rows={t4.items} columns={[{ key: "legal_name", label: "Employee" }, { key: "sin", label: "SIN" }, { key: "address", label: "Address" }, { key: "b14", label: "Box 14", value: (x) => x.box14 / 100 },
        { key: "b16", label: "Box 16", value: (x) => x.box16 / 100 }, { key: "b16a", label: "Box 16A", value: (x) => x.box16a / 100 }, { key: "b18", label: "Box 18", value: (x) => x.box18 / 100 }, { key: "b22", label: "Box 22", value: (x) => x.box22 / 100 },
        { key: "b24", label: "Box 24", value: (x) => x.box24 / 100 }, { key: "b26", label: "Box 26", value: (x) => x.box26 / 100 }]} />
    </div>
    <p class="text-sm text-muted">{t4.note}</p>
    <div class="overflow-x-auto"><table class="w-full min-w-[640px] text-sm">
      <thead><tr class="text-left"><th>Employee</th><th>14 Income</th><th>16 CPP</th><th>16A CPP2</th><th>18 EI</th><th>22 Tax</th><th>24 EI earnings</th><th>26 CPP earnings</th></tr></thead>
      <tbody>{#each t4.items as x (x.employee)}<tr class="border-t border-line"><td>{x.legal_name}</td><td>{money(x.box14)}</td><td>{money(x.box16)}</td><td>{money(x.box16a)}</td><td>{money(x.box18)}</td><td>{money(x.box22)}</td><td>{money(x.box24)}</td><td>{money(x.box26)}</td></tr>
      {:else}<tr><td colspan="8" class="text-muted">No pay in {t4.year}.</td></tr>{/each}</tbody>
    </table></div>
  {:else if tab === "roe"}
    <div class="card flex flex-wrap items-end gap-2">
      <label class="block grow"><span class="text-sm text-muted">Employee</span><select class="field" bind:value={roeEmp} onchange={loadRoe}><option value="">Choose…</option>{#each emps as e (e.id)}<option value={e.id}>{e.legal_name}{e.status === "ended" ? " (left " + e.end_date + ")" : ""}</option>{/each}</select></label>
    </div>
    {#if roe}
      <div class="card space-y-1 text-sm">
        <p><b>{roe.legal_name}</b> · SIN {roe.sin} · {roe.job_title} · pay periods {roe.pay_period_type}{roe.status !== "ended" ? " · still working: set the end date in People first" : ""}</p>
        <p>Block 10 first day worked: <b>{roe.block10_first_day}</b> · 11 last day paid: <b>{roe.block11_last_day_paid}</b> · 12 final pay period ending: <b>{roe.block12_final_period_end}</b></p>
        <p>Block 15A insurable hours: <b>{roe.block15a_insurable_hours}</b> · 15B total insurable earnings: <b>{money(roe.block15b_total_cents)}</b> · 17A vacation pay in the final pay: <b>{money(roe.block17a_vacation_pay_cents)}</b></p>
        <p class="text-muted">15C insurable earnings by pay period (latest first):</p>
        {#each roe.block15c_earnings as p (p.period)}<p>{p.period}. ending {p.period_end}: {money(p.insurable_cents)}</p>{/each}
        <p class="text-muted">File the ROE in ROE Web (Service Canada) with these figures; the reason for leaving is chosen there.</p>
      </div>
    {/if}
  {/if}
</section>

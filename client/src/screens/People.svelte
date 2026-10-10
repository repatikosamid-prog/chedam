<script>
  // People (P4 step 1; FR-9.09, 9.10): everyone sees their own record and leave balances ("Me"); managers
  // (hr.view) see the staff list, records without pay, SIN or bank, and record leave taken; the owner
  // (hr.manage) adds and changes records, pay, SIN (shown masked, revealed on request and logged) and bank
  // details, and adjusts leave balances with a reason.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import ExportMenu from "../components/ExportMenu.svelte";

  const staff = can("hr.view") || can("hr.manage"), owner = can("hr.manage");
  const KIND = { vacation: "Vacation", sick: "Sick", unpaid: "Unpaid" };
  const SRC = { accrual: "Earned", grant: "Yearly grant", taken: "Taken", adjust: "Adjusted", expire: "Expired", payroll: "From pay" };
  const STATUS = { active: "Working", on_leave: "On leave", ended: "Left" };
  const FREQ = { weekly: "Weekly", biweekly: "Every 2 weeks", semimonthly: "Twice a month", monthly: "Monthly" };
  let tab = $state(staff ? "staff" : "me"), data = $state(null), me = $state(undefined), error = $state(""), ok = $state("");
  let open = $state(null), hist = $state([]), form = $state(null), lv = $state(null), sin = $state(""), stubs = $state([]), stub = $state(null);
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const today = () => new Date().toISOString().substring(0, 10);
  const hrs = (h) => (Math.round(h * 100) / 100) + " h";

  async function load() {
    error = "";
    if (tab === "me") {
      const r = await api("GET", "/api/chedam/me/employee");
      if (r.ok) { me = r.json.employee; if (me) loadHist(me.id); } else await fail(r);
      const p = await api("GET", "/api/chedam/me/paystubs", null, { quiet: true });
      stubs = p.ok ? p.json.items : [];
      return;
    }
    const r = await api("GET", "/api/chedam/employees");
    if (r.ok) data = r.json; else await fail(r);
  }
  onMount(load);
  async function loadHist(id) { const r = await api("GET", `/api/chedam/employees/${id}/leave`, null, { quiet: true }); hist = r.ok ? r.json.items : []; }
  async function show(x) {
    if (open && open.id === x.id) { open = null; return; }
    sin = ""; lv = null; form = null;
    const r = await api("GET", `/api/chedam/employees/${x.id}`);
    if (!r.ok) return fail(r);
    open = r.json; loadHist(x.id);
  }

  function edit(x) {
    form = x ? { ...x, pay: x.pay_rate_cents != null ? (x.pay_rate_cents / 100).toFixed(2) : "", sin: "", bank: { institution: x.bank ? x.bank.institution : "", transit: x.bank ? x.bank.transit : "", account: "" }, files: [] }
      : { user: data.without_record.length ? data.without_record[0].id : "", legal_name: "", job_title: "", start_date: today(), status: "active", pay_type: "hourly", pay_frequency: "biweekly", pay: "",
          hours_per_week: 40, overtime_eligible: true, vacation_pct: 4, vacation_days_per_year: 10, sick_days_per_year: 5, sin: "", bank: { institution: "", transit: "", account: "" }, files: [] };
  }
  async function save(e) {
    e.preventDefault();
    const b = {};
    ["id", "user", "legal_name", "job_title", "start_date", "end_date", "status", "birth_date", "street", "city", "province", "postal_code", "personal_email", "personal_phone",
      "emergency_name", "emergency_phone", "emergency_relation", "pay_type", "pay_frequency", "notes"].forEach((k) => { if (form[k] !== undefined && form[k] !== null) b[k] = form[k]; });
    ["hours_per_week", "vacation_pct", "vacation_days_per_year", "sick_days_per_year"].forEach((k) => { if (form[k] !== "" && form[k] != null) b[k] = Number(form[k]); });
    b.overtime_eligible = !!form.overtime_eligible;
    if (form.pay !== "") b.pay_rate_cents = Math.round(Number(form.pay) * 100);
    if (form.sin) b.sin = form.sin;
    if (form.bank.account || (!form.id && (form.bank.institution || form.bank.transit))) b.bank = form.bank;
    const f = new FormData();
    f.append("data", JSON.stringify(b));
    form.files.forEach((x) => f.append("documents", x));
    const r = await api("POST", "/api/chedam/employees", f, { timeout: 30000 });
    if (!r.ok) return fail(r);
    ok = r.json.legal_name + " saved."; form = null; open = r.json; loadHist(r.json.id); load();
  }
  async function reveal() {
    if (!confirm("Show the full SIN? Who looked and when is recorded.")) return;
    const r = await api("POST", `/api/chedam/employees/${open.id}/sin`, {});
    if (r.ok) sin = r.json.sin || "(none)"; else fail(r);
  }
  async function saveLeave(e) {
    e.preventDefault();
    const r = await api("POST", `/api/chedam/employees/${open.id}/leave`, { kind: lv.kind, hours: Number(lv.hours), day: lv.day, note: lv.note, source: lv.source });
    if (!r.ok) return fail(r);
    open = r.json; lv = null; loadHist(open.id); load();
  }
  async function fileLink(x, name) {
    const t = await api("POST", "/api/files/token", {}, { quiet: true });
    if (t.ok) window.open(`/api/files/${x.collectionId}/${x.id}/${name}?token=${t.json.token}`, "_blank", "noopener");
  }
</script>

{#snippet leaveBox(x)}
  <div class="grid grid-cols-3 gap-2">
    {#each Object.keys(KIND) as k (k)}<div class="rounded-xl border border-line p-2"><p class="text-sm text-muted">{KIND[k]}</p><p class="text-lg font-semibold">{hrs(x.leave[k])}</p></div>{/each}
  </div>
{/snippet}
{#snippet history()}
  {#each hist as h, i (i)}<p class="flex justify-between border-b border-line text-sm"><span>{h.day} · {KIND[h.kind]} · {SRC[h.source]}{h.note ? " · " + h.note : ""}{h.by ? " · " + h.by : ""}</span>
    <span class={h.hours < 0 ? "text-bad" : "text-ok"}>{h.hours > 0 ? "+" : ""}{hrs(h.hours)}</span></p>{:else}<p class="text-sm text-muted">No leave yet.</p>{/each}
{/snippet}

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">People</h1></div>
    {#if owner && tab === "staff" && data && data.without_record.length}<button class="btn min-h-10 text-sm" onclick={() => { open = null; edit(null); }}>Add a record</button>{/if}
  </div>
  <div class="flex flex-wrap gap-2">
    {#each [["staff", "Staff", staff], ["me", "Me", true]].filter((x) => x[2]) as [k, l] (k)}
      <button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; open = null; form = null; load(); }}>{l}</button>{/each}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if form}
    <form class="card grid gap-2 sm:grid-cols-3" onsubmit={save}>
      <h2 class="font-semibold sm:col-span-3">{form.id ? "Change " + form.legal_name : "New employee record"}</h2>
      {#if !form.id}<label class="block sm:col-span-3"><span class="text-sm text-muted">Person (everyone who signs in)</span><select class="field" bind:value={form.user} required>{#each data.without_record as u (u.id)}<option value={u.id}>{u.name}</option>{/each}</select></label>{/if}
      <label class="block"><span class="text-sm text-muted">Legal name (pay stubs, T4)</span><input class="field" bind:value={form.legal_name} required maxlength="120" /></label>
      <label class="block"><span class="text-sm text-muted">Job title</span><input class="field" bind:value={form.job_title} maxlength="80" /></label>
      <label class="block"><span class="text-sm text-muted">Status</span><select class="field" bind:value={form.status}>{#each Object.entries(STATUS) as [k, l] (k)}<option value={k}>{l}</option>{/each}</select></label>
      <label class="block"><span class="text-sm text-muted">Start date</span><input class="field" type="date" bind:value={form.start_date} /></label>
      <label class="block"><span class="text-sm text-muted">End date</span><input class="field" type="date" bind:value={form.end_date} /></label>
      <label class="block"><span class="text-sm text-muted">Birth date</span><input class="field" type="date" bind:value={form.birth_date} /></label>
      <label class="block sm:col-span-2"><span class="text-sm text-muted">Street</span><input class="field" bind:value={form.street} maxlength="200" /></label>
      <label class="block"><span class="text-sm text-muted">City</span><input class="field" bind:value={form.city} maxlength="80" /></label>
      <label class="block"><span class="text-sm text-muted">Province</span><input class="field" bind:value={form.province} maxlength="40" placeholder="BC" /></label>
      <label class="block"><span class="text-sm text-muted">Postal code</span><input class="field" bind:value={form.postal_code} maxlength="12" /></label>
      <label class="block"><span class="text-sm text-muted">Personal phone</span><input class="field" bind:value={form.personal_phone} maxlength="40" /></label>
      <label class="block"><span class="text-sm text-muted">Personal email</span><input class="field" type="email" bind:value={form.personal_email} maxlength="120" /></label>
      <label class="block"><span class="text-sm text-muted">Emergency contact</span><input class="field" bind:value={form.emergency_name} maxlength="120" /></label>
      <label class="block"><span class="text-sm text-muted">Their phone</span><input class="field" bind:value={form.emergency_phone} maxlength="40" /></label>
      <label class="block"><span class="text-sm text-muted">Relation</span><input class="field" bind:value={form.emergency_relation} maxlength="60" /></label>
      <h3 class="pt-2 font-semibold sm:col-span-3">Pay</h3>
      <label class="block"><span class="text-sm text-muted">Pay type</span><select class="field" bind:value={form.pay_type}><option value="hourly">Hourly</option><option value="salary">Salary</option></select></label>
      <label class="block"><span class="text-sm text-muted">{form.pay_type === "salary" ? "Salary a year ($)" : "Rate an hour ($)"}</span><input class="field" inputmode="decimal" bind:value={form.pay} /></label>
      <label class="block"><span class="text-sm text-muted">Paid</span><select class="field" bind:value={form.pay_frequency}>{#each Object.entries(FREQ) as [k, l] (k)}<option value={k}>{l}</option>{/each}</select></label>
      <label class="block"><span class="text-sm text-muted">Hours a week</span><input class="field" type="number" min="0" max="80" step="0.5" bind:value={form.hours_per_week} /></label>
      <label class="block"><span class="text-sm text-muted">Vacation pay %</span><input class="field" type="number" min="0" max="20" step="0.5" bind:value={form.vacation_pct} /></label>
      <label class="flex min-h-12 items-center gap-2"><input type="checkbox" bind:checked={form.overtime_eligible} /> Overtime paid</label>
      <label class="block"><span class="text-sm text-muted">Vacation days a year</span><input class="field" type="number" min="0" max="60" bind:value={form.vacation_days_per_year} /></label>
      <label class="block"><span class="text-sm text-muted">Sick days a year</span><input class="field" type="number" min="0" max="30" bind:value={form.sick_days_per_year} /></label>
      <h3 class="pt-2 font-semibold sm:col-span-3">SIN and bank (encrypted; only the owner sees them)</h3>
      <label class="block"><span class="text-sm text-muted">SIN {form.sin_last3 ? "(now " + form.sin_last3 + "; blank keeps it)" : ""}</span><input class="field" inputmode="numeric" autocomplete="off" bind:value={form.sin} maxlength="11" /></label>
      <label class="block"><span class="text-sm text-muted">Institution (3)</span><input class="field" inputmode="numeric" bind:value={form.bank.institution} maxlength="3" /></label>
      <label class="block"><span class="text-sm text-muted">Transit (5)</span><input class="field" inputmode="numeric" bind:value={form.bank.transit} maxlength="5" /></label>
      <label class="block"><span class="text-sm text-muted">Account {form.id && form.bank_masked ? "(blank keeps it)" : ""}</span><input class="field" inputmode="numeric" autocomplete="off" bind:value={form.bank.account} maxlength="12" /></label>
      <label class="block sm:col-span-3"><span class="text-sm text-muted">Notes</span><textarea class="field" bind:value={form.notes} maxlength="2000"></textarea></label>
      <label class="btn-ghost flex min-h-12 cursor-pointer items-center sm:col-span-3">📎 Documents (contract, TD1, permit) {form.files.length ? "(" + form.files.length + ")" : ""}<input class="sr-only" type="file" accept="image/*,application/pdf" multiple onchange={(e) => (form.files = [...form.files, ...e.currentTarget.files].slice(0, 5))} /></label>
      <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (form = null)}>Cancel</button></div>
    </form>
  {/if}

  {#if tab === "me"}
    {#if me === null}<p class="text-muted">There is no employee record for you yet. Ask the owner.</p>
    {:else if me}
      <div class="card space-y-2">
        <p class="text-lg font-semibold">{me.legal_name}</p>
        <p class="text-sm text-muted">{me.job_title || "—"} · since {me.start_date || "—"} · {STATUS[me.status]} · {me.pay_type === "salary" ? "Salary" : "Hourly"}{me.pay_frequency ? ", paid " + FREQ[me.pay_frequency].toLowerCase() : ""}</p>
        {@render leaveBox(me)}
        <p class="text-sm">{[me.street, me.city, me.province, me.postal_code].filter(Boolean).join(", ") || "No address"} · {me.personal_phone || "no phone"} · {me.personal_email || "no email"}</p>
        <p class="text-sm">Emergency: {me.emergency_name || "—"} {me.emergency_phone} {me.emergency_relation ? "(" + me.emergency_relation + ")" : ""}</p>
        <p class="text-sm text-muted">SIN on file: {me.sin_last3 || "none"}. Something wrong? Tell the owner.</p>
      </div>
      <div class="card space-y-1"><h2 class="font-semibold">My leave</h2>{@render history()}</div>
      <div class="card space-y-1">
        <h2 class="font-semibold">Pay stubs</h2>
        {#each stubs as p (p.id)}
          <button class="flex w-full justify-between border-b border-line text-left text-sm" onclick={() => (stub = stub && stub.id === p.id ? null : p)}><span>{p.pay_date} · {p.period_start} to {p.period_end}</span><span>net <b>{money(p.net_cents)}</b></span></button>
          {#if stub && stub.id === p.id}
            <div class="space-y-1 rounded-xl border border-line p-2 text-sm">
              <p>{p.number} · {p.legal_name}</p>
              {#if p.pay_type === "salary"}<p>Salary {money(p.salary_cents)}{p.unpaid_cents ? " · unpaid leave −" + money(p.unpaid_cents) : ""}</p>
              {:else}<p>{Math.round(p.regular_min / 6) / 10} h × {money(p.rate_cents)} = {money(p.regular_cents)}{p.sick_cents ? " · sick pay " + money(p.sick_cents) : ""} · vacation pay {money(p.vacation_pay_cents)}</p>{/if}
              {#if p.overtime_cents + p.double_cents}<p>Overtime {money(p.overtime_cents + p.double_cents)}</p>{/if}
              {#if p.stat_cents + p.other_earnings_cents}<p>Stat holiday {money(p.stat_cents)} · other {money(p.other_earnings_cents)}</p>{/if}
              <p><b>Gross {money(p.gross_cents)}</b> · CPP {money(p.cpp_cents + p.cpp2_cents)} · EI {money(p.ei_cents)} · income tax {money(p.tax_cents)}{p.other_deductions_cents ? " · other " + money(p.other_deductions_cents) : ""}</p>
              {#if p.reimbursements_cents}<p>Expenses paid back {money(p.reimbursements_cents)} ({p.reimbursed.join(", ")})</p>{/if}
              <p><b>Net {money(p.net_cents)}</b></p>
              <p class="text-muted">Year to date: gross {money(p.ytd.gross_cents)} · CPP {money(p.ytd.cpp_cents + p.ytd.cpp2_cents)} · EI {money(p.ytd.ei_cents)} · tax {money(p.ytd.tax_cents)} · net {money(p.ytd.net_cents)}</p>
              <button class="btn-ghost min-h-10 text-sm" onclick={() => window.print()}>Print</button>
            </div>
          {/if}
        {:else}<p class="text-sm text-muted">No pay stubs yet.</p>{/each}
      </div>
    {/if}
  {:else if data}
    <div class="card flex flex-wrap justify-between gap-2 text-sm"><span>{data.employees.filter((x) => x.status !== "ended").length} working · {data.without_record.length} without a record</span>
      <ExportMenu title="People" rows={data.employees} columns={[{ key: "legal_name", label: "Name" }, { key: "job_title", label: "Job" }, { key: "start_date", label: "Start" }, { key: "status", label: "Status" }, { key: "pay_type", label: "Pay type" },
        { key: "v", label: "Vacation h", value: (x) => x.leave.vacation }, { key: "s", label: "Sick h", value: (x) => x.leave.sick }, { key: "emergency_name", label: "Emergency" }, { key: "emergency_phone", label: "Emergency phone" }]} /></div>
    {#each data.employees as x (x.id)}
      <div class="card space-y-2">
        <button class="flex w-full flex-wrap justify-between gap-2 text-left" onclick={() => show(x)}>
          <span><b>{x.legal_name}</b> · {x.job_title || "—"} <span class="text-sm text-muted">({x.name})</span></span>
          <span class="text-sm {x.status === 'ended' ? 'text-muted' : x.status === 'on_leave' ? 'text-warn' : 'text-ok'}">{STATUS[x.status]} · vac {hrs(x.leave.vacation)} · sick {hrs(x.leave.sick)}</span>
        </button>
        {#if open && open.id === x.id}
          <p class="text-sm text-muted">Since {open.start_date || "—"}{open.end_date ? " to " + open.end_date : ""} · {open.pay_type === "salary" ? "Salary" : "Hourly"}{open.pay_frequency ? ", " + FREQ[open.pay_frequency].toLowerCase() : ""} · {open.hours_per_week || 0} h a week{open.overtime_eligible ? " · overtime paid" : ""}</p>
          {#if data.full}
            <p class="text-sm">Pay: <b>{money(open.pay_rate_cents)}</b>{open.pay_type === "salary" ? " a year" : " an hour"} · vacation pay {open.vacation_pct}% · bank {open.bank.institution || "—"}-{open.bank.transit || "—"} {open.bank.account || ""}</p>
            <p class="text-sm">SIN: {sin || open.sin_last3 || "none"} {#if open.has_sin && !sin}<button class="ml-2 text-accent underline" onclick={reveal}>Show</button>{/if}</p>
            <p class="text-sm">{[open.street, open.city, open.province, open.postal_code].filter(Boolean).join(", ")} · {open.personal_phone} · {open.personal_email}{open.birth_date ? " · born " + open.birth_date : ""}</p>
            {#if open.notes}<p class="text-sm text-muted">{open.notes}</p>{/if}
            {#if open.documents.length}<div class="flex flex-wrap gap-2">{#each open.documents as d (d)}<button class="text-sm underline" onclick={() => fileLink(open, d)}>📎 {d.replace(/_[a-z0-9]{10}\./, ".")}</button>{/each}</div>{/if}
          {/if}
          <p class="text-sm">Emergency: {open.emergency_name || "—"} {open.emergency_phone} {open.emergency_relation ? "(" + open.emergency_relation + ")" : ""}</p>
          {@render leaveBox(open)}
          <div class="flex flex-wrap gap-2">
            <button class="btn min-h-10 text-sm" onclick={() => (lv = { kind: "vacation", hours: 8, day: today(), note: "", source: "taken" })}>Record leave taken</button>
            {#if owner}<button class="btn-ghost min-h-10 text-sm" onclick={() => (lv = { kind: "vacation", hours: "", day: today(), note: "", source: "adjust" })}>Adjust a balance</button>
              <button class="btn-ghost min-h-10 text-sm" onclick={() => edit({ ...open, bank_masked: open.bank.account })}>Change the record</button>{/if}
          </div>
          {#if lv}
            <form class="flex flex-wrap items-end gap-2" onsubmit={saveLeave}>
              <label class="block"><span class="text-sm text-muted">Kind</span><select class="field" bind:value={lv.kind}>{#each Object.entries(KIND) as [k, l] (k)}<option value={k}>{l}</option>{/each}</select></label>
              <label class="block"><span class="text-sm text-muted">{lv.source === "adjust" ? "Hours (+ add, − remove)" : "Hours taken"}</span><input class="field w-28" type="number" step="0.25" bind:value={lv.hours} required /></label>
              <label class="block"><span class="text-sm text-muted">Day</span><input class="field" type="date" bind:value={lv.day} /></label>
              <label class="block"><span class="text-sm text-muted">{lv.source === "adjust" ? "Why (needed)" : "Note"}</span><input class="field" bind:value={lv.note} maxlength="300" required={lv.source === "adjust"} /></label>
              <button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (lv = null)}>Cancel</button>
            </form>
          {/if}
          <div class="space-y-1"><h3 class="text-sm font-semibold">Leave history</h3>{@render history()}</div>
        {/if}
      </div>
    {:else}<p class="text-muted">No employee records yet.</p>{/each}
  {/if}
</section>

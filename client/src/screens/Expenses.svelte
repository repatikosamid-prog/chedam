<script>
  // Expenses (P3 step 6; FR-9.01-9.03): claim what you paid for the store (photo of the receipt, GST/PST,
  // category, how it was paid); see your claims; approvers check flagged ones (possible duplicate, missing
  // receipt), approve or reject (with a reason) and pay back (cash from the till, petty cash, cheque,
  // e-transfer, next pay); petty cash: the box's balance, top-ups and counts.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import ExportMenu from "../components/ExportMenu.svelte";

  const approver = can("expenses.approve");
  const PAID = { own_money: "My own money (pay me back)", petty_cash: "Petty cash box", company_card: "Store card", till_cash: "Cash from the till" };
  const BACK = { till_cash: "Cash from the till", petty_cash: "Petty cash box", cheque: "Cheque", e_transfer: "E-transfer", next_pay: "With the next pay" };
  const STATUS = { submitted: "Waiting", approved: "Approved, to pay back", rejected: "Rejected", reimbursed: "Done" };
  let tab = $state(approver ? "all" : "mine"), data = $state(null), error = $state(""), ok = $state("");
  let form = $state(null), act = $state(null), pc = $state(null), tills = $state([]), fileToken = $state("");
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const today = () => new Date().toISOString().substring(0, 10);

  async function load() {
    error = "";
    if (tab === "petty") { const r = await api("GET", "/api/chedam/petty-cash"); if (r.ok) pc = r.json; else await fail(r); return; }
    const r = await api("GET", "/api/chedam/expenses?who=" + (tab === "mine" ? "mine" : ""));
    if (r.ok) data = r.json; else await fail(r);
    if (data && data.items.some((x) => x.receipts.length)) { const t = await api("POST", "/api/files/token", {}, { quiet: true }); fileToken = t.ok ? t.json.token : ""; }
  }
  onMount(load);

  async function submit(e) {
    e.preventDefault();
    const body = { day: form.day, vendor_name: form.vendor, amount_cents: Math.round(Number(form.amount) * 100), gst_cents: Math.round(Number(form.gst || 0) * 100), pst_cents: Math.round(Number(form.pst || 0) * 100),
      category: form.category, paid_with: form.paid_with, note: form.note };
    const f = new FormData();
    f.append("data", JSON.stringify(body));
    form.files.forEach((x) => f.append("receipts", x));
    const r = await api("POST", "/api/chedam/expenses", f, { timeout: 30000 });
    if (!r.ok) return fail(r);
    ok = r.json.number + " sent" + (r.json.flags.length ? " (" + r.json.flags.map(flagText).join("; ") + ")" : "") + ".";
    form = null; load();
  }
  async function addPhoto(x, file) {
    if (!file) return;
    const f = new FormData(); f.append("receipts", file);
    const r = await api("POST", `/api/chedam/expenses/${x.id}/receipts`, f, { timeout: 30000 });
    if (r.ok) load(); else fail(r);
  }
  async function decide(x, action) {
    let body = {};
    if (action === "reject") { const reason = prompt("Why is it rejected?"); if (!reason) return; body = { reason }; }
    const r = await api("POST", `/api/chedam/expenses/${x.id}/${action}`, body);
    if (r.ok) load(); else fail(r);
  }
  async function startBack(x) {
    act = { id: x.id, with: "e_transfer", reference: "", till: "" };
    const r = await api("GET", "/api/collections/tills/records?perPage=20&filter=" + encodeURIComponent("status='open'"), null, { quiet: true });
    tills = r.ok ? r.json.items : [];
    if (tills.length) act.till = tills[0].id;
  }
  async function payBack(e) {
    e.preventDefault();
    const r = await api("POST", `/api/chedam/expenses/${act.id}/reimburse`, { with: act.with, reference: act.reference, till: act.till });
    if (!r.ok) return fail(r);
    act = null; load();
  }
  async function petty(action) {
    const v = prompt(action === "top_up" ? "Amount put in the box ($):" : "Count the box: how much is in it ($)?");
    if (v === null || v === "") return;
    const r = await api("POST", "/api/chedam/petty-cash/" + action, action === "top_up" ? { amount_cents: Math.round(Number(v) * 100) } : { counted_cents: Math.round(Number(v) * 100) });
    if (r.ok) pc = r.json; else fail(r);
  }
  const flagText = (f) => (f === "missing_receipt" ? "no receipt photo" : f.startsWith("duplicate:") ? "same as " + f.substring(10) + "?" : f);
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button><h1 class="text-xl font-bold">Expenses</h1></div>
    <button class="btn min-h-10 text-sm" onclick={() => (form = { day: today(), vendor: "", amount: "", gst: "", pst: "", category: "", paid_with: "own_money", note: "", files: [] })}>New claim</button>
  </div>
  <div class="flex flex-wrap gap-2">
    {#each [["mine", "My claims", true], ["all", "All claims", approver], ["petty", "Petty cash", approver]].filter((x) => x[2]) as [k, l] (k)}
      <button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; load(); }}>{l}</button>{/each}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if ok}<p role="status" class="rounded-xl bg-ok/10 px-3 py-2 text-ok">{ok}</p>{/if}

  {#if form}
    <form class="card grid gap-2 sm:grid-cols-3" onsubmit={submit}>
      <label class="block"><span class="text-sm text-muted">Day</span><input class="field" type="date" bind:value={form.day} /></label>
      <label class="block sm:col-span-2"><span class="text-sm text-muted">Where</span><input class="field" bind:value={form.vendor} maxlength="120" required placeholder="Home Depot" /></label>
      <label class="block"><span class="text-sm text-muted">Paid in all ($)</span><input class="field" inputmode="decimal" bind:value={form.amount} required /></label>
      <label class="block"><span class="text-sm text-muted">GST/HST in it</span><input class="field" inputmode="decimal" bind:value={form.gst} /></label>
      <label class="block"><span class="text-sm text-muted">PST in it</span><input class="field" inputmode="decimal" bind:value={form.pst} /></label>
      <label class="block"><span class="text-sm text-muted">Category</span><select class="field" bind:value={form.category} required><option value="">Choose…</option>{#each (data && data.categories) || [] as c (c)}<option value={c}>{c}</option>{/each}</select></label>
      <label class="block sm:col-span-2"><span class="text-sm text-muted">Paid with</span><select class="field" bind:value={form.paid_with}>{#each Object.entries(PAID) as [k, l] (k)}<option value={k}>{l}</option>{/each}</select></label>
      <label class="block sm:col-span-3"><span class="text-sm text-muted">What for</span><input class="field" bind:value={form.note} maxlength="1000" /></label>
      <label class="btn-ghost flex min-h-12 cursor-pointer items-center sm:col-span-3">📷 Photo of the receipt {form.files.length ? "(" + form.files.length + ")" : ""}<input class="sr-only" type="file" accept="image/*,application/pdf" capture="environment" multiple onchange={(e) => (form.files = [...form.files, ...e.currentTarget.files].slice(0, 5))} /></label>
      <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit">Send the claim</button><button class="btn-ghost" type="button" onclick={() => (form = null)}>Cancel</button></div>
    </form>
  {/if}

  {#if tab === "petty" && pc}
    <div class="card space-y-2">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <p>In the box: <b class="text-2xl">{money(pc.balance_cents)}</b> <span class="text-sm text-muted">float {money(pc.float_cents)}{pc.balance_cents < pc.float_cents ? " · top up " + money(pc.float_cents - pc.balance_cents) : ""}</span></p>
        <div class="flex gap-2"><button class="btn min-h-10 text-sm" onclick={() => petty("top_up")}>Top up</button><button class="btn-ghost min-h-10 text-sm" onclick={() => petty("count")}>Count</button></div>
      </div>
      {#each pc.moves as mv (mv.id)}<p class="flex justify-between border-b border-line text-sm"><span>{new Date(mv.at.replace(" ", "T")).toLocaleString()} · {mv.kind.replace("_", " ")} · {mv.note} · {mv.by}</span>
        <span class={mv.amount_cents < 0 ? "text-bad" : "text-ok"}>{mv.amount_cents ? money(mv.amount_cents) : ""} → {money(mv.balance_cents)}</span></p>{/each}
    </div>
  {:else if data}
    {#if tab === "all"}
      <div class="card flex flex-wrap justify-between gap-2 text-sm"><span>{data.waiting} waiting · {money(data.to_pay_back_cents)} to pay back</span>
        <ExportMenu title="Expenses" rows={data.items} columns={[{ key: "number", label: "No." }, { key: "day", label: "Day" }, { key: "claimant_name", label: "Who" }, { key: "vendor_name", label: "Where" }, { key: "category", label: "Category" },
          { key: "a", label: "Amount", value: (x) => x.amount_cents / 100 }, { key: "g", label: "GST/HST", value: (x) => x.gst_cents / 100 }, { key: "p", label: "PST", value: (x) => x.pst_cents / 100 }, { key: "paid_with", label: "Paid with" }, { key: "status", label: "Status" }]} /></div>
      <p class="text-sm text-muted">{Object.entries(data.by_category).map(([k, v]) => k + " " + money(v)).join(" · ")}</p>
    {/if}
    {#each data.items as x (x.id)}
      <div class="card space-y-1 {x.flags.length && x.status === 'submitted' ? 'border-warn' : ''}">
        <div class="flex flex-wrap justify-between gap-2"><p><b>{x.number} · {x.vendor_name}</b> · {x.day} · {x.category}{tab === "all" ? " · " + x.claimant_name : ""}</p><p><b>{money(x.amount_cents)}</b></p></div>
        <p class="text-sm text-muted">{PAID[x.paid_with]}{x.gst_cents ? " · GST " + money(x.gst_cents) : ""}{x.pst_cents ? " · PST " + money(x.pst_cents) : ""}{x.note ? " · " + x.note : ""}</p>
        <p class="text-sm {x.status === 'rejected' ? 'text-bad' : x.status === 'reimbursed' ? 'text-ok' : 'text-warn'}">{STATUS[x.status]}{x.decided_by ? " · " + x.decided_by : ""}{x.reject_reason ? ": " + x.reject_reason : ""}{x.reimbursed_with ? " · " + BACK[x.reimbursed_with] + (x.reimbursed_ref ? " " + x.reimbursed_ref : "") : ""}</p>
        {#each x.flags as f (f)}<p class="text-sm text-warn">⚠ {flagText(f)}</p>{/each}
        <div class="flex flex-wrap gap-2">
          {#each x.receipts as rc (rc)}<a class="text-sm underline" target="_blank" rel="noopener" href={`/api/files/${x.collectionId}/${x.id}/${rc}?token=${fileToken}`}>📎 receipt</a>{/each}
          {#if x.status === "submitted"}<label class="cursor-pointer text-sm text-accent underline">Add a photo<input class="sr-only" type="file" accept="image/*,application/pdf" capture="environment" onchange={(e) => addPhoto(x, e.currentTarget.files[0])} /></label>{/if}
          {#if tab === "all" && x.status === "submitted"}<button class="btn min-h-10 text-sm" onclick={() => decide(x, "approve")}>Approve</button><button class="btn-ghost min-h-10 text-sm" onclick={() => decide(x, "reject")}>Reject</button>{/if}
          {#if tab === "all" && x.status === "approved"}<button class="btn min-h-10 text-sm" onclick={() => startBack(x)}>Pay back</button>{/if}
        </div>
        {#if act && act.id === x.id}
          <form class="flex flex-wrap items-end gap-2" onsubmit={payBack}>
            <label class="block"><span class="text-sm text-muted">How</span><select class="field" bind:value={act.with}>{#each Object.entries(BACK) as [k, l] (k)}<option value={k}>{l}</option>{/each}</select></label>
            {#if act.with === "till_cash"}<label class="block"><span class="text-sm text-muted">Open till</span><select class="field" bind:value={act.till}>{#each tills as t (t.id)}<option value={t.id}>Till {t.number}</option>{:else}<option value="">No till is open</option>{/each}</select></label>
            {:else}<label class="block"><span class="text-sm text-muted">Cheque no. / reference</span><input class="field" bind:value={act.reference} maxlength="80" /></label>{/if}
            <button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (act = null)}>Cancel</button>
          </form>
        {/if}
      </div>
    {:else}<p class="text-muted">No claims yet.</p>{/each}
  {/if}
</section>

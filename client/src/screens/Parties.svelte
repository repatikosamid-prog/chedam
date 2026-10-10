<script>
  // Vendors and clients (P3 step 1; FR-8.01, 8.07, 8.08): the list (search, vendors / clients), one party's
  // details, contacts, documents and communication log (a follow-up date makes a task), and exchange rates.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";

  const manage = can("parties.manage");
  let tab = $state("list"), list = $state([]), q = $state(""), kind = $state(""), error = $state("");
  let open = $state(null), form = $state(null), contact = $state(null), log = $state({ kind: "call", text: "", contact: "", follow_up: "" });
  let rates = $state([]), rate = $state(null), fileToken = $state("");
  const KINDS = { vendor: "Vendor", client: "Client", both: "Vendor and client" };
  const LOGK = { call: "📞 Call", email: "✉ Email", visit: "🚶 Visit", meeting: "👥 Meeting", note: "📝 Note", order: "📦 Order" };
  const when = (t) => (t ? new Date(String(t).replace(" ", "T")).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const blank = () => ({ kind: "vendor", name: "", legal_name: "", code: "", tax_id: "", pst_number: "", business_number: "", importer: false, exporter: false, currency: "CAD",
    payment_terms_days: 30, terms_text: "", credit_limit: "", email: "", phone: "", website: "", street: "", city: "", province: "BC", postal_code: "", country: "CA", notes: "", active: true });

  async function load() {
    error = "";
    if (tab === "list") {
      const f = ["deleted_at=''"];
      if (kind) f.push(kind === "vendor" ? "(kind='vendor' || kind='both')" : "(kind='client' || kind='both')");
      if (q.trim()) f.push(`(name~'${q.replace(/'/g, "")}' || code~'${q.replace(/'/g, "")}')`);
      const r = await api("GET", "/api/collections/parties/records?perPage=200&sort=name&filter=" + encodeURIComponent(f.join(" && ")));
      if (r.ok) list = r.json.items; else await fail(r);
    } else {
      const r = await api("GET", "/api/collections/fx_rates/records?perPage=100&sort=-day,currency&filter=" + encodeURIComponent("deleted_at=''"));
      if (r.ok) rates = r.json.items; else await fail(r);
    }
  }
  onMount(load);

  async function openParty(id) {
    const r = await api("GET", "/api/chedam/parties/" + id);
    if (!r.ok) return fail(r);
    open = r.json; form = null; contact = null;
    if (open.party.documents && open.party.documents.length) { const t = await api("POST", "/api/files/token", {}, { quiet: true }); fileToken = t.ok ? t.json.token : ""; }
  }
  async function saveParty(e) {
    e.preventDefault();
    const body = { ...form, credit_limit_cents: form.credit_limit === "" ? 0 : Math.round(Number(form.credit_limit) * 100) };
    delete body.credit_limit; delete body.id;
    const r = form.id ? await api("PATCH", "/api/collections/parties/records/" + form.id, body) : await api("POST", "/api/collections/parties/records", body);
    if (!r.ok) return fail(r);
    form = null; await load(); openParty(r.json.id);
  }
  const editParty = (p) => (form = { ...blank(), ...p, credit_limit: p.credit_limit_cents ? (p.credit_limit_cents / 100).toFixed(2) : "" });
  async function saveContact(e) {
    e.preventDefault();
    const body = { party: open.party.id, name: contact.name, role: contact.role, email: contact.email, phone: contact.phone, primary: contact.primary };
    const r = contact.id ? await api("PATCH", "/api/collections/party_contacts/records/" + contact.id, body) : await api("POST", "/api/collections/party_contacts/records", body);
    if (!r.ok) return fail(r);
    contact = null; openParty(open.party.id);
  }
  async function addLog(e) {
    e.preventDefault();
    const r = await api("POST", `/api/chedam/parties/${open.party.id}/log`, { kind: log.kind, text: log.text, contact: log.contact, follow_up_at: log.follow_up ? new Date(log.follow_up).toISOString() : "" });
    if (!r.ok) return fail(r);
    log = { kind: "call", text: "", contact: "", follow_up: "" }; openParty(open.party.id);
  }
  async function addDoc(file) {
    if (!file) return;
    const f = new FormData();
    f.append("documents+", file);
    const r = await api("PATCH", "/api/collections/parties/records/" + open.party.id, f, { timeout: 30000 });
    if (!r.ok) return fail(r);
    openParty(open.party.id);
  }
  async function saveRate(e) {
    e.preventDefault();
    const r = await api("POST", "/api/collections/fx_rates/records", { currency: rate.currency, day: rate.day, rate: Number(rate.rate), source: rate.source || "manual" });
    if (!r.ok) return fail(r);
    rate = null; load();
  }
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => (open || form ? ((open = null), (form = null)) : go("home"))}>← {open || form ? "Vendors and clients" : "Back"}</button>
      <h1 class="text-xl font-bold">{open ? open.party.name : form ? (form.id ? "Change " + form.name : "New vendor or client") : "Vendors and clients"}</h1></div>
    {#if !open && !form && manage}<button class="btn min-h-10 text-sm" onclick={() => (form = blank())}>New</button>{/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  {#if form}
    <form class="card grid gap-2 sm:grid-cols-3" onsubmit={saveParty}>
      <label class="block"><span class="text-sm text-muted">Kind</span><select class="field" bind:value={form.kind}>{#each Object.entries(KINDS) as [k, l] (k)}<option value={k}>{l}</option>{/each}</select></label>
      <label class="block sm:col-span-2"><span class="text-sm text-muted">Name</span><input class="field" bind:value={form.name} maxlength="120" required /></label>
      <label class="block"><span class="text-sm text-muted">Short code</span><input class="field" bind:value={form.code} maxlength="20" placeholder="FRESH" /></label>
      <label class="block sm:col-span-2"><span class="text-sm text-muted">Legal name</span><input class="field" bind:value={form.legal_name} maxlength="160" /></label>
      <label class="block"><span class="text-sm text-muted">Email</span><input class="field" type="email" bind:value={form.email} maxlength="120" /></label>
      <label class="block"><span class="text-sm text-muted">Phone</span><input class="field" bind:value={form.phone} maxlength="40" /></label>
      <label class="block"><span class="text-sm text-muted">Website</span><input class="field" bind:value={form.website} maxlength="200" /></label>
      <label class="block sm:col-span-3"><span class="text-sm text-muted">Street</span><input class="field" bind:value={form.street} maxlength="200" /></label>
      <label class="block"><span class="text-sm text-muted">City</span><input class="field" bind:value={form.city} maxlength="80" /></label>
      <label class="block"><span class="text-sm text-muted">Province / state</span><input class="field" bind:value={form.province} maxlength="40" /></label>
      <div class="grid grid-cols-2 gap-2"><label class="block"><span class="text-sm text-muted">Postal code</span><input class="field" bind:value={form.postal_code} maxlength="12" /></label>
        <label class="block"><span class="text-sm text-muted">Country</span><input class="field" bind:value={form.country} maxlength="2" /></label></div>
      <label class="block"><span class="text-sm text-muted">Currency</span><input class="field" bind:value={form.currency} maxlength="3" /></label>
      <label class="block"><span class="text-sm text-muted">Pay within (days)</span><input class="field" type="number" min="0" max="365" bind:value={form.payment_terms_days} /></label>
      <label class="block"><span class="text-sm text-muted">Terms (as written)</span><input class="field" bind:value={form.terms_text} maxlength="200" placeholder="2% 10, net 30" /></label>
      <label class="block"><span class="text-sm text-muted">GST/HST number</span><input class="field" bind:value={form.tax_id} maxlength="40" /></label>
      <label class="block"><span class="text-sm text-muted">PST number</span><input class="field" bind:value={form.pst_number} maxlength="40" /></label>
      <label class="block"><span class="text-sm text-muted">Business number (CRA)</span><input class="field" bind:value={form.business_number} maxlength="40" /></label>
      {#if form.kind !== "vendor"}<label class="block"><span class="text-sm text-muted">Credit limit ($, house account)</span><input class="field" inputmode="decimal" bind:value={form.credit_limit} /></label>{/if}
      <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={form.importer} /> We import from them</label>
      <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={form.exporter} /> We export to them</label>
      <label class="block sm:col-span-3"><span class="text-sm text-muted">Notes</span><textarea class="field" rows="3" bind:value={form.notes} maxlength="4000"></textarea></label>
      <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={form.active} /> Active</label>
      <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (form = null)}>Cancel</button></div>
    </form>
  {:else if open}
    {@const p = open.party}
    <div class="card space-y-1">
      <div class="flex flex-wrap justify-between gap-2"><p class="text-sm text-muted">{KINDS[p.kind]}{p.code ? " · " + p.code : ""} · {p.currency}{p.active ? "" : " · inactive"}</p>
        {#if manage}<button class="btn-ghost min-h-10 text-sm" onclick={() => editParty(p)}>Change</button>{/if}</div>
      {#if p.legal_name}<p>{p.legal_name}</p>{/if}
      <p class="text-sm">{[p.street, p.city, p.province, p.postal_code, p.country].filter(Boolean).join(", ")}</p>
      <p class="text-sm">{[p.email, p.phone, p.website].filter(Boolean).join(" · ")}</p>
      <p class="text-sm text-muted">{p.payment_terms_days ? "Pay within " + p.payment_terms_days + " days" : ""}{p.terms_text ? " (" + p.terms_text + ")" : ""}{p.tax_id ? " · GST/HST " + p.tax_id : ""}{p.pst_number ? " · PST " + p.pst_number : ""}{p.business_number ? " · BN " + p.business_number : ""}{p.importer ? " · importer" : ""}{p.exporter ? " · exporter" : ""}{p.credit_limit_cents ? " · credit limit " + money(p.credit_limit_cents) : ""}</p>
      {#if p.notes}<p class="whitespace-pre-line text-sm">{p.notes}</p>{/if}
    </div>
    <div class="card space-y-1">
      <div class="flex justify-between"><h2 class="font-semibold">Contacts</h2>{#if manage}<button class="btn-ghost min-h-10 text-sm" onclick={() => (contact = { name: "", role: "", email: "", phone: "", primary: !open.contacts.length })}>Add</button>{/if}</div>
      {#if contact}
        <form class="grid gap-2 sm:grid-cols-2" onsubmit={saveContact}>
          <input class="field" bind:value={contact.name} placeholder="Name" maxlength="100" required aria-label="Name" /><input class="field" bind:value={contact.role} placeholder="Role (Sales rep, Accounts)" maxlength="80" aria-label="Role" />
          <input class="field" type="email" bind:value={contact.email} placeholder="Email" maxlength="120" aria-label="Email" /><input class="field" bind:value={contact.phone} placeholder="Phone" maxlength="40" aria-label="Phone" />
          <label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-accent" bind:checked={contact.primary} /> Main contact</label>
          <div class="flex gap-2"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (contact = null)}>Cancel</button></div>
        </form>
      {/if}
      {#each open.contacts as x (x.id)}<p class="flex flex-wrap items-center justify-between gap-2 text-sm"><span><b>{x.name}</b>{x.primary ? " ★" : ""} {x.role ? "· " + x.role : ""} {x.email ? "· " + x.email : ""} {x.phone ? "· " + x.phone : ""}</span>
        {#if manage}<button class="underline" onclick={() => (contact = { ...x })}>Change</button>{/if}</p>{:else}<p class="text-sm text-muted">No contacts yet.</p>{/each}
    </div>
    <div class="card space-y-1">
      <div class="flex flex-wrap justify-between gap-2"><h2 class="font-semibold">Documents</h2>
        {#if manage}<label class="btn-ghost min-h-10 cursor-pointer text-sm">Add a PDF or photo<input class="sr-only" type="file" accept="application/pdf,image/*" onchange={(e) => addDoc(e.currentTarget.files[0])} /></label>{/if}</div>
      {#each p.documents || [] as d (d)}<a class="block text-sm underline" target="_blank" rel="noopener" href={`/api/files/${p.collectionId}/${p.id}/${d}?token=${fileToken}`}>📎 {d}</a>{:else}<p class="text-sm text-muted">Agreements, price lists, certificates…</p>{/each}
    </div>
    <div class="card space-y-2">
      <h2 class="font-semibold">Communication log</h2>
      <form class="grid gap-2 sm:grid-cols-4" onsubmit={addLog}>
        <select class="field" bind:value={log.kind} aria-label="What">{#each Object.entries(LOGK) as [k, l] (k)}<option value={k}>{l}</option>{/each}</select>
        <input class="field" bind:value={log.contact} placeholder="With (optional)" maxlength="100" aria-label="With" />
        <label class="block sm:col-span-2"><span class="sr-only">Follow up on</span><input class="field" type="datetime-local" bind:value={log.follow_up} title="Follow up on (makes a task for you)" /></label>
        <textarea class="field sm:col-span-4" rows="2" bind:value={log.text} placeholder="What was said or done" maxlength="4000" aria-label="What was said or done"></textarea>
        <button class="btn sm:col-span-1" type="submit" disabled={!log.text.trim()}>Add to the log</button>
        <p class="text-xs text-muted sm:col-span-3">A follow-up date makes a task for you, due then.</p>
      </form>
      {#each open.log as l (l.id)}
        <div class="border-t border-line pt-1 text-sm"><p><b>{LOGK[l.kind]}</b>{l.contact ? " with " + l.contact : ""} · {l.by} · {when(l.at)}</p><p class="whitespace-pre-line">{l.text}</p>
          {#if l.follow_up_at}<p class="{l.follow_up && l.follow_up.status === 'open' ? 'text-warn' : 'text-ok'}">Follow up {when(l.follow_up_at)}{l.follow_up ? (l.follow_up.status === "open" ? " (open task)" : " ✓ done") : ""}</p>{/if}</div>
      {:else}<p class="text-sm text-muted">Nothing logged yet.</p>{/each}
    </div>
  {:else}
    <div class="flex flex-wrap gap-2">
      {#each [["list", "Vendors and clients"], ["rates", "Exchange rates"]] as [k, l] (k)}<button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; load(); }}>{l}</button>{/each}
    </div>
    {#if tab === "list"}
      <div class="flex flex-wrap gap-2">
        <input class="field flex-1" type="search" bind:value={q} oninput={load} placeholder="Search by name or code" aria-label="Search" />
        <select class="field w-auto" bind:value={kind} onchange={load} aria-label="Show"><option value="">All</option><option value="vendor">Vendors</option><option value="client">Clients</option></select>
      </div>
      {#each list as p (p.id)}
        <button class="card flex w-full flex-wrap items-center justify-between gap-2 text-left {p.active ? '' : 'opacity-60'}" onclick={() => openParty(p.id)}>
          <span><span class="block font-semibold">{p.name}{p.code ? " · " + p.code : ""}</span><span class="block text-sm text-muted">{KINDS[p.kind]} · {p.currency}{p.city ? " · " + p.city : ""}{p.phone ? " · " + p.phone : ""}</span></span>
          {#if p.payment_terms_days}<span class="text-sm text-muted">net {p.payment_terms_days}</span>{/if}
        </button>
      {:else}<p class="text-muted">No vendors or clients yet.</p>{/each}
    {:else}
      {#if can("parties.manage") || can("settings.manage")}<div class="flex justify-end"><button class="btn min-h-10 text-sm" onclick={() => (rate = { currency: "USD", day: new Date().toISOString().substring(0, 10), rate: "", source: "Bank of Canada" })}>Add a rate</button></div>{/if}
      {#if rate}
        <form class="card grid gap-2 sm:grid-cols-4" onsubmit={saveRate}>
          <label class="block"><span class="text-sm text-muted">Currency</span><input class="field" bind:value={rate.currency} maxlength="3" required /></label>
          <label class="block"><span class="text-sm text-muted">Day</span><input class="field" type="date" bind:value={rate.day} required /></label>
          <label class="block"><span class="text-sm text-muted">CAD for 1 {rate.currency}</span><input class="field" inputmode="decimal" bind:value={rate.rate} required /></label>
          <label class="block"><span class="text-sm text-muted">Source</span><input class="field" bind:value={rate.source} maxlength="80" /></label>
          <div class="flex gap-2 sm:col-span-4"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (rate = null)}>Cancel</button></div>
        </form>
      {/if}
      <p class="text-sm text-muted">Documents in another currency use the rate on (or before) their date.</p>
      {#each rates as r (r.id)}<p class="card flex justify-between text-sm"><span><b>{r.currency}</b> · {r.day}</span><span>1 {r.currency} = {r.rate} CAD <span class="text-muted">{r.source}</span></span></p>{:else}<p class="text-muted">No rates yet.</p>{/each}
    {/if}
  {/if}
</section>

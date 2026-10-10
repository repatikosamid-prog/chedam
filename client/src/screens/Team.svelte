<script>
  // Tasks and checklists (P2 step 7; FR-2.03, 2.11, 2.12): tasks (mine / everyone's / done), today's opening
  // and closing checklists (tick with who and when; finish when the required items are done), shift handover
  // notes, documents with expiry reminders (managers) and setting up the checklists (managers).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { s, go, can, handleRefusal } from "../lib/session.svelte.js";

  const tabs = [["tasks", "Tasks", true], ["checklists", "Checklists", true], ["handover", "Handover notes", true],
    ["documents", "Licences and insurance", can("documents.manage")], ["setup", "Set up checklists", can("checklists.manage")]].filter((x) => x[2]);
  let tab = $state(location.hash === "#team-checklists" ? "checklists" : "tasks");
  let error = $state(""), busy = $state(false);
  let tasks = $state([]), canManage = $state(false), which = $state("mine"), show = $state("open"), people = $state([]), newTask = $state(null);
  let today = $state(null), run = $state(null);
  let notes = $state([]), note = $state("");
  let docs = $state([]), doc = $state(null);
  let lists = $state([]), edit = $state(null);

  const when = (t) => (t ? new Date(String(t).replace(" ", "T")).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
  const day = (t) => (t ? String(t).substring(0, 10) : "");
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };
  const KINDS = { opening: "Opening", closing: "Closing", other: "Other" };
  const DOCS = { licence: "Licence", permit: "Permit", insurance: "Insurance", inspection: "Inspection", other: "Other" };

  async function load() {
    error = ""; busy = true;
    if (tab === "tasks") {
      const r = await api("GET", `/api/chedam/tasks?status=${show}${which === "mine" ? "&mine=1" : ""}`);
      if (r.ok) { tasks = r.json.tasks; canManage = r.json.can_manage; } else await fail(r);
      if (canManage && !people.length) { const u = await api("GET", "/api/collections/users/records?perPage=200&sort=name&filter=" + encodeURIComponent("status='active' && deleted_at=''")); if (u.ok) people = u.json.items; }
    }
    if (tab === "checklists") { const r = await api("GET", "/api/chedam/checklists/today"); if (r.ok) { today = r.json; if (run) run = (today.checklists.find((x) => x.run && x.run.id === run.id) || {}).run || run; } else await fail(r); }
    if (tab === "handover") { const r = await api("GET", "/api/chedam/handover"); if (r.ok) notes = r.json.notes; else await fail(r); }
    if (tab === "documents") { const r = await api("GET", "/api/collections/documents/records?perPage=200&sort=expires_on&filter=" + encodeURIComponent("deleted_at=''")); if (r.ok) docs = r.json.items; else await fail(r); }
    if (tab === "setup") { const r = await api("GET", "/api/collections/checklists/records?perPage=100&sort=sort,name&filter=" + encodeURIComponent("deleted_at=''")); if (r.ok) lists = r.json.items; else await fail(r); }
    busy = false;
  }
  onMount(load);

  // ---- Tasks
  async function act(x, action, body = {}) {
    const r = await api("POST", `/api/chedam/tasks/${x.id}/${action}`, body);
    if (!r.ok) return fail(r);
    load();
  }
  async function addTask(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/tasks", { title: newTask.title, note: newTask.note, owner: newTask.owner, priority: newTask.urgent ? "urgent" : "normal",
      due_at: newTask.due ? new Date(newTask.due).toISOString() : "" });
    if (!r.ok) return fail(r);
    newTask = null; load();
  }
  const openLink = (l) => {
    if (!l) return;
    if (l.collection === "products") { s.productId = l.id; go("product"); }
    else if (l.collection === "customers") go("customers");
    else if (l.collection === "documents") { tab = "documents"; load(); }
    else if (l.collection === "sales") go("sales");
    else if (l.collection === "stock_counts") go("counts");
    else if (l.collection === "promotions") go("promotions");
  };

  // ---- Checklists
  async function startRun(k) {
    const r = await api("POST", `/api/chedam/checklists/${k.id}/start`, {}, { quiet: true });
    if (!r.ok) return fail(r);
    run = r.json; load();
  }
  async function tick(i, done) {
    const r = await api("POST", `/api/chedam/checklist-runs/${run.id}/tick`, { index: i, done }, { quiet: true });
    if (!r.ok) return fail(r);
    run = r.json;
  }
  async function finish() {
    const r = await api("POST", `/api/chedam/checklist-runs/${run.id}/complete`, {});
    if (!r.ok) return fail(r);
    run = r.json; load();
  }

  // ---- Handover
  async function addNote(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/handover", { text: note });
    if (!r.ok) return fail(r);
    note = ""; load();
  }
  async function markRead(n) { await api("POST", `/api/chedam/handover/${n.id}/read`, {}, { quiet: true }); load(); }

  // ---- Documents (generic API; the file goes as a form)
  const daysLeft = (d) => (d.expires_on ? Math.round((new Date(day(d.expires_on) + "T00:00:00") - new Date(new Date().toDateString())) / 86400000) : null);
  async function saveDoc(e) {
    e.preventDefault();
    const f = new FormData();
    ["name", "kind", "number", "issuer", "note"].forEach((k) => f.append(k, doc[k] || ""));
    f.append("expires_on", doc.expires ? doc.expires + " 12:00:00.000Z" : "");
    f.append("remind_days", String(doc.remind_days || 30));
    f.append("archived", doc.archived ? "true" : "false");
    if (doc.file) f.append("file", doc.file);
    const r = doc.id ? await api("PATCH", "/api/collections/documents/records/" + doc.id, f, { timeout: 30000 }) : await api("POST", "/api/collections/documents/records", f, { timeout: 30000 });
    if (!r.ok) return fail(r);
    doc = null;
    await api("POST", "/api/chedam/reminders/run", {}, { quiet: true });
    load();
  }
  async function openFile(d) {
    const tk = await api("POST", "/api/files/token", {}, { quiet: true });
    if (!tk.ok) return fail(tk);
    window.open(`/api/files/${d.collectionId}/${d.id}/${d.file}?token=${tk.json.token}`, "_blank");
  }

  // ---- Set up checklists (generic API)
  async function saveList(e) {
    e.preventDefault();
    const items = edit.text.split("\n").map((x) => x.trim()).filter(Boolean).map((x) => ({ text: x.replace(/^\(optional\)\s*/i, ""), required: !/^\(optional\)/i.test(x) }));
    const body = { name: edit.name, kind: edit.kind, due_time: edit.due_time || "", active: edit.active, items, sort: edit.sort || 0 };
    const r = edit.id ? await api("PATCH", "/api/collections/checklists/records/" + edit.id, body) : await api("POST", "/api/collections/checklists/records", body);
    if (!r.ok) return fail(r);
    edit = null; load();
  }
  const editList = (k) => (edit = { id: k.id, name: k.name, kind: k.kind, due_time: k.due_time, active: k.active, sort: k.sort,
    text: (k.items || []).map((x) => (x.required === false ? "(optional) " : "") + x.text).join("\n") });
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
    <h1 class="text-xl font-bold">Tasks and checklists</h1>
  </div>
  <div class="flex flex-wrap gap-2">
    {#each tabs as [k, label] (k)}<button class="min-h-10 rounded-xl px-3 {tab === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => { tab = k; run = null; load(); }}>{label}</button>{/each}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  {#if tab === "tasks"}
    <div class="flex flex-wrap items-center gap-2">
      {#each [["mine", "Mine"], ["all", "Everyone's"]] as [k, l] (k)}<button class="min-h-10 rounded-lg px-3 text-sm {which === k ? 'bg-soft font-semibold' : 'border border-line'}" onclick={() => { which = k; load(); }}>{l}</button>{/each}
      {#each [["open", "Open"], ["done", "Done"]] as [k, l] (k)}<button class="min-h-10 rounded-lg px-3 text-sm {show === k ? 'bg-soft font-semibold' : 'border border-line'}" onclick={() => { show = k; load(); }}>{l}</button>{/each}
      {#if canManage}<button class="btn ml-auto min-h-10 text-sm" onclick={() => (newTask = { title: "", note: "", owner: "", due: "", urgent: false })}>New task</button>{/if}
    </div>
    {#if newTask}
      <form class="card grid gap-2 sm:grid-cols-2" onsubmit={addTask}>
        <label class="block sm:col-span-2"><span class="text-sm text-muted">What needs doing</span><input class="field" bind:value={newTask.title} maxlength="200" required /></label>
        <label class="block"><span class="text-sm text-muted">For</span><select class="field" bind:value={newTask.owner}><option value="">Anyone</option>{#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></label>
        <label class="block"><span class="text-sm text-muted">Due</span><input class="field" type="datetime-local" bind:value={newTask.due} /></label>
        <label class="block sm:col-span-2"><span class="text-sm text-muted">Note</span><textarea class="field" rows="2" bind:value={newTask.note} maxlength="2000"></textarea></label>
        <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={newTask.urgent} /> Urgent</label>
        <div class="flex gap-2 sm:col-span-2"><button class="btn" type="submit">Add task</button><button class="btn-ghost" type="button" onclick={() => (newTask = null)}>Cancel</button></div>
      </form>
    {/if}
    {#each tasks as x (x.id)}
      <div class="card space-y-1 {x.priority === 'urgent' && x.status === 'open' ? 'border-bad' : x.overdue ? 'border-warn' : ''}">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <p class="font-semibold">{x.priority === "urgent" ? "⚠ " : ""}{x.title}</p>
          <p class="text-sm {x.overdue ? 'text-warn' : 'text-muted'}">{x.due_at ? (x.overdue ? "Overdue · " : "Due ") + when(x.due_at) : ""}</p>
        </div>
        <p class="text-sm text-muted">{x.source === "rule" ? "Chedam (closes by itself when fixed)" : "From " + (x.created_by || "someone")}{x.owner ? " · for " + x.owner.name : ""}
          {#if x.link} · <button class="underline" onclick={() => openLink(x.link)}>{x.link.label}</button>{/if}
          {#if x.status !== "open"} · done {when(x.closed_at)}{x.done_by ? " by " + x.done_by : ""}{/if}</p>
        {#if x.note}<p class="whitespace-pre-line text-sm">{x.note}</p>{/if}
        {#if x.source !== "rule"}
          <div class="flex gap-2">
            {#if x.status === "open" && (canManage || (x.owner && s.me && x.owner.id === s.me.user.id))}<button class="btn min-h-10 text-sm" onclick={() => act(x, "done", { note: "" })}>Done</button>{/if}
            {#if x.status !== "open" && canManage}<button class="btn-ghost min-h-10 text-sm" onclick={() => act(x, "reopen")}>Reopen</button>{/if}
          </div>
        {/if}
      </div>
    {:else}<p class="text-muted">{busy ? "Loading…" : show === "open" ? "No open tasks. ✓" : "Nothing done yet."}</p>{/each}
  {/if}

  {#if tab === "checklists" && today}
    {#if run}
      <div class="card space-y-2">
        <div class="flex flex-wrap justify-between gap-2"><h2 class="font-semibold">{run.name} · {run.day}</h2>
          <span class="text-sm {run.status === 'done' ? 'text-ok' : 'text-muted'}">{run.status === "done" ? "Finished by " + run.completed_by : run.items.filter((x) => x.done).length + " of " + run.items.length + " done"}</span></div>
        {#each run.items as x, i (i)}
          <label class="flex min-h-12 items-start gap-3 border-b border-line py-1">
            <input type="checkbox" class="mt-1 h-6 w-6 shrink-0 accent-accent" checked={x.done} disabled={run.day !== today.day} onchange={(e) => tick(i, e.currentTarget.checked)} />
            <span><span class="block">{x.text}{x.required ? "" : " (optional)"}</span>{#if x.done}<span class="block text-xs text-muted">{x.by_name} · {when(x.at)}</span>{/if}</span>
          </label>
        {/each}
        <div class="flex gap-2">
          {#if run.status !== "done"}<button class="btn" onclick={finish}>Finish</button>{/if}
          <button class="btn-ghost" onclick={() => { run = null; load(); }}>Back to the list</button>
        </div>
      </div>
    {:else}
      {#each today.checklists as k (k.id)}
        <button class="card flex w-full flex-wrap items-center justify-between gap-2 text-left" onclick={() => (k.run ? (run = k.run) : startRun(k))}>
          <span><span class="block font-semibold">{k.name}</span><span class="block text-sm text-muted">{KINDS[k.kind]} · {k.items} items{k.due_time ? " · by " + k.due_time : ""}</span></span>
          <span class="text-sm {k.run && k.run.status === 'done' ? 'text-ok' : k.run ? 'text-warn' : 'text-muted'}">{k.run ? (k.run.status === "done" ? "Done ✓ " + k.run.completed_by : k.run.items.filter((x) => x.done).length + "/" + k.run.items.length + " · continue") : "Start"}</span>
        </button>
      {:else}<p class="text-muted">No checklists yet.{can("checklists.manage") ? " Set them up in 'Set up checklists'." : " A manager sets them up."}</p>{/each}
    {/if}
  {/if}

  {#if tab === "handover"}
    <form class="card space-y-2" onsubmit={addNote}>
      <label class="block"><span class="font-semibold">Note for the next shift</span><textarea class="field" rows="3" bind:value={note} maxlength="2000" placeholder="What the next people should know: deliveries, problems, customers waiting…"></textarea></label>
      <button class="btn" type="submit" disabled={!note.trim()}>Leave the note</button>
    </form>
    {#each notes as n (n.id)}
      <div class="card space-y-1 {n.read ? '' : 'border-accent'}">
        <p class="whitespace-pre-line">{n.text}</p>
        <p class="flex flex-wrap items-center justify-between gap-2 text-sm text-muted"><span>{n.author} · {when(n.created_at)}{n.read_by.length ? " · read by " + n.read_by.join(", ") : ""}</span>
          {#if !n.read}<button class="btn min-h-10 text-sm" onclick={() => markRead(n)}>Read it</button>{/if}</p>
      </div>
    {:else}<p class="text-muted">No notes in the last 7 days.</p>{/each}
  {/if}

  {#if tab === "documents"}
    <div class="flex justify-end"><button class="btn min-h-10 text-sm" onclick={() => (doc = { name: "", kind: "licence", number: "", issuer: "", expires: "", remind_days: 30, note: "", archived: false, file: null })}>Add a document</button></div>
    {#if doc}
      <form class="card grid gap-2 sm:grid-cols-2" onsubmit={saveDoc}>
        <label class="block"><span class="text-sm text-muted">Name</span><input class="field" bind:value={doc.name} maxlength="120" required placeholder="Business licence" /></label>
        <label class="block"><span class="text-sm text-muted">Kind</span><select class="field" bind:value={doc.kind}>{#each Object.entries(DOCS) as [k, l] (k)}<option value={k}>{l}</option>{/each}</select></label>
        <label class="block"><span class="text-sm text-muted">Number</span><input class="field" bind:value={doc.number} maxlength="80" /></label>
        <label class="block"><span class="text-sm text-muted">Issued by</span><input class="field" bind:value={doc.issuer} maxlength="120" /></label>
        <label class="block"><span class="text-sm text-muted">Expires on</span><input class="field" type="date" bind:value={doc.expires} /></label>
        <label class="block"><span class="text-sm text-muted">Remind me (days before)</span><input class="field" type="number" min="0" max="365" bind:value={doc.remind_days} /></label>
        <label class="block sm:col-span-2"><span class="text-sm text-muted">Copy (PDF or photo, optional)</span><input class="field" type="file" accept="application/pdf,image/*" onchange={(e) => (doc.file = e.currentTarget.files[0] || null)} /></label>
        <label class="block sm:col-span-2"><span class="text-sm text-muted">Note</span><input class="field" bind:value={doc.note} maxlength="1000" /></label>
        {#if doc.id}<label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={doc.archived} /> No longer needed (archive)</label>{/if}
        <div class="flex gap-2 sm:col-span-2"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (doc = null)}>Cancel</button></div>
      </form>
    {/if}
    {#each docs as d (d.id)}
      {@const left = daysLeft(d)}
      <div class="card flex flex-wrap items-start justify-between gap-2 {d.archived ? 'opacity-60' : left !== null && left < 0 ? 'border-bad' : left !== null && left <= (d.remind_days || 30) ? 'border-warn' : ''}">
        <div><p class="font-semibold">{d.name} <span class="text-sm font-normal text-muted">{DOCS[d.kind]}{d.number ? " · " + d.number : ""}{d.issuer ? " · " + d.issuer : ""}</span></p>
          <p class="text-sm {left !== null && left < 0 ? 'text-bad' : left !== null && left <= (d.remind_days || 30) ? 'text-warn' : 'text-muted'}">{d.expires_on ? (left < 0 ? "Expired " : "Expires ") + day(d.expires_on) + (left >= 0 ? " (in " + left + " days)" : "") : "No expiry date"}{d.archived ? " · archived" : ""}</p>
          {#if d.note}<p class="text-sm">{d.note}</p>{/if}</div>
        <div class="flex gap-2">
          {#if d.file}<button class="btn-ghost min-h-10 text-sm" onclick={() => openFile(d)}>Open copy</button>{/if}
          <button class="btn-ghost min-h-10 text-sm" onclick={() => (doc = { id: d.id, name: d.name, kind: d.kind, number: d.number, issuer: d.issuer, expires: day(d.expires_on), remind_days: d.remind_days || 30, note: d.note, archived: d.archived, file: null })}>Change</button>
        </div>
      </div>
    {:else}<p class="text-muted">No documents yet. Add the business licence, permits and insurance: Chedam reminds you before they expire.</p>{/each}
  {/if}

  {#if tab === "setup"}
    <div class="flex justify-end"><button class="btn min-h-10 text-sm" onclick={() => (edit = { name: "", kind: "opening", due_time: "", active: true, sort: lists.length + 1, text: "" })}>New checklist</button></div>
    {#if edit}
      <form class="card grid gap-2 sm:grid-cols-3" onsubmit={saveList}>
        <label class="block"><span class="text-sm text-muted">Name</span><input class="field" bind:value={edit.name} maxlength="80" required placeholder="Opening" /></label>
        <label class="block"><span class="text-sm text-muted">Kind</span><select class="field" bind:value={edit.kind}>{#each Object.entries(KINDS) as [k, l] (k)}<option value={k}>{l}</option>{/each}</select></label>
        <label class="block"><span class="text-sm text-muted">Done by (time, optional)</span><input class="field" type="time" bind:value={edit.due_time} /></label>
        <label class="block sm:col-span-3"><span class="text-sm text-muted">Items, one per line (start a line with "(optional)" when it may be skipped)</span>
          <textarea class="field font-mono" rows="8" bind:value={edit.text} placeholder={"Unlock the doors\nTurn on the lights and coolers\nCount the float\n(optional) Wipe the counter"}></textarea></label>
        <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={edit.active} /> In use</label>
        <div class="flex gap-2 sm:col-span-3"><button class="btn" type="submit">Save</button><button class="btn-ghost" type="button" onclick={() => (edit = null)}>Cancel</button></div>
      </form>
    {/if}
    {#each lists as k (k.id)}
      <div class="card flex flex-wrap items-center justify-between gap-2 {k.active ? '' : 'opacity-60'}">
        <span><span class="block font-semibold">{k.name}</span><span class="block text-sm text-muted">{KINDS[k.kind]} · {(k.items || []).length} items{k.due_time ? " · by " + k.due_time : ""}{k.active ? "" : " · not in use"}</span></span>
        <button class="btn-ghost min-h-10 text-sm" onclick={() => editList(k)}>Change</button>
      </div>
    {:else}<p class="text-muted">No checklists yet.</p>{/each}
  {/if}
</section>

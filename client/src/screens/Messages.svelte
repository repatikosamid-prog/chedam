<script>
  // Messages (P2 step 8, FR-2.04, 2.05): announcements on top (acknowledge; managers post and see who has
  // read them), then conversations: Everyone, groups, one-to-one. A conversation shows its messages live
  // (lib/live.svelte.js), with @mentions, a link to a product, a photo or PDF, reactions, who has read it,
  // and removing your own. Messages follow the person on every device.
  import { onMount, tick } from "svelte";
  import { api } from "../lib/api.js";
  import { s, go, can, handleRefusal } from "../lib/session.svelte.js";
  import { on, refreshBadge } from "../lib/live.svelte.js";

  const EMOJI = ["👍", "❤️", "😂", "😮", "✅", "👀"];
  let chans = $state([]), me = $state(""), people = $state([]), error = $state("");
  let open = $state(null), msgs = $state([]), reads = $state([]), more = $state(false), fileToken = $state("");
  let text = $state(""), mentions = $state([]), file = $state(null), link = $state(null), sending = $state(false);
  let mentionQ = $state(null), linkQ = $state(null), linkHits = $state([]);
  let anns = $state([]), canAnn = $state(false), newAnn = $state(null), newChan = $state(null);
  let list;

  const when = (t) => (t ? new Date(String(t).replace(" ", "T")).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "");
  const fail = async (r) => { if (!(await handleRefusal(r))) error = r.message; };

  async function loadChans() {
    const r = await api("GET", "/api/chedam/messages/channels");
    if (!r.ok) return fail(r);
    chans = r.json.channels; me = r.json.me; people = r.json.people;
  }
  async function loadAnns() {
    const r = await api("GET", "/api/chedam/announcements");
    if (r.ok) { anns = r.json.announcements; canAnn = r.json.can_manage; }
  }
  async function token() { const t = await api("POST", "/api/files/token", {}, { quiet: true }); fileToken = t.ok ? t.json.token : ""; }

  async function openChan(id, before = "") {
    const r = await api("GET", `/api/chedam/messages/channels/${id}` + (before ? "?before=" + encodeURIComponent(before) : ""));
    if (!r.ok) return fail(r);
    await token();
    if (before) msgs = r.json.messages.concat(msgs);
    else { open = r.json.channel; msgs = r.json.messages; text = ""; mentions = []; file = null; link = null; }
    reads = r.json.reads; more = r.json.more;
    if (!before) { await markRead(); await tick(); if (list) list.scrollTop = list.scrollHeight; }
  }
  async function markRead() {
    if (!open) return;
    await api("POST", `/api/chedam/messages/channels/${open.id}/read`, {}, { quiet: true });
    refreshBadge(); loadChans();
  }

  onMount(() => {
    loadChans(); loadAnns();
    // A message for the open conversation is shown at once; others update the list
    const offM = on("messages", async (d) => {
      const rec = d.record;
      if (open && rec.channel === open.id) {
        const r = await api("GET", `/api/chedam/messages/channels/${open.id}`);
        if (r.ok) { msgs = r.json.messages; reads = r.json.reads; await tick(); if (list) list.scrollTop = list.scrollHeight; }
        if (d.action === "create") markRead();
      } else loadChans();
    });
    const offA = on("announcements", () => loadAnns());
    return () => { offM(); offA(); };
  });

  // ---- Writing
  function onType() {
    const m = text.match(/@(\w*)$/);
    mentionQ = m ? m[1].toLowerCase() : null;
  }
  const mentionable = $derived(open && mentionQ !== null ? open.members.filter((p) => p.id !== me && p.name.toLowerCase().includes(mentionQ)).slice(0, 6) : []);
  function pickMention(p) {
    text = text.replace(/@(\w*)$/, "@" + p.name.split(" ")[0] + " ");
    if (!mentions.includes(p.id)) mentions = [...mentions, p.id];
    mentionQ = null;
  }
  async function findLink() {
    const q = (linkQ || "").trim();
    if (!q) { linkHits = []; return; }
    const r = await api("GET", "/api/collections/products/records?perPage=8&fields=id,name&filter=" + encodeURIComponent(`deleted_at='' && name~'${q.replace(/'/g, "")}'`));
    linkHits = r.ok ? r.json.items : [];
  }
  async function sendMsg(e) {
    e.preventDefault();
    if (!text.trim() && !file) return;
    sending = true; error = "";
    let r;
    if (file) {
      const f = new FormData();
      f.append("channel", open.id); f.append("text", text); f.append("mentions", JSON.stringify(mentions)); f.append("attachment", file);
      if (link) { f.append("link_collection", "products"); f.append("link_id", link.id); }
      r = await api("POST", "/api/chedam/messages", f, { quiet: true, timeout: 30000 });
    } else {
      r = await api("POST", "/api/chedam/messages", { channel: open.id, text, mentions, ...(link ? { link_collection: "products", link_id: link.id } : {}) }, { quiet: true });
    }
    sending = false;
    if (!r.ok) return fail(r);
    text = ""; mentions = []; file = null; link = null; linkQ = null;
    openChan(open.id);
  }
  async function react(m, emoji) { const r = await api("POST", `/api/chedam/messages/${m.id}/react`, { emoji }, { quiet: true }); if (r.ok) msgs = msgs.map((x) => (x.id === m.id ? r.json : x)); }
  async function removeMsg(m) { if (!confirm("Remove this message?")) return; const r = await api("POST", `/api/chedam/messages/${m.id}/remove`, {}); if (r.ok) msgs = msgs.map((x) => (x.id === m.id ? r.json : x)); else fail(r); }
  const readers = (m) => reads.filter((r) => r.at >= m.created_at).map((r) => r.name);
  const openLink = (l) => { if (l.collection === "products") { s.productId = l.id; go("product"); } };

  // ---- Conversations and announcements
  async function startChan(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/messages/channels", newChan.kind === "direct" ? { kind: "direct", members: [newChan.who] } : { kind: "group", name: newChan.name, members: newChan.members }, { quiet: true });
    if (!r.ok) return fail(r);
    newChan = null; await loadChans(); openChan(r.json.id);
  }
  async function ack(a) { const r = await api("POST", `/api/chedam/announcements/${a.id}/ack`, {}, { quiet: true }); if (r.ok) { loadAnns(); refreshBadge(); } }
  async function endAnn(a) { if (!confirm("End this announcement?")) return; await api("POST", `/api/chedam/announcements/${a.id}/end`, {}); loadAnns(); }
  async function postAnn(e) {
    e.preventDefault();
    const r = await api("POST", "/api/chedam/announcements", { title: newAnn.title, text: newAnn.text, needs_ack: newAnn.needs_ack, ends_at: newAnn.ends ? new Date(newAnn.ends + "T23:59:00").toISOString() : "" });
    if (!r.ok) return fail(r);
    newAnn = null; loadAnns();
  }
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => (open ? (open = null, loadChans()) : go("home"))}>← {open ? "Conversations" : "Back"}</button>
      <h1 class="text-xl font-bold">{open ? open.name : "Messages"}</h1>
      {#if open && open.kind !== "direct"}<p class="text-sm text-muted">{open.members.length} people</p>{/if}</div>
    {#if !open}<div class="flex gap-2">
      {#if canAnn}<button class="btn-ghost min-h-10 text-sm" onclick={() => (newAnn = { title: "", text: "", needs_ack: true, ends: "" })}>New announcement</button>{/if}
      <button class="btn min-h-10 text-sm" onclick={() => (newChan = { kind: "direct", who: "", name: "", members: [] })}>New conversation</button></div>{/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}

  {#if !open}
    {#if newAnn}
      <form class="card space-y-2" onsubmit={postAnn}>
        <label class="block"><span class="text-sm text-muted">Title</span><input class="field" bind:value={newAnn.title} maxlength="120" required /></label>
        <label class="block"><span class="text-sm text-muted">Text</span><textarea class="field" rows="4" bind:value={newAnn.text} maxlength="4000"></textarea></label>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={newAnn.needs_ack} /> Everyone must confirm they read it</label>
          <label class="block"><span class="text-sm text-muted">Show until (optional)</span><input class="field" type="date" bind:value={newAnn.ends} /></label>
        </div>
        <div class="flex gap-2"><button class="btn" type="submit">Post</button><button class="btn-ghost" type="button" onclick={() => (newAnn = null)}>Cancel</button></div>
      </form>
    {/if}
    {#each anns as a (a.id)}
      <div class="card space-y-1 {a.needs_ack && !a.acked ? 'border-warn' : 'border-accent'}">
        <p class="font-semibold">📌 {a.title}</p>
        {#if a.text}<p class="whitespace-pre-line">{a.text}</p>{/if}
        <p class="text-sm text-muted">{a.author} · {when(a.created_at)}{a.ends_at ? " · until " + when(a.ends_at) : ""}</p>
        <div class="flex flex-wrap gap-2">
          {#if a.needs_ack && !a.acked}<button class="btn min-h-10 text-sm" onclick={() => ack(a)}>I have read this</button>{:else if a.needs_ack}<span class="text-sm text-ok">You confirmed ✓</span>{/if}
          {#if canAnn}<button class="btn-ghost min-h-10 text-sm" onclick={() => endAnn(a)}>End</button>{/if}
        </div>
        {#if a.acks}<p class="text-sm"><span class="text-ok">Read: {a.acks.map((k) => k.name).join(", ") || "nobody yet"}</span>{#if a.needs_ack && a.waiting.length} · <span class="text-warn">Not yet: {a.waiting.join(", ")}</span>{/if}</p>{/if}
      </div>
    {/each}

    {#if newChan}
      <form class="card space-y-2" onsubmit={startChan}>
        <div class="flex gap-2">{#each [["direct", "With one person"], ["group", "A group"]] as [k, l] (k)}<button type="button" class="min-h-10 rounded-lg px-3 text-sm {newChan.kind === k ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => (newChan.kind = k)}>{l}</button>{/each}</div>
        {#if newChan.kind === "direct"}
          <label class="block"><span class="text-sm text-muted">Who</span><select class="field" bind:value={newChan.who} required><option value="">Choose…</option>{#each people.filter((p) => p.id !== me) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></label>
        {:else}
          <label class="block"><span class="text-sm text-muted">Group name</span><input class="field" bind:value={newChan.name} maxlength="80" required placeholder="Morning shift" /></label>
          <fieldset class="grid gap-1 sm:grid-cols-2"><legend class="text-sm text-muted">People</legend>
            {#each people.filter((p) => p.id !== me) as p (p.id)}<label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-accent" checked={newChan.members.includes(p.id)}
              onchange={(e) => (newChan.members = e.currentTarget.checked ? [...newChan.members, p.id] : newChan.members.filter((x) => x !== p.id))} /> {p.name}</label>{/each}</fieldset>
        {/if}
        <div class="flex gap-2"><button class="btn" type="submit">Start</button><button class="btn-ghost" type="button" onclick={() => (newChan = null)}>Cancel</button></div>
      </form>
    {/if}
    {#each chans as c (c.id)}
      <button class="card flex w-full items-center justify-between gap-3 text-left {c.unread ? 'border-accent' : ''}" onclick={() => openChan(c.id)}>
        <span class="min-w-0"><span class="block font-semibold">{c.kind === "everyone" ? "📣 " : c.kind === "group" ? "👥 " : ""}{c.name}</span>
          {#if c.last}<span class="block truncate text-sm text-muted">{c.last.author}: {c.last.text}</span>{/if}</span>
        {#if c.unread}<span class="shrink-0 rounded-full px-2 font-semibold {c.mentioned ? 'bg-warn text-white' : 'bg-accent text-accent-ink'}">{c.mentioned ? "@ " : ""}{c.unread}</span>{/if}
      </button>
    {/each}
  {:else}
    <div class="card flex flex-col gap-2" style="height: calc(100dvh - var(--app-top, 4rem) - 9rem)">
      <div class="min-h-0 flex-1 space-y-2 overflow-y-auto" bind:this={list}>
        {#if more}<button class="btn-ghost w-full text-sm" onclick={() => openChan(open.id, msgs[0].created_at)}>Earlier messages</button>{/if}
        {#each msgs as m (m.id)}
          <div class="flex {m.mine ? 'justify-end' : 'justify-start'}">
            <div class="max-w-[85%] rounded-2xl px-3 py-2 {m.mine ? 'bg-accent/15' : m.mentions_me ? 'bg-warn/15' : 'bg-soft'}">
              {#if !m.mine}<p class="text-xs font-semibold">{m.author_name}</p>{/if}
              {#if m.removed}<p class="text-sm italic text-muted">Message removed</p>{:else}
                {#if m.text}<p class="whitespace-pre-line break-words">{m.text}</p>{/if}
                {#if m.link}<button class="text-sm underline" onclick={() => openLink(m.link)}>🔗 {m.link.label}</button>{/if}
                {#if m.attachment}{#if m.attachment.image}<a href={m.attachment.url + "?token=" + fileToken} target="_blank" rel="noopener"><img src={m.attachment.url + "?thumb=320x320&token=" + fileToken} alt="Attachment" class="mt-1 max-h-48 rounded-lg" /></a>
                  {:else}<a class="text-sm underline" href={m.attachment.url + "?token=" + fileToken} target="_blank" rel="noopener">📎 {m.attachment.name}</a>{/if}{/if}
              {/if}
              <p class="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">{when(m.created_at)}
                {#each Object.entries(m.reactions) as [e, r] (e)}<button class="rounded-full border px-1 {r.mine ? 'border-accent' : 'border-line'}" title={r.who.join(", ")} onclick={() => react(m, e)}>{e} {r.count}</button>{/each}
                {#if !m.removed}<span class="inline-flex gap-0.5">{#each EMOJI.filter((e) => !m.reactions[e]) as e (e)}<button class="opacity-50 hover:opacity-100" aria-label={"React " + e} onclick={() => react(m, e)}>{e}</button>{/each}</span>{/if}
                {#if m.mine && !m.removed}<button class="underline" onclick={() => removeMsg(m)}>Remove</button>{/if}
                {#if m.mine && open.kind !== "everyone" && readers(m).length}<span>· Read by {readers(m).join(", ")}</span>{/if}</p>
            </div>
          </div>
        {:else}<p class="text-center text-muted">No messages yet. Say hello.</p>{/each}
      </div>
      {#if mentionable.length}<div class="flex flex-wrap gap-1">{#each mentionable as p (p.id)}<button class="btn-ghost min-h-8 text-sm" onclick={() => pickMention(p)}>@{p.name}</button>{/each}</div>{/if}
      {#if linkQ !== null}
        <div class="flex flex-wrap items-center gap-1"><input class="field min-h-10 flex-1" bind:value={linkQ} oninput={findLink} placeholder="Product name" />
          {#each linkHits as p (p.id)}<button class="btn-ghost min-h-8 text-sm" onclick={() => { link = p; linkQ = null; linkHits = []; }}>{p.name}</button>{/each}</div>
      {/if}
      {#if link || file}<p class="text-sm">{link ? "🔗 " + link.name + " " : ""}{file ? "📎 " + file.name : ""} <button class="underline" onclick={() => { link = null; file = null; }}>Clear</button></p>{/if}
      <form class="flex items-end gap-2" onsubmit={sendMsg}>
        <label class="sr-only" for="msg-text">Message</label>
        <textarea id="msg-text" class="field min-h-12 flex-1" rows="1" bind:value={text} oninput={onType} maxlength="4000" placeholder="Message (type @ to mention)"
          onkeydown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(e); } }}></textarea>
        <label class="btn-ghost flex min-h-12 cursor-pointer items-center" title="Attach a photo or PDF">📎<input class="sr-only" type="file" accept="image/*,application/pdf" onchange={(e) => (file = e.currentTarget.files[0] || null)} /></label>
        <button class="btn-ghost min-h-12" type="button" title="Link a product" onclick={() => (linkQ = linkQ === null ? "" : null)}>🔗</button>
        <button class="btn min-h-12" type="submit" disabled={sending || (!text.trim() && !file)}>Send</button>
      </form>
    </div>
  {/if}
</section>

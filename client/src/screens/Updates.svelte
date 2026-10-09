<script>
  // Updates (FR-12.02, FR-12.04): installed version, look for updates online or on a USB stick, install
  // now or tonight (outside trading hours). The hub backs up first and rolls back by itself if needed.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";

  let st = $state(null), busy = $state(""), msg = $state({ text: "", kind: "" });
  const STATUS = { verified: "ready", scheduled: "tonight", installing: "installing…", installed: "✓ installed", failed: "failed", rolled_back: "rolled back" };

  async function load() {
    const r = await api("GET", "/api/chedam/updates/status");
    if (!r.ok) { if (!(await handleRefusal(r))) msg = { text: r.message, kind: "bad" }; return; }
    st = r.json;
  }
  onMount(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); });

  async function look(source) {
    busy = source; msg = { text: "", kind: "" };
    const r = await api("POST", "/api/chedam/updates/check", { source }, { timeout: 130000 });
    busy = "";
    if (!r.ok) { if (!(await handleRefusal(r))) msg = { text: r.message, kind: "bad" }; load(); return; }
    st = r.json;
    msg = st.available.length ? { text: "Update found.", kind: "ok" } : { text: "Chedam is up to date.", kind: "ok" };
  }

  async function install(u, when) {
    if (when === "now" && !confirm("Install " + u.version + " now? Chedam stops for about a minute; devices reconnect by themselves.")) return;
    const r = await api("POST", "/api/chedam/updates/" + u.id + "/install", { when });
    if (!r.ok) { if (!(await handleRefusal(r))) msg = { text: r.message, kind: "bad" }; return; }
    msg = when === "now" ? { text: "Installing " + u.version + "… The hub restarts; this page reconnects.", kind: "" }
      : { text: u.version + " will be installed tonight between " + st.window.start + " and " + st.window.end + ".", kind: "ok" };
    load();
  }

  function when(s) { return s ? new Date(s.replace(" ", "T")).toLocaleString() : ""; }
  function size(n) { return n ? (n / 1e6).toFixed(1) + " MB" : ""; }
</script>

<section class="space-y-4">
  <div class="screen-head">
    <button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
    <h1 class="text-xl font-bold">Updates</h1>
  </div>
  {#if msg.text}<p role="status" class="rounded-xl px-3 py-2 {msg.kind === 'bad' ? 'bg-bad/10 text-bad' : msg.kind === 'ok' ? 'bg-ok/10 text-ok' : 'bg-soft'}">{msg.text}</p>{/if}

  {#if st}
    <div class="card space-y-2">
      <p class="text-lg"><b>Installed:</b> {st.installed || "unknown"}</p>
      <p class="text-sm text-muted">
        Last online check: {st.last_check.at ? new Date(st.last_check.at).toLocaleString() + (st.last_check.ok === false ? " (failed: " + st.last_check.error + ")" : "") : "never"}.
        Updates install tonight between {st.window.start} and {st.window.end} unless you choose "now".
      </p>
      <div class="flex flex-wrap gap-2 pt-1">
        <button class="btn" disabled={!!busy} onclick={() => look("online")}>{busy === "online" ? "Looking online…" : "Check online"}</button>
        <button class="btn-ghost" disabled={!!busy} onclick={() => look("usb")}>{busy === "usb" ? "Looking on USB…" : "Check USB stick"}</button>
      </div>
    </div>

    {#each st.available as u (u.id)}
      <div class="card space-y-2 border-accent">
        <h2 class="font-semibold">Chedam {u.version} <span class="text-sm font-normal text-muted">· {u.source === "usb" ? "from USB" : "online"} · {size(u.size_bytes)} · signed ✓</span></h2>
        {#if u.notes}<p class="whitespace-pre-line">{u.notes}</p>{/if}
        {#if u.status === "scheduled"}
          <p class="text-sm">Will install tonight ({st.window.start}–{st.window.end}).</p>
        {/if}
        {#if can("updates.install")}
          <div class="flex flex-wrap gap-2">
            <button class="btn" onclick={() => install(u, "now")}>Install now</button>
            {#if u.status !== "scheduled"}<button class="btn-ghost" onclick={() => install(u, "tonight")}>Install tonight</button>{/if}
          </div>
          <p class="text-xs text-muted">Before installing, the hub saves a copy of the data and the current version. If the new version does not start properly, it goes back on its own.</p>
        {:else}
          <p class="text-sm text-muted">The owner installs updates.</p>
        {/if}
      </div>
    {/each}

    <div class="card">
      <h2 class="mb-2 font-semibold">History</h2>
      {#if st.history.length}
        <ul class="divide-y divide-line text-sm">
          {#each st.history as h (h.id)}
            <li class="py-2">
              <div class="flex flex-wrap justify-between gap-2">
                <span>{h.version} · {h.source === "usb" ? "USB" : "online"}</span>
                <span class={h.status === "installed" ? "text-ok" : h.status === "failed" || h.status === "rolled_back" ? "text-bad" : ""}>
                  {STATUS[h.status] || h.status} {when(h.installed_at || h.rolled_back_at)}</span>
              </div>
              {#if h.error}<p class="text-bad">{h.error}</p>{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-muted">No updates yet.</p>
      {/if}
    </div>
  {:else}
    <p class="text-muted">Loading…</p>
  {/if}
</section>

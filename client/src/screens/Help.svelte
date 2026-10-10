<script>
  // Help (P2 step 11, FR-12.11): the help pages (in the app, so they work offline), found by topic or search,
  // and the store's short training videos kept on the hub (managers add them; anyone watches).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { s, go, can } from "../lib/session.svelte.js";
  import { PAGES, pageFor, search } from "../lib/help_pages.js";

  let q = $state(""), page = $state(pageFor(s.helpFor || "")), videos = $state([]), adding = $state(null), error = $state(""), playing = $state(null);
  const hits = $derived(search(q));
  const vids = $derived(videos.filter((v) => !page || !v.topic || v.topic === page.id));

  async function loadVideos() {
    const r = await api("GET", "/api/collections/help_videos/records?perPage=200&sort=sort,title&filter=" + encodeURIComponent("archived=false && deleted_at=''"), null, { quiet: true });
    if (r.ok) videos = r.json.items;
  }
  onMount(loadVideos);

  async function addVideo(e) {
    e.preventDefault();
    if (!adding.file) { error = "Choose the video file."; return; }
    const f = new FormData();
    f.append("title", adding.title); f.append("topic", adding.topic); f.append("description", adding.description); f.append("minutes", String(adding.minutes || 0));
    f.append("sort", String(videos.length + 1)); f.append("video", adding.file);
    error = "Uploading…";
    const r = await api("POST", "/api/collections/help_videos/records", f, { timeout: 600000 });
    if (!r.ok) { error = r.message; return; }
    error = ""; adding = null; loadVideos();
  }
  async function archive(v) { if (!confirm("Remove '" + v.title + "' from Help?")) return; await api("PATCH", "/api/collections/help_videos/records/" + v.id, { archived: true }); loadVideos(); }
  const url = (v) => `/api/files/${v.collectionId}/${v.id}/${v.video}`;
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => go(s.helpFor && s.helpFor !== "help" ? s.helpFor : "home")}>← Back</button>
      <h1 class="text-xl font-bold">Help</h1></div>
    {#if can("settings.manage")}<button class="btn-ghost min-h-10 text-sm" onclick={() => (adding = { title: "", topic: page ? page.id : "", description: "", minutes: 2, file: null })}>Add a training video</button>{/if}
  </div>
  <label class="block"><span class="sr-only">Search help</span><input class="field" type="search" bind:value={q} placeholder="Search help: refund, count, coupon, offline…" /></label>
  {#if error}<p role="alert" class="rounded-xl bg-soft px-3 py-2">{error}</p>{/if}

  {#if adding}
    <form class="card grid gap-2 sm:grid-cols-2" onsubmit={addVideo}>
      <label class="block"><span class="text-sm text-muted">Title</span><input class="field" bind:value={adding.title} maxlength="120" required placeholder="Opening the till" /></label>
      <label class="block"><span class="text-sm text-muted">Help page</span><select class="field" bind:value={adding.topic}><option value="">General</option>{#each PAGES as p (p.id)}<option value={p.id}>{p.title}</option>{/each}</select></label>
      <label class="block sm:col-span-2"><span class="text-sm text-muted">What it shows</span><input class="field" bind:value={adding.description} maxlength="1000" /></label>
      <label class="block"><span class="text-sm text-muted">Minutes long</span><input class="field" type="number" min="0" max="120" step="0.5" bind:value={adding.minutes} /></label>
      <label class="block"><span class="text-sm text-muted">Video (MP4 or WebM, up to 150 MB)</span><input class="field" type="file" accept="video/mp4,video/webm,video/quicktime" onchange={(e) => (adding.file = e.currentTarget.files[0] || null)} /></label>
      <div class="flex gap-2 sm:col-span-2"><button class="btn" type="submit">Upload</button><button class="btn-ghost" type="button" onclick={() => (adding = null)}>Cancel</button></div>
    </form>
  {/if}

  <div class="grid gap-4 md:grid-cols-[14rem_1fr]">
    <nav class="flex flex-wrap gap-1 md:flex-col" aria-label="Help pages">
      {#each hits as p (p.id)}<button class="min-h-10 rounded-lg px-3 text-left text-sm {page && page.id === p.id ? 'bg-accent text-accent-ink' : 'border border-line'}" onclick={() => (page = p)}>{p.title}</button>{/each}
      {#if !hits.length}<p class="text-sm text-muted">Nothing found. Try another word.</p>{/if}
    </nav>
    {#if page}
      <article class="card space-y-3">
        <h2 class="text-lg font-bold">{page.title}</h2>
        {#each page.body as b, i (i)}
          {#if b.p}<p>{b.p}</p>{/if}
          {#if b.steps}<ol class="list-decimal space-y-1 pl-6">{#each b.steps as x, k (k)}<li>{x}</li>{/each}</ol>{/if}
          {#if b.tip}<p class="rounded-xl bg-soft px-3 py-2 text-sm">💡 {b.tip}</p>{/if}
          {#if b.warn}<p class="rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">⚠ {b.warn}</p>{/if}
        {/each}
        {#if vids.length}
          <h3 class="font-semibold">Training videos</h3>
          {#each vids as v (v.id)}
            <div class="space-y-1 border-t border-line pt-2">
              <div class="flex flex-wrap items-center justify-between gap-2"><button class="text-left font-semibold underline" onclick={() => (playing = playing === v.id ? null : v.id)}>▶ {v.title}{v.minutes ? " · " + v.minutes + " min" : ""}</button>
                {#if can("settings.manage")}<button class="text-sm underline" onclick={() => archive(v)}>Remove</button>{/if}</div>
              {#if v.description}<p class="text-sm text-muted">{v.description}</p>{/if}
              {#if playing === v.id}<!-- svelte-ignore a11y_media_has_caption --><video class="w-full rounded-xl" src={url(v)} controls preload="metadata"></video>{/if}
            </div>
          {/each}
        {/if}
      </article>
    {/if}
  </div>
</section>

<script>
  // The customer on a sale (FR-7.02, 7.06): find by phone or card scan; join with a first name, a phone
  // and/or a card and "customer agreed". Offline: members are found in the till's offline list (phone
  // numbers only as salted hashes); joining needs the hub.
  import { api, isHubDown } from "../lib/api.js";
  import { findMemberOffline } from "../lib/offline_price.js";

  let { ix = null, onPick, onCancel } = $props();
  let q = $state(""), results = $state([]), error = $state(""), busy = $state(false), join = $state(null);

  const sha256 = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((b) => b.toString(16).padStart(2, "0")).join("");
  function focusNow(node) { setTimeout(() => node.focus(), 30); }

  async function search(e) {
    e && e.preventDefault();
    error = ""; results = []; join = null;
    const t = q.trim();
    if (!t) return;
    busy = true;
    if (isHubDown()) {
      const found = await findMemberOffline(ix, t, sha256).catch(() => []);
      busy = false;
      if (found.length) results = found.map((c) => ({ id: c.id, first_name: c.first_name, points: c.points, card: c.card }));
      else error = "Not found on this till's list (offline). New members join when the hub is back.";
      return;
    }
    const r = await api("GET", "/api/chedam/customers/find?q=" + encodeURIComponent(t));
    busy = false;
    if (!r.ok) { error = r.message; return; }
    const res = r.json.results;
    if (res.length === 1 && res[0].new_card) { join = { first_name: "", phone: "", card: res[0].new_card, agreed: false }; return; }
    results = res;
    if (!res.length) join = { first_name: "", phone: /\d{7,}/.test(t.replace(/\D/g, "")) ? t : "", card: "", agreed: false };
  }

  async function doJoin(e) {
    e.preventDefault();
    error = ""; busy = true;
    const r = await api("POST", "/api/chedam/customers", { first_name: join.first_name, phone: join.phone, card: join.card || undefined, agreed: join.agreed }, { quiet: true });
    busy = false;
    if (!r.ok) { error = r.message; return; }
    onPick(r.json);
  }
</script>

<div class="space-y-2 rounded-xl border border-accent p-3" role="dialog" aria-label="Customer">
  <form class="flex gap-2" onsubmit={search}>
    <label class="sr-only" for="cust-q">Phone number or loyalty card</label>
    <input id="cust-q" class="field" bind:value={q} placeholder="Phone number or scan the card" autocomplete="off" inputmode="tel" use:focusNow />
    <button class="btn" type="submit" disabled={busy}>Find</button>
  </form>
  {#if error}<p role="alert" class="text-sm text-bad">{error}</p>{/if}
  {#each results as c (c.id)}
    <button class="btn-ghost w-full justify-between" onclick={() => onPick(c)}><span>{c.first_name}{c.phone ? " · " + c.phone : ""}</span><span>{c.points} points</span></button>
  {/each}
  {#if join}
    <form class="space-y-2 border-t border-line pt-2" onsubmit={doJoin}>
      <p class="font-semibold">{join.card ? "New card " + join.card + ": join" : "Not a member yet: join"}</p>
      <label class="block"><span class="text-sm text-muted">First name</span><input class="field" bind:value={join.first_name} maxlength="60" required use:focusNow /></label>
      <label class="block"><span class="text-sm text-muted">Phone{join.card ? " (optional)" : ""}</span><input class="field" bind:value={join.phone} inputmode="tel" /></label>
      <label class="flex min-h-12 items-center gap-3"><input type="checkbox" class="h-6 w-6 accent-accent" bind:checked={join.agreed} /> Customer agreed (we keep their first name, phone, purchases and points; we never contact them)</label>
      <button class="btn" type="submit" disabled={busy || !join.agreed || isHubDown()}>Join and add to the sale</button>
    </form>
  {/if}
  <button class="btn-ghost" onclick={onCancel}>Close</button>
</div>

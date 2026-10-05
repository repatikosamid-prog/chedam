<script>
  import { untrack } from "svelte";
  // FR-1.01 business profile: names, type, address, GST/PST/BN, currency, time zone, fiscal year.
  import { api } from "../../lib/api.js";
  import { handleRefusal } from "../../lib/session.svelte.js";
  import StepActions from "../../components/StepActions.svelte";

  let { business: current, onsaved, onskip } = $props();
  // The form starts from the saved values once (the step is re-created each time it opens)
  const business = untrack(() => current);

  const SHOP_TYPES = { grocery: "Grocery", convenience: "Convenience store", clothing_gifts: "Clothing and gifts", food_takeout: "Food and takeout", general_retail: "General retail" };
  const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
  const ZONES = ["America/Vancouver", "America/Edmonton", "America/Regina", "America/Winnipeg", "America/Toronto", "America/Halifax", "America/St_Johns", "America/Whitehorse"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const a = business.address || {};
  let f = $state({
    trade_name: business.trade_name || "", legal_name: business.legal_name || "", shop_type: business.shop_type || "grocery",
    line1: a.line1 || "", line2: a.line2 || "", city: a.city || "", province: a.province || "BC", postal: a.postal || "",
    phone: business.phone || "", email: business.email || "",
    gst_number: business.gst_number || "", pst_number: business.pst_number || "", business_number: business.business_number || "",
    time_zone: business.time_zone || "America/Vancouver", fy_month: (business.fiscal_year_start || "01-01").substring(0, 2),
    tax_display_mode: business.tax_display_mode || "tax_added",
  });
  let busy = $state(false), error = $state("");

  async function save(e) {
    e.preventDefault();
    busy = true; error = "";
    const address = { line1: f.line1, line2: f.line2, city: f.city, province: f.province, postal: f.postal.toUpperCase(), country: "CA" };
    const r = await api("PATCH", "/api/collections/business/records/" + business.id, {
      trade_name: f.trade_name, legal_name: f.legal_name, shop_type: f.shop_type, address, phone: f.phone, email: f.email,
      gst_number: f.gst_number, pst_number: f.pst_number, business_number: f.business_number, currency: "CAD",
      time_zone: f.time_zone, fiscal_year_start: f.fy_month + "-01", tax_display_mode: f.tax_display_mode,
    });
    if (r.ok) {
      // The main location carries the same address
      const loc = await api("GET", "/api/collections/locations/records?perPage=1&filter=" + encodeURIComponent("is_primary=true && deleted_at=''"));
      if (loc.ok && loc.json.items[0]) await api("PATCH", "/api/collections/locations/records/" + loc.json.items[0].id, { address });
    }
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = fieldError(r); return; }
    onsaved();
  }

  function fieldError(r) {
    const d = r.json && r.json.data;
    const k = d && Object.keys(d)[0];
    return k ? "Please check " + k.replace(/_/g, " ") + ": " + d[k].message : r.message;
  }
</script>

<form class="card space-y-3" onsubmit={save}>
  <h2 class="text-xl font-bold">Business profile</h2>
  <div class="grid gap-3 sm:grid-cols-2">
    <div><label for="b-trade" class="block font-semibold">Store name (on receipts)</label><input id="b-trade" class="field" bind:value={f.trade_name} maxlength="200" required /></div>
    <div><label for="b-legal" class="block font-semibold">Legal name</label><input id="b-legal" class="field" bind:value={f.legal_name} maxlength="200" /></div>
  </div>
  <label for="b-type" class="block font-semibold">Type of store</label>
  <select id="b-type" class="field" bind:value={f.shop_type}>
    {#each Object.entries(SHOP_TYPES) as [v, l]}<option value={v}>{l}</option>{/each}
  </select>

  <fieldset class="space-y-2">
    <legend class="font-semibold">Address</legend>
    <label for="b-l1" class="sr-only">Street</label><input id="b-l1" class="field" bind:value={f.line1} placeholder="Street and number" autocomplete="address-line1" />
    <label for="b-l2" class="sr-only">Unit</label><input id="b-l2" class="field" bind:value={f.line2} placeholder="Unit (optional)" autocomplete="address-line2" />
    <div class="grid grid-cols-[1fr_6rem_8rem] gap-2">
      <div><label for="b-city" class="sr-only">City</label><input id="b-city" class="field" bind:value={f.city} placeholder="City" autocomplete="address-level2" /></div>
      <div><label for="b-prov" class="sr-only">Province</label>
        <select id="b-prov" class="field" bind:value={f.province}>{#each PROVINCES as p}<option>{p}</option>{/each}</select></div>
      <div><label for="b-postal" class="sr-only">Postal code</label><input id="b-postal" class="field uppercase" bind:value={f.postal} placeholder="V5K 0A1" maxlength="7" autocomplete="postal-code" /></div>
    </div>
  </fieldset>

  <div class="grid gap-3 sm:grid-cols-2">
    <div><label for="b-phone" class="block font-semibold">Phone</label><input id="b-phone" class="field" type="tel" bind:value={f.phone} maxlength="40" /></div>
    <div><label for="b-email" class="block font-semibold">Email</label><input id="b-email" class="field" type="email" bind:value={f.email} /></div>
  </div>

  <fieldset class="grid gap-3 sm:grid-cols-3">
    <legend class="mb-1 font-semibold">Tax numbers (printed on receipts where required)</legend>
    <div><label for="b-gst" class="block text-sm">GST/HST number</label><input id="b-gst" class="field" bind:value={f.gst_number} maxlength="40" placeholder="123456789 RT0001" /></div>
    <div><label for="b-pst" class="block text-sm">PST number</label><input id="b-pst" class="field" bind:value={f.pst_number} maxlength="40" /></div>
    <div><label for="b-bn" class="block text-sm">Business number</label><input id="b-bn" class="field" bind:value={f.business_number} maxlength="40" /></div>
  </fieldset>

  <div class="grid gap-3 sm:grid-cols-3">
    <div><label for="b-cur" class="block font-semibold">Currency</label><select id="b-cur" class="field" disabled><option>CAD</option></select></div>
    <div><label for="b-tz" class="block font-semibold">Time zone</label>
      <select id="b-tz" class="field" bind:value={f.time_zone}>{#each ZONES as z}<option value={z}>{z.replace("America/", "").replace("_", " ")}</option>{/each}</select></div>
    <div><label for="b-fy" class="block font-semibold">Fiscal year starts</label>
      <select id="b-fy" class="field" bind:value={f.fy_month}>{#each MONTHS as m, i}<option value={String(i + 1).padStart(2, "0")}>{m}</option>{/each}</select></div>
  </div>

  <fieldset>
    <legend class="mb-1 font-semibold">Prices on shelf labels</legend>
    <label class="flex min-h-12 items-center gap-3"><input type="radio" class="h-5 w-5 accent-accent" bind:group={f.tax_display_mode} value="tax_added" /> Tax is added at the till (usual in Canada)</label>
    <label class="flex min-h-12 items-center gap-3"><input type="radio" class="h-5 w-5 accent-accent" bind:group={f.tax_display_mode} value="tax_included" /> Prices already include tax</label>
  </fieldset>

  <StepActions {onskip} {busy} {error} />
</form>

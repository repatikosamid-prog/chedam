<script>
  import { untrack } from "svelte";
  // FR-1.02 branding: logo upload, colours (automatically from the logo, can be changed), receipt
  // header and footer, live receipt preview.
  import { api, apiForm } from "../../lib/api.js";
  import { handleRefusal, loadBrand } from "../../lib/session.svelte.js";
  import { coloursFromImage, contrast, rgb } from "../../lib/colours.js";
  import StepActions from "../../components/StepActions.svelte";

  let { business: current, onsaved, onskip } = $props();
  // The form starts from the saved values once (the step is re-created each time it opens)
  const business = untrack(() => current);

  const c0 = business.colours || {};
  let colours = $state({ primary: c0.primary || "#1f6f5c", secondary: c0.secondary || "#f2b134", accent: c0.accent || "#1f6f5c", from_logo: !!c0.from_logo });
  let header = $state(business.receipt_header || [business.trade_name, business.address && business.address.line1].filter(Boolean).join("\n"));
  let footer = $state(business.receipt_footer || "Thank you for shopping with us!");
  let logoFile = $state(null);
  let inApp = $state(!!business.logo_in_app);               // DL-115: the owner's choice, asked here
  let logoUrl = $state(business.logo ? `/api/files/${business.collectionId}/${business.id}/${business.logo}` : "");
  let busy = $state(false), error = $state(""), note = $state("");

  async function pick(e) {
    const file = e.currentTarget.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { error = "The logo must be under 2 MB."; return; }
    error = "";
    logoFile = file;
    logoUrl = URL.createObjectURL(file);
    const found = await coloursFromImage(file).catch(() => null);
    if (found) { colours = found; note = "Colours taken from your logo. You can change them."; }
    else note = "No clear colours found in the logo (black and white?). Pick them below.";
  }

  const readable = $derived(contrast(rgb(colours.accent), [255, 255, 255]) >= 4.5);

  async function save(e) {
    e.preventDefault();
    busy = true; error = "";
    if (logoFile) {
      const form = new FormData();
      form.append("logo", logoFile);
      const up = await apiForm("PATCH", "/api/collections/business/records/" + business.id, form);
      if (!up.ok) { busy = false; if (!(await handleRefusal(up))) error = up.message; return; }
    }
    const r = await api("PATCH", "/api/collections/business/records/" + business.id, { colours, receipt_header: header, receipt_footer: footer, logo_in_app: !!(inApp && logoUrl) });
    busy = false;
    if (!r.ok) { if (!(await handleRefusal(r))) error = r.message; return; }
    loadBrand();
    onsaved();
  }
</script>

<form class="card space-y-4" onsubmit={save}>
  <h2 class="text-xl font-bold">Logo and receipt</h2>
  <div class="grid gap-6 md:grid-cols-2">
    <div class="space-y-3">
      <div>
        <label for="logo" class="block font-semibold">Logo (PNG, JPG, WebP or SVG, under 2 MB)</label>
        <input id="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="field py-2" onchange={pick} />
        {#if note}<p class="mt-1 text-sm text-muted">{note}</p>{/if}
        {#if logoUrl}
          <label class="mt-2 flex min-h-10 items-start gap-3 rounded-xl border border-line p-2">
            <input type="checkbox" class="mt-1 h-5 w-5 accent-accent" bind:checked={inApp} />
            <span>Also show this logo in the app, at the top of every screen and on Home, on all devices</span>
          </label>
        {/if}
      </div>
      <fieldset class="grid grid-cols-3 gap-2">
        <legend class="mb-1 font-semibold">Colours</legend>
        {#each [["primary", "Main"], ["secondary", "Second"], ["accent", "Buttons"]] as [k, label]}
          <label class="flex flex-col items-start gap-1 text-sm">
            {label}
            <input type="color" class="h-12 w-full cursor-pointer rounded-xl border border-line bg-card" bind:value={colours[k]}
              oninput={() => (colours.from_logo = false)} />
          </label>
        {/each}
      </fieldset>
      {#if !readable}<p class="text-sm text-warn">White text on the button colour is hard to read. Choose a darker one.</p>{/if}
      <div>
        <label for="r-head" class="block font-semibold">Receipt header</label>
        <textarea id="r-head" class="field min-h-24" bind:value={header} maxlength="500"></textarea>
      </div>
      <div>
        <label for="r-foot" class="block font-semibold">Receipt footer</label>
        <textarea id="r-foot" class="field min-h-20" bind:value={footer} maxlength="500" placeholder="Returns policy, thank-you note…"></textarea>
      </div>
    </div>

    <div>
      <p class="mb-1 font-semibold">Preview</p>
      <div class="mx-auto w-72 rounded-md border border-line bg-white p-4 font-mono text-[13px] leading-snug text-black shadow-sm" aria-label="Receipt preview">
        {#if logoUrl}<img src={logoUrl} alt="Logo" class="mx-auto mb-2 max-h-16 max-w-40 object-contain" />{/if}
        <p class="text-center font-bold whitespace-pre-line" style="color:{colours.accent}">{header}</p>
        {#if business.gst_number}<p class="text-center">GST/HST {business.gst_number}</p>{/if}
        <p class="my-2 border-t border-dashed border-black"></p>
        <p class="flex justify-between"><span>Milk 2L</span><span>5.49</span></p>
        <p class="flex justify-between"><span>Bread</span><span>3.99</span></p>
        <p class="flex justify-between"><span>GST 5%</span><span>0.00</span></p>
        <p class="mt-1 flex justify-between font-bold"><span>TOTAL</span><span>9.48</span></p>
        <p class="my-2 border-t border-dashed border-black"></p>
        <p class="text-center whitespace-pre-line">{footer}</p>
        <div class="mt-3 flex justify-center gap-1" aria-hidden="true">
          <span class="h-3 w-8 rounded" style="background:{colours.primary}"></span>
          <span class="h-3 w-8 rounded" style="background:{colours.secondary}"></span>
          <span class="h-3 w-8 rounded" style="background:{colours.accent}"></span>
        </div>
      </div>
      <p class="mt-1 text-center text-xs text-muted">Sample items. Receipt printers print in black; the colours are for screens.</p>
    </div>
  </div>
  <StepActions {onskip} {busy} {error} />
</form>

<script>
  // Dashboard (P2 step 6, FR-2.01): what needs attention first, then today and the month against last week
  // and last month, sales per day for 30 days (with last year's), margin by category, the P&L month to date
  // as far as Chedam's records go, and stock health. Each part shows only what the person may see (the hub
  // decides); refreshed every minute.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { go, can, handleRefusal } from "../lib/session.svelte.js";
  import { money } from "../lib/catalogue.js";
  import Chart from "../components/Chart.svelte";

  let d = $state(null), error = $state("");
  async function load() {
    const r = await api("GET", "/api/chedam/dashboard");
    if (r.ok) { d = r.json; error = ""; } else if (!(await handleRefusal(r))) error = r.message;
  }
  onMount(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); });

  const change = (now, then) => (!then ? "" : (now >= then ? "▲ " : "▼ ") + Math.abs(Math.round((100 * (now - then)) / then)) + "%");
  const up = (now, then) => !then || now >= then;
  const short = (day) => day.substring(5).replace("-", "/");
  const daily = (t) => ({
    grid: { left: 48, right: 8, top: 28, bottom: 24 },
    tooltip: { trigger: "axis", valueFormatter: (v) => "$" + Number(v).toFixed(2) },
    legend: { top: 0, textStyle: { color: t.muted }, data: ["This year", "Last year"] },
    xAxis: { type: "category", data: d.daily.map((x) => short(x.day)), axisLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted } },
    yAxis: { type: "value", axisLabel: { color: t.muted, formatter: (v) => "$" + v }, splitLine: { lineStyle: { color: t.line } } },
    series: [
      { name: "This year", type: "bar", data: d.daily.map((x) => x.sales_cents / 100), itemStyle: { color: t.accent, borderRadius: [3, 3, 0, 0] } },
      { name: "Last year", type: "line", data: d.daily.map((x) => x.last_year_cents / 100), symbol: "none", lineStyle: { color: t.muted, type: "dashed" } },
    ],
  });
  const cats = (t) => {
    const list = d.categories.slice(0, 10).reverse();
    const margin = list.length && list[0].margin_pct !== undefined;
    return {
      grid: { left: 110, right: 40, top: 8, bottom: 8 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p) => { const x = list[p[0].dataIndex]; return x.name + "<br>Sales $" + (x.sales_cents / 100).toFixed(2) + (margin ? "<br>Margin " + x.margin_pct + "%" : ""); } },
      xAxis: { type: "value", show: false },
      yAxis: { type: "category", data: list.map((x) => x.name), axisLabel: { color: t.ink }, axisLine: { show: false }, axisTick: { show: false } },
      series: [{ type: "bar", data: list.map((x) => (margin ? x.margin_pct : x.sales_cents / 100)), itemStyle: { color: t.accent, borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: "right", color: t.muted, formatter: (p) => (margin ? p.value + "%" : "$" + Number(p.value).toFixed(0)) } }],
    };
  };
</script>

<section class="space-y-4">
  <div class="screen-head flex flex-wrap items-end justify-between gap-2">
    <div><button class="mb-1 min-h-10 text-sm underline" onclick={() => go("home")}>← Back</button>
      <h1 class="text-xl font-bold">Dashboard</h1></div>
    {#if can("sales.view")}<button class="btn-ghost min-h-10 text-sm" onclick={() => go("reports")}>Reports and insights</button>{/if}
  </div>
  {#if error}<p role="alert" class="rounded-xl bg-bad/10 px-3 py-2 text-bad">{error}</p>{/if}
  {#if !d}<p class="text-muted">Loading…</p>{:else}

    <div class="card space-y-1">
      <h2 class="font-semibold">Needs attention</h2>
      {#each d.attention as a (a.kind)}
        <button class="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2 text-left hover:bg-soft" onclick={() => a.go && go(a.go)}>
          <span>{a.text}</span><span class="rounded-full bg-warn/15 px-2 font-semibold text-warn">{a.count}</span></button>
      {:else}<p class="text-ok">Nothing waiting. ✓</p>{/each}
      {#if d.tasks && d.tasks.length}<ul class="list-disc pl-5 text-sm text-muted">{#each d.tasks as t (t.id)}<li>{t.title}</li>{/each}</ul>{/if}
    </div>

    {#if d.kpis}
      {@const k = d.kpis}
      <div class="grid gap-2 sm:grid-cols-4">
        {#each [["Sales today", k.today.sales_cents, k.same_day_last_week.sales_cents, true], ["Transactions", k.today.transactions, k.same_day_last_week.transactions, false],
          ["Average sale", k.today.avg_basket_cents, k.same_day_last_week.avg_basket_cents, true], ["Sales this month", k.month.sales_cents, k.last_month_same_days.sales_cents, true]] as [label, now, then, isMoney], i (i)}
          <div class="card"><p class="text-sm text-muted">{label}</p><p class="text-2xl font-bold tabular-nums">{isMoney ? money(now) : now}</p>
            <p class="text-sm {up(now, then) ? 'text-ok' : 'text-bad'}">{change(now, then)} <span class="text-muted">{i < 3 ? "vs same day last week" : "vs same days last month"} ({isMoney ? money(then) : then})</span></p></div>
        {/each}
      </div>
      {#if k.today.margin_pct !== undefined}<p class="text-sm text-muted">Margin today {k.today.margin_pct}% · this month {k.month.margin_pct}% · returns this month {money(k.month.returns_cents || 0)} · sales are before tax, after discounts</p>{/if}
      <div class="card"><h2 class="font-semibold">Sales per day, last 30 days</h2><Chart option={daily} label="Sales per day for the last 30 days, bars this year and a dashed line last year" /></div>
      {#if d.categories.length}<div class="card"><h2 class="font-semibold">{d.categories[0].margin_pct !== undefined ? "Margin by category, this month" : "Sales by category, this month"}</h2>
        <Chart option={cats} label="Categories this month" height={Math.max(8, Math.min(10, d.categories.length) * 2.2) + "rem"} /></div>{/if}
    {/if}

    {#if d.pnl}
      {@const p = d.pnl}
      <div class="card space-y-1">
        <h2 class="font-semibold">This month so far (from {d.kpis.month_from})</h2>
        {#each [["Sales (before tax)", p.sales_cents, ""], ["Cost of goods sold", -p.cost_cents, ""], ["Gross profit", p.gross_cents, "font-semibold"], ["Damaged stock written off", -p.damage_cents, ""],
          ["Lost stock", -p.loss_cents, ""], ["Count differences", -p.count_cents, ""], ["Cash paid out of the till", -p.payouts_cents, ""], ["Result so far", p.result_cents, "font-bold border-t border-line pt-1"]] as [label, v, cls] (label)}
          <p class="flex justify-between {cls}"><span>{label}</span><span class="tabular-nums {v < 0 ? 'text-bad' : ''}">{money(v)}</span></p>
        {/each}
        <p class="text-sm text-muted">Gross margin {p.gross_pct}% · discounts given {money(p.discount_cents)}. Only what Chedam records: rent, wages and bills are not in it yet.</p>
      </div>
    {/if}

    {#if d.inventory}
      {@const v = d.inventory}
      <div class="card space-y-2">
        <h2 class="font-semibold">Stock health</h2>
        <div class="grid gap-2 text-sm sm:grid-cols-3">
          {#if v.stock_value_cents !== undefined}<p>Stock value at cost <b class="block text-xl">{money(v.stock_value_cents)}</b></p>{/if}
          <p>Out of stock <b class="block text-xl {v.out_of_stock ? 'text-bad' : ''}">{v.out_of_stock}</b></p>
          <p>Low (at reorder point) <b class="block text-xl {v.low_stock ? 'text-warn' : ''}">{v.low_stock}</b></p>
          <p>Lots expiring in 3 days <b class="block text-xl {v.near_expiry_lots ? 'text-warn' : ''}">{v.near_expiry_lots}</b></p>
          <p>Expired lots in stock <b class="block text-xl {v.expired_lots ? 'text-bad' : ''}">{v.expired_lots}{v.expired_value_cents ? " · " + money(v.expired_value_cents) : ""}</b></p>
          <p>No sales in 60 days <b class="block text-xl">{v.no_sales_60_days}</b></p>
        </div>
        {#if v.low.length}<p class="text-sm"><b>Low:</b> {v.low.map((x) => x.name + " (" + x.on_hand + ")").join(", ")}</p>{/if}
        {#if v.out.length}<p class="text-sm"><b>Out:</b> {v.out.map((x) => x.name).join(", ")}</p>{/if}
        {#if v.dead.length}<p class="text-sm text-muted"><b>Not selling:</b> {v.dead.map((x) => x.name).join(", ")}</p>{/if}
      </div>
    {/if}
  {/if}
</section>

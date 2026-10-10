<script>
  // One chart. option(t) builds the ECharts option from the theme's colours t (lib/charts.js); ECharts is
  // loaded the first time a chart is drawn. A label describes the chart for screen readers.
  import { onMount } from "svelte";

  let { option, label = "", height = "16rem" } = $props();
  let el, chart = null, lib = null;
  let ready = $state(false);   // the effect re-draws when the data the option reads changes

  function draw() {
    if (!chart || !lib) return;
    const t = lib.tokens();
    chart.setOption({ textStyle: { color: t.ink, fontFamily: "inherit" }, animation: false, ...option(t) }, true);
  }

  onMount(() => {
    let ro;
    import("../lib/charts.js").then((m) => {
      lib = m;
      chart = m.echarts.init(el, null, { renderer: "canvas" });
      ready = true;
      ro = new ResizeObserver(() => chart && chart.resize());
      ro.observe(el);
    });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", draw);
    return () => { mq.removeEventListener("change", draw); if (ro) ro.disconnect(); if (chart) chart.dispose(); };
  });
  $effect(() => { if (ready) draw(); });
</script>

<div bind:this={el} role="img" aria-label={label} style="height: {height}; width: 100%"></div>

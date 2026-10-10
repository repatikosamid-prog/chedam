// Charts (P2-g): Apache ECharts, only the parts Chedam uses, loaded on the screens that draw charts.
// Colours come from the app's own tokens (app.css), so light, dark and high-contrast themes all work.
import * as echarts from "echarts/core";
import { LineChart, BarChart, HeatmapChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, BarChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, CanvasRenderer]);

export function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue("--" + n).trim();
  return { ink: v("ink"), muted: v("muted"), line: v("line"), accent: v("accent"), soft: v("soft"), card: v("card"), ok: v("ok"), warn: v("warn") };
}

export { echarts };

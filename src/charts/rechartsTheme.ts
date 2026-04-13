export const RECHARTS_TOOLTIP_PROPS = {
  contentStyle: {
    background: "var(--surface-2)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text)",
  },
  labelStyle: { color: "var(--text-secondary)" },
  itemStyle: { color: "var(--text)" },
  wrapperStyle: { outline: "none" },
} as const;

export const CHART_TICK = {
  fill: "var(--text-secondary)",
  fontSize: 11,
} as const;

export const CHART_TICK_DENSE = {
  fill: "var(--text-secondary)",
  fontSize: 10,
} as const;

export const CHART_GRID_PROPS = {
  stroke: "var(--chart-grid)",
  strokeDasharray: "2 6",
  opacity: 0.75,
} as const;

export const CHART_CURSOR_PROPS = {
  stroke: "var(--chart-grid-strong)",
  strokeDasharray: "2 6",
} as const;

export const CHART_AXIS_BASE_PROPS = {
  axisLine: false,
  tickLine: false,
} as const;


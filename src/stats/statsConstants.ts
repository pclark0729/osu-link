import type { NeuSelectOption } from "../NeuSelect";

export const MODE_OPTIONS: NeuSelectOption[] = [
  { value: "osu", label: "osu!" },
  { value: "taiko", label: "Taiko" },
  { value: "fruits", label: "Catch" },
  { value: "mania", label: "Mania" },
];

export const MODE_LABELS: Record<string, string> = {
  osu: "osu!",
  taiko: "Taiko",
  fruits: "Catch",
  mania: "Mania",
};

export const RECHARTS_TOOLTIP_PROPS = {
  contentStyle: {
    background: "var(--surface-2)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text)",
  },
  labelStyle: { color: "var(--text-secondary)" },
  itemStyle: { color: "var(--text)" },
} as const;

export const WIKI_PP_WEIGHT = "https://osu.ppy.sh/wiki/en/Performance_points/Weighting_system";
export const WIKI_TOTAL_PP = "https://osu.ppy.sh/wiki/en/Performance_points/Total_performance_points";
export const WIKI_ACCURACY = "https://osu.ppy.sh/wiki/en/Gameplay/Accuracy";
export const WIKI_UR = "https://osu.ppy.sh/wiki/en/Gameplay/Unstable_rate";

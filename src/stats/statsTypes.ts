export type EnrichedScore = {
  pp: number | null;
  accuracy: number | null;
  rank: string;
  stars: number | null;
  label: string;
  beatmapsetId: number | null;
  modsLabel: string;
  atMs: number | null;
};

export type CrossModeRow = { mode: string; label: string; pp: number | null; rank: number | null };

export type StatsSubTab = "overview" | "charts" | "insights";

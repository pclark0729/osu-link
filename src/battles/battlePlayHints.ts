import { pickBeatmapIdForAssignedTier } from "../challengeScoring";

export type BattlePlayHint = { beatmapId: number; version: string; stars: number };

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Resolves version/★ for the beatmap id {@link pickBeatmapIdForAssignedTier} would choose. */
export function playHintFromBeatmapset(beatmaps: unknown[], preferredStars: number | null): BattlePlayHint | null {
  const id = pickBeatmapIdForAssignedTier(beatmaps, preferredStars);
  if (id == null) return null;
  for (const item of beatmaps) {
    const bm = asRecord(item);
    if (Number(bm.id) !== id) continue;
    const version = String(bm.version ?? "Beatmap").trim() || "Beatmap";
    const stars = Number(bm.difficulty_rating);
    return {
      beatmapId: id,
      version,
      stars: Number.isFinite(stars) && stars > 0 ? stars : NaN,
    };
  }
  return { beatmapId: id, version: "Beatmap", stars: NaN };
}

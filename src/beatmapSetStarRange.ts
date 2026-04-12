/**
 * Min–max star string for osu! ranked difficulties in a beatmapset search result
 * (`beatmapsets[].beatmaps[]` from osu! API).
 */
export function osuRankedStarRangeFromBeatmapset(r: Record<string, unknown>): string | null {
  const bms = r.beatmaps;
  if (!Array.isArray(bms)) return null;
  const stars: number[] = [];
  for (const x of bms) {
    if (typeof x !== "object" || x === null) continue;
    const bm = x as Record<string, unknown>;
    if (String(bm.mode ?? "") !== "osu") continue;
    const st = String(bm.status ?? "").toLowerCase();
    if (st && st !== "ranked") continue;
    const sr = Number(bm.difficulty_rating);
    if (Number.isFinite(sr)) stars.push(sr);
  }
  if (stars.length === 0) return null;
  const min = Math.min(...stars);
  const max = Math.max(...stars);
  if (min === max) return `${min.toFixed(1)}★`;
  return `${min.toFixed(1)}★–${max.toFixed(1)}★`;
}

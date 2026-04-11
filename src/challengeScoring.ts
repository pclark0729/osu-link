/**
 * Challenge standings: relative PP vs a per-user PP/★ baseline from osu! best scores.
 */
import { computeStarProfile, type InsightScore } from "./statsInsights";

const EPSILON_EXPECTED_PP = 30;
/** When best-score sample has no usable PP/★ ratios. */
export const FALLBACK_PP_PER_STAR = 45;

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function scoreBeatmapsetId(s: Record<string, unknown>): number | null {
  const bm = s.beatmap;
  if (bm && typeof bm === "object") {
    const n = Number((bm as Record<string, unknown>).beatmapset_id);
    if (Number.isFinite(n)) return n;
  }
  const bs = s.beatmapset;
  if (bs && typeof bs === "object") {
    const n = Number((bs as Record<string, unknown>).id);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function playBeatmapIdFromScore(s: Record<string, unknown>): number | null {
  const bm = s.beatmap;
  if (bm && typeof bm === "object") {
    const n = Number((bm as Record<string, unknown>).id);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function beatmapStars(s: Record<string, unknown>): number | null {
  const bm = asRecord(s.beatmap ?? {});
  const d = num(bm.difficulty_rating);
  if (d != null && d > 0) return d;
  const diff = asRecord(bm.difficulty ?? {});
  return num(diff.nominal_rating) ?? num(diff.stars) ?? num(diff.difficulty_rating);
}

function extractScoreArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const o = asRecord(raw);
  if (Array.isArray(o.scores)) return o.scores;
  return [];
}

function bestScoresToInsightScores(raw: unknown): InsightScore[] {
  const list = extractScoreArray(raw);
  const out: InsightScore[] = [];
  for (const item of list) {
    const s = asRecord(item);
    out.push({
      pp: num(s.pp),
      accuracy: null,
      stars: beatmapStars(s),
      modsLabel: "NM",
      atMs: null,
    });
  }
  return out;
}

/** Mean PP/★ from osu! `best` scores payload (same idea as stats star profile). */
export function baselinePpPerStarFromBestScores(rawBest: unknown): number | null {
  const insight = bestScoresToInsightScores(rawBest);
  const prof = computeStarProfile(insight);
  return prof?.ppPerStarMean ?? null;
}

export function expectedPpAtStars(baselinePpPerStar: number | null, stars: number): number {
  const b =
    baselinePpPerStar != null && Number.isFinite(baselinePpPerStar) && baselinePpPerStar > 0
      ? baselinePpPerStar
      : FALLBACK_PP_PER_STAR;
  return Math.max(EPSILON_EXPECTED_PP, b * stars);
}

export function challengeRankValue(pp: number, stars: number, baselinePpPerStar: number | null): number {
  const exp = expectedPpAtStars(baselinePpPerStar, stars);
  return pp / exp;
}

export type PickedChallengePlay = {
  score: number;
  pp: number;
  stars: number;
  playBeatmapId: number;
  rankValue: number;
  /** Stored for transparency; may match baseline input or fall back. */
  baselinePpPerStar: number;
};

function scoreTotalFromOsu(s: Record<string, unknown>): number | null {
  const n = Number(s.score);
  return Number.isFinite(n) ? n : null;
}

/**
 * Choose the recent play on the set (optional fixed beatmap) with highest relative PP.
 * Requires PP on the score (ranked plays). Returns null if none qualify.
 */
export function pickBestChallengePlay(
  rawRecent: unknown,
  beatmapsetId: number,
  options: { fixedBeatmapId?: number | null; baselinePpPerStar: number | null },
): PickedChallengePlay | null {
  const list = extractScoreArray(rawRecent);
  const baseline = options.baselinePpPerStar;
  const fixed = options.fixedBeatmapId;
  let best: PickedChallengePlay | null = null;

  const baselineUsed =
    baseline != null && Number.isFinite(baseline) && baseline > 0 ? baseline : FALLBACK_PP_PER_STAR;

  for (const item of list) {
    const s = asRecord(item);
    if (scoreBeatmapsetId(s) !== beatmapsetId) continue;
    const bmid = playBeatmapIdFromScore(s);
    if (fixed != null && Number.isFinite(fixed) && bmid !== fixed) continue;
    const pp = num(s.pp);
    const stars = beatmapStars(s);
    const tot = scoreTotalFromOsu(s);
    if (pp == null || pp <= 0 || stars == null || stars <= 0 || bmid == null || tot == null) continue;

    const rv = challengeRankValue(pp, stars, baseline);
    if (
      best == null ||
      rv > best.rankValue ||
      (rv === best.rankValue && pp > best.pp) ||
      (rv === best.rankValue && pp === best.pp && tot > best.score)
    ) {
      best = {
        score: Math.round(tot),
        pp,
        stars,
        playBeatmapId: bmid,
        rankValue: rv,
        baselinePpPerStar: baselineUsed,
      };
    }
  }

  return best;
}

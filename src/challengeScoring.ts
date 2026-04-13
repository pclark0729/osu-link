/**
 * Challenge standings: relative PP vs a per-user PP/★ baseline from osu! best scores.
 */
import { computeStarProfile, type InsightScore } from "./statsInsights";

const EPSILON_EXPECTED_PP = 30;
/** When best-score sample has no usable PP/★ ratios. */
export const FALLBACK_PP_PER_STAR = 45;

/**
 * Relative PP without a fixed beatmap: a recent play counts only if map ★ is within this distance of your
 * assigned tier ({@link medianStarsFromBestScores}). Stricter than “closest wins” alone — far-off difficulties are rejected.
 */
export const ASSIGNED_STAR_MAX_DELTA = 1;

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

/** Typical star rating from the player's best scores (median, else mean). Used to pick a fair difficulty in a set. */
export function medianStarsFromBestScores(rawBest: unknown): number | null {
  const insight = bestScoresToInsightScores(rawBest);
  const prof = computeStarProfile(insight);
  const m = prof?.median ?? prof?.mean;
  return m != null && Number.isFinite(m) && m > 0 ? m : null;
}

/** How difficulty is resolved for a challenge (rules_json + optional fixed beatmap). */
export type ChallengeDifficultyMode = "fixed" | "auto" | "any";

/**
 * Parse difficulty mode from API row. Legacy challenges without `difficultyMode` default to `auto`
 * (median ★ tiering) to match behavior before explicit Any vs Auto existed.
 */
export function parseChallengeDifficultyMode(
  rulesJson: unknown,
  beatmapId: number | null | undefined,
): ChallengeDifficultyMode {
  if (beatmapId != null && Number.isFinite(Number(beatmapId))) return "fixed";
  let obj: unknown = rulesJson;
  if (typeof rulesJson === "string") {
    try {
      obj = JSON.parse(rulesJson);
    } catch {
      return "auto";
    }
  }
  if (!obj || typeof obj !== "object") return "auto";
  const m = String((obj as Record<string, unknown>).difficultyMode ?? "")
    .trim()
    .toLowerCase();
  if (m === "any") return "any";
  if (m === "auto") return "auto";
  return "auto";
}

/** `rules_json.global` — server treats these as open to all signed-in users (no Join). */
export function isGlobalChallengeRules(rulesJson: unknown): boolean {
  let obj: unknown = rulesJson;
  if (typeof rulesJson === "string") {
    try {
      obj = JSON.parse(rulesJson);
    } catch {
      return false;
    }
  }
  if (!obj || typeof obj !== "object") return false;
  return Boolean((obj as Record<string, unknown>).global);
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
 *
 * When there is no fixed beatmap but `preferredStars` is set, plays must satisfy
 * |★ − preferredStars| ≤ {@link ASSIGNED_STAR_MAX_DELTA}, then among those the closest ★ tier wins ties, then rank value.
 */
export function pickBestChallengePlay(
  rawRecent: unknown,
  beatmapsetId: number,
  options: {
    fixedBeatmapId?: number | null;
    baselinePpPerStar: number | null;
    /**
     * When there is no fixed beatmap, only plays within {@link ASSIGNED_STAR_MAX_DELTA} ★ of this value qualify
     * (e.g. median ★ from the player's best scores), then best relative rank among the closest tier.
     */
    preferredStars?: number | null;
  },
): PickedChallengePlay | null {
  const list = extractScoreArray(rawRecent);
  const baseline = options.baselinePpPerStar;
  const fixed = options.fixedBeatmapId;
  const preferredStars = options.preferredStars;

  const baselineUsed =
    baseline != null && Number.isFinite(baseline) && baseline > 0 ? baseline : FALLBACK_PP_PER_STAR;

  type Cand = PickedChallengePlay & { starDist: number };

  const cands: Cand[] = [];

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
    const starDist =
      fixed == null && preferredStars != null && Number.isFinite(preferredStars)
        ? Math.abs(stars - preferredStars)
        : 0;

    cands.push({
      score: Math.round(tot),
      pp,
      stars,
      playBeatmapId: bmid,
      rankValue: rv,
      baselinePpPerStar: baselineUsed,
      starDist,
    });
  }

  if (cands.length === 0) return null;

  const useStarTier = fixed == null && preferredStars != null && Number.isFinite(preferredStars);

  if (!useStarTier) {
    let best: PickedChallengePlay | null = null;
    for (const c of cands) {
      const cur = c;
      if (
        best == null ||
        cur.rankValue > best.rankValue ||
        (cur.rankValue === best.rankValue && cur.pp > best.pp) ||
        (cur.rankValue === best.rankValue && cur.pp === best.pp && cur.score > best.score)
      ) {
        const { starDist: _, ...rest } = cur;
        best = rest;
      }
    }
    return best;
  }

  const inAssignedBand = cands.filter((c) => c.starDist <= ASSIGNED_STAR_MAX_DELTA);
  if (inAssignedBand.length === 0) return null;

  const minDist = Math.min(...inAssignedBand.map((c) => c.starDist));
  const tiered = inAssignedBand.filter((c) => c.starDist <= minDist + 1e-9);
  let best: PickedChallengePlay | null = null;
  for (const c of tiered) {
    if (
      best == null ||
      c.rankValue > best.rankValue ||
      (c.rankValue === best.rankValue && c.pp > best.pp) ||
      (c.rankValue === best.rankValue && c.pp === best.pp && c.score > best.score)
    ) {
      const { starDist: _, ...rest } = c;
      best = rest;
    }
  }
  return best;
}

/**
 * Derive starting star band from osu! API score payloads (recent + optional best).
 */
import { beatmapStars, playBeatmapIdFromScore } from "./challengeScoring";
import type { Mode } from "./searchTypes";
import { computeStarProfile, type InsightScore } from "./statsInsights";

const MS_DAY = 86400000;
export const BASELINE_RECENT_DAYS = 30;
const MIN_ACC_FOR_BASELINE = 80;

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractScoreArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const o = asRecord(raw);
  if (Array.isArray(o.scores)) return o.scores;
  return [];
}

/** osu! API score accuracy: 0–100 scale. */
export function normalizeAccuracy(raw: unknown): number | null {
  const a = num(raw);
  if (a == null) return null;
  if (a >= 0 && a <= 1) return a * 100;
  return a;
}

function scoreAtMs(s: Record<string, unknown>): number | null {
  const atRaw = s.created_at ?? s.ended_at;
  if (typeof atRaw === "string") {
    const t = Date.parse(atRaw);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof atRaw === "number" && Number.isFinite(atRaw)) {
    return atRaw > 1e12 ? atRaw : atRaw * 1000;
  }
  return null;
}

export type BaselineResult = {
  /** Center of initial star window */
  anchorStars: number;
  /** Suggested min star for first search (inclusive) */
  starMin: number;
  starMax: number;
  /** Beatmap ids from recent window used for avg PP seed (best candidate) */
  seedBeatmapIds: number[];
  fallbackFromBestProfile: boolean;
  recentSampleCount: number;
};

function bestScoresToInsight(raw: unknown): InsightScore[] {
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

/**
 * Compute baseline from recent scores (30d) and optionally fall back to star profile from best scores.
 */
export function computeTrainingBaseline(
  recentRaw: unknown,
  bestRaw: unknown | null,
  _mode: Mode,
): BaselineResult {
  const now = Date.now();
  const cutoff = now - BASELINE_RECENT_DAYS * MS_DAY;
  const list = extractScoreArray(recentRaw);
  let maxStars = 0;
  let seedBeatmapIds: number[] = [];
  let recentSampleCount = 0;

  for (const item of list) {
    const s = asRecord(item);
    const at = scoreAtMs(s);
    if (at == null || at < cutoff) continue;
    recentSampleCount += 1;
    const acc = normalizeAccuracy(s.accuracy);
    const stars = beatmapStars(s);
    const bmid = playBeatmapIdFromScore(s);
    if (stars == null || stars <= 0) continue;
    if (acc != null && acc < MIN_ACC_FOR_BASELINE) continue;
    if (stars > maxStars) {
      maxStars = stars;
      if (bmid != null) seedBeatmapIds = [bmid];
    }
  }

  let fallbackFromBestProfile = false;
  if (maxStars < 1 && bestRaw != null) {
    const prof = computeStarProfile(bestScoresToInsight(bestRaw));
    if (prof?.median != null && prof.median > 0) {
      maxStars = prof.median;
      fallbackFromBestProfile = true;
    }
  }
  if (maxStars < 1) {
    maxStars = 3;
    fallbackFromBestProfile = true;
  }

  const anchorStars = maxStars;
  const band = 0.35;
  const starMin = Math.max(1, Math.round((anchorStars - band) * 10) / 10);
  const starMax = Math.min(9.99, Math.round((anchorStars + band) * 10) / 10);

  return {
    anchorStars,
    starMin,
    starMax,
    seedBeatmapIds,
    fallbackFromBestProfile,
    recentSampleCount,
  };
}

/**
 * Performance rank from osu! ruleset statistics (all modes), not achievements.
 * Composite blends skill (PP + rank), precision (accuracy), reliability (weighted consistency), excellence (grades).
 */
import type { ParsedRow } from "./SocialLeaderboard";

export type PlayerRankId = "unranked" | "novice" | "bronze" | "silver" | "gold" | "platinum" | "master";

export type PerformanceBreakdown = {
  /** Weighted PP + global rank standing (0–100). */
  skill: number;
  /** Play-weighted hit accuracy (0–100). */
  precision: number;
  /** Volume-adjusted consistency index (0–100). */
  reliability: number;
  /** SS / S / A grade mix vs play volume (0–100). */
  excellence: number;
};

/** Native `title` text for each breakdown metric (keep in sync with formulas below). */
export const PERFORMANCE_METRIC_TOOLTIPS: Record<keyof PerformanceBreakdown, string> = {
  skill:
    "62% log-scaled total PP across modes + 38% log-scaled standing from your best global rank among modes with plays.",
  precision: "Mean hit accuracy (%) weighted by play count per mode.",
  reliability:
    "Play-weighted mean of (accuracy × log₁₀(plays+10)) per mode, normalized to a 0–100 index.",
  excellence:
    "0.55×(SS/plays) + 0.28×(S/plays) + 0.08×(A/plays), scaled so all-SS ⇒ 100 (ranked grade counts vs total plays).",
};

export type PlayerRankInfo = {
  rankId: PlayerRankId;
  name: string;
  shortLabel: string;
  /** Composite performance score 0–100 (algorithm output). */
  compositeScore: number;
  breakdown: PerformanceBreakdown;
  /** Always 100 for UI scale. */
  maxScore: number;
  percentOfMax: number;
  nextRank: { rankId: PlayerRankId; name: string; scoreAtNext: number } | null;
  progressInTier: number;
  /** True if no usable profile stats (e.g. signed out or zero plays and PP). */
  isEmpty: boolean;
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Reference total PP where log curve nears saturation (not “max PP”). */
const PP_REF = 14_000;

/** Global rank: #1 → ~1, deep ranks → ~0 (log scale). */
export function invRankNorm(globalRank: number | null): number {
  if (globalRank == null || globalRank < 1) return 0;
  return clamp01(1 - Math.log10(globalRank) / Math.log10(6_000_000));
}

/** Total PP across modes, log-scaled 0–1. */
export function ppNorm(totalPp: number): number {
  return clamp01(Math.log1p(Math.max(0, totalPp)) / Math.log1p(PP_REF));
}

function sumPp(rows: ParsedRow[]): number {
  return rows.reduce((s, r) => s + (r.pp ?? 0), 0);
}

function sumPlays(rows: ParsedRow[]): number {
  return rows.reduce((s, r) => s + (r.playCount ?? 0), 0);
}

/** Best (lowest) global rank among modes with activity. */
function bestGlobalRank(rows: ParsedRow[]): number | null {
  const ranks = rows
    .filter((r) => (r.playCount ?? 0) > 0 && r.globalRank != null && r.globalRank > 0)
    .map((r) => r.globalRank!);
  return ranks.length ? Math.min(...ranks) : null;
}

/** Play-weighted mean accuracy (0–100). */
export function weightedAccuracy(rows: ParsedRow[]): number {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const p = r.playCount ?? 0;
    const a = r.accuracy;
    if (p > 0 && a != null && Number.isFinite(a)) {
      num += a * p;
      den += p;
    }
  }
  return den > 0 ? num / den : 0;
}

/**
 * Reliability: play-weighted average of per-mode consistency (acc × log10(plays+10)),
 * normalized — rewards stable accuracy with meaningful volume without letting one huge mode dominate unrealistically.
 */
export function reliabilityIndex(rows: ParsedRow[]): number {
  let w = 0;
  let c = 0;
  for (const r of rows) {
    const p = r.playCount ?? 0;
    if (p <= 0) continue;
    w += p;
    c += r.consistency * p;
  }
  if (w === 0) return 0;
  const avg = c / w;
  // Typical upper range for serious players ~350–500+; cap for normalization.
  return clamp01(avg / 420) * 100;
}

/** Weights for SS / S / A grade rates; max weighted sum when every counted play is SS. */
const EXCELLENCE_W_SS = 0.55;
const EXCELLENCE_W_S = 0.28;
const EXCELLENCE_W_A = 0.08;
const EXCELLENCE_MAX_RAW = EXCELLENCE_W_SS;

/**
 * Excellence: high-rank grades per play, diminishing returns on A.
 * Normalized to 0–100 so a 100% SS rate (ssR=1) scores 100; previously 55×rates + clamp01 saturated at ~2% SS.
 */
export function excellenceIndex(rows: ParsedRow[]): number {
  let ss = 0;
  let s = 0;
  let a = 0;
  let plays = 0;
  for (const r of rows) {
    ss += r.gradeSS;
    s += r.gradeS;
    a += r.gradeA;
    plays += r.playCount ?? 0;
  }
  if (plays <= 0) return 0;
  const ssR = ss / plays;
  const sR = s / plays;
  const aR = a / plays;
  const raw = EXCELLENCE_W_SS * ssR + EXCELLENCE_W_S * sR + EXCELLENCE_W_A * aR;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const v = (raw / EXCELLENCE_MAX_RAW) * 100;
  return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
}

/**
 * Skill sub-index 0–100: mostly PP curve, part global rank so rank isn’t only raw PP.
 */
export function skillIndex(rows: ParsedRow[]): number {
  const totalPp = sumPp(rows);
  const br = bestGlobalRank(rows);
  const ppPart = ppNorm(totalPp) * 100;
  const rankPart = invRankNorm(br) * 100;
  return 0.62 * ppPart + 0.38 * rankPart;
}

/**
 * Composite 0–100 from four pillars (weights sum to 1).
 * - Skill: peak performance (PP + rank standing)
 * - Precision: hit accuracy (play-weighted)
 * - Reliability: consistency × volume (from osu stats consistency field)
 * - Excellence: grade distribution vs volume
 */
export function computeCompositeScore(b: PerformanceBreakdown): number {
  const v =
    0.4 * b.skill +
    0.22 * b.precision +
    0.22 * b.reliability +
    0.16 * b.excellence;
  return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
}

export function buildPerformanceBreakdown(rows: ParsedRow[]): PerformanceBreakdown {
  const skill = skillIndex(rows);
  const wa = weightedAccuracy(rows);
  const precision = Math.min(100, Math.max(0, wa));
  const reliability = reliabilityIndex(rows);
  const excellence = excellenceIndex(rows);
  return { skill, precision, reliability, excellence };
}

const RANK_FLOORS: Array<{ rankId: PlayerRankId; name: string; shortLabel: string; minScore: number }> = [
  { rankId: "unranked", name: "Unranked", shortLabel: "—", minScore: 0 },
  { rankId: "novice", name: "Novice", shortLabel: "I", minScore: 7 },
  { rankId: "bronze", name: "Bronze", shortLabel: "II", minScore: 21 },
  { rankId: "silver", name: "Silver", shortLabel: "III", minScore: 35 },
  { rankId: "gold", name: "Gold", shortLabel: "IV", minScore: 49 },
  { rankId: "platinum", name: "Platinum", shortLabel: "V", minScore: 63 },
  { rankId: "master", name: "Master", shortLabel: "VI", minScore: 77 },
];

export function hasUsableOsuStats(rows: ParsedRow[]): boolean {
  return sumPlays(rows) > 0 || sumPp(rows) > 0;
}

/**
 * Performance rank from four ruleset stat payloads (e.g. osu, taiko, fruits, mania).
 */
export function computeOsuPerformanceRank(rows: ParsedRow[]): PlayerRankInfo {
  const emptyBreakdown: PerformanceBreakdown = { skill: 0, precision: 0, reliability: 0, excellence: 0 };

  if (!rows.length || !hasUsableOsuStats(rows)) {
    const floor = RANK_FLOORS[0];
    return {
      rankId: floor.rankId,
      name: floor.name,
      shortLabel: floor.shortLabel,
      compositeScore: 0,
      breakdown: emptyBreakdown,
      maxScore: 100,
      percentOfMax: 0,
      nextRank: { rankId: "novice", name: "Novice", scoreAtNext: RANK_FLOORS[1].minScore },
      progressInTier: 0,
      isEmpty: true,
    };
  }

  const breakdown = buildPerformanceBreakdown(rows);
  const compositeScore = computeCompositeScore(breakdown);

  let idx = 0;
  for (let i = RANK_FLOORS.length - 1; i >= 0; i--) {
    if (compositeScore + 1e-9 >= RANK_FLOORS[i].minScore) {
      idx = i;
      break;
    }
  }

  const current = RANK_FLOORS[idx];
  const nextDef = RANK_FLOORS[idx + 1];
  const nextRank =
    nextDef != null ? { rankId: nextDef.rankId, name: nextDef.name, scoreAtNext: nextDef.minScore } : null;

  const floorScore = current.minScore;
  const ceilingScore = nextDef != null ? nextDef.minScore : 100;
  let progressInTier = 1;
  if (nextDef != null && ceilingScore > floorScore) {
    progressInTier = Math.max(0, Math.min(1, (compositeScore - floorScore) / (ceilingScore - floorScore)));
  }

  return {
    rankId: current.rankId,
    name: current.name,
    shortLabel: current.shortLabel,
    compositeScore,
    breakdown,
    maxScore: 100,
    percentOfMax: compositeScore / 100,
    nextRank,
    progressInTier,
    isEmpty: false,
  };
}

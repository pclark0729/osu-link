/** Client-side performance insights from sampled API scores. Not a replacement for osu! client PP totals. */

const PP_DECAY = 0.95;

export type InsightScore = {
  pp: number | null;
  accuracy: number | null;
  stars: number | null;
  modsLabel: string;
  atMs: number | null;
};

export type WeightedSampleInsight = {
  /** Sum of pp[i] * 0.95^(i-1) over sorted-best list (osu! wiki weighting). */
  weightedSum: number;
  /** Fraction of weightedSum from the single highest-PP play. */
  shareTop1: number;
  shareTop5: number;
  shareTop20: number;
  /** Number of scores with finite PP used in the sum. */
  count: number;
};

export type AccuracySpreadInsight = {
  mean: number;
  stdev: number;
  n: number;
};

export type StarProfileInsight = {
  mean: number | null;
  median: number | null;
  n: number;
  /** Informal: mean(pp / stars) where both defined and stars > 0. */
  ppPerStarMean: number | null;
};

export type ModDominance = { name: string; count: number };

export type RecentActivityWindow = {
  fromLabel: string;
  toLabel: string;
};

export type PerformanceInsights = {
  weightedSample: WeightedSampleInsight | null;
  accuracySpread: AccuracySpreadInsight | null;
  starProfile: StarProfileInsight | null;
  topMods: ModDominance[];
  recentActivity: RecentActivityWindow | null;
  /** ratio weightedSum / totalPp when both known — illustrative only. */
  sampleWeightedToProfilePpRatio: number | null;
  caveats: string[];
};

function sortedFinitePp(scores: InsightScore[]): number[] {
  return scores
    .map((s) => s.pp)
    .filter((p): p is number => p != null && Number.isFinite(p) && p >= 0)
    .sort((a, b) => b - a);
}

/** osu! wiki: pp[1]*0.95^0 + pp[2]*0.95^1 + ... */
export function weightedPpSum(ppDescending: number[]): number {
  let sum = 0;
  for (let i = 0; i < ppDescending.length; i++) {
    sum += ppDescending[i] * PP_DECAY ** i;
  }
  return sum;
}

export function computeWeightedSampleInsight(scores: InsightScore[]): WeightedSampleInsight | null {
  const pp = sortedFinitePp(scores);
  if (pp.length === 0) return null;
  const weightedSum = weightedPpSum(pp);
  if (weightedSum <= 0) return null;

  const contrib = (take: number) => {
    let c = 0;
    for (let i = 0; i < Math.min(take, pp.length); i++) {
      c += pp[i] * PP_DECAY ** i;
    }
    return c;
  };

  return {
    weightedSum,
    shareTop1: contrib(1) / weightedSum,
    shareTop5: contrib(5) / weightedSum,
    shareTop20: contrib(20) / weightedSum,
    count: pp.length,
  };
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Sample standard deviation (Bessel's correction when n > 1). */
export function stdevSample(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return n === 1 ? 0 : null;
  const m = mean(values);
  const sq = values.reduce((acc, x) => acc + (x - m) ** 2, 0);
  return Math.sqrt(sq / (n - 1));
}

export function computeAccuracySpread(scores: InsightScore[]): AccuracySpreadInsight | null {
  const acc = scores
    .map((s) => s.accuracy)
    .filter((a): a is number => a != null && Number.isFinite(a));
  if (acc.length === 0) return null;
  const sd = stdevSample(acc);
  return {
    mean: mean(acc),
    stdev: sd ?? 0,
    n: acc.length,
  };
}

function medianSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeStarProfile(scores: InsightScore[]): StarProfileInsight | null {
  const stars = scores
    .map((s) => s.stars)
    .filter((x): x is number => x != null && Number.isFinite(x) && x > 0);
  if (stars.length === 0) {
    return { mean: null, median: null, n: 0, ppPerStarMean: null };
  }
  const sorted = [...stars].sort((a, b) => a - b);
  const ratios: number[] = [];
  for (const s of scores) {
    if (s.pp != null && Number.isFinite(s.pp) && s.stars != null && s.stars > 0) {
      ratios.push(s.pp / s.stars);
    }
  }
  return {
    mean: mean(stars),
    median: medianSorted(sorted),
    n: stars.length,
    ppPerStarMean: ratios.length ? mean(ratios) : null,
  };
}

export function topModsFromBest(scores: InsightScore[], limit = 3): ModDominance[] {
  const map = new Map<string, number>();
  for (const s of scores) {
    const k = s.modsLabel?.trim() || "NM";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function recentActivityWindow(recent: InsightScore[]): RecentActivityWindow | null {
  const times = recent.map((s) => s.atMs).filter((t): t is number => t != null && Number.isFinite(t));
  if (times.length === 0) return null;
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  return {
    fromLabel: new Date(lo).toLocaleDateString(undefined, opts),
    toLabel: new Date(hi).toLocaleDateString(undefined, opts),
  };
}

const CAVEATS = [
  "Weighted PP uses osu!'s 0.95 decay on your sampled best scores only; your real total PP includes every submitted play and bonus PP.",
  "Accuracy spread uses score accuracy % from the API, not Unstable Rate (timing) from replays.",
  "PP per star is an informal ratio, not an official osu! statistic.",
] as const;

export function computePerformanceInsights(input: {
  best: InsightScore[];
  recent: InsightScore[];
  totalPp: number | null;
}): PerformanceInsights {
  const weightedSample = computeWeightedSampleInsight(input.best);
  const accuracySpread = computeAccuracySpread(input.best);
  const starProfile = computeStarProfile(input.best);
  const topMods = topModsFromBest(input.best, 4);
  const recentActivity = recentActivityWindow(input.recent);

  let sampleWeightedToProfilePpRatio: number | null = null;
  if (
    weightedSample &&
    weightedSample.weightedSum > 0 &&
    input.totalPp != null &&
    Number.isFinite(input.totalPp) &&
    input.totalPp > 0
  ) {
    sampleWeightedToProfilePpRatio = weightedSample.weightedSum / input.totalPp;
  }

  return {
    weightedSample,
    accuracySpread,
    starProfile,
    topMods,
    recentActivity,
    sampleWeightedToProfilePpRatio,
    caveats: [...CAVEATS],
  };
}

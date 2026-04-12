import { describe, expect, it } from "vitest";
import type { ParsedRow } from "./SocialLeaderboard";
import {
  computeCompositeScore,
  computeOsuPerformanceRank,
  excellenceIndex,
  invRankNorm,
  ppNorm,
  reliabilityIndex,
  skillIndex,
  weightedAccuracy,
} from "./playerRank";

function mockRow(partial: Partial<ParsedRow> & Pick<ParsedRow, "playCount" | "pp" | "accuracy" | "globalRank">): ParsedRow {
  return {
    osuId: 1,
    username: "t",
    label: "t",
    avatarUrl: null,
    countryCode: null,
    rankedScore: null,
    totalScore: null,
    maxCombo: null,
    totalHits: null,
    levelCurrent: null,
    levelProgress: null,
    countryRank: null,
    replaysWatched: null,
    error: null,
    raw: {},
    gradeSS: 0,
    gradeS: 0,
    gradeA: 0,
    trophyDensity: 0,
    consistency: (partial.accuracy ?? 0) * Math.log10((partial.playCount ?? 0) + 10),
    ...partial,
  };
}

describe("playerRank osu performance", () => {
  it("ppNorm increases with PP", () => {
    expect(ppNorm(0)).toBeLessThan(ppNorm(3000));
    expect(ppNorm(3000)).toBeLessThan(ppNorm(12000));
  });

  it("invRankNorm favors top ranks", () => {
    expect(invRankNorm(1)).toBeGreaterThan(invRankNorm(100000));
  });

  it("computeOsuPerformanceRank is empty without stats", () => {
    const r = computeOsuPerformanceRank([]);
    expect(r.isEmpty).toBe(true);
    expect(r.compositeScore).toBe(0);
  });

  it("composite blends breakdown", () => {
    const b = { skill: 80, precision: 90, reliability: 70, excellence: 60 };
    const c = computeCompositeScore(b);
    expect(c).toBeGreaterThan(60);
    expect(c).toBeLessThanOrEqual(100);
  });

  it("weightedAccuracy respects play weights", () => {
    const rows = [
      mockRow({ playCount: 100, accuracy: 80, pp: 100, globalRank: 50000 }),
      mockRow({ playCount: 900, accuracy: 98, pp: 2000, globalRank: 5000 }),
    ];
    expect(weightedAccuracy(rows)).toBeGreaterThan(95);
  });

  it("higher stats yield higher composite", () => {
    const low: ParsedRow[] = [
      mockRow({
        playCount: 50,
        accuracy: 85,
        pp: 200,
        globalRank: 200000,
        gradeSS: 0,
        gradeS: 2,
        gradeA: 5,
      }),
    ];
    low[0].trophyDensity = 0;
    low[0].consistency = (low[0].accuracy ?? 0) * Math.log10(60);

    const high: ParsedRow[] = [
      mockRow({
        playCount: 5000,
        accuracy: 97,
        pp: 8000,
        globalRank: 5000,
        gradeSS: 120,
        gradeS: 400,
        gradeA: 800,
      }),
    ];
    high[0].trophyDensity = (high[0].gradeSS / (high[0].playCount ?? 1)) * 1000;
    high[0].consistency = (high[0].accuracy ?? 0) * Math.log10(5010);

    const rLow = computeOsuPerformanceRank(low);
    const rHigh = computeOsuPerformanceRank(high);
    expect(rHigh.compositeScore).toBeGreaterThan(rLow.compositeScore);
  });

  it("indices are bounded", () => {
    const rows = [
      mockRow({
        playCount: 1000,
        accuracy: 99,
        pp: 5000,
        globalRank: 100,
        gradeSS: 50,
        gradeS: 100,
        gradeA: 200,
      }),
    ];
    rows[0].trophyDensity = rows[0].gradeSS / 1000;
    rows[0].consistency = 99 * Math.log10(1010);
    expect(skillIndex(rows)).toBeLessThanOrEqual(100);
    expect(reliabilityIndex(rows)).toBeLessThanOrEqual(100);
    expect(excellenceIndex(rows)).toBeLessThanOrEqual(100);
  });

  it("excellenceIndex scales 0–100 without saturating (all-SS ⇒ 100, mixed grades spread)", () => {
    const allSs = [mockRow({ playCount: 100, accuracy: 99, pp: 1000, globalRank: 1000, gradeSS: 100, gradeS: 0, gradeA: 0 })];
    allSs[0].consistency = 99 * Math.log10(110);
    expect(excellenceIndex(allSs)).toBe(100);

    const low = [mockRow({ playCount: 100, accuracy: 90, pp: 500, globalRank: 50000, gradeSS: 0, gradeS: 2, gradeA: 5 })];
    low[0].consistency = 90 * Math.log10(110);
    const high = [mockRow({ playCount: 100, accuracy: 95, pp: 2000, globalRank: 10000, gradeSS: 5, gradeS: 15, gradeA: 25 })];
    high[0].consistency = 95 * Math.log10(110);
    expect(excellenceIndex(high)).toBeGreaterThan(excellenceIndex(low));
    expect(excellenceIndex(low)).toBeLessThan(50);
  });
});

import { describe, expect, it } from "vitest";
import {
  computeAccuracySpread,
  computePerformanceInsights,
  computeWeightedSampleInsight,
  stdevSample,
  weightedPpSum,
} from "./statsInsights";

function s(partial: Partial<import("./statsInsights").InsightScore>): import("./statsInsights").InsightScore {
  return {
    pp: null,
    accuracy: null,
    stars: null,
    modsLabel: "NM",
    atMs: null,
    ...partial,
  };
}

describe("weightedPpSum", () => {
  it("matches wiki formula for a short list", () => {
    const pp = [100, 50, 25];
    const w = weightedPpSum(pp);
    expect(w).toBeCloseTo(100 + 50 * 0.95 + 25 * 0.95 ** 2, 10);
  });
});

describe("computeWeightedSampleInsight", () => {
  it("computes concentration shares", () => {
    const scores = [s({ pp: 100 }), s({ pp: 50 }), s({ pp: 25 })];
    const out = computeWeightedSampleInsight(scores);
    expect(out).not.toBeNull();
    const w = weightedPpSum([100, 50, 25]);
    expect(out!.shareTop1).toBeCloseTo(100 / w, 10);
    expect(out!.weightedSum).toBeCloseTo(w, 10);
    expect(out!.shareTop5).toBe(1);
  });
});

describe("stdevSample", () => {
  it("returns null for empty", () => {
    expect(stdevSample([])).toBeNull();
  });
  it("returns 0 for single value", () => {
    expect(stdevSample([5])).toBe(0);
  });
  it("matches sample stdev for [1,2,3]", () => {
    expect(stdevSample([1, 2, 3])).toBeCloseTo(1, 10);
  });
});

describe("computeAccuracySpread", () => {
  it("ignores null accuracies", () => {
    const out = computeAccuracySpread([s({ accuracy: 98 }), s({ accuracy: null }), s({ accuracy: 92 })]);
    expect(out?.n).toBe(2);
    expect(out?.mean).toBeCloseTo(95, 10);
  });
});

describe("computePerformanceInsights", () => {
  it("returns ratio when total PP given", () => {
    const best = [s({ pp: 400, accuracy: 99, stars: 6, modsLabel: "HD" })];
    const out = computePerformanceInsights({ best, recent: [], totalPp: 2000 });
    expect(out.weightedSample?.weightedSum).toBe(400);
    expect(out.sampleWeightedToProfilePpRatio).toBeCloseTo(0.2, 10);
    expect(out.caveats.length).toBeGreaterThan(0);
  });
});

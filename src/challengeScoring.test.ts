import { describe, expect, it } from "vitest";
import {
  baselinePpPerStarFromBestScores,
  challengeRankValue,
  expectedPpAtStars,
  FALLBACK_PP_PER_STAR,
  pickBestChallengePlay,
} from "./challengeScoring";

describe("challengeRankValue", () => {
  it("divides pp by expected pp from baseline * stars (floored)", () => {
    const baseline = 50;
    const stars = 4;
    const exp = expectedPpAtStars(baseline, stars);
    expect(exp).toBe(Math.max(30, 50 * 4));
    expect(challengeRankValue(200, stars, baseline)).toBeCloseTo(200 / exp);
  });

  it("uses fallback baseline when null", () => {
    const stars = 2;
    const exp = expectedPpAtStars(null, stars);
    expect(exp).toBe(Math.max(30, FALLBACK_PP_PER_STAR * 2));
  });
});

describe("baselinePpPerStarFromBestScores", () => {
  it("returns mean pp/stars from best list", () => {
    const raw = [
      {
        pp: 100,
        beatmap: { difficulty_rating: 4 },
      },
      {
        pp: 50,
        beatmap: { difficulty_rating: 5 },
      },
    ];
    const b = baselinePpPerStarFromBestScores(raw);
    expect(b).not.toBeNull();
    expect(b!).toBeCloseTo((100 / 4 + 50 / 5) / 2);
  });
});

describe("pickBestChallengePlay", () => {
  const setId = 42;

  function score(
    sid: number,
    beatmapId: number,
    pp: number,
    stars: number,
    total: number,
  ): Record<string, unknown> {
    return {
      score: total,
      pp,
      beatmap: {
        id: beatmapId,
        beatmapset_id: sid,
        difficulty_rating: stars,
      },
    };
  }

  it("prefers higher relative performance over raw score", () => {
    const raw = [
      score(setId, 1, 80, 4, 9_000_000),
      score(setId, 2, 100, 5, 1_000_000),
    ];
    const baseline = 20;
    const picked = pickBestChallengePlay(raw, setId, { baselinePpPerStar: baseline });
    expect(picked).not.toBeNull();
    expect(picked!.playBeatmapId).toBe(2);
    expect(picked!.pp).toBe(100);
  });

  it("filters by fixed beatmap id", () => {
    const raw = [score(setId, 10, 200, 6, 5_000_000), score(setId, 11, 50, 2, 8_000_000)];
    const picked = pickBestChallengePlay(raw, setId, { fixedBeatmapId: 10, baselinePpPerStar: 30 });
    expect(picked!.playBeatmapId).toBe(10);
  });

  it("returns null when no ranked pp on set", () => {
    const raw = [
      {
        score: 1e6,
        beatmap: { id: 1, beatmapset_id: setId, difficulty_rating: 4 },
      },
    ];
    expect(pickBestChallengePlay(raw, setId, { baselinePpPerStar: 40 })).toBeNull();
  });
});

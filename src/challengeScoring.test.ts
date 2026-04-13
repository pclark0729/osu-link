import { describe, expect, it } from "vitest";
import {
  ASSIGNED_STAR_MAX_DELTA,
  baselinePpPerStarFromBestScores,
  challengeRankValue,
  expectedPpAtStars,
  FALLBACK_PP_PER_STAR,
  medianStarsFromBestScores,
  isGlobalChallengeRules,
  parseChallengeDifficultyMode,
  pickBeatmapIdForAssignedTier,
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

  it("with preferredStars, prefers the difficulty closest to the player tier before comparing rank value", () => {
    const raw = [
      score(setId, 1, 180, 6, 5_000_000),
      score(setId, 2, 120, 5, 4_000_000),
    ];
    const baseline = 30;
    const picked = pickBestChallengePlay(raw, setId, {
      baselinePpPerStar: baseline,
      preferredStars: 5,
    });
    expect(picked).not.toBeNull();
    expect(picked!.playBeatmapId).toBe(2);
    const rv6 = challengeRankValue(180, 6, baseline);
    const rv5 = challengeRankValue(120, 5, baseline);
    expect(rv6).toBeGreaterThan(rv5);
  });

  it("with preferredStars, breaks ties at same star distance by rank value", () => {
    const raw = [
      score(setId, 1, 100, 4.5, 3_000_000),
      score(setId, 2, 150, 5.5, 3_100_000),
    ];
    const baseline = 25;
    const picked = pickBestChallengePlay(raw, setId, {
      baselinePpPerStar: baseline,
      preferredStars: 5,
    });
    expect(picked!.playBeatmapId).toBe(2);
  });

  it("with preferredStars, rejects plays farther than ASSIGNED_STAR_MAX_DELTA from assigned tier", () => {
    const raw = [score(setId, 1, 300, 7.2, 5_000_000)];
    const picked = pickBestChallengePlay(raw, setId, {
      baselinePpPerStar: 30,
      preferredStars: 5,
    });
    expect(picked).toBeNull();
    expect(7.2 - 5).toBeGreaterThan(ASSIGNED_STAR_MAX_DELTA);
  });

  it("with preferredStars, accepts plays within ASSIGNED_STAR_MAX_DELTA", () => {
    const raw = [score(setId, 9, 180, 5.9, 4_000_000)];
    const picked = pickBestChallengePlay(raw, setId, {
      baselinePpPerStar: 30,
      preferredStars: 5,
    });
    expect(picked).not.toBeNull();
    expect(picked!.playBeatmapId).toBe(9);
  });
});

describe("parseChallengeDifficultyMode", () => {
  it("returns fixed when beatmap_id is set", () => {
    expect(parseChallengeDifficultyMode({ difficultyMode: "any" }, 123)).toBe("fixed");
  });

  it("reads any/auto from rules object", () => {
    expect(parseChallengeDifficultyMode({ difficultyMode: "any" }, null)).toBe("any");
    expect(parseChallengeDifficultyMode({ difficultyMode: "auto" }, null)).toBe("auto");
  });

  it("parses JSON string rules", () => {
    expect(parseChallengeDifficultyMode('{"difficultyMode":"any"}', null)).toBe("any");
  });

  it("defaults to auto when mode missing (legacy)", () => {
    expect(parseChallengeDifficultyMode({ display: { title: "x" } }, null)).toBe("auto");
  });
});

describe("isGlobalChallengeRules", () => {
  it("is true when rules_json.global is set", () => {
    expect(isGlobalChallengeRules({ global: true })).toBe(true);
    expect(isGlobalChallengeRules({ global: false })).toBe(false);
  });

  it("parses JSON string", () => {
    expect(isGlobalChallengeRules('{"global":true}')).toBe(true);
  });
});

describe("medianStarsFromBestScores", () => {
  it("returns median star rating from best list", () => {
    const raw = [
      { pp: 100, beatmap: { difficulty_rating: 4 } },
      { pp: 80, beatmap: { difficulty_rating: 6 } },
      { pp: 90, beatmap: { difficulty_rating: 5 } },
    ];
    const m = medianStarsFromBestScores(raw);
    expect(m).toBe(5);
  });
});

describe("pickBeatmapIdForAssignedTier", () => {
  function bm(id: number, stars: number): Record<string, unknown> {
    return { id, mode: "osu", status: "ranked", difficulty_rating: stars, version: "Insane" };
  }

  it("returns null when preferredStars is missing", () => {
    expect(pickBeatmapIdForAssignedTier([bm(1, 4)], null)).toBeNull();
  });

  it("prefers a difficulty inside the assigned band when available", () => {
    const list = [bm(10, 3), bm(11, 5.1), bm(12, 7)];
    const preferred = 5;
    expect(pickBeatmapIdForAssignedTier(list, preferred)).toBe(11);
  });

  it("when none in band, picks closest ★ overall", () => {
    const list = [bm(1, 2), bm(2, 8)];
    expect(pickBeatmapIdForAssignedTier(list, 5)).toBe(1);
  });

  it("ignores non-osu and non-ranked", () => {
    const list = [
      { id: 1, mode: "taiko", status: "ranked", difficulty_rating: 5 },
      { id: 2, mode: "osu", status: "loved", difficulty_rating: 5 },
      bm(3, 5),
    ];
    expect(pickBeatmapIdForAssignedTier(list, 5)).toBe(3);
  });
});

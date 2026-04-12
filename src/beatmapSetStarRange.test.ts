import { describe, expect, it } from "vitest";
import { osuRankedStarRangeFromBeatmapset } from "./beatmapSetStarRange";

describe("osuRankedStarRangeFromBeatmapset", () => {
  it("returns null when no beatmaps", () => {
    expect(osuRankedStarRangeFromBeatmapset({})).toBeNull();
    expect(osuRankedStarRangeFromBeatmapset({ beatmaps: [] })).toBeNull();
  });

  it("returns single star when one osu ranked map", () => {
    expect(
      osuRankedStarRangeFromBeatmapset({
        beatmaps: [{ mode: "osu", status: "ranked", difficulty_rating: 5.25 }],
      }),
    ).toBe("5.3★");
  });

  it("ignores non-osu and non-ranked", () => {
    expect(
      osuRankedStarRangeFromBeatmapset({
        beatmaps: [
          { mode: "taiko", status: "ranked", difficulty_rating: 9 },
          { mode: "osu", status: "loved", difficulty_rating: 9 },
          { mode: "osu", status: "ranked", difficulty_rating: 4 },
          { mode: "osu", status: "ranked", difficulty_rating: 6.5 },
        ],
      }),
    ).toBe("4.0★–6.5★");
  });
});

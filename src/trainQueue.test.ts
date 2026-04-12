import { describe, expect, it } from "vitest";
import { applyDifficultyFeelToBand } from "./trainQueue";

describe("applyDifficultyFeelToBand", () => {
  it("shifts band up for too_easy", () => {
    const a = applyDifficultyFeelToBand(4.0, 4.5, "too_easy");
    expect(a.starMin).toBeGreaterThan(4.0);
    expect(a.starMax).toBeGreaterThan(4.5);
    expect(a.starMax - a.starMin).toBeGreaterThanOrEqual(0.25);
  });

  it("shifts band down for too_hard", () => {
    const a = applyDifficultyFeelToBand(4.0, 4.5, "too_hard");
    expect(a.starMin).toBeLessThan(4.0);
    expect(a.starMax).toBeLessThan(4.5);
    expect(a.starMax - a.starMin).toBeGreaterThanOrEqual(0.25);
  });

  it("too_easy is strictly higher than too_hard for the same input", () => {
    const easy = applyDifficultyFeelToBand(5.0, 5.5, "too_easy");
    const hard = applyDifficultyFeelToBand(5.0, 5.5, "too_hard");
    expect(easy.starMin).toBeGreaterThan(hard.starMin);
    expect(easy.starMax).toBeGreaterThan(hard.starMax);
  });

  it("clamps near 10 stars", () => {
    const a = applyDifficultyFeelToBand(8.8, 9.5, "too_easy");
    expect(a.starMax).toBeLessThanOrEqual(9.99);
    expect(a.starMin).toBeGreaterThanOrEqual(1);
    expect(a.starMax - a.starMin).toBeGreaterThanOrEqual(0.25);
  });

  it("clamps near 1 star", () => {
    const a = applyDifficultyFeelToBand(1.0, 1.4, "too_hard");
    expect(a.starMin).toBeGreaterThanOrEqual(1);
    expect(a.starMax).toBeLessThanOrEqual(9.99);
    expect(a.starMax - a.starMin).toBeGreaterThanOrEqual(0.25);
  });
});

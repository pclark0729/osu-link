import { describe, expect, it } from "vitest";
import { formatTimeRemaining } from "./timeFormat";

describe("formatTimeRemaining", () => {
  it("formats sub-minute with seconds", () => {
    expect(formatTimeRemaining(45_000)).toBe("0m 45s");
  });

  it("formats hours and minutes", () => {
    expect(formatTimeRemaining(3_600_000 + 5 * 60_000)).toBe("1h 5m");
  });

  it("formats multi-day when >= 48h", () => {
    expect(formatTimeRemaining(50 * 60 * 60 * 1000)).toMatch(/^2d /);
  });

  it("returns 0:00 for non-positive", () => {
    expect(formatTimeRemaining(0)).toBe("0:00");
    expect(formatTimeRemaining(-1000)).toBe("0:00");
  });
});

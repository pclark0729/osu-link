import { describe, expect, it } from "vitest";
import { detectSlotProgress } from "./trainProgress";

describe("detectSlotProgress", () => {
  it("passes when recent score matches beatmap, time, and accuracy", () => {
    const slotStart = Date.parse("2025-01-01T00:00:00.000Z");
    const raw = [
      {
        accuracy: 0.955,
        created_at: "2025-01-02T12:00:00.000Z",
        beatmap: { id: 42, beatmapset_id: 1 },
        beatmapset: { id: 1, artist: "A", title: "T" },
      },
    ];
    const p = detectSlotProgress(raw, 42, slotStart, 90);
    expect(p.passed).toBe(true);
    expect(p.accuracy).toBeCloseTo(95.5, 5);
  });

  it("does not pass when score is before slot start", () => {
    const slotStart = Date.parse("2025-01-02T13:00:00.000Z");
    const raw = [
      {
        accuracy: 0.99,
        created_at: "2025-01-02T12:00:00.000Z",
        beatmap: { id: 7, beatmapset_id: 1 },
      },
    ];
    const p = detectSlotProgress(raw, 7, slotStart, 90);
    expect(p.passed).toBe(false);
  });
});

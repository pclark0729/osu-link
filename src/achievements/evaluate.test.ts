import { describe, expect, it } from "vitest";
import { evaluateAchievements, type EvaluateInput } from "./evaluate";

const zeroSocial: Pick<
  EvaluateInput,
  | "asyncBattleWinsCount"
  | "localBeatmapsetCount"
  | "friendRequestsSentCount"
  | "acceptedFriendsCount"
  | "challengesJoinedCount"
  | "battlesCompletedCount"
> = {
  asyncBattleWinsCount: 0,
  localBeatmapsetCount: 0,
  friendRequestsSentCount: 0,
  acceptedFriendsCount: 0,
  challengesJoinedCount: 0,
  battlesCompletedCount: 0,
};

describe("evaluateAchievements", () => {
  it("unlocks onboarding and oauth flags", () => {
    const m = evaluateAchievements(
      {
        training: { sessions: [], mapOutcomes: [] },
        onboardingCompleted: true,
        oauthLoggedIn: true,
        ...zeroSocial,
      },
      1_000_000,
    );
    expect(m.get("app-onboarding")?.earnedAtMs).toBe(1_000_000);
    expect(m.get("app-oauth")?.earnedAtMs).toBe(1_000_000);
  });

  it("unlocks first session from earliest session end", () => {
    const m = evaluateAchievements(
      {
        training: {
          sessions: [
            {
              sessionId: "a",
              startedAtMs: 100,
              endedAtMs: 500,
              mode: "osu",
              source: "auto",
              trainingSetName: null,
              mapsPassed: 1,
              mapsFailed: 0,
              peakStars: 2,
              accSum: 95,
              accCount: 1,
            },
          ],
          mapOutcomes: [],
        },
        onboardingCompleted: false,
        oauthLoggedIn: false,
        ...zeroSocial,
      },
      9_999,
    );
    expect(m.get("train-first-session")?.earnedAtMs).toBe(500);
  });

  it("unlocks ten clears from 10th pass timestamp", () => {
    const mapOutcomes = Array.from({ length: 12 }, (_, i) => ({
      beatmapId: i,
      beatmapsetId: i,
      stars: 4,
      accuracy: 98,
      passed: true,
      accThreshold: 90,
      atMs: 1000 + i * 100,
      label: "m",
    }));
    const m = evaluateAchievements(
      {
        training: { sessions: [], mapOutcomes },
        onboardingCompleted: false,
        oauthLoggedIn: false,
        ...zeroSocial,
      },
      1,
    );
    expect(m.get("train-maps-10")?.earnedAtMs).toBe(1000 + 9 * 100);
  });

  it("unlocks peak 5 from first qualifying session", () => {
    const m = evaluateAchievements(
      {
        training: {
          sessions: [
            {
              sessionId: "a",
              startedAtMs: 0,
              endedAtMs: 200,
              mode: "osu",
              source: "auto",
              trainingSetName: null,
              mapsPassed: 1,
              mapsFailed: 0,
              peakStars: 4,
              accSum: 95,
              accCount: 1,
            },
            {
              sessionId: "b",
              startedAtMs: 200,
              endedAtMs: 400,
              mode: "osu",
              source: "auto",
              trainingSetName: null,
              mapsPassed: 1,
              mapsFailed: 0,
              peakStars: 5.5,
              accSum: 96,
              accCount: 1,
            },
          ],
          mapOutcomes: [],
        },
        onboardingCompleted: false,
        oauthLoggedIn: false,
        ...zeroSocial,
      },
      1,
    );
    expect(m.get("train-peak-5")?.earnedAtMs).toBe(400);
  });

  it("unlocks library tiers from local beatmap count", () => {
    const m = evaluateAchievements(
      {
        training: { sessions: [], mapOutcomes: [] },
        onboardingCompleted: false,
        oauthLoggedIn: false,
        ...zeroSocial,
        localBeatmapsetCount: 100,
      },
      42,
    );
    expect(m.get("app-library-10")?.earnedAtMs).toBe(42);
    expect(m.get("app-library-50")?.earnedAtMs).toBe(42);
    expect(m.get("app-library-100")?.earnedAtMs).toBe(42);
    expect(m.get("app-library-250")).toBeUndefined();
  });
});

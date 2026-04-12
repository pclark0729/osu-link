import type { TrainingHistoryFile } from "../trainHistory";
import { ACHIEVEMENTS } from "./catalog";

export type EvaluateInput = {
  training: TrainingHistoryFile;
  onboardingCompleted: boolean;
  oauthLoggedIn: boolean;
  acceptedFriendsCount: number;
  /** User joined at least one open challenge (client counts from social API). */
  challengesJoinedCount: number;
  /** Closed async battles the user participated in (creator or opponent). */
  battlesCompletedCount: number;
  /** Closed async battles where winner_osu_id is the current user. */
  asyncBattleWinsCount: number;
  /** Indexed local beatmap set count (Songs folder). */
  localBeatmapsetCount: number;
  /** Friendships where this user sent the request (requested_by === me). */
  friendRequestsSentCount: number;
};

export type EarnedEntry = { earnedAtMs: number };

function firstSessionPeakAtLeast(
  sessions: TrainingHistoryFile["sessions"],
  minStars: number,
): number | null {
  const sorted = [...sessions].sort((a, b) => a.endedAtMs - b.endedAtMs);
  for (const s of sorted) {
    if (s.peakStars >= minStars) return s.endedAtMs;
  }
  return null;
}

/**
 * Returns locally derivable achievement unlocks with best-effort timestamps.
 */
export function evaluateAchievements(input: EvaluateInput, nowMs: number = Date.now()): Map<string, EarnedEntry> {
  const out = new Map<string, EarnedEntry>();
  const {
    training,
    onboardingCompleted,
    oauthLoggedIn,
    acceptedFriendsCount,
    challengesJoinedCount,
    battlesCompletedCount,
    asyncBattleWinsCount,
    localBeatmapsetCount,
    friendRequestsSentCount,
  } = input;

  const sessions = training.sessions;
  const sessionsChrono = [...sessions].sort((a, b) => a.endedAtMs - b.endedAtMs);

  if (onboardingCompleted) {
    out.set("app-onboarding", { earnedAtMs: nowMs });
  }
  if (oauthLoggedIn) {
    out.set("app-oauth", { earnedAtMs: nowMs });
  }

  if (localBeatmapsetCount >= 10) {
    out.set("app-library-10", { earnedAtMs: nowMs });
  }
  if (localBeatmapsetCount >= 50) {
    out.set("app-library-50", { earnedAtMs: nowMs });
  }
  if (localBeatmapsetCount >= 100) {
    out.set("app-library-100", { earnedAtMs: nowMs });
  }
  if (localBeatmapsetCount >= 250) {
    out.set("app-library-250", { earnedAtMs: nowMs });
  }

  if (sessions.length > 0) {
    const firstEnd = Math.min(...sessions.map((s) => s.endedAtMs));
    out.set("train-first-session", { earnedAtMs: firstEnd });
  }

  if (sessionsChrono.length >= 5) {
    out.set("train-sessions-5", { earnedAtMs: sessionsChrono[4].endedAtMs });
  }
  if (sessionsChrono.length >= 25) {
    out.set("train-sessions-25", { earnedAtMs: sessionsChrono[24].endedAtMs });
  }

  const customFirst = sessionsChrono.find((s) => s.source === "custom");
  if (customFirst) {
    out.set("train-custom-set", { earnedAtMs: customFirst.endedAtMs });
  }

  const modeTime = (m: string) => {
    const s = sessionsChrono.find((x) => x.mode === m);
    return s ? s.endedAtMs : null;
  };
  const taikoT = modeTime("taiko");
  if (taikoT != null) out.set("train-mode-taiko", { earnedAtMs: taikoT });
  const catchT = modeTime("fruits");
  if (catchT != null) out.set("train-mode-catch", { earnedAtMs: catchT });
  const maniaT = modeTime("mania");
  if (maniaT != null) out.set("train-mode-mania", { earnedAtMs: maniaT });

  const failedOutcomes = training.mapOutcomes.filter((o) => !o.passed).sort((a, b) => a.atMs - b.atMs);
  if (failedOutcomes.length > 0) {
    out.set("train-oops", { earnedAtMs: failedOutcomes[0].atMs });
  }

  const passedOutcomes = training.mapOutcomes.filter((o) => o.passed).sort((a, b) => a.atMs - b.atMs);

  if (passedOutcomes.length >= 10) {
    out.set("train-maps-10", { earnedAtMs: passedOutcomes[9].atMs });
  }
  if (passedOutcomes.length >= 50) {
    out.set("train-maps-50", { earnedAtMs: passedOutcomes[49].atMs });
  }
  if (passedOutcomes.length >= 100) {
    out.set("train-maps-100", { earnedAtMs: passedOutcomes[99].atMs });
  }
  if (passedOutcomes.length >= 250) {
    out.set("train-maps-250", { earnedAtMs: passedOutcomes[249].atMs });
  }

  const acc99 = passedOutcomes.filter((o) => o.accuracy != null && o.accuracy >= 99).sort((a, b) => a.atMs - b.atMs);
  if (acc99.length > 0) {
    out.set("train-accuracy-99", { earnedAtMs: acc99[0].atMs });
  }

  for (const threshold of [4, 5, 6, 7, 8] as const) {
    const t = firstSessionPeakAtLeast(sessions, threshold);
    if (t != null) {
      const id =
        threshold === 4
          ? "train-peak-4"
          : threshold === 5
            ? "train-peak-5"
            : threshold === 6
              ? "train-peak-6"
              : threshold === 7
                ? "train-peak-7"
                : "train-peak-8";
      out.set(id, { earnedAtMs: t });
    }
  }

  if (friendRequestsSentCount >= 1) {
    out.set("social-friend-request", { earnedAtMs: nowMs });
  }
  if (acceptedFriendsCount >= 1) {
    out.set("social-first-friend", { earnedAtMs: nowMs });
  }
  if (acceptedFriendsCount >= 5) {
    out.set("social-friends-5", { earnedAtMs: nowMs });
  }
  if (challengesJoinedCount >= 1) {
    out.set("social-challenge-join", { earnedAtMs: nowMs });
  }
  if (challengesJoinedCount >= 3) {
    out.set("social-challenge-join-3", { earnedAtMs: nowMs });
  }
  if (battlesCompletedCount >= 1) {
    out.set("social-battle-done", { earnedAtMs: nowMs });
  }
  if (asyncBattleWinsCount >= 1) {
    out.set("social-battle-win", { earnedAtMs: nowMs });
  }
  if (asyncBattleWinsCount >= 3) {
    out.set("social-battle-wins-3", { earnedAtMs: nowMs });
  }

  const validIds = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const k of [...out.keys()]) {
    if (!validIds.has(k)) out.delete(k);
  }

  return out;
}

/** Merge local evaluation with server rows; keep minimum earnedAtMs per id. */
export function mergeEarnedMaps(
  local: Map<string, EarnedEntry>,
  server: Array<{ achievementId: string; earnedAtMs: number }>,
): Map<string, EarnedEntry> {
  const m = new Map<string, EarnedEntry>(local);
  for (const row of server) {
    const id = row.achievementId;
    const t = row.earnedAtMs;
    if (!id || !Number.isFinite(t)) continue;
    const prev = m.get(id);
    if (!prev || t < prev.earnedAtMs) {
      m.set(id, { earnedAtMs: t });
    }
  }
  return m;
}

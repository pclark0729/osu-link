import { invoke, isTauri } from "@tauri-apps/api/core";
import { openBattleSubmitTargetInOsu } from "./battles/openInOsu";
import {
  challengeUsesAssignedStarTier,
  medianStarsFromBestScores,
  parseChallengeDifficultyMode,
  pickBeatmapIdForAssignedTier,
} from "./challengeScoring";
import type { ChallengeRow } from "./challengeTypes";

/**
 * Opens the challenge's fixed difficulty, a tier-matched ranked osu! difficulty when rules use a per-player star band, or the set.
 */
export async function openChallengeInOsu(args: { challenge: ChallengeRow; meId: number | null }): Promise<void> {
  const { challenge, meId } = args;
  if (!isTauri()) return;
  const setId = challenge.beatmapset_id;
  if (!Number.isFinite(setId) || setId <= 0) return;

  const fixed =
    challenge.beatmap_id != null && Number.isFinite(challenge.beatmap_id) ? Math.round(challenge.beatmap_id) : null;
  if (fixed != null) {
    await openBattleSubmitTargetInOsu(setId, fixed);
    return;
  }

  const diffMode = parseChallengeDifficultyMode(challenge.rules_json, challenge.beatmap_id);
  const useTier = challengeUsesAssignedStarTier(challenge.rules_json, challenge.beatmap_id, diffMode);
  if (!useTier || meId == null) {
    await openBattleSubmitTargetInOsu(setId, null);
    return;
  }

  const bestRaw = await invoke<unknown>("osu_user_best_scores", { userId: meId, limit: 100, mode: "osu" });
  const med = medianStarsFromBestScores(bestRaw);
  if (med == null || !Number.isFinite(med) || med <= 0) {
    await openBattleSubmitTargetInOsu(setId, null);
    return;
  }

  const rawSet = await invoke<unknown>("get_beatmapset", { beatmapsetId: setId });
  const root = typeof rawSet === "object" && rawSet !== null ? (rawSet as Record<string, unknown>) : {};
  const bms = root.beatmaps;
  const list = Array.isArray(bms) ? bms : [];
  const bm = pickBeatmapIdForAssignedTier(list, med);
  await openBattleSubmitTargetInOsu(setId, bm);
}

import { invoke, isTauri } from "@tauri-apps/api/core";

/** Whether the desktop app can hand off to osu!stable for this battle’s submit target. */
export function canOpenBattleSubmitInOsu(beatmapsetId: number, fixedBeatmapId: number | null): boolean {
  if (!isTauri()) return false;
  if (fixedBeatmapId != null && Number.isFinite(fixedBeatmapId) && fixedBeatmapId > 0) return true;
  return Number.isFinite(beatmapsetId) && beatmapsetId > 0;
}

/** Opens the fixed difficulty, or the set (any diff) when no fixed beatmap. */
export async function openBattleSubmitTargetInOsu(
  beatmapsetId: number,
  fixedBeatmapId: number | null,
): Promise<void> {
  if (!isTauri()) return;
  if (fixedBeatmapId != null && Number.isFinite(fixedBeatmapId) && fixedBeatmapId > 0) {
    await invoke("open_osu_beatmap", { beatmapId: fixedBeatmapId });
    return;
  }
  if (Number.isFinite(beatmapsetId) && beatmapsetId > 0) {
    await invoke("open_osu_beatmapset", { beatmapsetId });
  }
}

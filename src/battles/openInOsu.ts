import { invoke, isTauri } from "@tauri-apps/api/core";

/** Whether the desktop app can hand off to osu!stable for this battle’s submit target. */
export function canOpenBattleSubmitInOsu(beatmapsetId: number, fixedBeatmapId: number | null): boolean {
  if (!isTauri()) return false;
  if (fixedBeatmapId != null && Number.isFinite(fixedBeatmapId) && fixedBeatmapId > 0) return true;
  return Number.isFinite(beatmapsetId) && beatmapsetId > 0;
}

/** Opens a specific beatmap when `fixedBeatmapId` is set; otherwise opens the beatmap set (any difficulty). Callers may pass a tier-resolved beatmap id for relative-PP battles. */
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
    try {
      await invoke("open_osu_beatmapset", { beatmapsetId });
    } catch (e) {
      // Some systems register `osu://b/...` but not `osu://s/...`; fall back to opening a specific difficulty.
      // We avoid extra API calls here (OAuth may not be configured), so this is best-effort only.
      const msg = String(e);
      throw new Error(`Could not open beatmapset in osu! (${msg}). If this keeps happening, try updating osu!stable or ensure the osu:// protocol is registered.`);
    }
  }
}

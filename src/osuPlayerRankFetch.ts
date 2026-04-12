import { invoke } from "@tauri-apps/api/core";
import { computeOsuPerformanceRank, type PlayerRankInfo } from "./playerRank";
import { parseUserRulesetPayload, type ParsedRow } from "./SocialLeaderboard";

/**
 * Loads ruleset stats for all modes and returns the same performance rank used in Achievements / profiles.
 */
export async function fetchOsuPerformanceRankForUser(osuId: number): Promise<PlayerRankInfo> {
  const modes = ["osu", "taiko", "fruits", "mania"] as const;
  const results = await Promise.all(
    modes.map((m) => invoke<unknown>("osu_user_ruleset_stats", { userId: osuId, mode: m }).catch(() => null)),
  );
  const rows: ParsedRow[] = [];
  for (let i = 0; i < modes.length; i++) {
    const raw = results[i];
    const pr = raw ? parseUserRulesetPayload(raw, modes[i]) : null;
    if (pr) rows.push(pr);
  }
  return computeOsuPerformanceRank(rows);
}

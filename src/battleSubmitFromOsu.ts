import { invoke } from "@tauri-apps/api/core";
import {
  baselinePpPerStarFromBestScores,
  pickBestChallengePlay,
  scoreBeatmapsetId,
} from "./challengeScoring";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function scoreTotalFromOsu(s: Record<string, unknown>): number | null {
  const n = Number(s.score);
  return Number.isFinite(n) ? n : null;
}

export type SubmitBattleFromOsuArgs = {
  battleId: number;
  beatmapsetId: number;
  relativePp: boolean;
  fixedBeatmapId: number | null;
  meId: number | null;
  oauthOsuId: number | null;
  socialPost: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
};

export type SubmitBattleFromOsuResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Same logic as the Battles panel “Submit from osu!” — ranked recent play on the set (or fixed difficulty for relative PP).
 */
export async function submitBattleFromOsu(args: SubmitBattleFromOsuArgs): Promise<SubmitBattleFromOsuResult> {
  const { battleId, beatmapsetId, relativePp, fixedBeatmapId, meId, oauthOsuId, socialPost } = args;
  const uid = meId ?? oauthOsuId;
  if (uid == null) {
    return { ok: false, error: "Sign in with osu! so we can read your recent scores." };
  }
  if (relativePp && meId == null) {
    return { ok: false, error: "Sign in with osu! so we can read your recent scores." };
  }
  try {
    if (relativePp) {
      const bestRaw = await invoke<unknown>("osu_user_best_scores", {
        userId: meId!,
        limit: 100,
        mode: "osu",
      });
      const baseline = baselinePpPerStarFromBestScores(bestRaw);
      const recentRaw = await invoke<unknown>("osu_user_recent_scores", { userId: uid, limit: 100, mode: "osu" });
      const picked = pickBestChallengePlay(recentRaw, beatmapsetId, {
        fixedBeatmapId,
        baselinePpPerStar: baseline,
      });
      if (picked == null) {
        return {
          ok: false,
          error:
            "No recent ranked score on this battle (need PP on the map). Play in osu! (stable), then try again.",
        };
      }
      await socialPost(`/api/v1/battles/${battleId}/submit`, {
        score: picked.score,
        mods: 0,
        rankValue: picked.rankValue,
        pp: picked.pp,
        stars: picked.stars,
        playBeatmapId: picked.playBeatmapId,
        baselinePpPerStar: picked.baselinePpPerStar,
        isUnweighted: false,
      });
      return {
        ok: true,
        message: `Submitted ${picked.pp.toFixed(0)}pp (${picked.rankValue.toFixed(2)}× vs your baseline) from osu! recent scores.`,
      };
    }
    const raw = await invoke<unknown>("osu_user_recent_scores", { userId: uid, limit: 100, mode: "osu" });
    const list = Array.isArray(raw) ? raw : [];
    let best: number | null = null;
    for (const item of list) {
      const s = asRecord(item);
      const sid = scoreBeatmapsetId(s);
      if (sid !== beatmapsetId) continue;
      const tot = scoreTotalFromOsu(s);
      if (tot == null) continue;
      if (best == null || tot > best) best = tot;
    }
    if (best == null) {
      return {
        ok: false,
        error:
          "No recent osu! score on this beatmap set. Play it in osu! (stable), then use “Submit from osu!” again.",
      };
    }
    await socialPost(`/api/v1/battles/${battleId}/submit`, { score: best, mods: 0 });
    return { ok: true, message: `Submitted score ${best.toLocaleString()} from your osu! recent scores.` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

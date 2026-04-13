/** Shared helpers for async battles UI. */

export function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h >= 48) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  if (h > 0) return `${h}h ${m}m`;
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

/** osu!web beatmap set cover (card @1x). */
export function beatmapCoverUrl(beatmapsetId: number): string {
  return `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/cover.jpg`;
}

export type BattleActionPriority = 0 | 1 | 2 | 3;

/**
 * Lower sort key = higher priority (show first).
 * 0: your turn (opponent submitted, you have not)
 * 1: nobody submitted yet
 * 2: you submitted, waiting on opponent
 * 3: both submitted (resolving)
 */
export function battleActionSortKey(raw: unknown, selfOsuId: number | null): { tier: BattleActionPriority; end: number } {
  const r = asRecord(raw);
  const end = Number(r.window_end);
  const state = String(r.state);
  const windowOpen = Number.isFinite(end) && Date.now() <= end;
  const canTrySubmit = state !== "closed" && windowOpen;
  const scoresRaw = r.scores;
  const scoreList = Array.isArray(scoresRaw) ? scoresRaw.map((x) => asRecord(x as Record<string, unknown>)) : [];
  const myScore = scoreList.some((s) => Number(s.user_osu_id) === selfOsuId);

  let tier: BattleActionPriority = 3;
  if (canTrySubmit) {
    if (scoreList.length === 0) tier = 1;
    else if (scoreList.length === 1) tier = myScore ? 2 : 0;
    else tier = 3;
  } else {
    tier = 3;
  }

  return { tier, end: Number.isFinite(end) ? end : Number.POSITIVE_INFINITY };
}

/** Sort active battles: action priority, then sooner deadline first. */
export function sortActiveBattlesByPriority(battles: unknown[], selfOsuId: number | null): unknown[] {
  return [...battles].sort((a, b) => {
    const ka = battleActionSortKey(a, selfOsuId);
    const kb = battleActionSortKey(b, selfOsuId);
    if (ka.tier !== kb.tier) return ka.tier - kb.tier;
    return ka.end - kb.end;
  });
}

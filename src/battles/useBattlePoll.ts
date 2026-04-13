import { useEffect, useRef } from "react";
import { asRecord } from "./battleUtils";

const IDLE_MS = 15_000;
const URGENT_MS = 8_000;

function battleNeedsAttention(battles: unknown[], selfOsuId: number | null): boolean {
  if (selfOsuId == null) return false;
  for (const raw of battles) {
    const r = asRecord(raw);
    const end = Number(r.window_end);
    const state = String(r.state);
    const windowOpen = Number.isFinite(end) && Date.now() <= end;
    if (state === "closed" || !windowOpen) continue;
    const scoresRaw = r.scores;
    const scoreList = Array.isArray(scoresRaw) ? scoresRaw : [];
    if (scoreList.length !== 1) continue;
    const sub = asRecord(scoreList[0]);
    const uid = Number(sub.user_osu_id);
    if (Number.isFinite(uid) && uid !== selfOsuId) return true;
  }
  return false;
}

type UseBattlePollArgs = {
  resolvedSocialApiBaseUrl: string | null;
  refreshBattles: () => Promise<void>;
  battles: unknown[];
  selfOsuId: number | null;
};

/**
 * Polls battle list; slows when tab hidden; faster interval when your action is needed.
 */
export function useBattlePoll({ resolvedSocialApiBaseUrl, refreshBattles, battles, selfOsuId }: UseBattlePollArgs): void {
  const refreshRef = useRef(refreshBattles);
  refreshRef.current = refreshBattles;

  useEffect(() => {
    if (!resolvedSocialApiBaseUrl) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const clear = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const schedule = () => {
      clear();
      const urgent = battleNeedsAttention(battles, selfOsuId);
      const ms = document.visibilityState === "hidden" ? IDLE_MS * 2 : urgent ? URGENT_MS : IDLE_MS;
      timer = setInterval(() => {
        if (document.visibilityState === "hidden") return;
        void refreshRef.current().catch(() => {});
      }, ms);
    };

    schedule();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshRef.current().catch(() => {});
      }
      schedule();
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clear();
    };
  }, [resolvedSocialApiBaseUrl, refreshBattles, battles, selfOsuId]);
}

import { useEffect, useRef } from "react";
import { notifyDesktop } from "./desktopNotify";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

type BattleSnap = {
  state: string;
  winner: number | null;
  /** Sorted comma-separated user_osu_ids who submitted */
  scoreUids: string;
};

function snapFromBattle(raw: unknown, scoresRaw: unknown): BattleSnap {
  const r = asRecord(raw);
  const state = String(r.state ?? "");
  const winner = r.winner_osu_id != null ? Number(r.winner_osu_id) : null;
  const list = Array.isArray(scoresRaw) ? scoresRaw : [];
  const uids = list
    .map((x) => Number(asRecord(x).user_osu_id))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  return {
    state,
    winner: Number.isFinite(winner!) ? winner : null,
    scoreUids: uids.join(","),
  };
}

/**
 * Polls battles while the party server is linked and notifies on incoming challenges,
 * opponent submits, and battle closed — even when the Battles sub-tab is not mounted.
 */
export function useBattleDesktopNotifications(
  socialGet: (path: string) => Promise<unknown>,
  selfOsuId: number | null,
  resolvedSocialApiBaseUrl: string | null,
  socialLoadDone: boolean,
  displayNameForOsu: (osuId: number) => string,
): void {
  const prevRef = useRef<Map<number, BattleSnap>>(new Map());
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (!resolvedSocialApiBaseUrl || selfOsuId == null || !socialLoadDone) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const j = asRecord(await socialGet("/api/v1/battles"));
        const battles = j.battles;
        if (!Array.isArray(battles) || cancelled) return;

        const nextMap = new Map<number, BattleSnap>();
        for (const raw of battles) {
          const r = asRecord(raw);
          const id = Number(r.id);
          if (!Number.isFinite(id)) continue;
          const scores = r.scores;
          nextMap.set(id, snapFromBattle(raw, scores));
        }

        if (!bootstrappedRef.current) {
          prevRef.current = nextMap;
          bootstrappedRef.current = true;
          return;
        }

        const prev = prevRef.current;

        for (const [id, snap] of nextMap) {
          const old = prev.get(id);
          const raw = battles.find((b) => Number(asRecord(b).id) === id);
          if (!raw) continue;
          const r = asRecord(raw);
          const creator = Number(r.creator_osu_id);
          const opponent = Number(r.opponent_osu_id);
          const other = selfOsuId === creator ? opponent : selfOsuId === opponent ? creator : null;

          if (old == null) {
            if (other != null && opponent === selfOsuId && creator !== selfOsuId) {
              const label = displayNameForOsu(creator);
              void notifyDesktop("osu-link — Battle challenge", `${label} challenged you — ${mapTitleHint(r)}`);
            }
            continue;
          }

          if (other != null && old.state !== "closed" && snap.state === "closed") {
            const w = snap.winner;
            let body: string;
            if (w == null) body = `Battle #${id} ended — no winner. ${mapTitleHint(r)}`;
            else if (w === selfOsuId) body = `You won battle #${id}. ${mapTitleHint(r)}`;
            else body = `${displayNameForOsu(w)} won battle #${id}. ${mapTitleHint(r)}`;
            void notifyDesktop("osu-link — Battle finished", body);
          }

          if (other != null && old.state === snap.state && snap.state !== "closed") {
            const hadOtherScore = old.scoreUids.split(",").includes(String(other));
            const hasOtherScore = snap.scoreUids.split(",").includes(String(other));
            const hasMine = snap.scoreUids.split(",").includes(String(selfOsuId));
            if (!hadOtherScore && hasOtherScore && !hasMine) {
              void notifyDesktop(
                "osu-link — Battle",
                `${displayNameForOsu(other)} submitted — your turn (#${id}). ${mapTitleHint(r)}`,
              );
            }
          }
        }

        prevRef.current = nextMap;
      } catch {
        /* ignore */
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 40_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [socialGet, selfOsuId, resolvedSocialApiBaseUrl, socialLoadDone, displayNameForOsu]);

  useEffect(() => {
    bootstrappedRef.current = false;
    prevRef.current = new Map();
  }, [resolvedSocialApiBaseUrl]);
}

function mapTitleHint(r: Record<string, unknown>): string {
  const disp = r.display as { title?: string; artist?: string } | undefined;
  if (disp && (String(disp.title ?? "").trim() || String(disp.artist ?? "").trim())) {
    const title = String(disp.title ?? "").trim() || "—";
    const artist = String(disp.artist ?? "").trim() || "—";
    return `${artist} — ${title}`;
  }
  const sid = Number(r.beatmapset_id);
  return Number.isFinite(sid) ? `Set ${sid}` : "";
}

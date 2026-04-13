import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ASSIGNED_STAR_MAX_DELTA, pickBeatmapIdForAssignedTier } from "../challengeScoring";
import { canOpenBattleSubmitInOsu, openBattleSubmitTargetInOsu } from "./openInOsu";

export type FixedBeatmapDetail = { version: string; stars: number };

type BattleSubmitRequirementProps = {
  beatmapsetId: number;
  relativePp: boolean;
  fixedBeatmapId: number | null;
  /** From osu! API when available; otherwise we show beatmap id only. */
  fixedBeatmapDetail: FixedBeatmapDetail | null | undefined;
  creatorId: number;
  opponentId: number;
  medianStarsByOsuId: Map<number, number | null>;
  /** Signed-in user’s osu! id — “Open in osu!” uses their assigned tier to pick a difficulty when the battle is not fixed. */
  viewerOsuId: number | null;
  displayNameForOsu: (osuId: number) => string;
  /** Called when handing off to osu!stable fails (desktop app only). */
  onOpenInOsuError?: (message: string) => void;
};

export function BattleSubmitRequirement({
  beatmapsetId,
  relativePp,
  fixedBeatmapId,
  fixedBeatmapDetail,
  creatorId,
  opponentId,
  medianStarsByOsuId,
  viewerOsuId,
  displayNameForOsu,
  onOpenInOsuError,
}: BattleSubmitRequirementProps) {
  const setUrl = Number.isFinite(beatmapsetId) ? `https://osu.ppy.sh/beatmapsets/${beatmapsetId}` : null;
  const [tierOpenBeatmapId, setTierOpenBeatmapId] = useState<number | null>(null);
  const [openingOsu, setOpeningOsu] = useState(false);
  const openingRef = useRef(false);

  const preferredStarsForViewer =
    viewerOsuId != null && Number.isFinite(viewerOsuId)
      ? medianStarsByOsuId.get(viewerOsuId)
      : null;
  const medOk =
    preferredStarsForViewer != null &&
    Number.isFinite(preferredStarsForViewer) &&
    preferredStarsForViewer > 0;

  useEffect(() => {
    setTierOpenBeatmapId(null);
    if (!isTauri()) return;
    if (!relativePp || fixedBeatmapId != null) return;
    if (!Number.isFinite(beatmapsetId) || beatmapsetId <= 0) return;
    if (viewerOsuId == null || !Number.isFinite(viewerOsuId)) return;
    if (!medOk) return;

    let cancelled = false;
    void (async () => {
      try {
        const raw = await invoke<unknown>("get_beatmapset", { beatmapsetId });
        if (cancelled) return;
        const root = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
        const bms = root.beatmaps;
        const list = Array.isArray(bms) ? bms : [];
        const picked = pickBeatmapIdForAssignedTier(list, preferredStarsForViewer);
        if (!cancelled) setTierOpenBeatmapId(picked);
      } catch {
        if (!cancelled) setTierOpenBeatmapId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [beatmapsetId, relativePp, fixedBeatmapId, viewerOsuId, medOk, preferredStarsForViewer]);

  const effectiveOpenBeatmapId =
    fixedBeatmapId != null && Number.isFinite(fixedBeatmapId) ? fixedBeatmapId : tierOpenBeatmapId;

  const showOpenInOsu = canOpenBattleSubmitInOsu(beatmapsetId, effectiveOpenBeatmapId);

  const handleOpenInOsu = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpeningOsu(true);
    try {
      let bm =
        fixedBeatmapId != null && Number.isFinite(fixedBeatmapId) ? fixedBeatmapId : tierOpenBeatmapId;
      if (bm == null && relativePp && medOk && Number.isFinite(beatmapsetId) && beatmapsetId > 0 && isTauri()) {
        try {
          const raw = await invoke<unknown>("get_beatmapset", { beatmapsetId });
          const root = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
          const bms = root.beatmaps;
          const list = Array.isArray(bms) ? bms : [];
          bm = pickBeatmapIdForAssignedTier(list, preferredStarsForViewer);
        } catch {
          bm = null;
        }
      }
      await openBattleSubmitTargetInOsu(beatmapsetId, bm);
    } catch (e) {
      onOpenInOsuError?.(String(e));
    } finally {
      openingRef.current = false;
      setOpeningOsu(false);
    }
  }, [
    beatmapsetId,
    fixedBeatmapId,
    tierOpenBeatmapId,
    relativePp,
    medOk,
    preferredStarsForViewer,
    onOpenInOsuError,
  ]);

  const head = (title: string) => (
    <div className="battles-panel__submit-req-head">
      <div className="battles-panel__submit-req-title">{title}</div>
      {showOpenInOsu ? (
        <button
          type="button"
          className="secondary small-btn battles-panel__submit-req-osu"
          disabled={openingOsu}
          onClick={() => void handleOpenInOsu()}
        >
          {openingOsu ? "Opening…" : "Open in osu!"}
        </button>
      ) : null}
    </div>
  );

  if (!relativePp) {
    return (
      <div className="battles-panel__submit-req">
        {head("What to submit")}
        <p className="battles-panel__submit-req-body">
          Highest recent score on{" "}
          {setUrl ? (
            <a href={setUrl} target="_blank" rel="noreferrer">
              this beatmap set
            </a>
          ) : (
            "this beatmap set"
          )}
          — any difficulty counts.
        </p>
      </div>
    );
  }

  if (fixedBeatmapId != null && Number.isFinite(fixedBeatmapId)) {
    const bmUrl = `https://osu.ppy.sh/beatmaps/${fixedBeatmapId}`;
    const detail =
      fixedBeatmapDetail && fixedBeatmapDetail.stars > 0
        ? `${fixedBeatmapDetail.version} (~${fixedBeatmapDetail.stars.toFixed(1)}★)`
        : fixedBeatmapDetail
          ? fixedBeatmapDetail.version
          : `beatmap #${fixedBeatmapId}`;
    return (
      <div className="battles-panel__submit-req">
        {head("What to submit")}
        <p className="battles-panel__submit-req-body">
          Both players: same ranked difficulty —{" "}
          <a href={bmUrl} target="_blank" rel="noreferrer">
            {detail}
          </a>
          .
        </p>
      </div>
    );
  }

  const playerLine = (pid: number) => {
    const name = displayNameForOsu(pid);
    const med = medianStarsByOsuId.get(pid);
    if (med != null && Number.isFinite(med) && med > 0) {
      const lo = Math.max(0, med - ASSIGNED_STAR_MAX_DELTA);
      const hi = med + ASSIGNED_STAR_MAX_DELTA;
      return (
        <li key={pid}>
          <span className="battles-panel__submit-req-name">{name}</span>
          <span className="battles-panel__submit-req-rule">
            {" "}
            — ranked play on this set, <strong>{lo.toFixed(1)}★–{hi.toFixed(1)}★</strong> (assigned ~{med.toFixed(1)}★ from
            your top plays)
          </span>
        </li>
      );
    }
    return (
      <li key={pid}>
        <span className="battles-panel__submit-req-name">{name}</span>
        <span className="battles-panel__submit-req-rule">
          {" "}
          — ranked play within <strong>±{ASSIGNED_STAR_MAX_DELTA}★</strong> of your assigned tier (sign in + osu! data
          loads your ~★ band)
        </span>
      </li>
    );
  };

  return (
    <div className="battles-panel__submit-req">
      {head("What each player submits")}
      <ul className="battles-panel__submit-req-list">
        {playerLine(creatorId)}
        {playerLine(opponentId)}
      </ul>
      {setUrl ? (
        <p className="hint battles-panel__submit-req-foot">
          Only difficulties on{" "}
          <a href={setUrl} target="_blank" rel="noreferrer">
            this beatmap set
          </a>{" "}
          in your osu! recent scores (stable).
          {medOk && viewerOsuId != null ? (
            <>
              {" "}
              In the desktop app, <strong>Open in osu!</strong> picks the ranked difficulty on this set closest to your
              assigned ~★.
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

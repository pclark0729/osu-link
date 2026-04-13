import { useCallback, useRef, useState } from "react";
import { ASSIGNED_STAR_MAX_DELTA } from "../challengeScoring";
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
  displayNameForOsu,
  onOpenInOsuError,
}: BattleSubmitRequirementProps) {
  const setUrl = Number.isFinite(beatmapsetId) ? `https://osu.ppy.sh/beatmapsets/${beatmapsetId}` : null;
  const showOpenInOsu = canOpenBattleSubmitInOsu(beatmapsetId, fixedBeatmapId);
  const [openingOsu, setOpeningOsu] = useState(false);
  const openingRef = useRef(false);

  const handleOpenInOsu = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpeningOsu(true);
    try {
      await openBattleSubmitTargetInOsu(beatmapsetId, fixedBeatmapId);
    } catch (e) {
      onOpenInOsuError?.(String(e));
    } finally {
      openingRef.current = false;
      setOpeningOsu(false);
    }
  }, [beatmapsetId, fixedBeatmapId, onOpenInOsuError]);

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
        </p>
      ) : null}
    </div>
  );
}

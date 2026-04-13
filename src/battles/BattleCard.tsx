import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import type { BattlePlayHint } from "./battlePlayHints";
import { playHintFromBeatmapset } from "./battlePlayHints";
import { asRecord, beatmapCoverUrl, formatTimeRemaining } from "./battleUtils";
import { canOpenBattleSubmitInOsu, openBattleSubmitTargetInOsu } from "./openInOsu";

export type BattleCardProps = {
  raw: unknown;
  selfOsuId: number | null;
  tick: number;
  uiLocked: boolean;
  /** Beatmap line: `artist — title` */
  mapTitle: string;
  /** Mapper username from beatmap set metadata, when known */
  mapMapper?: string;
  displayNameForOsu: (osuId: number) => string;
  fighterSubtitle: (osuId: number, relativePpBattle: boolean, fixedBeatmapId: number | null) => ReactNode;
  /** Fixed-difficulty battle: the map both players use. */
  fixedPlayHint: BattlePlayHint | null;
  /** Relative-PP “any diff” battle: suggested map per player (null while loading or if unknown). */
  tierPlayHints: { creator: BattlePlayHint | null; opponent: BattlePlayHint | null } | null;
  viewerPlayHint: BattlePlayHint | null;
  viewerMedianStars: number | null;
  onOpenDetails: (id: number) => void;
  onRematch: (r: Record<string, unknown>) => void;
  onSubmitFromOsu: (
    battleId: number,
    beatmapsetId: number,
    opts: { relativePp: boolean; fixedBeatmapId: number | null },
  ) => void;
  onOpenScoreModal: (battleId: number, relativePp: boolean) => void;
  onOpenInOsuError?: (message: string) => void;
};

export function BattleCard({
  raw,
  selfOsuId,
  tick,
  uiLocked,
  mapTitle,
  mapMapper,
  displayNameForOsu,
  fighterSubtitle,
  fixedPlayHint,
  tierPlayHints,
  viewerPlayHint,
  viewerMedianStars,
  onOpenDetails,
  onRematch,
  onSubmitFromOsu,
  onOpenScoreModal,
  onOpenInOsuError,
}: BattleCardProps) {
  const r = asRecord(raw);
  const id = Number(r.id);
  const creator = Number(r.creator_osu_id);
  const opponent = Number(r.opponent_osu_id);
  const setId = Number(r.beatmapset_id);
  const windowStart = Number(r.window_start);
  const end = Number(r.window_end);
  const state = String(r.state);
  const winner = r.winner_osu_id != null ? Number(r.winner_osu_id) : null;
  const relativePpBattle = Number(r.relative_pp) === 1;
  const fixedBattleBm = r.beatmap_id != null ? Number(r.beatmap_id) : null;
  const windowOpen = Number.isFinite(end) && Date.now() <= end;
  const canTrySubmit = state !== "closed" && windowOpen;
  const scoresRaw = r.scores;
  const scoreList = Array.isArray(scoresRaw) ? scoresRaw.map((x) => asRecord(x as Record<string, unknown>)) : [];
  const myScore = scoreList.find((s) => Number(s.user_osu_id) === selfOsuId);

  let statusBadge = "";
  let statusClass = "battles-panel__status battles-panel__status--open";
  if (state === "closed") {
    if (winner == null) {
      statusBadge = "Finished · no winner";
      statusClass = "battles-panel__status battles-panel__status--muted";
    } else if (selfOsuId != null && winner === selfOsuId) {
      statusBadge = "You won";
      statusClass = "battles-panel__status battles-panel__status--win";
    } else {
      statusBadge = "You lost";
      statusClass = "battles-panel__status battles-panel__status--loss";
    }
  } else if (!windowOpen) {
    statusBadge = "Window ended";
    statusClass = "battles-panel__status battles-panel__status--muted";
  } else if (scoreList.length >= 2) {
    statusBadge = "Both submitted";
    statusClass = "battles-panel__status battles-panel__status--done";
  } else if (scoreList.length === 1) {
    statusBadge = myScore ? "Awaiting opponent" : "Your turn";
    statusClass = "battles-panel__status battles-panel__status--wait";
  } else {
    statusBadge = "Open";
    statusClass = "battles-panel__status battles-panel__status--open";
  }

  const scoresLine =
    scoreList.length > 0 ? (
      <div className="battles-panel__scores-strip" aria-label="Submitted scores">
        {scoreList.map((s) => {
          const uid = Number(s.user_osu_id);
          const sc = Number(s.score);
          const rv = s.rank_value != null ? Number(s.rank_value) : null;
          const ppV = s.pp != null ? Number(s.pp) : null;
          const starsV = s.stars != null ? Number(s.stars) : null;
          const unweighted = Boolean(s.is_unweighted);
          let primary: string;
          let detail: string | null = null;
          if (relativePpBattle && unweighted) {
            primary = Number.isFinite(sc) ? sc.toLocaleString() : "—";
            detail = `${displayNameForOsu(uid)} · raw`;
          } else if (relativePpBattle && rv != null && Number.isFinite(rv)) {
            const starBit = starsV != null && Number.isFinite(starsV) ? `★${starsV.toFixed(1)}` : "";
            const ppBit = ppV != null && Number.isFinite(ppV) ? `${ppV.toFixed(0)}pp` : "";
            primary = `${rv.toFixed(2)}×`;
            detail = [displayNameForOsu(uid), starBit, ppBit].filter(Boolean).join(" · ");
          } else {
            primary = Number.isFinite(sc) ? sc.toLocaleString() : "—";
            detail = displayNameForOsu(uid);
          }
          return (
            <div key={uid} className="battles-panel__score-chip">
              <span className="battles-panel__score-chip-val">{primary}</span>
              {detail ? <span className="battles-panel__score-chip-meta">{detail}</span> : null}
            </div>
          );
        })}
      </div>
    ) : (
      <p className="hint battles-panel__no-scores">No scores yet.</p>
    );

  const remaining = Number.isFinite(end) ? end - Date.now() : 0;
  const totalWin =
    Number.isFinite(windowStart) && Number.isFinite(end) && end > windowStart ? end - windowStart : 0;
  const progressFrac =
    totalWin > 0 && Number.isFinite(remaining) ? Math.max(0, Math.min(1, remaining / totalWin)) : null;

  const countdown =
    canTrySubmit && Number.isFinite(end) ? (
      <span key={tick} className="battles-panel__countdown" title={new Date(end).toLocaleString()}>
        {formatTimeRemaining(remaining)} left
      </span>
    ) : null;

  const coverSrc = Number.isFinite(setId) && setId > 0 ? beatmapCoverUrl(setId) : null;

  const fixedBmOk = fixedBattleBm != null && Number.isFinite(fixedBattleBm);
  const effectiveOpenBeatmapId =
    fixedBmOk ? fixedBattleBm : viewerPlayHint != null ? viewerPlayHint.beatmapId : null;
  const showOpenInOsuBtn = canTrySubmit && canOpenBattleSubmitInOsu(setId, effectiveOpenBeatmapId);
  const [openingOsu, setOpeningOsu] = useState(false);
  const openingOsuRef = useRef(false);

  const handleOpenInOsu = useCallback(async () => {
    if (openingOsuRef.current) return;
    openingOsuRef.current = true;
    setOpeningOsu(true);
    try {
      let bm: number | null = fixedBmOk ? fixedBattleBm : viewerPlayHint?.beatmapId ?? null;
      if (
        bm == null &&
        relativePpBattle &&
        !fixedBmOk &&
        selfOsuId != null &&
        viewerMedianStars != null &&
        Number.isFinite(viewerMedianStars) &&
        viewerMedianStars > 0 &&
        Number.isFinite(setId) &&
        setId > 0 &&
        isTauri()
      ) {
        try {
          const raw = await invoke<unknown>("get_beatmapset", { beatmapsetId: setId });
          const root = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
          const bms = Array.isArray(root.beatmaps) ? root.beatmaps : [];
          const hint = playHintFromBeatmapset(bms, viewerMedianStars);
          bm = hint?.beatmapId ?? null;
        } catch {
          bm = null;
        }
      }
      await openBattleSubmitTargetInOsu(setId, bm);
    } catch (e) {
      onOpenInOsuError?.(String(e));
    } finally {
      openingOsuRef.current = false;
      setOpeningOsu(false);
    }
  }, [
    fixedBmOk,
    fixedBattleBm,
    viewerPlayHint,
    relativePpBattle,
    selfOsuId,
    viewerMedianStars,
    setId,
    onOpenInOsuError,
  ]);

  const playHintLink = (h: BattlePlayHint | null) => {
    if (h == null) {
      return <span className="battles-panel__play-target-missing">—</span>;
    }
    const starBit = Number.isFinite(h.stars) && h.stars > 0 ? ` (~${h.stars.toFixed(1)}★)` : "";
    return (
      <a href={`https://osu.ppy.sh/beatmaps/${h.beatmapId}`} target="_blank" rel="noreferrer">
        {h.version}
        {starBit}
      </a>
    );
  };

  const showPlayTargets =
    fixedPlayHint != null || (relativePpBattle && !fixedBmOk && tierPlayHints != null);

  return (
    <li className="battles-panel__card battles-panel__card--enhanced">
      {coverSrc ? (
        <div className="battles-panel__cover-wrap" aria-hidden>
          <img className="battles-panel__cover" src={coverSrc} alt="" loading="lazy" />
        </div>
      ) : null}
      <div className="battles-panel__card-inner">
        <div className="battles-panel__card-main">
          <div className="battles-panel__card-head">
            <div className="battles-panel__map-headlines">
              <span className="battles-panel__map-title">{mapTitle}</span>
              {mapMapper ? (
                <span className="battles-panel__map-mapper">
                  <span className="battles-panel__map-mapper-sep" aria-hidden>
                    ·
                  </span>
                  {mapMapper}
                </span>
              ) : null}
            </div>
            <span className={statusClass}>{statusBadge}</span>
          </div>
          <div className="battles-panel__versus-strip" aria-label="Players">
            <div
              className={`battles-panel__fighter${
                state === "closed" && winner != null && Number.isFinite(creator) && winner === creator
                  ? " battles-panel__fighter--winner"
                  : ""
              }`}
            >
              <span className="battles-panel__fighter-name">{displayNameForOsu(creator)}</span>
              {fighterSubtitle(creator, relativePpBattle, fixedBattleBm != null && Number.isFinite(fixedBattleBm) ? fixedBattleBm : null)}
            </div>
            <span className="battles-panel__vs" aria-hidden>
              vs
            </span>
            <div
              className={`battles-panel__fighter${
                state === "closed" && winner != null && Number.isFinite(opponent) && winner === opponent
                  ? " battles-panel__fighter--winner"
                  : ""
              }`}
            >
              <span className="battles-panel__fighter-name">{displayNameForOsu(opponent)}</span>
              {fighterSubtitle(opponent, relativePpBattle, fixedBattleBm != null && Number.isFinite(fixedBattleBm) ? fixedBattleBm : null)}
            </div>
          </div>
          {showPlayTargets ? (
            <div className="battles-panel__play-targets">
              {fixedPlayHint != null ? (
                <p className="hint battles-panel__play-target-line">
                  <span className="battles-panel__play-target-k">Map</span> {playHintLink(fixedPlayHint)}{" "}
                  <span className="battles-panel__play-target-note">· same diff</span>
                </p>
              ) : tierPlayHints != null ? (
                <div className="battles-panel__play-target-grid">
                  <div className="battles-panel__play-target-cell">
                    <span className="battles-panel__play-target-k">{displayNameForOsu(creator)}</span>
                    {playHintLink(tierPlayHints.creator)}
                  </div>
                  <div className="battles-panel__play-target-cell">
                    <span className="battles-panel__play-target-k">{displayNameForOsu(opponent)}</span>
                    {playHintLink(tierPlayHints.opponent)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {canTrySubmit && progressFrac != null ? (
            <div
              className="battles-panel__window-bar"
              role="progressbar"
              aria-valuenow={Math.round(progressFrac * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Time remaining in battle window"
            >
              <div className="battles-panel__window-bar-fill" style={{ width: `${progressFrac * 100}%` }} />
            </div>
          ) : null}
          {scoresLine}
          <div className="battles-panel__meta-row">
            <span className="hint battles-panel__meta">
              #{id}
              {Number.isFinite(setId) ? ` · ${setId}` : ""}
              {relativePpBattle ? " · rel PP" : ""}
              {fixedBattleBm != null && Number.isFinite(fixedBattleBm) ? ` · bm ${fixedBattleBm}` : ""}
            </span>
            {Number.isFinite(end) || countdown ? (
              <span className="hint battles-panel__meta battles-panel__meta--time">
                {Number.isFinite(end) ? new Date(end).toLocaleString() : null}
                {countdown ? (
                  <>
                    {Number.isFinite(end) ? " · " : null}
                    {countdown}
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
          <div className="battles-panel__action-bar">
            <div className="battles-panel__action-bar-start">
              <button type="button" className="secondary small-btn" onClick={() => onOpenDetails(id)}>
                Details
              </button>
              {state === "closed" && selfOsuId != null && (selfOsuId === creator || selfOsuId === opponent) ? (
                <button type="button" className="secondary small-btn" onClick={() => onRematch(r)}>
                  Rematch
                </button>
              ) : null}
            </div>
            {canTrySubmit ? (
              <div className="battles-panel__action-bar-end">
                <button
                  type="button"
                  className="primary small-btn"
                  disabled={uiLocked}
                  title="Submit from osu!"
                  onClick={() =>
                    void onSubmitFromOsu(id, setId, {
                      relativePp: relativePpBattle,
                      fixedBeatmapId:
                        fixedBattleBm != null && Number.isFinite(fixedBattleBm) ? fixedBattleBm : null,
                    })
                  }
                >
                  Submit
                </button>
                {showOpenInOsuBtn ? (
                  <button
                    type="button"
                    className="secondary small-btn"
                    disabled={uiLocked || openingOsu}
                    onClick={() => void handleOpenInOsu()}
                    title="Open this beatmap in the osu! client"
                  >
                    {openingOsu ? "…" : "In osu!"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="secondary small-btn"
                  disabled={uiLocked}
                  title="Enter score manually"
                  onClick={() => onOpenScoreModal(id, relativePpBattle)}
                >
                  Score…
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {!canTrySubmit &&
        selfOsuId != null &&
        (selfOsuId === creator || selfOsuId === opponent) &&
        !myScore &&
        (state === "closed" || !windowOpen) ? (
          <p className="hint battles-panel__missed">You did not submit a score for this battle.</p>
        ) : null}
      </div>
    </li>
  );
}

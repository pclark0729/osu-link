import type { ReactNode } from "react";
import { asRecord, beatmapCoverUrl, formatTimeRemaining } from "./battleUtils";

export type BattleCardProps = {
  raw: unknown;
  selfOsuId: number | null;
  tick: number;
  uiLocked: boolean;
  mapTitle: string;
  displayNameForOsu: (osuId: number) => string;
  fighterSubtitle: (osuId: number, relativePpBattle: boolean, fixedBeatmapId: number | null) => ReactNode;
  onOpenDetails: (id: number) => void;
  onRematch: (r: Record<string, unknown>) => void;
  onSubmitFromOsu: (
    battleId: number,
    beatmapsetId: number,
    opts: { relativePp: boolean; fixedBeatmapId: number | null },
  ) => void;
  onOpenScoreModal: (battleId: number, relativePp: boolean) => void;
};

export function BattleCard({
  raw,
  selfOsuId,
  tick,
  uiLocked,
  mapTitle,
  displayNameForOsu,
  fighterSubtitle,
  onOpenDetails,
  onRematch,
  onSubmitFromOsu,
  onOpenScoreModal,
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
      <ul className="battles-panel__scores" aria-label="Submitted scores">
        {scoreList.map((s) => {
          const uid = Number(s.user_osu_id);
          const sc = Number(s.score);
          const rv = s.rank_value != null ? Number(s.rank_value) : null;
          const ppV = s.pp != null ? Number(s.pp) : null;
          const starsV = s.stars != null ? Number(s.stars) : null;
          const unweighted = Boolean(s.is_unweighted);
          let line: string;
          if (relativePpBattle && unweighted) {
            line = `${displayNameForOsu(uid)} — ${Number.isFinite(sc) ? sc.toLocaleString() : "—"} (raw)`;
          } else if (relativePpBattle && rv != null && Number.isFinite(rv)) {
            const starBit = starsV != null && Number.isFinite(starsV) ? `★${starsV.toFixed(1)} · ` : "";
            const ppBit = ppV != null && Number.isFinite(ppV) ? `${ppV.toFixed(0)}pp · ` : "";
            line = `${displayNameForOsu(uid)} — ${starBit}${ppBit}${rv.toFixed(2)}×`;
          } else {
            line = `${displayNameForOsu(uid)}: ${Number.isFinite(sc) ? sc.toLocaleString() : "—"}`;
          }
          return <li key={uid}>{line}</li>;
        })}
      </ul>
    ) : (
      <p className="hint battles-panel__no-scores">No scores submitted yet.</p>
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
            <span className="battles-panel__map-title">{mapTitle}</span>
            <span className={statusClass}>{statusBadge}</span>
          </div>
          <div className="battles-panel__fighters" aria-label="Players">
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
            <span className="hint battles-panel__vs">vs</span>
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
          <div className="battles-panel__card-tools">
            <button type="button" className="secondary small-btn" onClick={() => onOpenDetails(id)}>
              Details
            </button>
            {state === "closed" && selfOsuId != null && (selfOsuId === creator || selfOsuId === opponent) ? (
              <button type="button" className="secondary small-btn" onClick={() => onRematch(r)}>
                Rematch
              </button>
            ) : null}
          </div>
          <span className="hint battles-panel__meta">
            #{id}
            {Number.isFinite(setId) ? ` · set ${setId}` : ""}
            {relativePpBattle ? " · relative PP" : ""}
            {fixedBattleBm != null && Number.isFinite(fixedBattleBm) ? ` · fixed beatmap ${fixedBattleBm}` : ""}
            {Number.isFinite(end) ? ` · ends ${new Date(end).toLocaleString()}` : ""}
            {countdown ? (
              <>
                {" "}
                · {countdown}
              </>
            ) : null}
          </span>
          {scoresLine}
        </div>
        {canTrySubmit && (
          <div className="battles-panel__card-actions">
            <button
              type="button"
              className="primary small-btn"
              disabled={uiLocked}
              onClick={() =>
                void onSubmitFromOsu(id, setId, {
                  relativePp: relativePpBattle,
                  fixedBeatmapId:
                    fixedBattleBm != null && Number.isFinite(fixedBattleBm) ? fixedBattleBm : null,
                })
              }
            >
              Submit from osu!
            </button>
            <button
              type="button"
              className="secondary small-btn"
              disabled={uiLocked}
              onClick={() => onOpenScoreModal(id, relativePpBattle)}
            >
              Enter score…
            </button>
          </div>
        )}
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

import { BattleDetailLoadingSkeleton } from "../Skeleton";
import { BattleSubmitRequirement, type FixedBeatmapDetail } from "./BattleSubmitRequirement";
import { asRecord } from "./battleUtils";

type BattleDetailModalProps = {
  detailBattleId: number;
  uiLocked: boolean;
  detailErr: string | null;
  detailPayload: {
    battle: Record<string, unknown>;
    scores: unknown[];
  } | null;
  mapLineForBattle: (r: Record<string, unknown>) => string;
  displayNameForOsu: (osuId: number) => string;
  medianStarsByOsuId: Map<number, number | null>;
  fixedBeatmapDetailById: Map<number, FixedBeatmapDetail | null>;
  onOpenInOsuError?: (message: string) => void;
  onClose: () => void;
};

export function BattleDetailModal({
  detailBattleId,
  uiLocked,
  detailErr,
  detailPayload,
  mapLineForBattle,
  displayNameForOsu,
  medianStarsByOsuId,
  fixedBeatmapDetailById,
  onOpenInOsuError,
  onClose,
}: BattleDetailModalProps) {
  return (
    <div
      className="battles-panel__modal-backdrop battles-panel__modal-backdrop--animate"
      role="presentation"
      onClick={() => !uiLocked && onClose()}
    >
      <div
        className="battles-panel__modal battles-panel__modal--wide battles-panel__modal--animate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="battles-detail-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 id="battles-detail-modal-title" className="battles-panel__modal-title">
          Battle #{detailBattleId}
        </h4>
        {detailErr && <div className="error-banner">{detailErr}</div>}
        {!detailPayload && !detailErr ? <BattleDetailLoadingSkeleton /> : null}
        {detailPayload ? (
          <div className="battles-panel__detail-body">
            {(() => {
              const b = detailPayload.battle;
              const setId = Number(b.beatmapset_id);
              const ws = Number(b.window_start);
              const we = Number(b.window_end);
              const rel = Number(b.relative_pp) === 1;
              const fbm = b.beatmap_id != null ? Number(b.beatmap_id) : null;
              const w = b.winner_osu_id != null ? Number(b.winner_osu_id) : null;
              const st = String(b.state ?? "");
              const creatorId = Number(b.creator_osu_id);
              const opponentId = Number(b.opponent_osu_id);
              const mapHref = Number.isFinite(setId) ? `https://osu.ppy.sh/beatmapsets/${setId}` : null;
              return (
                <>
                  <p className="battles-panel__detail-map">{mapLineForBattle(b)}</p>
                  {mapHref ? (
                    <p>
                      <a href={mapHref} target="_blank" rel="noreferrer">
                        Open beatmap set
                      </a>
                      {Number.isFinite(setId) ? ` · set ${setId}` : ""}
                    </p>
                  ) : null}
                  {Number.isFinite(creatorId) && Number.isFinite(opponentId) ? (
                    <BattleSubmitRequirement
                      beatmapsetId={setId}
                      relativePp={rel}
                      fixedBeatmapId={fbm != null && Number.isFinite(fbm) ? fbm : null}
                      fixedBeatmapDetail={
                        fbm != null && Number.isFinite(fbm) ? fixedBeatmapDetailById.get(fbm) : undefined
                      }
                      creatorId={creatorId}
                      opponentId={opponentId}
                      medianStarsByOsuId={medianStarsByOsuId}
                      displayNameForOsu={displayNameForOsu}
                      onOpenInOsuError={onOpenInOsuError}
                    />
                  ) : null}
                  <ul className="battles-panel__detail-facts">
                    <li>
                      <strong>Window:</strong> {Number.isFinite(ws) ? new Date(ws).toLocaleString() : "—"} →{" "}
                      {Number.isFinite(we) ? new Date(we).toLocaleString() : "—"}
                    </li>
                    <li>
                      <strong>Mode:</strong> {rel ? "Relative PP" : "Raw score"}
                    </li>
                    {fbm != null && Number.isFinite(fbm) ? (
                      <li>
                        <strong>Fixed beatmap:</strong>{" "}
                        <a href={`https://osu.ppy.sh/beatmaps/${fbm}`} target="_blank" rel="noreferrer">
                          {fbm}
                        </a>
                      </li>
                    ) : null}
                    <li>
                      <strong>State:</strong> {st}
                      {w != null && Number.isFinite(w) ? (
                        <>
                          {" "}
                          · <strong>Winner:</strong> {displayNameForOsu(w)}
                        </>
                      ) : null}
                    </li>
                  </ul>
                  <h5 className="battles-panel__detail-scores-h">Submissions</h5>
                  <ul className="battles-panel__detail-scores">
                    {detailPayload.scores.length === 0 ? (
                      <li className="hint">No scores yet.</li>
                    ) : (
                      detailPayload.scores.map((raw, i) => {
                        const s = asRecord(raw);
                        const uid = Number(s.user_osu_id);
                        const sc = Number(s.score);
                        const at = Number(s.submitted_at);
                        const mods = s.mods != null ? Number(s.mods) : 0;
                        const rv = s.rank_value != null ? Number(s.rank_value) : null;
                        const ppV = s.pp != null ? Number(s.pp) : null;
                        const stV = s.stars != null ? Number(s.stars) : null;
                        const pbm = s.play_beatmap_id != null ? Number(s.play_beatmap_id) : null;
                        const base = s.baseline_pp_per_star != null ? Number(s.baseline_pp_per_star) : null;
                        const unweighted = Boolean(s.is_unweighted);
                        return (
                          <li key={i}>
                            <strong>{displayNameForOsu(uid)}</strong>
                            {Number.isFinite(at) ? (
                              <span className="hint"> · {new Date(at).toLocaleString()}</span>
                            ) : null}
                            <br />
                            Score: {Number.isFinite(sc) ? sc.toLocaleString() : "—"} · mods: {mods}
                            {unweighted ? " · unweighted (raw)" : ""}
                            {rv != null && Number.isFinite(rv) ? (
                              <>
                                <br />
                                PP: {ppV != null && Number.isFinite(ppV) ? `${ppV.toFixed(0)} · ` : ""}
                                {stV != null && Number.isFinite(stV) ? `★${stV.toFixed(1)} · ` : ""}
                                {rv.toFixed(2)}× vs baseline
                                {base != null && Number.isFinite(base) ? ` (baseline ~${base.toFixed(1)}pp/★)` : ""}
                              </>
                            ) : null}
                            {pbm != null && Number.isFinite(pbm) ? (
                              <>
                                <br />
                                Play:{" "}
                                <a
                                  href={`https://osu.ppy.sh/beatmapsets/${setId}#osu/${pbm}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  beatmap {pbm}
                                </a>
                              </>
                            ) : null}
                          </li>
                        );
                      })
                    )}
                  </ul>
                </>
              );
            })()}
          </div>
        ) : null}
        <div className="battles-panel__modal-actions">
          <button type="button" className="primary" onClick={() => onClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

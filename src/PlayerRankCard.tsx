import { PERFORMANCE_METRIC_TOOLTIPS, type PlayerRankInfo } from "./playerRank";

export function PlayerRankCard({
  info,
  variant = "default",
}: {
  info: PlayerRankInfo;
  variant?: "default" | "compact";
}) {
  const pct = Math.round(info.percentOfMax * 1000) / 10;
  const next = info.nextRank;
  const b = info.breakdown;

  return (
    <div className={`player-rank-card player-rank-card--${info.rankId} ${variant === "compact" ? "player-rank-card--compact" : ""}`}>
      <div className="player-rank-card-main">
        <span className="player-rank-card-label">Performance rank</span>
        <span className="player-rank-card-name">{info.name}</span>
        <span
          className="player-rank-card-score"
          title="Weighted osu! stats across all modes: skill (PP + rank), precision (accuracy), reliability (consistency × volume), excellence (grades)."
        >
          {info.compositeScore.toLocaleString()} / {info.maxScore} ({pct}%)
        </span>
      </div>
      {info.isEmpty ? (
        <p className="hint player-rank-card-empty">Sign in with osu! to load ruleset stats for this rank.</p>
      ) : (
        <>
          <dl className="player-rank-card-split player-rank-card-split--4">
            <div className="player-rank-card-metric" title={PERFORMANCE_METRIC_TOOLTIPS.skill}>
              <dt>Skill</dt>
              <dd>{Math.round(b.skill)}</dd>
            </div>
            <div className="player-rank-card-metric" title={PERFORMANCE_METRIC_TOOLTIPS.precision}>
              <dt>Precision</dt>
              <dd>{Math.round(b.precision)}</dd>
            </div>
            <div className="player-rank-card-metric" title={PERFORMANCE_METRIC_TOOLTIPS.reliability}>
              <dt>Reliability</dt>
              <dd>{Math.round(b.reliability)}</dd>
            </div>
            <div className="player-rank-card-metric" title={PERFORMANCE_METRIC_TOOLTIPS.excellence}>
              <dt>Excellence</dt>
              <dd>{Math.round(b.excellence)}</dd>
            </div>
          </dl>
          {next ? (
            <div className="player-rank-card-next">
              <div className="player-rank-card-next-head">
                <span>Next: {next.name}</span>
                <span className="player-rank-card-next-pts">
                  {Math.max(0, Math.ceil(next.scoreAtNext - info.compositeScore))} pts to go
                </span>
              </div>
              <div
                className="player-rank-card-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(info.progressInTier * 100)}
                aria-label={`Progress toward ${next.name}`}
              >
                <div className="player-rank-card-bar-fill" style={{ width: `${info.progressInTier * 100}%` }} />
              </div>
            </div>
          ) : (
            <p className="player-rank-card-max hint">Maximum rank reached.</p>
          )}
        </>
      )}
    </div>
  );
}

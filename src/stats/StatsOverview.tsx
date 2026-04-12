import type { ParsedRow } from "../SocialLeaderboard";
import { PlayerRankCard } from "../PlayerRankCard";
import type { PlayerRankInfo } from "../playerRank";
import { TrainingStatsSection } from "../TrainingStatsSection";
import type { EnrichedScore } from "./statsTypes";
import { formatInt } from "./statsParsing";

export function StatsOverview({
  row,
  firstCount,
  localOverlap,
  joinDate,
  countryName,
  rankInfo,
  recent,
  onGoToTrain,
}: {
  row: ParsedRow;
  firstCount: number | null;
  localOverlap: { n: number; total: number };
  joinDate: string | null;
  countryName: string;
  rankInfo: PlayerRankInfo;
  recent: EnrichedScore[];
  onGoToTrain: () => void;
}) {
  return (
    <div className="stats-tab-panel stats-tab-panel--overview">
      <div className="social-card stats-kpi-card stats-kpi-card--surface">
        <div className="stats-kpi-grid">
          <div className="stats-kpi">
            <span className="stats-kpi-label">PP</span>
            <span className="stats-kpi-value">{row.pp != null ? row.pp.toFixed(2) : "—"}</span>
          </div>
          <div className="stats-kpi">
            <span className="stats-kpi-label">Global</span>
            <span className="stats-kpi-value">#{formatInt(row.globalRank)}</span>
          </div>
          <div className="stats-kpi">
            <span className="stats-kpi-label">Country</span>
            <span className="stats-kpi-value">#{formatInt(row.countryRank)}</span>
          </div>
          <div className="stats-kpi">
            <span className="stats-kpi-label">Accuracy</span>
            <span className="stats-kpi-value">{row.accuracy != null ? `${row.accuracy.toFixed(2)}%` : "—"}</span>
          </div>
          <div className="stats-kpi">
            <span className="stats-kpi-label">Play count</span>
            <span className="stats-kpi-value">{formatInt(row.playCount)}</span>
          </div>
          <div className="stats-kpi">
            <span className="stats-kpi-label">Level</span>
            <span className="stats-kpi-value">
              {row.levelCurrent != null ? `${Math.round(row.levelCurrent)}` : "—"}
              {row.levelProgress != null ? (
                <span className="stats-kpi-sub"> · {Math.round(row.levelProgress)}% next</span>
              ) : null}
            </span>
          </div>
          <div className="stats-kpi">
            <span className="stats-kpi-label">#1 ranks (sample)</span>
            <span className="stats-kpi-value">{firstCount != null ? String(firstCount) : "—"}</span>
          </div>
          <div className="stats-kpi">
            <span className="stats-kpi-label">Top plays in Songs folder</span>
            <span className="stats-kpi-value">
              {localOverlap.total > 0 ? `${localOverlap.n} / ${localOverlap.total} sets` : "—"}
            </span>
          </div>
        </div>

        {joinDate || countryName ? (
          <p className="hint stats-meta-line">
            {joinDate ? <>Joined {joinDate}</> : null}
            {countryName ? (
              <>
                {joinDate ? " · " : ""}
                {countryName}
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <section className="social-card stats-rank-card" aria-label="Performance rank">
        <span className="stats-section-eyebrow">osu! performance</span>
        <PlayerRankCard info={rankInfo} />
      </section>

      <div className="social-card stats-training-card">
        <TrainingStatsSection recentAccSample={recent.map((s) => s.accuracy)} onGoToTrain={onGoToTrain} />
      </div>
    </div>
  );
}

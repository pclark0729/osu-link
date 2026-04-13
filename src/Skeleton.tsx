/** Shared loading placeholders — pair with `.ui-skeleton-*` styles in App.css */

export function SrOnlyLoading({ children }: { children: string }) {
  return <span className="visually-hidden">{children}</span>;
}

export function SearchResultsSkeletonList({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={`sk-${i}`} className="result-skeleton-card" aria-hidden>
          <div className="result-skeleton-card__thumb" />
          <div className="result-skeleton-card__lines">
            <div className="result-skeleton-card__line" />
            <div className="result-skeleton-card__line result-skeleton-card__line--short" />
          </div>
        </div>
      ))}
      <SrOnlyLoading>Fetching search results</SrOnlyLoading>
    </>
  );
}

export function PersonalStatsBodySkeleton() {
  return (
    <div className="stats-tab-panel stats-tab-body-skeleton" role="status" aria-busy="true">
      <SrOnlyLoading>Loading profile stats</SrOnlyLoading>
      <div className="social-card stats-kpi-card stats-kpi-card--surface">
        <div className="stats-kpi-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="stats-kpi stats-kpi-skeleton">
              <div className="ui-skeleton-line ui-skeleton-line--kpi-label" />
              <div className="ui-skeleton-line ui-skeleton-line--kpi-value" />
            </div>
          ))}
        </div>
      </div>
      <div className="stats-body-skeleton-secondary">
        <div className="ui-skeleton-line ui-skeleton-line--medium" />
        <div className="ui-skeleton-line ui-skeleton-line--short" />
      </div>
    </div>
  );
}

export function FriendProfileLoadingSkeleton() {
  return (
    <div className="friend-profile-loading-skeleton" role="status" aria-busy="true">
      <SrOnlyLoading>Loading friend profile</SrOnlyLoading>
      <div className="friend-profile-stats-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="friend-profile-stat friend-profile-stat--skeleton">
            <div className="ui-skeleton-line ui-skeleton-line--kpi-label" />
            <div className="ui-skeleton-line ui-skeleton-line--kpi-value" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BattleDetailLoadingSkeleton() {
  return (
    <div className="battles-panel__detail-body battles-panel__detail-body--skeleton" role="status" aria-busy="true">
      <SrOnlyLoading>Loading battle details</SrOnlyLoading>
      <div className="ui-skeleton-line ui-skeleton-line--title ui-skeleton-line--wide" />
      <div className="ui-skeleton-line ui-skeleton-line--medium" />
      <div className="ui-skeleton-line ui-skeleton-line--short" />
      <ul className="battles-panel__detail-scores battles-panel__detail-scores--skeleton">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i}>
            <div className="ui-skeleton-line" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChallengeStandingsLoadingSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true">
      <SrOnlyLoading>Loading standings</SrOnlyLoading>
      <ol className="social-challenge-standings-full">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="social-challenge-standings-full__li social-challenge-standings-full__li--skeleton">
            <span className="social-challenge-standings-full__rank">
              <span className="ui-skeleton-line ui-skeleton-line--rank" />
            </span>
            <span className="social-challenge-standings-full__body">
              <div className="ui-skeleton-line" />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SocialLeaderboardLoadingSkeleton({ tableRows }: { tableRows: number }) {
  const n = Math.min(12, Math.max(3, tableRows));
  return (
    <div className="social-lb-skeleton-wrap" role="status" aria-busy="true">
      <SrOnlyLoading>Loading leaderboard</SrOnlyLoading>
      <div className="social-lb-charts">
        <div className="social-lb-chart-card">
          <h4 className="social-h4">PP snapshot</h4>
          <div className="social-lb-chart-inner social-lb-chart-inner--skeleton">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="social-lb-skeleton-hbar">
                <div className="ui-skeleton-line ui-skeleton-line--hbar-label" />
                <div className="ui-skeleton-line ui-skeleton-line--hbar-track" />
              </div>
            ))}
          </div>
        </div>
        <div className="social-lb-chart-card">
          <h4 className="social-h4">Group grade totals</h4>
          <div className="social-lb-chart-inner social-lb-chart-inner--short social-lb-chart-inner--skeleton">
            <div className="social-lb-skeleton-grade-bars">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="social-lb-skeleton-grade-bars__col">
                  <div className="ui-skeleton-line ui-skeleton-line--grade-col" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="social-lb-chart-card social-lb-radar-card">
          <div className="social-lb-radar-head">
            <h4 className="social-h4">Shape vs group median</h4>
            <div className="ui-skeleton-line ui-skeleton-line--radar-select" />
          </div>
          <div className="social-lb-chart-inner social-lb-chart-inner--skeleton social-lb-chart-inner--radar-skel">
            <div className="ui-skeleton-line ui-skeleton-line--radar-blob" />
          </div>
        </div>
      </div>

      <div className="social-lb-table-wrap social-lb-table-wrap--skeleton">
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="social-lb-skeleton-table-row">
            <div className="ui-skeleton-line ui-skeleton-line--lb-num" />
            <div className="social-lb-skeleton-player">
              <div className="ui-skeleton-circle ui-skeleton-circle--xs" aria-hidden />
              <div className="ui-skeleton-line ui-skeleton-line--lb-name" />
            </div>
            <div className="ui-skeleton-line ui-skeleton-line--lb-metric" />
            <div className="ui-skeleton-line ui-skeleton-line--lb-metric" />
            <div className="ui-skeleton-line ui-skeleton-line--lb-metric-short" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BeatmapsetDetailLoadingSkeleton() {
  return (
    <div className="beatmapset-detail-skeleton" role="status" aria-busy="true">
      <SrOnlyLoading>Loading beatmap set</SrOnlyLoading>
      <div className="beatmapset-detail-hero">
        <div className="beatmapset-detail-skeleton-cover" aria-hidden />
        <div className="beatmapset-detail-hero-text">
          <div className="ui-skeleton-line ui-skeleton-line--title ui-skeleton-line--wide" />
          <div className="ui-skeleton-line ui-skeleton-line--medium" />
          <div className="beatmapset-detail-skeleton-tags">
            <div className="ui-skeleton-line ui-skeleton-line--tag" />
            <div className="ui-skeleton-line ui-skeleton-line--tag" />
            <div className="ui-skeleton-line ui-skeleton-line--tag" />
          </div>
        </div>
      </div>
      <div className="ui-skeleton-line ui-skeleton-line--ruleset-hint" />
      <div className="beatmapset-detail-table-wrap">
        <table className="beatmapset-detail-table">
          <thead>
            <tr>
              {["Ver", "★", "Len", "CS", "AR", "OD", "HP", "Avg PP", "Best"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 9 }).map((__, j) => (
                  <td key={j}>
                    <div className="ui-skeleton-line ui-skeleton-line--table-sm" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

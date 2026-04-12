import type { PerformanceInsights } from "../statsInsights";
import { WIKI_ACCURACY, WIKI_PP_WEIGHT, WIKI_TOTAL_PP, WIKI_UR } from "./statsConstants";

export function StatsInsights({
  performanceInsights,
  insightsListEmpty,
}: {
  performanceInsights: PerformanceInsights;
  insightsListEmpty: boolean;
}) {
  return (
    <div className="social-card stats-insights-card stats-tab-panel stats-tab-panel--insights">
      <h3 className="social-h3 stats-insights-title">Insights</h3>
      <p className="panel-sub stats-insights-lead">
        Derived from your sampled best / recent scores. See{" "}
        <a href={WIKI_PP_WEIGHT} target="_blank" rel="noreferrer">
          PP weighting
        </a>
        ,{" "}
        <a href={WIKI_TOTAL_PP} target="_blank" rel="noreferrer">
          total PP
        </a>
        , and{" "}
        <a href={WIKI_ACCURACY} target="_blank" rel="noreferrer">
          accuracy
        </a>{" "}
        on the osu! wiki.
      </p>
      <ul className="stats-insights-list">
        {insightsListEmpty ? (
          <li className="hint">Not enough score data for insights yet. Play ranked maps and refresh.</li>
        ) : (
          <>
            {performanceInsights.weightedSample ? (
              <li>
                <strong>PP concentration (weighted sample):</strong> top 1 play ≈{" "}
                {(performanceInsights.weightedSample.shareTop1 * 100).toFixed(1)}% of the weighted sum; top 5 ≈{" "}
                {(performanceInsights.weightedSample.shareTop5 * 100).toFixed(1)}%; top 20 ≈{" "}
                {(performanceInsights.weightedSample.shareTop20 * 100).toFixed(1)}%. Uses the{" "}
                <code className="stats-inline-code">0.95</code> decay on your best-score list (
                {performanceInsights.weightedSample.count} plays with PP).
              </li>
            ) : null}
            {performanceInsights.sampleWeightedToProfilePpRatio != null ? (
              <li>
                <strong>Sample vs profile PP:</strong> weighted sum of this sample is ≈{" "}
                {(performanceInsights.sampleWeightedToProfilePpRatio * 100).toFixed(1)}% of your profile PP — only a rough
                comparison; your real total includes every play and bonus PP.
              </li>
            ) : null}
            {performanceInsights.accuracySpread && performanceInsights.accuracySpread.n > 1 ? (
              <li>
                <strong>Accuracy spread (best scores):</strong> σ ≈ {performanceInsights.accuracySpread.stdev.toFixed(2)}%
                around a mean of {performanceInsights.accuracySpread.mean.toFixed(2)}% (
                {performanceInsights.accuracySpread.n} scores). This is score accuracy, not{" "}
                <a href={WIKI_UR} target="_blank" rel="noreferrer">
                  unstable rate
                </a>
                .
              </li>
            ) : null}
            {performanceInsights.starProfile && performanceInsights.starProfile.n > 0 ? (
              <li>
                <strong>Star profile (best):</strong> mean {performanceInsights.starProfile.mean?.toFixed(2) ?? "—"}★,
                median {performanceInsights.starProfile.median?.toFixed(2) ?? "—"}★ (
                {performanceInsights.starProfile.n} maps with star data).
                {performanceInsights.starProfile.ppPerStarMean != null ? (
                  <> Informal PP/★ mean ≈ {performanceInsights.starProfile.ppPerStarMean.toFixed(1)}.</>
                ) : null}
              </li>
            ) : null}
            {performanceInsights.topMods.length > 0 ? (
              <li>
                <strong>Common mods on best:</strong>{" "}
                {performanceInsights.topMods.map((m) => `${m.name} (${m.count})`).join(", ")}.
              </li>
            ) : null}
            {performanceInsights.recentActivity ? (
              <li>
                <strong>Recent score dates:</strong> {performanceInsights.recentActivity.fromLabel} —{" "}
                {performanceInsights.recentActivity.toLabel}.
              </li>
            ) : null}
          </>
        )}
      </ul>
      <details className="stats-insights-details">
        <summary>Limitations</summary>
        <ul className="stats-insights-caveats">
          {performanceInsights.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

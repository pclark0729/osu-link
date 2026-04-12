import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  computeTrainingAggregates,
  loadTrainingHistory,
  trainVsGeneralAccInsight,
  type TrainingHistoryFile,
} from "./trainHistory";

const RECHARTS_TOOLTIP_PROPS = {
  contentStyle: {
    background: "var(--surface-2)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text)",
  },
  labelStyle: { color: "var(--text-secondary)" },
  itemStyle: { color: "var(--text)" },
} as const;

export function TrainingStatsSection({
  recentAccSample,
  onGoToTrain,
}: {
  /** Sample of recent score accuracies (0–100) for comparison insight */
  recentAccSample: (number | null)[];
  onGoToTrain: () => void;
}) {
  const [history, setHistory] = useState<TrainingHistoryFile>(() => loadTrainingHistory());
  useEffect(() => {
    const refresh = () => setHistory(loadTrainingHistory());
    window.addEventListener("focus", refresh);
    window.addEventListener("osu-link-training-history", refresh as EventListener);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("osu-link-training-history", refresh as EventListener);
    };
  }, []);
  const agg = useMemo(() => computeTrainingAggregates(history), [history]);

  const sessionChart = useMemo(() => {
    const sessions = [...history.sessions].sort((a, b) => a.startedAtMs - b.startedAtMs).slice(-24);
    return sessions.map((s, i) => ({
      n: i + 1,
      label: new Date(s.startedAtMs).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      cleared: s.mapsPassed,
    }));
  }, [history]);

  const passAccInsight = trainVsGeneralAccInsight(
    agg.meanAccPasses,
    recentAccSample.map((x) => (x == null ? null : x)),
  );

  if (agg.sessionCount === 0 && history.mapOutcomes.length === 0) {
    return (
      <section className="panel-section training-stats-section" aria-labelledby="training-stats-heading">
        <h3 id="training-stats-heading" className="social-h3">
          Training
        </h3>
        <p className="hint">
          No training sessions yet.{" "}
          <button type="button" className="secondary" onClick={onGoToTrain}>
            Open Train
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="panel-section training-stats-section" aria-labelledby="training-stats-heading">
      <h3 id="training-stats-heading" className="social-h3">
        Training
      </h3>
      <p className="hint u-mb-3">
        From osu-link Train mode (local history). Not synced with osu! servers beyond what the Train tab reads from the API.
      </p>

      <div className="stats-kpi-grid training-stats-kpis">
        <div className="stats-kpi">
          <span className="stats-kpi-label">Sessions</span>
          <span className="stats-kpi-value">{agg.sessionCount}</span>
        </div>
        <div className="stats-kpi">
          <span className="stats-kpi-label">Maps cleared</span>
          <span className="stats-kpi-value">{agg.mapsCleared}</span>
        </div>
        <div className="stats-kpi">
          <span className="stats-kpi-label">Mean acc (passes)</span>
          <span className="stats-kpi-value">
            {agg.meanAccPasses != null ? `${agg.meanAccPasses.toFixed(2)}%` : "—"}
          </span>
        </div>
        <div className="stats-kpi">
          <span className="stats-kpi-label">Peak ★ (train)</span>
          <span className="stats-kpi-value">{agg.peakStars != null ? agg.peakStars.toFixed(2) : "—"}</span>
        </div>
      </div>

      {passAccInsight.delta != null && (
        <p className="hint u-mt-2">
          Train pass accuracy is{" "}
          <strong>
            {passAccInsight.delta >= 0 ? "+" : ""}
            {passAccInsight.delta.toFixed(2)}%
          </strong>{" "}
          vs mean of sampled recent scores ({passAccInsight.note})
        </p>
      )}

      {sessionChart.length > 1 && (
        <div className="u-mt-3">
          <h4 className="social-h4">Maps cleared per session (recent)</h4>
          <div className="stats-chart-wrap" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sessionChart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
                <YAxis tick={{ fill: "var(--text-secondary)", fontSize: 11 }} allowDecimals={false} />
                <Tooltip {...RECHARTS_TOOLTIP_PROPS} />
                <Area
                  type="monotone"
                  dataKey="cleared"
                  name="Cleared"
                  stroke="var(--accent)"
                  fill="var(--accent-muted)"
                  fillOpacity={0.35}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}

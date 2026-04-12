import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { RECHARTS_TOOLTIP_PROPS } from "./statsConstants";

type GradeSlice = { name: string; value: number; fill: string };

export function StatsCharts({
  ppByModeData,
  radarData,
  gradePie,
  recentSeries,
  topPlaysData,
  ppHist,
  starHist,
  modsFreq,
  scatterData,
}: {
  ppByModeData: { name: string; pp: number }[];
  radarData: { metric: string; You: number }[];
  gradePie: GradeSlice[];
  recentSeries: { t: number; label: string; pp: number }[];
  topPlaysData: { name: string; pp: number }[];
  ppHist: { bucket: string; count: number }[];
  starHist: { bucket: string; count: number }[];
  modsFreq: { name: string; value: number }[];
  scatterData: { pp: number; acc: number; label: string }[];
}) {
  return (
    <div className="stats-charts-section stats-tab-panel stats-tab-panel--charts">
      <div className="stats-charts-grid">
        <div className="social-card stats-chart-card">
          <h4 className="social-h4">PP by ruleset</h4>
          <div className="stats-chart-inner">
            {ppByModeData.some((d) => d.pp > 0) ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={ppByModeData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip {...RECHARTS_TOOLTIP_PROPS} formatter={(v: number) => [`${v} pp`, "PP"]} />
                  <Bar dataKey="pp" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">No cross-mode PP yet.</p>
            )}
          </div>
        </div>

        <div className="social-card stats-chart-card">
          <h4 className="social-h4">Profile shape (scaled)</h4>
          <div className="stats-chart-inner">
            {radarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                  <PolarGrid />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                  <Radar name="You" dataKey="You" stroke="var(--lb-radar-a)" fill="var(--lb-radar-a)" fillOpacity={0.35} />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">No radar data.</p>
            )}
          </div>
        </div>

        <div className="social-card stats-chart-card">
          <h4 className="social-h4">Ranked grades</h4>
          <div className="stats-chart-inner stats-chart-inner--short">
            {gradePie.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={gradePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88}>
                    {gradePie.map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Pie>
                  <Tooltip {...RECHARTS_TOOLTIP_PROPS} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">No SS/S/A totals.</p>
            )}
          </div>
        </div>

        <div className="social-card stats-chart-card">
          <h4 className="social-h4">Recent PP (chronological)</h4>
          <div className="stats-chart-inner">
            {recentSeries.length > 1 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={recentSeries} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip {...RECHARTS_TOOLTIP_PROPS} formatter={(v: number) => [`${v} pp`, "PP"]} />
                  <Area type="monotone" dataKey="pp" stroke="var(--accent)" fill="var(--accent-glow)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">Not enough dated recent scores for a trend.</p>
            )}
          </div>
        </div>

        <div className="social-card stats-chart-card stats-chart-card--wide">
          <h4 className="social-h4">Top plays by PP</h4>
          <div className="stats-chart-inner stats-chart-inner--tall">
            {topPlaysData.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(220, topPlaysData.length * 26)}>
                <BarChart data={topPlaysData} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={200} tick={{ fontSize: 10 }} />
                  <Tooltip {...RECHARTS_TOOLTIP_PROPS} formatter={(v: number) => [`${v} pp`, "PP"]} />
                  <Bar dataKey="pp" fill="var(--lb-bar-me)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">No best scores returned for this mode.</p>
            )}
          </div>
        </div>

        <div className="social-card stats-chart-card">
          <h4 className="social-h4">PP distribution (best)</h4>
          <div className="stats-chart-inner">
            {ppHist.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ppHist} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip {...RECHARTS_TOOLTIP_PROPS} />
                  <Bar dataKey="count" fill="var(--lb-grade-a)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">No PP histogram data.</p>
            )}
          </div>
        </div>

        <div className="social-card stats-chart-card">
          <h4 className="social-h4">Star rating (best plays)</h4>
          <div className="stats-chart-inner">
            {starHist.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={starHist} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip {...RECHARTS_TOOLTIP_PROPS} />
                  <Bar dataKey="count" fill="var(--lb-bar-friend)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">No star data on best scores (maps may lack difficulty_rating).</p>
            )}
          </div>
        </div>

        <div className="social-card stats-chart-card">
          <h4 className="social-h4">Mods on best plays</h4>
          <div className="stats-chart-inner">
            {modsFreq.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={modsFreq} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                  <Tooltip {...RECHARTS_TOOLTIP_PROPS} />
                  <Bar dataKey="value" fill="var(--warn)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">No mod data.</p>
            )}
          </div>
        </div>

        <div className="social-card stats-chart-card">
          <h4 className="social-h4">PP vs accuracy (best)</h4>
          <div className="stats-chart-inner">
            {scatterData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" dataKey="pp" name="PP" tick={{ fontSize: 11 }} />
                  <YAxis type="number" dataKey="acc" name="Acc %" tick={{ fontSize: 11 }} />
                  <ZAxis range={[40, 40]} />
                  <Tooltip
                    {...RECHARTS_TOOLTIP_PROPS}
                    cursor={{ strokeDasharray: "3 3" }}
                    formatter={(v: number, name: string) => [v, name]}
                  />
                  <Scatter name="Scores" data={scatterData} fill="var(--ok)" />
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">Need PP and accuracy on best scores.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

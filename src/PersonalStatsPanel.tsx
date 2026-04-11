import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { NeuSelect, type NeuSelectOption } from "./NeuSelect";
import { parseUserRulesetPayload, type ParsedRow } from "./SocialLeaderboard";
import { computePerformanceInsights } from "./statsInsights";

const WIKI_PP_WEIGHT = "https://osu.ppy.sh/wiki/en/Performance_points/Weighting_system";
const WIKI_TOTAL_PP = "https://osu.ppy.sh/wiki/en/Performance_points/Total_performance_points";
const WIKI_ACCURACY = "https://osu.ppy.sh/wiki/en/Gameplay/Accuracy";
const WIKI_UR = "https://osu.ppy.sh/wiki/en/Gameplay/Unstable_rate";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const MODE_OPTIONS: NeuSelectOption[] = [
  { value: "osu", label: "osu!" },
  { value: "taiko", label: "Taiko" },
  { value: "fruits", label: "Catch" },
  { value: "mania", label: "Mania" },
];

const MODE_LABELS: Record<string, string> = {
  osu: "osu!",
  taiko: "Taiko",
  fruits: "Catch",
  mania: "Mania",
};

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

function scoreBeatmapsetId(s: Record<string, unknown>): number | null {
  const bm = s.beatmap;
  if (bm && typeof bm === "object") {
    const n = Number((bm as Record<string, unknown>).beatmapset_id);
    if (Number.isFinite(n)) return n;
  }
  const bs = s.beatmapset;
  if (bs && typeof bs === "object") {
    const n = Number((bs as Record<string, unknown>).id);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractScoreArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const o = asRecord(raw);
  if (Array.isArray(o.scores)) return o.scores;
  return [];
}

function beatmapStars(s: Record<string, unknown>): number | null {
  const bm = asRecord(s.beatmap ?? {});
  const d = num(bm.difficulty_rating);
  if (d != null && d > 0) return d;
  const diff = asRecord(bm.difficulty ?? {});
  return num(diff.nominal_rating) ?? num(diff.stars) ?? num(diff.difficulty_rating);
}

function mapLabelFromScore(s: Record<string, unknown>): string {
  const bs = asRecord(s.beatmapset ?? {});
  const artist = String(bs.artist ?? bs.artist_unicode ?? "").trim();
  const title = String(bs.title ?? bs.title_unicode ?? "").trim();
  const line = artist && title ? `${artist} — ${title}` : title || artist || "Map";
  return line.length > 48 ? `${line.slice(0, 46)}…` : line;
}

function modsLabel(mods: unknown): string {
  if (mods == null) return "NM";
  if (Array.isArray(mods)) {
    const parts = mods.map((x) => String(x)).filter(Boolean);
    return parts.length ? parts.join("+") : "NM";
  }
  if (typeof mods === "string" && mods.trim()) return mods.trim();
  if (typeof mods === "number" && mods !== 0) return String(mods);
  return "NM";
}

export type EnrichedScore = {
  pp: number | null;
  accuracy: number | null;
  rank: string;
  stars: number | null;
  label: string;
  beatmapsetId: number | null;
  modsLabel: string;
  atMs: number | null;
};

function parseScoresDetailed(raw: unknown): EnrichedScore[] {
  const list = extractScoreArray(raw);
  const out: EnrichedScore[] = [];
  for (const item of list) {
    const s = asRecord(item);
    const pp = num(s.pp);
    const accPct = num(s.accuracy);
    const rank = String(s.rank ?? s.grade ?? "?").trim() || "?";
    const atRaw = s.created_at ?? s.ended_at;
    let atMs: number | null = null;
    if (typeof atRaw === "string") {
      const t = Date.parse(atRaw);
      atMs = Number.isFinite(t) ? t : null;
    } else if (typeof atRaw === "number" && Number.isFinite(atRaw)) {
      atMs = atRaw > 1e12 ? atRaw : atRaw * 1000;
    }
    out.push({
      pp,
      accuracy: accPct,
      rank,
      stars: beatmapStars(s),
      label: mapLabelFromScore(s),
      beatmapsetId: scoreBeatmapsetId(s),
      modsLabel: modsLabel(s.mods),
      atMs,
    });
  }
  return out;
}

type RadarSolo = Record<"PP" | "Accuracy" | "Volume" | "Rank" | "Hits" | "Grades", number>;

function soloRadar(row: ParsedRow): RadarSolo {
  const ppN = Math.min(100, ((row.pp ?? 0) / 10_000) * 100);
  const accN = Math.min(100, row.accuracy ?? 0);
  const playN = Math.min(100, (Math.log10((row.playCount ?? 0) + 1) / Math.log10(50_000)) * 100);
  const gr = row.globalRank;
  const rankN =
    gr == null ? 0 : Math.min(100, (1 - Math.min(gr, 999_999) / 1_000_000) * 100);
  const hitsN = Math.min(100, ((row.totalHits ?? 0) / 5_000_000) * 100);
  const gradeW = row.gradeSS * 3 + row.gradeS * 2 + row.gradeA;
  const gradeN = Math.min(100, Math.sqrt(gradeW / Math.max(1, row.playCount ?? 1)) * 25);
  return {
    PP: Math.round(ppN),
    Accuracy: Math.round(accN),
    Volume: Math.round(playN),
    Rank: Math.round(rankN),
    Hits: Math.round(hitsN),
    Grades: Math.round(gradeN),
  };
}

function formatInt(n: number | null): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString();
}

function ppHistogramBucket(pp: number): string {
  if (!Number.isFinite(pp) || pp < 0) return "0–100";
  if (pp >= 500) return "500+";
  const lo = Math.floor(pp / 100) * 100;
  return `${lo}–${lo + 100}`;
}

function starHistogramBucket(stars: number): string {
  if (!Number.isFinite(stars) || stars < 0) return "—";
  if (stars >= 7) return "7+";
  const lo = Math.floor(stars);
  return `${lo}–${lo + 1}`;
}

type CrossModeRow = { mode: string; label: string; pp: number | null; rank: number | null };

export function PersonalStatsPanel({
  onToast,
}: {
  onToast: (tone: "info" | "success" | "error", message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [meId, setMeId] = useState<number | null>(null);
  const [mode, setMode] = useState("osu");
  const [profile, setProfile] = useState<unknown>(null);
  const [rulesetRow, setRulesetRow] = useState<ParsedRow | null>(null);
  const [recent, setRecent] = useState<EnrichedScore[]>([]);
  const [best, setBest] = useState<EnrichedScore[]>([]);
  const [firstCount, setFirstCount] = useState<number | null>(null);
  const [crossMode, setCrossMode] = useState<CrossModeRow[]>([]);
  const [localIds, setLocalIds] = useState<Set<number>>(() => new Set());
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<{ loggedIn: boolean; osuId?: number | null }>("auth_status").then((st) => {
      const id = st.osuId;
      setMeId(typeof id === "number" && Number.isFinite(id) ? id : null);
    });
  }, []);

  const loadLocal = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const ids = await invoke<number[]>("get_local_beatmapset_ids");
      setLocalIds(new Set(ids));
    } catch {
      setLocalIds(new Set());
    }
  }, []);

  const load = useCallback(async () => {
    if (!isTauri()) return;
    if (meId == null) {
      setProfile(null);
      setRulesetRow(null);
      setRecent([]);
      setBest([]);
      setFirstCount(null);
      setCrossMode([]);
      return;
    }
    setBusy(true);
    setLoadErr(null);
    try {
      const modes = ["osu", "taiko", "fruits", "mania"] as const;
      const [
        profRaw,
        rulesetRaw,
        recentRaw,
        bestRaw,
        firstRaw,
        crossResults,
      ] = await Promise.all([
        invoke<unknown>("osu_user_profile", { userId: meId }).catch(() => null),
        invoke<unknown>("osu_user_ruleset_stats", { userId: meId, mode }).catch(() => null),
        invoke<unknown>("osu_user_recent_scores", { userId: meId, limit: 100, mode }).catch(() => []),
        invoke<unknown>("osu_user_best_scores", { userId: meId, limit: 100, mode }).catch(() => []),
        invoke<unknown>("osu_user_first_scores", { userId: meId, limit: 100, mode }).catch(() => []),
        Promise.all(
          modes.map((m) =>
            invoke<unknown>("osu_user_ruleset_stats", { userId: meId, mode: m }).then(
              (raw) => ({ m, raw }),
              () => ({ m, raw: null }),
            ),
          ),
        ),
      ]);

      setProfile(profRaw);

      const row = rulesetRaw ? parseUserRulesetPayload(rulesetRaw, "You") : null;
      setRulesetRow(row);

      setRecent(parseScoresDetailed(recentRaw));
      setBest(parseScoresDetailed(bestRaw));
      setFirstCount(extractScoreArray(firstRaw).length);

      const cm: CrossModeRow[] = [];
      for (const { m, raw } of crossResults) {
        if (!raw) {
          cm.push({ mode: m, label: MODE_LABELS[m] ?? m, pp: null, rank: null });
          continue;
        }
        const pr = parseUserRulesetPayload(raw, MODE_LABELS[m] ?? m);
        if (!pr) {
          cm.push({ mode: m, label: MODE_LABELS[m] ?? m, pp: null, rank: null });
          continue;
        }
        cm.push({
          mode: m,
          label: MODE_LABELS[m] ?? m,
          pp: pr.pp,
          rank: pr.globalRank,
        });
      }
      setCrossMode(cm);

      await loadLocal();
    } catch (e) {
      const msg = String(e);
      setLoadErr(msg);
      onToast("error", msg);
    } finally {
      setBusy(false);
    }
  }, [meId, mode, onToast, loadLocal]);

  useEffect(() => {
    void load();
  }, [load]);

  const radarData = useMemo(() => {
    if (!rulesetRow || rulesetRow.error) return [];
    const n = soloRadar(rulesetRow);
    const keys = Object.keys(n) as (keyof RadarSolo)[];
    return keys.map((k) => ({ metric: k, You: n[k] }));
  }, [rulesetRow]);

  const gradePie = useMemo(() => {
    if (!rulesetRow || rulesetRow.error) return [];
    return [
      { name: "SS", value: rulesetRow.gradeSS, fill: "var(--lb-grade-ss)" },
      { name: "S", value: rulesetRow.gradeS, fill: "var(--lb-grade-s)" },
      { name: "A", value: rulesetRow.gradeA, fill: "var(--lb-grade-a)" },
    ].filter((x) => x.value > 0);
  }, [rulesetRow]);

  const ppByModeData = useMemo(
    () => crossMode.map((r) => ({ name: r.label, pp: r.pp != null ? Math.round(r.pp * 100) / 100 : 0 })),
    [crossMode],
  );

  const recentSeries = useMemo(() => {
    const pts = recent
      .filter((s) => s.atMs != null && s.pp != null)
      .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0))
      .map((s) => ({
        t: s.atMs!,
        label: new Date(s.atMs!).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        pp: Math.round((s.pp ?? 0) * 100) / 100,
      }));
    return pts;
  }, [recent]);

  const topPlaysData = useMemo(() => {
    const sorted = [...best].filter((s) => s.pp != null).sort((a, b) => (b.pp ?? 0) - (a.pp ?? 0));
    return sorted.slice(0, 15).map((s, i) => ({
      name: `#${i + 1} ${s.label}`,
      pp: Math.round((s.pp ?? 0) * 100) / 100,
    }));
  }, [best]);

  const ppHist = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of best) {
      if (s.pp == null) continue;
      const k = ppHistogramBucket(s.pp);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    const order = ["0–100", "100–200", "200–300", "300–400", "400–500", "500+"];
    const keys = [...new Set([...order, ...map.keys()])].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ bucket: k, count: map.get(k) ?? 0 })).filter((x) => x.count > 0);
  }, [best]);

  const starHist = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of best) {
      if (s.stars == null) continue;
      const k = starHistogramBucket(s.stars);
      if (k === "—") continue;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    const order = ["0–1", "1–2", "2–3", "3–4", "4–5", "5–6", "6–7", "7+"];
    const keys = [...new Set([...order, ...map.keys()])].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ bucket: k, count: map.get(k) ?? 0 })).filter((x) => x.count > 0);
  }, [best]);

  const modsFreq = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of best) {
      const k = s.modsLabel || "NM";
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [best]);

  const scatterData = useMemo(() => {
    return best
      .filter((s) => s.pp != null && s.accuracy != null)
      .map((s) => ({
        pp: Math.round((s.pp ?? 0) * 100) / 100,
        acc: Math.round((s.accuracy ?? 0) * 100) / 100,
        label: s.label,
      }));
  }, [best]);

  const localOverlap = useMemo(() => {
    if (localIds.size === 0 || best.length === 0) return { n: 0, total: 0 };
    let n = 0;
    const seen = new Set<number>();
    for (const s of best) {
      const id = s.beatmapsetId;
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      if (localIds.has(id)) n += 1;
    }
    return { n, total: seen.size };
  }, [best, localIds]);

  const performanceInsights = useMemo(
    () => computePerformanceInsights({ best, recent, totalPp: rulesetRow?.pp ?? null }),
    [best, recent, rulesetRow?.pp],
  );

  const insightsListEmpty = useMemo(() => {
    const pi = performanceInsights;
    return (
      !pi.weightedSample &&
      pi.sampleWeightedToProfilePpRatio == null &&
      !(pi.accuracySpread && pi.accuracySpread.n > 1) &&
      !(pi.starProfile && pi.starProfile.n > 0) &&
      pi.topMods.length === 0 &&
      !pi.recentActivity
    );
  }, [performanceInsights]);

  const profileRec = profile ? asRecord(profile) : null;
  const joinDate =
    profileRec?.join_date != null
      ? String(profileRec.join_date)
      : profileRec?.joinDate != null
        ? String(profileRec.joinDate)
        : null;
  const countryRec = profileRec?.country != null ? asRecord(profileRec.country) : null;
  const countryName = countryRec?.name != null ? String(countryRec.name) : "";

  if (!isTauri()) {
    return (
      <div className="social-section stats-section">
        <div className="social-card stats-intro-card">
          <p className="panel-sub stats-intro-lead">Use the desktop app for profile and charts.</p>
        </div>
      </div>
    );
  }

  if (meId == null) {
    return (
      <div className="social-section stats-section">
        <div className="social-card stats-intro-card">
          <p className="panel-sub stats-intro-lead">Sign in from Settings to see stats.</p>
        </div>
      </div>
    );
  }

  const row = rulesetRow;
  const disabled = busy;

  return (
    <div className="social-section stats-section">
      <div className="social-card stats-profile-card">
        <div className="stats-hero-row">
          <div className="stats-hero-text">
            {row?.username ? (
              <p className="stats-username">{row.username}</p>
            ) : (
              <p className="hint stats-username-placeholder">{busy && !row ? "Loading your profile…" : "—"}</p>
            )}
          </div>
          {row?.avatarUrl ? (
            <img className="stats-avatar" src={row.avatarUrl} alt="" width={56} height={56} />
          ) : null}
        </div>

        <div className="grid-2 stats-toolbar-grid">
          <label className="field">
            <span>Ruleset</span>
            <NeuSelect value={mode} disabled={disabled} options={MODE_OPTIONS} onChange={(v) => setMode(v)} />
          </label>
          <div className="stats-toolbar-actions">
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() => void load()}
              title="Uses the official osu! API. Each refresh loads cross-mode PP for all rulesets."
            >
              {busy ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {loadErr ? <p className="hint stats-err">{loadErr}</p> : null}

        {row && !row.error ? (
          <>
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
          </>
        ) : null}
      </div>

      {row && !row.error ? (
        <>
          <div className="social-card stats-insights-card">
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
                      {(performanceInsights.sampleWeightedToProfilePpRatio * 100).toFixed(1)}% of your profile PP — only a
                      rough comparison; your real total includes every play and bonus PP.
                    </li>
                  ) : null}
                  {performanceInsights.accuracySpread && performanceInsights.accuracySpread.n > 1 ? (
                    <li>
                      <strong>Accuracy spread (best scores):</strong> σ ≈{" "}
                      {performanceInsights.accuracySpread.stdev.toFixed(2)}% around a mean of{" "}
                      {performanceInsights.accuracySpread.mean.toFixed(2)}% ({performanceInsights.accuracySpread.n} scores).
                      This is score accuracy, not{" "}
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

          <div className="stats-charts-section">
            <h3 className="social-h3 stats-section-heading">Charts</h3>
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
        </>
      ) : row?.error ? (
        <p className="hint stats-err">Could not load ruleset stats: {row.error}</p>
      ) : null}
    </div>
  );
}

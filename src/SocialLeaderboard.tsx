import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { NeuSelect, type NeuSelectOption } from "./NeuSelect";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type LeaderboardParticipant = { osuId: number; label: string };

const MODE_OPTIONS: NeuSelectOption[] = [
  { value: "osu", label: "osu!" },
  { value: "taiko", label: "Taiko" },
  { value: "fruits", label: "Catch" },
  { value: "mania", label: "Mania" },
];

export type SortKey =
  | "pp"
  | "global_rank"
  | "accuracy"
  | "play_count"
  | "ranked_score"
  | "total_score"
  | "total_hits"
  | "max_combo"
  | "country_rank"
  | "trophy_density"
  | "consistency";

const SORT_OPTIONS: NeuSelectOption[] = [
  { value: "pp", label: "Performance (PP)" },
  { value: "global_rank", label: "Global rank (↑)" },
  { value: "accuracy", label: "Accuracy" },
  { value: "play_count", label: "Play count" },
  { value: "ranked_score", label: "Ranked score" },
  { value: "total_score", label: "Total score" },
  { value: "total_hits", label: "Total hits" },
  { value: "max_combo", label: "Max combo" },
  { value: "country_rank", label: "Country rank (↑)" },
  { value: "trophy_density", label: "SS density (per 1k plays)" },
  { value: "consistency", label: "Consistency (acc × log plays)" },
];

function countryCodeToFlag(code: string | null): string {
  if (!code || code.length !== 2) return "";
  const A = 0x1f1e6;
  const upper = code.toUpperCase();
  const pts: number[] = [];
  for (let i = 0; i < 2; i++) {
    const c = upper.charCodeAt(i);
    if (c < 65 || c > 90) return "";
    pts.push(A + (c - 65));
  }
  return String.fromCodePoint(...pts);
}

export type ParsedRow = {
  osuId: number;
  username: string;
  label: string;
  avatarUrl: string | null;
  countryCode: string | null;
  pp: number | null;
  globalRank: number | null;
  rankedScore: number | null;
  totalScore: number | null;
  playCount: number | null;
  accuracy: number | null;
  maxCombo: number | null;
  totalHits: number | null;
  gradeSS: number;
  gradeS: number;
  gradeA: number;
  levelCurrent: number | null;
  levelProgress: number | null;
  countryRank: number | null;
  replaysWatched: number | null;
  trophyDensity: number;
  consistency: number;
  error: string | null;
  raw: unknown;
};

function parseGradeCounts(gc: Record<string, unknown>): { ss: number; s: number; a: number } {
  const ss = (num(gc.ss) ?? 0) + (num(gc.ssh) ?? 0);
  const s = (num(gc.s) ?? 0) + (num(gc.sh) ?? 0);
  const a = num(gc.a) ?? 0;
  return { ss, s, a };
}

export function parseUserRulesetPayload(raw: unknown, fallbackLabel: string): ParsedRow | null {
  const r = asRecord(raw);
  const id = num(r.id);
  if (id == null) return null;
  const stats = asRecord(r.statistics ?? {});
  const gc = parseGradeCounts(asRecord(stats.grade_counts ?? {}));
  const lvl = asRecord(stats.level ?? {});
  const country = asRecord(r.country ?? {});
  const playCount = num(stats.play_count);
  const acc = num(stats.hit_accuracy);
  const trophyDensity = (gc.ss / Math.max(1, playCount ?? 1)) * 1000;
  const consistency = (acc ?? 0) * Math.log10((playCount ?? 0) + 10);
  return {
    osuId: id,
    username: String(r.username ?? ""),
    label: String(r.username ?? fallbackLabel),
    avatarUrl: r.avatar_url != null ? String(r.avatar_url) : null,
    countryCode: r.country_code != null ? String(r.country_code) : country.code != null ? String(country.code) : null,
    pp: num(stats.pp),
    globalRank: num(stats.global_rank),
    rankedScore: num(stats.ranked_score),
    totalScore: num(stats.total_score),
    playCount,
    accuracy: acc,
    maxCombo: num(stats.maximum_combo),
    totalHits: num(stats.total_hits),
    gradeSS: gc.ss,
    gradeS: gc.s,
    gradeA: gc.a,
    levelCurrent: num(lvl.current),
    levelProgress: num(lvl.progress),
    countryRank: num(stats.country_rank),
    replaysWatched: num(stats.replays_watched_by_others),
    trophyDensity,
    consistency,
    error: null,
    raw,
  };
}

export type RecentScoreMini = { pp: number | null; rank: string };

function parseRecentScores(raw: unknown): RecentScoreMini[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentScoreMini[] = [];
  for (const item of raw) {
    const s = asRecord(item);
    const pp = num(s.pp);
    const rank = String(s.rank ?? s.grade ?? "?").trim() || "?";
    out.push({ pp, rank });
  }
  return out;
}

function sortValue(row: ParsedRow, key: SortKey): number | null {
  switch (key) {
    case "pp":
      return row.pp;
    case "global_rank":
      return row.globalRank;
    case "accuracy":
      return row.accuracy;
    case "play_count":
      return row.playCount;
    case "ranked_score":
      return row.rankedScore;
    case "total_score":
      return row.totalScore;
    case "total_hits":
      return row.totalHits;
    case "max_combo":
      return row.maxCombo;
    case "country_rank":
      return row.countryRank;
    case "trophy_density":
      return row.trophyDensity;
    case "consistency":
      return row.consistency;
    default:
      return row.pp;
  }
}

function compareRows(a: ParsedRow, b: ParsedRow, key: SortKey): number {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  const lowerBetter = key === "global_rank" || key === "country_rank";
  const nullLast = (x: number | null) => (x == null ? (lowerBetter ? Infinity : -Infinity) : x);
  const na = nullLast(va);
  const nb = nullLast(vb);
  if (na === nb) return (b.pp ?? 0) - (a.pp ?? 0);
  if (lowerBetter) return na - nb;
  return nb - na;
}

function formatInt(n: number | null): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString();
}

function formatCompact(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

function MicroBar({ value, max, title }: { value: number | null; max: number; title: string }) {
  const v = value ?? 0;
  const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;
  return (
    <div className="lb-microbar" title={title}>
      <div className="lb-microbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function AccGauge({ value }: { value: number | null }) {
  const v = value ?? 0;
  const pct = Math.min(100, Math.max(0, v));
  return (
    <div className="lb-acc-gauge" title={value != null ? `${value.toFixed(2)}%` : "—"}>
      <div className="lb-acc-gauge-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function LevelStrip({ current, progress }: { current: number | null; progress: number | null }) {
  const p = progress ?? 0;
  return (
    <div className="lb-level-strip" title={current != null ? `Level ${current} · ${p.toFixed(0)}% to next` : "—"}>
      <span className="lb-level-num">{current != null ? Math.round(current) : "—"}</span>
      <div className="lb-level-bar">
        <div className="lb-level-bar-fill" style={{ width: `${Math.min(100, Math.max(0, p))}%` }} />
      </div>
    </div>
  );
}

function GradeStack({ ss, s, a }: { ss: number; s: number; a: number }) {
  const t = ss + s + a;
  if (t <= 0) return <span className="hint">—</span>;
  return (
    <div className="lb-grade-stack" title={`SS ${ss.toLocaleString()} · S ${s.toLocaleString()} · A ${a.toLocaleString()}`}>
      <span className="lb-grade-seg lb-grade-ss" style={{ flex: ss }} />
      <span className="lb-grade-seg lb-grade-s" style={{ flex: s }} />
      <span className="lb-grade-seg lb-grade-a" style={{ flex: a }} />
    </div>
  );
}

function ReplayBar({ value, max }: { value: number | null; max: number }) {
  const v = value ?? 0;
  const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;
  return (
    <div className="lb-replay-wrap" title={value != null ? value.toLocaleString() : "—"}>
      <span className="lb-replay-eye" aria-hidden>
        ◉
      </span>
      <div className="lb-microbar lb-replay-bar">
        <div className="lb-microbar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RecentStrip({ scores }: { scores: RecentScoreMini[] }) {
  if (scores.length === 0) return <span className="hint">—</span>;
  const maxPp = Math.max(1, ...scores.map((s) => s.pp ?? 0));
  return (
    <div className="lb-recent-strip">
      {scores.map((s, i) => {
        const ppVal = s.pp ?? 0;
        const h = ppVal > 0 ? Math.max(8, (ppVal / maxPp) * 36) : 6;
        const rk = s.rank.replace(/[^a-z]/gi, "").toLowerCase() || "x";
        return (
          <div
            key={i}
            className="lb-recent-col"
            title={s.pp != null ? `${s.pp.toFixed(ppVal >= 100 ? 0 : 1)}pp · ${s.rank}` : s.rank}
          >
            <div className="lb-recent-bar" style={{ height: `${h}px` }} />
            <span className={`lb-recent-rank lb-rank-${rk}`}>{s.rank}</span>
          </div>
        );
      })}
    </div>
  );
}

type RadarNorm = Record<"PP" | "Accuracy" | "Volume" | "Rank" | "Hits" | "Grades", number>;

function normRadar(rows: ParsedRow[], row: ParsedRow): RadarNorm {
  const maxPp = Math.max(1, ...rows.map((r) => r.pp ?? 0));
  const maxPlays = Math.max(1, ...rows.map((r) => r.playCount ?? 0));
  const maxHits = Math.max(1, ...rows.map((r) => r.totalHits ?? 0));
  const maxRank = Math.max(1, ...rows.map((r) => r.globalRank ?? 1));
  const ppN = (row.pp ?? 0) / maxPp;
  const accN = (row.accuracy ?? 0) / 100;
  const playN = Math.log10((row.playCount ?? 0) + 1) / Math.log10(maxPlays + 1);
  const rankN = row.globalRank == null ? 0 : 1 - (row.globalRank - 1) / maxRank;
  const hitsN = (row.totalHits ?? 0) / maxHits;
  const gradeWeight = row.gradeSS * 3 + row.gradeS * 2 + row.gradeA;
  const maxGw = Math.max(1, ...rows.map((r) => r.gradeSS * 3 + r.gradeS * 2 + r.gradeA));
  const gradeN = gradeWeight / maxGw;
  return {
    PP: Math.round(ppN * 100),
    Accuracy: Math.round(accN * 100),
    Volume: Math.round(playN * 100),
    Rank: Math.round(rankN * 100),
    Hits: Math.round(hitsN * 100),
    Grades: Math.round(gradeN * 100),
  };
}

function medianRadar(rows: ParsedRow[]): RadarNorm {
  if (rows.length === 0) {
    return { PP: 0, Accuracy: 0, Volume: 0, Rank: 0, Hits: 0, Grades: 0 };
  }
  const norms = rows.map((r) => normRadar(rows, r));
  const keys: (keyof RadarNorm)[] = ["PP", "Accuracy", "Volume", "Rank", "Hits", "Grades"];
  const out = {} as RadarNorm;
  for (const k of keys) {
    const vals = norms.map((n) => n[k]).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    out[k] = vals.length % 2 ? vals[mid] : Math.round((vals[mid - 1] + vals[mid]) / 2);
  }
  return out;
}

type SocialLeaderboardProps = {
  meId: number | null;
  participants: LeaderboardParticipant[];
  refreshSignal: number;
  onToast: (tone: "info" | "success" | "error", message: string) => void;
};

export function SocialLeaderboard({ meId, participants, refreshSignal, onToast }: SocialLeaderboardProps) {
  const [mode, setMode] = useState("osu");
  const [sortKey, setSortKey] = useState<SortKey>("pp");
  const [includeRecent, setIncludeRecent] = useState(true);
  const [radarTarget, setRadarTarget] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [recentMap, setRecentMap] = useState<Record<number, RecentScoreMini[]>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [lbBusy, setLbBusy] = useState(false);

  const load = useCallback(async () => {
    if (participants.length === 0) {
      setRows([]);
      setRecentMap({});
      return;
    }
    setLbBusy(true);
    try {
      const statsTasks = participants.map((p) =>
        invoke<unknown>("osu_user_ruleset_stats", { userId: p.osuId, mode })
          .then((raw) => ({ ok: true as const, osuId: p.osuId, label: p.label, raw }))
          .catch((e: unknown) => ({ ok: false as const, osuId: p.osuId, label: p.label, error: String(e) })),
      );
      const statsResults = await Promise.all(statsTasks);
      const parsed: ParsedRow[] = [];
      for (const r of statsResults) {
        if (!r.ok) {
          parsed.push({
            osuId: r.osuId,
            username: "",
            label: r.label,
            avatarUrl: null,
            countryCode: null,
            pp: null,
            globalRank: null,
            rankedScore: null,
            totalScore: null,
            playCount: null,
            accuracy: null,
            maxCombo: null,
            totalHits: null,
            gradeSS: 0,
            gradeS: 0,
            gradeA: 0,
            levelCurrent: null,
            levelProgress: null,
            countryRank: null,
            replaysWatched: null,
            trophyDensity: 0,
            consistency: 0,
            error: r.error,
            raw: null,
          });
          continue;
        }
        const row = parseUserRulesetPayload(r.raw, r.label);
        if (row) {
          row.label = meId != null && row.osuId === meId ? "You" : row.username || r.label;
          parsed.push(row);
        }
      }
      setRows(parsed);

      if (includeRecent) {
        const recentTasks = participants.map((p) =>
          invoke<unknown>("osu_user_recent_scores", { userId: p.osuId, limit: 8, mode }).then(
            (raw) => ({ osuId: p.osuId, raw }),
            () => ({ osuId: p.osuId, raw: [] }),
          ),
        );
        const recentRes = await Promise.all(recentTasks);
        const rm: Record<number, RecentScoreMini[]> = {};
        for (const x of recentRes) {
          rm[x.osuId] = parseRecentScores(x.raw);
        }
        setRecentMap(rm);
      } else {
        setRecentMap({});
      }
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setLbBusy(false);
    }
  }, [participants, mode, includeRecent, meId, onToast]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const sorted = useMemo(() => {
    const ok = rows.filter((r) => !r.error);
    const errRows = rows.filter((r) => r.error);
    const copy = [...ok];
    copy.sort((a, b) => compareRows(a, b, sortKey));
    return [...copy, ...errRows];
  }, [rows, sortKey]);

  const maxes = useMemo(() => {
    const ok = rows.filter((r) => !r.error);
    return {
      pp: Math.max(1, ...ok.map((r) => r.pp ?? 0)),
      rank: Math.max(1, ...ok.map((r) => r.globalRank ?? 0)),
      plays: Math.max(1, ...ok.map((r) => r.playCount ?? 0)),
      hits: Math.max(1, ...ok.map((r) => r.totalHits ?? 0)),
      replay: Math.max(1, ...ok.map((r) => r.replaysWatched ?? 0)),
    };
  }, [rows]);

  const ppChartData = useMemo(() => {
    return sorted
      .filter((r) => !r.error)
      .map((r) => ({
        name: r.label.length > 14 ? `${r.label.slice(0, 12)}…` : r.label,
        fullName: r.label,
        pp: Math.round((r.pp ?? 0) * 100) / 100,
        isMe: meId != null && r.osuId === meId,
      }));
  }, [sorted, meId]);

  const gradeAgg = useMemo(() => {
    const ok = rows.filter((r) => !r.error);
    return [
      { name: "SS", value: ok.reduce((s, r) => s + r.gradeSS, 0), fill: "var(--lb-grade-ss)" },
      { name: "S", value: ok.reduce((s, r) => s + r.gradeS, 0), fill: "var(--lb-grade-s)" },
      { name: "A", value: ok.reduce((s, r) => s + r.gradeA, 0), fill: "var(--lb-grade-a)" },
    ];
  }, [rows]);

  const radarOptions: NeuSelectOption[] = useMemo(() => {
    const ok = rows.filter((r) => !r.error);
    return [{ value: "", label: "Group median" }, ...ok.map((r) => ({ value: String(r.osuId), label: r.label }))];
  }, [rows]);

  const radarData = useMemo(() => {
    const ok = rows.filter((r) => !r.error);
    if (ok.length === 0) return [];
    const med = medianRadar(ok);
    const targetId = radarTarget ? Number(radarTarget) : null;
    const targetRow =
      targetId != null
        ? ok.find((r) => r.osuId === targetId)
        : meId != null
          ? ok.find((r) => r.osuId === meId)
          : ok[0];
    const a = targetRow ? normRadar(ok, targetRow) : med;
    const keys = Object.keys(med) as (keyof RadarNorm)[];
    return keys.map((k) => ({
      metric: k,
      A: a[k],
      B: med[k],
    }));
  }, [rows, radarTarget]);

  const gapToAbove = (idx: number): string => {
    if (sortKey !== "pp" || idx === 0) return "";
    const cur = sorted[idx];
    const above = sorted[idx - 1];
    if (!cur || !above || cur.error || above.error) return "";
    const c = cur.pp ?? 0;
    const u = above.pp ?? 0;
    const d = u - c;
    if (d <= 0) return "";
    return `−${d.toFixed(0)} pp`;
  };

  const disabled = lbBusy;

  return (
    <div className="social-section social-leaderboard-section">
      {lbBusy && <p className="hint social-lb-loading" aria-live="polite">Loading leaderboard…</p>}
      <p className="hint social-lb-intro">
        Rankings use the official osu! API (one request per friend for stats
        {includeRecent ? ", plus recent scores for sparklines" : ""}). Large friend lists mean more API calls on refresh.
      </p>

      <div className="social-card social-lb-toolbar">
        <div className="grid-2 social-lb-toolbar-grid">
          <label className="field">
            <span>Ruleset</span>
            <NeuSelect value={mode} disabled={disabled} options={MODE_OPTIONS} onChange={(v) => setMode(v)} />
          </label>
          <label className="field">
            <span>Sort by</span>
            <NeuSelect
              value={sortKey}
              disabled={disabled}
              options={SORT_OPTIONS}
              onChange={(v) => setSortKey(v as SortKey)}
            />
          </label>
        </div>
        <label className="field social-lb-toggle">
          <input type="checkbox" checked={includeRecent} disabled={disabled} onChange={(e) => setIncludeRecent(e.target.checked)} />
          <span>Include recent score charts (~2× API calls)</span>
        </label>
      </div>

      {participants.length === 0 ? (
        <p className="hint">Add osu-link or osu! web friends to compare. Your profile appears when signed in.</p>
      ) : (
        <>
          <div className="social-lb-charts">
            <div className="social-lb-chart-card">
              <h4 className="social-h4">PP snapshot</h4>
              <div className="social-lb-chart-inner">
                {ppChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(200, ppChartData.length * 28)}>
                    <BarChart data={ppChartData} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(v: number) => [`${v} pp`, "PP"]}
                        labelFormatter={(label) => {
                          const row = ppChartData.find((d) => d.name === label);
                          return row?.fullName ?? String(label ?? "");
                        }}
                      />
                      <Bar dataKey="pp" radius={[0, 4, 4, 0]}>
                        {ppChartData.map((e, i) => (
                          <Cell key={i} fill={e.isMe ? "var(--lb-bar-me)" : "var(--lb-bar-friend)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="hint">No data</p>
                )}
              </div>
            </div>
            <div className="social-lb-chart-card">
              <h4 className="social-h4">Group grade totals</h4>
              <div className="social-lb-chart-inner social-lb-chart-inner--short">
                {gradeAgg.some((g) => g.value > 0) ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={gradeAgg}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {gradeAgg.map((e, i) => (
                          <Cell key={i} fill={e.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="hint">No grades</p>
                )}
              </div>
            </div>
            <div className="social-lb-chart-card social-lb-radar-card">
              <div className="social-lb-radar-head">
                <h4 className="social-h4">Shape vs median</h4>
                <NeuSelect value={radarTarget} disabled={disabled} options={radarOptions} onChange={setRadarTarget} />
              </div>
              <div className="social-lb-chart-inner">
                {radarData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                      <PolarGrid />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                      <Radar name="Player" dataKey="A" stroke="var(--lb-radar-a)" fill="var(--lb-radar-a)" fillOpacity={0.35} />
                      <Radar name="Median" dataKey="B" stroke="var(--lb-radar-b)" fill="var(--lb-radar-b)" fillOpacity={0.2} />
                      <Legend />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="hint">No data</p>
                )}
              </div>
            </div>
          </div>

          <div className="social-lb-table-wrap">
            <table className="social-lb-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>PP</th>
                  <th>Global</th>
                  <th>Δ PP</th>
                  <th>Acc</th>
                  <th>Plays</th>
                  <th>Hits</th>
                  <th>Ranked score</th>
                  <th>Max combo</th>
                  <th>Grades</th>
                  <th>Level</th>
                  <th>Ctry</th>
                  <th>Replays</th>
                  <th>Fun</th>
                  {includeRecent ? <th>Recent</th> : null}
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, idx) => {
                  if (r.error) {
                    return (
                      <tr key={r.osuId} className="social-lb-row social-lb-row--err">
                        <td colSpan={includeRecent ? 17 : 16}>
                          <strong>{r.label}</strong> — {r.error}
                        </td>
                      </tr>
                    );
                  }
                  const podium = idx === 0 ? "podium-1" : idx === 1 ? "podium-2" : idx === 2 ? "podium-3" : "";
                  const isMe = meId != null && r.osuId === meId;
                  return (
                    <tr key={r.osuId} className={`social-lb-row ${podium} ${isMe ? "row-is-me" : ""}`}>
                      <td>{idx + 1}</td>
                      <td className="social-lb-player">
                        {r.avatarUrl ? <img className="social-lb-avatar" src={r.avatarUrl} alt="" /> : null}
                        <span>{r.label}</span>
                        {countryCodeToFlag(r.countryCode) ? (
                          <span className="social-lb-flag">{countryCodeToFlag(r.countryCode)}</span>
                        ) : null}
                      </td>
                      <td>
                        <div className="social-lb-numcell">
                          <MicroBar value={r.pp} max={maxes.pp} title={`${r.pp?.toFixed(2) ?? "—"} pp`} />
                          <span>{r.pp != null ? r.pp.toFixed(2) : "—"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="social-lb-numcell">
                          <MicroBar
                            value={r.globalRank == null ? null : maxes.rank - r.globalRank + 1}
                            max={maxes.rank}
                            title={`#${formatInt(r.globalRank)}`}
                          />
                          <span>#{formatInt(r.globalRank)}</span>
                        </div>
                      </td>
                      <td className="hint">{gapToAbove(idx)}</td>
                      <td>
                        <div className="social-lb-numcell">
                          <AccGauge value={r.accuracy} />
                          <span>{r.accuracy != null ? `${r.accuracy.toFixed(2)}%` : "—"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="social-lb-numcell">
                          <MicroBar value={r.playCount} max={maxes.plays} title={formatInt(r.playCount)} />
                          <span>{formatCompact(r.playCount)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="social-lb-numcell">
                          <MicroBar value={r.totalHits} max={maxes.hits} title={formatInt(r.totalHits)} />
                          <span>{formatCompact(r.totalHits)}</span>
                        </div>
                      </td>
                      <td>{formatCompact(r.rankedScore)}</td>
                      <td>{formatCompact(r.maxCombo)}</td>
                      <td>
                        <GradeStack ss={r.gradeSS} s={r.gradeS} a={r.gradeA} />
                      </td>
                      <td>
                        <LevelStrip current={r.levelCurrent} progress={r.levelProgress} />
                      </td>
                      <td>#{formatInt(r.countryRank)}</td>
                      <td>
                        <ReplayBar value={r.replaysWatched} max={maxes.replay} />
                      </td>
                      <td className="social-lb-fun">
                        <span title="SS per 1k plays">{r.trophyDensity.toFixed(2)} SS/k</span>
                        <span title="acc × log₁₀(plays+10)">{r.consistency.toFixed(1)} c</span>
                      </td>
                      {includeRecent ? (
                        <td>
                          <RecentStrip scores={recentMap[r.osuId] ?? []} />
                        </td>
                      ) : null}
                      <td>
                        <button
                          type="button"
                          className="secondary small-btn"
                          onClick={() => setExpanded((e) => ({ ...e, [r.osuId]: !e[r.osuId] }))}
                        >
                          {expanded[r.osuId] ? "Hide" : "JSON"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sorted.some((r) => expanded[r.osuId] && !r.error) ? (
            <div className="social-lb-json-panel">
              {sorted.map((r) =>
                r.error || !expanded[r.osuId] ? null : (
                  <pre key={r.osuId} className="social-pre social-lb-json-block">
                    {JSON.stringify(r.raw, null, 2)}
                  </pre>
                ),
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

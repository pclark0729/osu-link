import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUserRulesetPayload, type ParsedRow } from "./SocialLeaderboard";
import { computePerformanceInsights } from "./statsInsights";
import { computeOsuPerformanceRank } from "./playerRank";
import { MainPaneSticky } from "./MainPaneSticky";
import { StatsCharts } from "./stats/StatsCharts";
import { StatsHero } from "./stats/StatsHero";
import { StatsInsights } from "./stats/StatsInsights";
import { StatsOverview } from "./stats/StatsOverview";
import { StatsSubnav } from "./stats/StatsSubnav";
import { MODE_LABELS } from "./stats/statsConstants";
import {
  extractScoreArray,
  parseScoresDetailed,
  ppHistogramBucket,
  radarRowsFromRuleset,
  starHistogramBucket,
} from "./stats/statsParsing";
import type { CrossModeRow, EnrichedScore, StatsSubTab } from "./stats/statsTypes";

export type { EnrichedScore } from "./stats/statsTypes";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function PersonalStatsPanel({
  onToast,
  onGoToTrain,
}: {
  onToast: (tone: "info" | "success" | "error", message: string) => void;
  onGoToTrain: () => void;
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
  const [crossModeParsedRows, setCrossModeParsedRows] = useState<ParsedRow[]>([]);
  const [localIds, setLocalIds] = useState<Set<number>>(() => new Set());
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [statsTab, setStatsTab] = useState<StatsSubTab>("overview");

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
      setCrossModeParsedRows([]);
      return;
    }
    setBusy(true);
    setLoadErr(null);
    try {
      const modes = ["osu", "taiko", "fruits", "mania"] as const;
      const [profRaw, rulesetRaw, recentRaw, bestRaw, firstRaw, crossResults] = await Promise.all([
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
      const parsedForRank: ParsedRow[] = [];
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
        parsedForRank.push(pr);
        cm.push({
          mode: m,
          label: MODE_LABELS[m] ?? m,
          pp: pr.pp,
          rank: pr.globalRank,
        });
      }
      setCrossMode(cm);
      setCrossModeParsedRows(parsedForRank);

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

  const rankInfo = useMemo(() => computeOsuPerformanceRank(crossModeParsedRows), [crossModeParsedRows]);

  const radarData = useMemo(() => radarRowsFromRuleset(rulesetRow), [rulesetRow]);

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

  const chartProps = {
    ppByModeData,
    radarData,
    gradePie,
    recentSeries,
    topPlaysData,
    ppHist,
    starHist,
    modsFreq,
    scatterData,
  };

  return (
    <div className="social-section stats-section panel panel-elevated stats-panel">
      <MainPaneSticky className="stats-sticky">
        <StatsHero
          username={row?.username ?? null}
          usernamePlaceholder={busy && !row ? "Loading your profile…" : "—"}
          avatarUrl={row?.avatarUrl ?? null}
          mode={mode}
          disabled={disabled}
          busy={busy}
          loadErr={loadErr}
          onModeChange={(v) => setMode(v)}
          onRefresh={() => void load()}
        />
        <StatsSubnav tab={statsTab} onChange={setStatsTab} />
      </MainPaneSticky>

      {row && !row.error ? (
        <>
          {statsTab === "overview" ? (
            <StatsOverview
              row={row}
              firstCount={firstCount}
              localOverlap={localOverlap}
              joinDate={joinDate}
              countryName={countryName}
              rankInfo={rankInfo}
              recent={recent}
              onGoToTrain={onGoToTrain}
            />
          ) : null}

          {statsTab === "charts" ? <StatsCharts {...chartProps} /> : null}

          {statsTab === "insights" ? (
            <StatsInsights performanceInsights={performanceInsights} insightsListEmpty={insightsListEmpty} />
          ) : null}
        </>
      ) : row?.error ? (
        <p className="hint stats-err stats-tab-body-err">Could not load ruleset stats: {row.error}</p>
      ) : (
        <p className="hint stats-tab-body-placeholder">{busy ? "Loading…" : null}</p>
      )}
    </div>
  );
}

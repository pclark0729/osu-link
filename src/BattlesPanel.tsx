import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { baselinePpPerStarFromBestScores } from "./challengeScoring";
import { submitBattleFromOsu as submitBattleFromOsuApi } from "./battleSubmitFromOsu";
import { osuRankedStarRangeFromBeatmapset } from "./beatmapSetStarRange";
import { NeuSelect, type NeuSelectOption } from "./NeuSelect";
import { fetchOsuPerformanceRankForUser } from "./osuPlayerRankFetch";
import type { PlayerRankInfo } from "./playerRank";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const AUTO_SUBMIT_STORAGE_KEY = "osu-link.battles.autoSubmit.v1";

function loadAutoSubmitEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_SUBMIT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveAutoSubmitEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_SUBMIT_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const BATTLE_WINDOW_PRESET_OPTIONS: NeuSelectOption[] = [
  { value: "", label: "Choose time limit…" },
  { value: "86400000", label: "24 hours" },
  { value: "172800000", label: "48 hours" },
  { value: "604800000", label: "7 days" },
  { value: "custom", label: "Custom end date…" },
];

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h >= 48) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  if (h > 0) return `${h}h ${m}m`;
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

export type BattlesPanelProps = {
  onToast: (tone: "info" | "success" | "error", message: string) => void;
  socialGet: (path: string) => Promise<unknown>;
  socialPost: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  meId: number | null;
  oauthOsuId: number | null;
  displayNameForOsu: (osuId: number) => string;
  friendSelectOptions: NeuSelectOption[];
  resolvedSocialApiBaseUrl: string | null;
  /** Increment to refetch battles (e.g. after parent refresh completes) */
  refreshSignal: number;
};

export function BattlesPanel({
  onToast,
  socialGet,
  socialPost,
  meId,
  oauthOsuId,
  displayNameForOsu,
  friendSelectOptions,
  resolvedSocialApiBaseUrl,
  refreshSignal,
}: BattlesPanelProps) {
  const [busy, setBusy] = useState(false);
  const [battles, setBattles] = useState<unknown[]>([]);
  const [battleOpponentFriend, setBattleOpponentFriend] = useState("");
  const [battleOpponentManual, setBattleOpponentManual] = useState("");
  const [battleMapQuery, setBattleMapQuery] = useState("");
  const [battleMapResults, setBattleMapResults] = useState<
    Array<{ id: number; title: string; artist: string; starRange: string | null }>
  >([]);
  const [battleMapSearching, setBattleMapSearching] = useState(false);
  const [battlePick, setBattlePick] = useState<{
    id: number;
    title: string;
    artist: string;
    starRange: string | null;
  } | null>(null);
  const [battleMapSelectValue, setBattleMapSelectValue] = useState("");
  const [battleRelativePp, setBattleRelativePp] = useState(true);
  const [battleDiffOptions, setBattleDiffOptions] = useState<NeuSelectOption[]>([
    { value: "", label: "Any difficulty" },
  ]);
  const [battleDiffValue, setBattleDiffValue] = useState("");
  const [battleDeadlinePreset, setBattleDeadlinePreset] = useState("");
  const [battleDeadlineCustom, setBattleDeadlineCustom] = useState("");
  const [hydratedTitles, setHydratedTitles] = useState<Record<number, { title: string; artist: string }>>({});
  const fetchedSetRef = useRef<Set<number>>(new Set());
  const [tick, setTick] = useState(0);
  const [scoreModal, setScoreModal] = useState<{ battleId: number; relativePp: boolean } | null>(null);
  const [scoreDraft, setScoreDraft] = useState("");
  const battlePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [rankByOsuId, setRankByOsuId] = useState<Map<number, PlayerRankInfo>>(new Map());
  const [baselinePpByOsuId, setBaselinePpByOsuId] = useState<Map<number, number | null>>(new Map());
  const [detailBattleId, setDetailBattleId] = useState<number | null>(null);
  const [detailPayload, setDetailPayload] = useState<{
    battle: Record<string, unknown>;
    scores: unknown[];
  } | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [autoSubmitEnabled, setAutoSubmitEnabled] = useState(() => loadAutoSubmitEnabled());
  const pendingRematchBmRef = useRef<number | null>(null);
  const autoSubmitWarnedRef = useRef(false);
  const autoSubmitTargetsRef = useRef<
    Array<{ id: number; setId: number; relativePp: boolean; fixedBm: number | null }>
  >([]);

  const selfOsuId = meId ?? oauthOsuId;

  const refreshBattles = useCallback(async () => {
    const j = asRecord(await socialGet("/api/v1/battles"));
    const b = j.battles;
    setBattles(Array.isArray(b) ? b : []);
  }, [socialGet]);

  useEffect(() => {
    void refreshBattles().catch(() => {});
  }, [refreshBattles, refreshSignal]);

  useEffect(() => {
    if (!resolvedSocialApiBaseUrl) return;
    battlePollRef.current = setInterval(() => {
      void refreshBattles().catch(() => {});
    }, 15_000);
    return () => {
      if (battlePollRef.current) clearInterval(battlePollRef.current);
    };
  }, [resolvedSocialApiBaseUrl, refreshBattles]);

  useEffect(() => {
    const q = battleMapQuery.trim();
    if (q.length < 2) {
      setBattleMapResults([]);
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        setBattleMapSearching(true);
        try {
          const res = await invoke<Record<string, unknown>>("search_beatmapsets", {
            input: { q, s: "ranked", sort: "plays_desc", m: 0 },
          });
          const sets = (res.beatmapsets as unknown[]) || [];
          const out: Array<{ id: number; title: string; artist: string; starRange: string | null }> = [];
          for (const x of sets.slice(0, 12)) {
            const r = asRecord(x);
            const id = Number(r.id);
            if (!Number.isFinite(id)) continue;
            out.push({
              id,
              title: String(r.title ?? ""),
              artist: String(r.artist ?? ""),
              starRange: osuRankedStarRangeFromBeatmapset(r),
            });
          }
          setBattleMapResults(out);
        } catch {
          setBattleMapResults([]);
        } finally {
          setBattleMapSearching(false);
        }
      })();
    }, 380);
    return () => clearTimeout(t);
  }, [battleMapQuery]);

  useEffect(() => {
    if (!battlePick) return;
    if (!battleMapResults.some((m) => m.id === battlePick.id)) {
      setBattlePick(null);
      setBattleMapSelectValue("");
    }
  }, [battleMapResults, battlePick]);

  useEffect(() => {
    if (!battlePick || !battleRelativePp) {
      setBattleDiffOptions([{ value: "", label: "Any difficulty" }]);
      setBattleDiffValue("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = await invoke<unknown>("get_beatmapset", { beatmapsetId: battlePick.id });
        const root = asRecord(raw);
        const bms = root.beatmaps;
        const opts: NeuSelectOption[] = [{ value: "", label: "Any difficulty (relative PP)" }];
        if (Array.isArray(bms)) {
          for (const x of bms) {
            const bm = asRecord(x);
            if (String(bm.mode ?? "") !== "osu") continue;
            const st = String(bm.status ?? "").toLowerCase();
            if (st && st !== "ranked") continue;
            const id = Number(bm.id);
            const stars = Number(bm.difficulty_rating);
            const ver = String(bm.version ?? "Beatmap").trim() || "Beatmap";
            if (!Number.isFinite(id)) continue;
            opts.push({
              value: String(id),
              label: Number.isFinite(stars) ? `${ver} (${stars.toFixed(1)}★)` : ver,
            });
          }
        }
        if (!cancelled) {
          setBattleDiffOptions(opts);
          const pending = pendingRematchBmRef.current;
          if (pending != null) {
            const want = String(pending);
            pendingRematchBmRef.current = null;
            if (opts.some((o) => o.value === want)) {
              setBattleDiffValue(want);
            } else {
              setBattleDiffValue("");
            }
          } else {
            setBattleDiffValue("");
          }
        }
      } catch {
        if (!cancelled) {
          setBattleDiffOptions([{ value: "", label: "Any difficulty" }]);
          setBattleDiffValue("");
          pendingRematchBmRef.current = null;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [battlePick, battleRelativePp]);

  const battleMapSelectOptions: NeuSelectOption[] = useMemo(() => {
    const hint = battleMapSearching ? "Searching…" : "Search below, then choose a set…";
    const opts: NeuSelectOption[] = [{ value: "", label: hint }];
    for (const m of battleMapResults) {
      const starBit = m.starRange ? ` · ${m.starRange}` : "";
      opts.push({
        value: String(m.id),
        label: `${m.artist} — ${m.title} (#${m.id})${starBit}`,
      });
    }
    return opts;
  }, [battleMapResults, battleMapSearching]);

  const battleParticipantKey = useMemo(() => {
    const s = new Set<number>();
    for (const b of battles) {
      const r = asRecord(b);
      const c = Number(r.creator_osu_id);
      const o = Number(r.opponent_osu_id);
      if (Number.isFinite(c)) s.add(c);
      if (Number.isFinite(o)) s.add(o);
    }
    return [...s].sort((a, b) => a - b).join(",");
  }, [battles]);

  const relativeBaselineKey = useMemo(() => {
    const s = new Set<number>();
    for (const b of battles) {
      const r = asRecord(b);
      if (Number(r.relative_pp) !== 1) continue;
      const c = Number(r.creator_osu_id);
      const o = Number(r.opponent_osu_id);
      if (Number.isFinite(c)) s.add(c);
      if (Number.isFinite(o)) s.add(o);
    }
    return [...s].sort((a, b) => a - b).join(",");
  }, [battles]);

  const autoSubmitTargets = useMemo(() => {
    if (!autoSubmitEnabled || selfOsuId == null) return [];
    const now = Date.now();
    const out: Array<{ id: number; setId: number; relativePp: boolean; fixedBm: number | null }> = [];
    for (const raw of battles) {
      const r = asRecord(raw);
      if (String(r.state) === "closed") continue;
      const end = Number(r.window_end);
      if (!Number.isFinite(end) || now > end) continue;
      const scoresRaw = r.scores;
      const scores = Array.isArray(scoresRaw) ? scoresRaw : [];
      const my = scores.some((s) => Number(asRecord(s).user_osu_id) === selfOsuId);
      if (my) continue;
      out.push({
        id: Number(r.id),
        setId: Number(r.beatmapset_id),
        relativePp: Number(r.relative_pp) === 1,
        fixedBm: r.beatmap_id != null ? Number(r.beatmap_id) : null,
      });
    }
    return out;
  }, [battles, autoSubmitEnabled, selfOsuId]);

  const hasActiveBattle = useMemo(
    () =>
      battles.some((raw) => {
        const r = asRecord(raw);
        const end = Number(r.window_end);
        const state = String(r.state);
        return state !== "closed" && Number.isFinite(end) && Date.now() <= end;
      }),
    [battles],
  );

  useEffect(() => {
    if (!hasActiveBattle) return;
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, [hasActiveBattle]);

  useEffect(() => {
    autoSubmitTargetsRef.current = autoSubmitTargets;
  }, [autoSubmitTargets]);

  useEffect(() => {
    if (!isTauri() || battleParticipantKey.length === 0) return;
    const ids = battleParticipantKey
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        ids.map(async (osuId) => {
          try {
            return [osuId, await fetchOsuPerformanceRankForUser(osuId)] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setRankByOsuId((prev) => {
        const next = new Map(prev);
        for (const e of entries) {
          if (e) next.set(e[0], e[1]);
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [battleParticipantKey]);

  useEffect(() => {
    if (!isTauri() || relativeBaselineKey.length === 0) return;
    const ids = relativeBaselineKey
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
    let cancelled = false;
    void (async () => {
      const m = new Map<number, number | null>();
      for (const osuId of ids) {
        if (cancelled) return;
        try {
          const raw = await invoke<unknown>("osu_user_best_scores", {
            userId: osuId,
            limit: 100,
            mode: "osu",
          });
          m.set(osuId, baselinePpPerStarFromBestScores(raw));
        } catch {
          m.set(osuId, null);
        }
      }
      if (cancelled) return;
      setBaselinePpByOsuId((prev) => {
        const next = new Map(prev);
        for (const [k, v] of m) next.set(k, v);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [relativeBaselineKey]);

  useEffect(() => {
    if (detailBattleId == null) {
      setDetailPayload(null);
      setDetailErr(null);
      return;
    }
    let cancelled = false;
    setDetailErr(null);
    setDetailPayload(null);
    void (async () => {
      try {
        const j = asRecord(await socialGet(`/api/v1/battles/${detailBattleId}`));
        if (cancelled) return;
        setDetailPayload({
          battle: asRecord(j.battle),
          scores: Array.isArray(j.scores) ? j.scores : [],
        });
      } catch (e) {
        if (!cancelled) setDetailErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailBattleId, socialGet]);

  useEffect(() => {
    if (!autoSubmitEnabled || !resolvedSocialApiBaseUrl) return;
    const id = window.setInterval(() => {
      void (async () => {
        const targets = autoSubmitTargetsRef.current;
        if (targets.length === 0) return;
        const needsMe = targets.some((t) => t.relativePp);
        if (needsMe && meId == null) {
          if (!autoSubmitWarnedRef.current) {
            autoSubmitWarnedRef.current = true;
            onToast(
              "info",
              "Auto-submit for relative PP battles needs party-server sign-in so we can read your top plays.",
            );
          }
        }
        for (const t of targets) {
          if (t.relativePp && meId == null) continue;
          const res = await submitBattleFromOsuApi({
            battleId: t.id,
            beatmapsetId: t.setId,
            relativePp: t.relativePp,
            fixedBeatmapId: t.fixedBm != null && Number.isFinite(t.fixedBm) ? t.fixedBm : null,
            meId,
            oauthOsuId,
            socialPost,
          });
          if (res.ok) {
            onToast("success", `[Auto] ${res.message}`);
            await refreshBattles();
            return;
          }
        }
      })();
    }, 4 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [autoSubmitEnabled, resolvedSocialApiBaseUrl, meId, oauthOsuId, socialPost, onToast, refreshBattles]);

  useEffect(() => {
    const toFetch: number[] = [];
    for (const b of battles) {
      const r = asRecord(b);
      const sid = Number(r.beatmapset_id);
      if (!Number.isFinite(sid)) continue;
      const disp = r.display as { title?: string; artist?: string } | undefined;
      const hasServer =
        disp && (String(disp.title ?? "").trim() !== "" || String(disp.artist ?? "").trim() !== "");
      if (hasServer) continue;
      if (hydratedTitles[sid]) continue;
      if (fetchedSetRef.current.has(sid)) continue;
      fetchedSetRef.current.add(sid);
      toFetch.push(sid);
    }
    if (toFetch.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const sid of toFetch) {
        if (cancelled) return;
        try {
          const raw = await invoke<unknown>("get_beatmapset", { beatmapsetId: sid });
          const o = asRecord(raw);
          const title = String(o.title ?? "");
          const artist = String(o.artist ?? "");
          if (cancelled) return;
          setHydratedTitles((prev) => ({ ...prev, [sid]: { title, artist } }));
        } catch {
          /* keep placeholder */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [battles, hydratedTitles]);

  const mapLineForBattle = useCallback(
    (r: Record<string, unknown>) => {
      const sid = Number(r.beatmapset_id);
      const disp = r.display as { title?: string; artist?: string } | undefined;
      if (disp && (String(disp.title ?? "").trim() || String(disp.artist ?? "").trim())) {
        const title = String(disp.title ?? "").trim() || "—";
        const artist = String(disp.artist ?? "").trim() || "—";
        return `${artist} — ${title}`;
      }
      if (Number.isFinite(sid) && hydratedTitles[sid]) {
        const h = hydratedTitles[sid];
        return `${h.artist} — ${h.title}`;
      }
      return `Set #${Number.isFinite(sid) ? sid : "—"}`;
    },
    [hydratedTitles],
  );

  const fighterSubtitle = useCallback(
    (osuId: number, relativePpBattle: boolean) => {
      const rank = rankByOsuId.get(osuId);
      const rankBit = rank && !rank.isEmpty ? `${rank.name} (${rank.shortLabel})` : "—";
      const b = baselinePpByOsuId.get(osuId);
      const baseBit =
        relativePpBattle && b != null && Number.isFinite(b) && b > 0
          ? ` · ~${b.toFixed(0)}pp/★ baseline`
          : relativePpBattle
            ? " · baseline —"
            : "";
      return (
        <span
          className="battles-panel__fighter-sub"
          title="Performance tier from osu! stats; baseline from top plays (relative PP)."
        >
          {rankBit}
          {baseBit}
        </span>
      );
    },
    [rankByOsuId, baselinePpByOsuId],
  );

  const applyRematch = useCallback(
    (r: Record<string, unknown>) => {
      const creator = Number(r.creator_osu_id);
      const opponent = Number(r.opponent_osu_id);
      const other = selfOsuId === creator ? opponent : creator;
      const friendVal = friendSelectOptions.some((o) => o.value === String(other) && o.value !== "");
      if (friendVal) {
        setBattleOpponentFriend(String(other));
        setBattleOpponentManual("");
      } else {
        setBattleOpponentManual(String(other));
        setBattleOpponentFriend("");
      }
      const sid = Number(r.beatmapset_id);
      const disp = r.display as { title?: string; artist?: string } | undefined;
      setBattlePick({
        id: sid,
        title: String(disp?.title ?? "").trim() || "—",
        artist: String(disp?.artist ?? "").trim() || "—",
        starRange: null,
      });
      setBattleMapSelectValue(String(sid));
      const rel = Number(r.relative_pp) === 1;
      setBattleRelativePp(rel);
      const fbm = r.beatmap_id != null ? Number(r.beatmap_id) : null;
      if (rel && fbm != null && Number.isFinite(fbm)) {
        pendingRematchBmRef.current = fbm;
      } else {
        pendingRematchBmRef.current = null;
      }
      setBattleMapQuery("");
      setBattleMapResults([]);
      onToast("info", "Rematch — confirm time limit and start battle.");
      document.querySelector(".battles-panel__new")?.scrollIntoView({ behavior: "smooth" });
    },
    [selfOsuId, friendSelectOptions, onToast],
  );

  const uiLocked = busy;

  const createBattle = async () => {
    const opp =
      battleOpponentFriend !== "" ? Number(battleOpponentFriend) : Number(battleOpponentManual.trim());
    if (!battlePick || !Number.isFinite(opp)) {
      onToast("error", "Choose an opponent and a beatmap set.");
      return;
    }
    let windowEndMs: number | null = null;
    if (battleDeadlinePreset === "custom") {
      if (!battleDeadlineCustom.trim()) {
        onToast("error", "Pick an end date and time for the battle window.");
        return;
      }
      const ms = new Date(battleDeadlineCustom).getTime();
      windowEndMs = Number.isFinite(ms) ? ms : null;
    } else if (battleDeadlinePreset) {
      const offset = Number(battleDeadlinePreset);
      windowEndMs = Number.isFinite(offset) ? Date.now() + offset : null;
    }
    if (windowEndMs == null || !Number.isFinite(windowEndMs) || windowEndMs <= Date.now()) {
      onToast("error", "Choose a valid time limit (end must be in the future).");
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        opponentOsuId: opp,
        beatmapsetId: battlePick.id,
        windowEndMs,
        display: { title: battlePick.title, artist: battlePick.artist },
      };
      if (battleRelativePp) {
        body.relativePp = true;
        if (battleDiffValue.trim()) {
          const bid = Number(battleDiffValue);
          if (Number.isFinite(bid)) body.beatmapId = bid;
        }
      }
      await socialPost("/api/v1/battles", body);
      onToast("success", "Battle created.");
      setBattleMapQuery("");
      setBattleMapResults([]);
      setBattlePick(null);
      setBattleMapSelectValue("");
      setBattleRelativePp(true);
      setBattleDiffValue("");
      setBattleDeadlinePreset("");
      setBattleDeadlineCustom("");
      await refreshBattles();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitBattleFromOsu = async (
    battleId: number,
    beatmapsetId: number,
    opts: { relativePp: boolean; fixedBeatmapId: number | null },
  ) => {
    setBusy(true);
    try {
      const res = await submitBattleFromOsuApi({
        battleId,
        beatmapsetId,
        relativePp: opts.relativePp,
        fixedBeatmapId: opts.fixedBeatmapId,
        meId,
        oauthOsuId,
        socialPost,
      });
      if (res.ok) {
        onToast("success", res.message);
        await refreshBattles();
      } else {
        onToast("error", res.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const openScoreModal = (battleId: number, relativePp: boolean) => {
    setScoreDraft("");
    setScoreModal({ battleId, relativePp });
  };

  const confirmScoreModal = async () => {
    if (!scoreModal) return;
    const score = Number(scoreDraft.replace(/,/g, ""));
    if (!Number.isFinite(score) || score <= 0) {
      onToast("error", "Enter a valid score.");
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { score, mods: 0 };
      if (scoreModal.relativePp) {
        body.isUnweighted = true;
      }
      await socialPost(`/api/v1/battles/${scoreModal.battleId}/submit`, body);
      onToast(
        "success",
        scoreModal.relativePp ? "Raw score submitted (unweighted)." : "Score submitted.",
      );
      setScoreModal(null);
      await refreshBattles();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const { activeBattles, historyBattles } = useMemo(() => {
    const active: unknown[] = [];
    const hist: unknown[] = [];
    const now = Date.now();
    for (const b of battles) {
      const r = asRecord(b);
      const end = Number(r.window_end);
      const state = String(r.state);
      const inWindow = Number.isFinite(end) && now <= end;
      const isHistory = state === "closed" || !inWindow;
      if (isHistory) hist.push(b);
      else active.push(b);
    }
    return { activeBattles: active, historyBattles: hist };
  }, [battles]);

  const renderBattleCard = (raw: unknown) => {
    const r = asRecord(raw);
    const id = Number(r.id);
    const creator = Number(r.creator_osu_id);
    const opponent = Number(r.opponent_osu_id);
    const setId = Number(r.beatmapset_id);
    const end = Number(r.window_end);
    const state = String(r.state);
    const winner = r.winner_osu_id != null ? Number(r.winner_osu_id) : null;
    const relativePpBattle = Number(r.relative_pp) === 1;
    const fixedBattleBm = r.beatmap_id != null ? Number(r.beatmap_id) : null;
    const windowOpen = Number.isFinite(end) && Date.now() <= end;
    const canTrySubmit = state !== "closed" && windowOpen;
    const scoresRaw = r.scores;
    const scoreList = Array.isArray(scoresRaw) ? scoresRaw.map((x) => asRecord(x as Record<string, unknown>)) : [];
    const myScore = scoreList.find((s) => Number(s.user_osu_id) === selfOsuId);

    let statusBadge = "";
    let statusClass = "battles-panel__status battles-panel__status--open";
    if (state === "closed") {
      if (winner == null) {
        statusBadge = "Finished · no winner";
        statusClass = "battles-panel__status battles-panel__status--muted";
      } else if (selfOsuId != null && winner === selfOsuId) {
        statusBadge = "You won";
        statusClass = "battles-panel__status battles-panel__status--win";
      } else {
        statusBadge = "You lost";
        statusClass = "battles-panel__status battles-panel__status--loss";
      }
    } else if (!windowOpen) {
      statusBadge = "Window ended";
      statusClass = "battles-panel__status battles-panel__status--muted";
    } else if (scoreList.length >= 2) {
      statusBadge = "Both submitted";
      statusClass = "battles-panel__status battles-panel__status--done";
    } else if (scoreList.length === 1) {
      statusBadge = myScore ? "Awaiting opponent" : "Opponent submitted — your turn";
      statusClass = "battles-panel__status battles-panel__status--wait";
    } else {
      statusBadge = "Open";
      statusClass = "battles-panel__status battles-panel__status--open";
    }

    const scoresLine =
      scoreList.length > 0 ? (
        <ul className="battles-panel__scores" aria-label="Submitted scores">
          {scoreList.map((s) => {
            const uid = Number(s.user_osu_id);
            const sc = Number(s.score);
            const rv = s.rank_value != null ? Number(s.rank_value) : null;
            const ppV = s.pp != null ? Number(s.pp) : null;
            const starsV = s.stars != null ? Number(s.stars) : null;
            const unweighted = Boolean(s.is_unweighted);
            let line: string;
            if (relativePpBattle && unweighted) {
              line = `${displayNameForOsu(uid)} — ${Number.isFinite(sc) ? sc.toLocaleString() : "—"} (raw)`;
            } else if (relativePpBattle && rv != null && Number.isFinite(rv)) {
              const starBit = starsV != null && Number.isFinite(starsV) ? `★${starsV.toFixed(1)} · ` : "";
              const ppBit = ppV != null && Number.isFinite(ppV) ? `${ppV.toFixed(0)}pp · ` : "";
              line = `${displayNameForOsu(uid)} — ${starBit}${ppBit}${rv.toFixed(2)}×`;
            } else {
              line = `${displayNameForOsu(uid)}: ${Number.isFinite(sc) ? sc.toLocaleString() : "—"}`;
            }
            return (
              <li key={uid}>
                {line}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint battles-panel__no-scores">No scores submitted yet.</p>
      );

    const remaining = Number.isFinite(end) ? end - Date.now() : 0;
    const countdown =
      canTrySubmit && Number.isFinite(end) ? (
        <span
          key={tick}
          className="battles-panel__countdown"
          title={new Date(end).toLocaleString()}
        >
          {formatTimeRemaining(remaining)} left
        </span>
      ) : null;

    return (
      <li key={id} className="battles-panel__card">
        <div className="battles-panel__card-main">
          <div className="battles-panel__card-head">
            <span className="battles-panel__map-title">{mapLineForBattle(r)}</span>
            <span className={statusClass}>{statusBadge}</span>
          </div>
          <div className="battles-panel__fighters" aria-label="Players">
            <div className="battles-panel__fighter">
              <span className="battles-panel__fighter-name">{displayNameForOsu(creator)}</span>
              {fighterSubtitle(creator, relativePpBattle)}
            </div>
            <span className="hint battles-panel__vs">vs</span>
            <div className="battles-panel__fighter">
              <span className="battles-panel__fighter-name">{displayNameForOsu(opponent)}</span>
              {fighterSubtitle(opponent, relativePpBattle)}
            </div>
          </div>
          <div className="battles-panel__card-tools">
            <button type="button" className="secondary small-btn" onClick={() => setDetailBattleId(id)}>
              Details
            </button>
            {state === "closed" && selfOsuId != null && (selfOsuId === creator || selfOsuId === opponent) ? (
              <button type="button" className="secondary small-btn" onClick={() => applyRematch(r)}>
                Rematch
              </button>
            ) : null}
          </div>
          <span className="hint battles-panel__meta">
            #{id}
            {Number.isFinite(setId) ? ` · set ${setId}` : ""}
            {relativePpBattle ? " · relative PP" : ""}
            {fixedBattleBm != null && Number.isFinite(fixedBattleBm) ? ` · fixed beatmap ${fixedBattleBm}` : ""}
            {Number.isFinite(end) ? ` · ends ${new Date(end).toLocaleString()}` : ""}
            {countdown ? (
              <>
                {" "}
                · {countdown}
              </>
            ) : null}
          </span>
          {scoresLine}
        </div>
        {canTrySubmit && (
          <div className="battles-panel__card-actions">
            <button
              type="button"
              className="primary small-btn"
              disabled={uiLocked}
              onClick={() =>
                void submitBattleFromOsu(id, setId, {
                  relativePp: relativePpBattle,
                  fixedBeatmapId:
                    fixedBattleBm != null && Number.isFinite(fixedBattleBm) ? fixedBattleBm : null,
                })
              }
            >
              Submit from osu!
            </button>
            <button
              type="button"
              className="secondary small-btn"
              disabled={uiLocked}
              onClick={() => openScoreModal(id, relativePpBattle)}
            >
              Enter score…
            </button>
          </div>
        )}
        {!canTrySubmit &&
        selfOsuId != null &&
        (selfOsuId === creator || selfOsuId === opponent) &&
        !myScore &&
        (state === "closed" || !windowOpen) ? (
          <p className="hint battles-panel__missed">You did not submit a score for this battle.</p>
        ) : null}
      </li>
    );
  };

  return (
    <div className="social-section battles-panel social-battle-view">
      <div className="social-subview-head">
        <p className="panel-sub panel-sub--tight battles-panel__lede">
          1v1 on a ranked set: submit from osu! or enter a score. Relative PP (vs your PP/★ curve) is the default, like
          Challenges. The server picks a winner when the window ends or both players have submitted.
        </p>
        <label className="field field--checkbox battles-panel__auto-submit">
          <input
            type="checkbox"
            checked={autoSubmitEnabled}
            disabled={uiLocked}
            onChange={(e) => {
              const on = e.target.checked;
              saveAutoSubmitEnabled(on);
              setAutoSubmitEnabled(on);
            }}
          />
          <span>
            Auto-submit from osu! (every ~4 min when you have an open battle and no submission yet — same rules as
            “Submit from osu!”)
          </span>
        </label>
      </div>

      <details className="social-compose-details battles-panel__new" open>
        <summary className="social-compose-details__summary">Start a new battle</summary>
        <div className="social-compose-shell battles-panel__form">
          <div className="grid-2">
            <label className="field">
              <span>Opponent</span>
              <NeuSelect
                value={battleOpponentFriend}
                disabled={uiLocked}
                options={friendSelectOptions}
                onChange={(v) => {
                  setBattleOpponentFriend(v);
                  if (v) setBattleOpponentManual("");
                }}
              />
            </label>
            <label className="field">
              <span>Or osu! user id</span>
              <input
                type="text"
                inputMode="numeric"
                value={battleOpponentManual}
                onChange={(e) => {
                  setBattleOpponentManual(e.target.value);
                  if (e.target.value.trim()) setBattleOpponentFriend("");
                }}
                placeholder="Anyone not in the list"
              />
            </label>
          </div>
          <div className="battle-map-panel">
            <div className="battle-map-panel-header">
              <span className="battle-map-panel-title">Map</span>
              <span className="battle-map-panel-sub">Ranked beatmaps · search, then pick from the list</span>
            </div>
            <label className="field battle-map-search-field">
              <span>Search</span>
              <input
                type="search"
                value={battleMapQuery}
                onChange={(e) => setBattleMapQuery(e.target.value)}
                placeholder="Type at least 2 characters…"
                autoComplete="off"
              />
            </label>
            {battleMapSearching && (
              <p className="hint battle-map-search-status" aria-live="polite">
                Searching…
              </p>
            )}
            <label className="field">
              <span>Beatmap set</span>
              <NeuSelect
                value={battleMapSelectValue}
                disabled={uiLocked}
                options={battleMapSelectOptions}
                onChange={(v) => {
                  setBattleMapSelectValue(v);
                  if (!v) {
                    setBattlePick(null);
                    return;
                  }
                  const m = battleMapResults.find((x) => String(x.id) === v);
                  setBattlePick(m ?? null);
                }}
              />
            </label>
            {battlePick && (
              <div className="battle-selected-strip">
                <span className="battle-selected-label">Selected map</span>
                <p className="battle-selected-body">
                  <strong>{battlePick.title}</strong>
                  <span className="battle-selected-dash"> — </span>
                  {battlePick.artist}
                  <span className="hint battle-selected-set">
                    {" "}
                    · set {battlePick.id}
                    {battlePick.starRange ? ` · ${battlePick.starRange}` : ""}
                  </span>
                </p>
              </div>
            )}
            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={battleRelativePp}
                disabled={uiLocked}
                onChange={(e) => setBattleRelativePp(e.target.checked)}
              />
              <span>Relative PP (vs your baseline)</span>
            </label>
            {battleRelativePp && battlePick && (
              <label className="field">
                <span>Difficulty</span>
                <NeuSelect
                  value={battleDiffValue}
                  disabled={uiLocked}
                  options={battleDiffOptions}
                  onChange={(v) => setBattleDiffValue(v)}
                />
              </label>
            )}
          </div>
          <div className="grid-2">
            <label className="field">
              <span>Time limit</span>
              <NeuSelect
                value={battleDeadlinePreset}
                disabled={uiLocked}
                options={BATTLE_WINDOW_PRESET_OPTIONS}
                onChange={(v) => {
                  setBattleDeadlinePreset(v);
                  if (v !== "custom") setBattleDeadlineCustom("");
                }}
              />
            </label>
            {battleDeadlinePreset === "custom" && (
              <label className="field">
                <span>End date &amp; time</span>
                <input
                  type="datetime-local"
                  value={battleDeadlineCustom}
                  onChange={(e) => setBattleDeadlineCustom(e.target.value)}
                />
              </label>
            )}
          </div>
          <div className="row-actions row-actions--spaced battles-panel__primary-row">
            <button type="button" className="primary" disabled={uiLocked} onClick={() => void createBattle()}>
              Start battle
            </button>
          </div>
        </div>
      </details>

      <section className="battles-panel__section social-list-section" aria-labelledby="battles-active-heading">
        <h3 id="battles-active-heading" className="social-list-section__title">
          Active
        </h3>
        {activeBattles.length > 0 ? (
          <ul className="social-list battles-panel__list">{activeBattles.map((b) => renderBattleCard(b))}</ul>
        ) : (
          <div className="social-card social-empty-card">
            <p className="hint social-empty-card-text">No active battles. Start one above, or wait for a friend to challenge you.</p>
          </div>
        )}
      </section>

      <section className="battles-panel__section social-list-section" aria-labelledby="battles-history-heading">
        <h3 id="battles-history-heading" className="social-list-section__title">
          History
        </h3>
        {historyBattles.length > 0 ? (
          <ul className="social-list battles-panel__list">{historyBattles.map((b) => renderBattleCard(b))}</ul>
        ) : (
          <div className="social-card social-empty-card">
            <p className="hint social-empty-card-text">No past battles yet.</p>
          </div>
        )}
      </section>

      {detailBattleId != null && (
        <div
          className="battles-panel__modal-backdrop"
          role="presentation"
          onClick={() => !uiLocked && setDetailBattleId(null)}
        >
          <div
            className="battles-panel__modal battles-panel__modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="battles-detail-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="battles-detail-modal-title" className="battles-panel__modal-title">
              Battle #{detailBattleId}
            </h4>
            {detailErr && <div className="error-banner">{detailErr}</div>}
            {!detailPayload && !detailErr ? <p className="hint">Loading…</p> : null}
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
                      <ul className="battles-panel__detail-facts">
                        <li>
                          <strong>Window:</strong>{" "}
                          {Number.isFinite(ws) ? new Date(ws).toLocaleString() : "—"} →{" "}
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
              <button type="button" className="primary" onClick={() => setDetailBattleId(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {scoreModal && (
        <div
          className="battles-panel__modal-backdrop"
          role="presentation"
          onClick={() => !uiLocked && setScoreModal(null)}
        >
          <div
            className="battles-panel__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="battles-score-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="battles-score-modal-title" className="battles-panel__modal-title">
              Enter score
            </h4>
            <p className="hint battles-panel__modal-hint">
              {scoreModal.relativePp
                ? "Honor system — manual entries are raw and rank below osu! submits in relative battles."
                : "Honor system — use your best score on this map."}
            </p>
            <label className="field">
              <span>Score</span>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={scoreDraft}
                onChange={(e) => setScoreDraft(e.target.value)}
                placeholder="e.g. 1234567"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmScoreModal();
                }}
              />
            </label>
            <div className="battles-panel__modal-actions">
              <button type="button" className="secondary" disabled={uiLocked} onClick={() => setScoreModal(null)}>
                Cancel
              </button>
              <button type="button" className="primary" disabled={uiLocked} onClick={() => void confirmScoreModal()}>
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ASSIGNED_STAR_MAX_DELTA,
  baselinePpPerStarFromBestScores,
  medianStarsFromBestScores,
} from "./challengeScoring";
import { submitBattleFromOsu as submitBattleFromOsuApi } from "./battleSubmitFromOsu";
import type { NeuSelectOption } from "./NeuSelect";
import { fetchOsuPerformanceRankForUser } from "./osuPlayerRankFetch";
import type { PlayerRankInfo } from "./playerRank";
import { BattleCard } from "./battles/BattleCard";
import type { BattlePlayHint } from "./battles/battlePlayHints";
import { playHintFromBeatmapset } from "./battles/battlePlayHints";
import type { FixedBeatmapDetail } from "./battles/BattleSubmitRequirement";
import { BattleDetailModal } from "./battles/BattleDetailModal";
import { loadAutoSubmitEnabled, saveAutoSubmitEnabled } from "./battles/battleConstants";
import { BattleNewFlow, type BattleRematchSeed } from "./battles/BattleNewFlow";
import { BattleScoreModal } from "./battles/BattleScoreModal";
import { asRecord, sortActiveBattlesByPriority } from "./battles/battleUtils";
import { useBattlePoll } from "./battles/useBattlePoll";
import { ChallengesPanel } from "./ChallengesPanel";

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
  /** Parent Social panel busy (global refresh) */
  refreshBusy: boolean;
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
  refreshBusy,
}: BattlesPanelProps) {
  const [busy, setBusy] = useState(false);
  const [battles, setBattles] = useState<unknown[]>([]);
  const [hydratedTitles, setHydratedTitles] = useState<
    Record<number, { title: string; artist: string; creator?: string }>
  >({});
  const fetchedSetRef = useRef<Set<number>>(new Set());
  const [fixedBeatmapDetailById, setFixedBeatmapDetailById] = useState<
    Map<number, FixedBeatmapDetail | null>
  >(() => new Map());
  const fixedBeatmapInFlightRef = useRef<Set<number>>(new Set());
  const [tick, setTick] = useState(0);
  const [scoreModal, setScoreModal] = useState<{ battleId: number; relativePp: boolean } | null>(null);
  const [scoreDraft, setScoreDraft] = useState("");
  const [rankByOsuId, setRankByOsuId] = useState<Map<number, PlayerRankInfo>>(new Map());
  const [baselinePpByOsuId, setBaselinePpByOsuId] = useState<Map<number, number | null>>(new Map());
  /** Median ★ from top plays — assigned tier for relative PP when no fixed difficulty (submit must be within ±ASSIGNED_STAR_MAX_DELTA). */
  const [medianStarsByOsuId, setMedianStarsByOsuId] = useState<Map<number, number | null>>(new Map());
  /** Relative-PP (non-fixed) battles: osu id → suggested map for that player’s tier. */
  const [tierPlayHintsByBattleId, setTierPlayHintsByBattleId] = useState<
    Map<number, Map<number, BattlePlayHint | null>>
  >(() => new Map());
  const [detailBattleId, setDetailBattleId] = useState<number | null>(null);
  const [detailPayload, setDetailPayload] = useState<{
    battle: Record<string, unknown>;
    scores: unknown[];
  } | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [autoSubmitEnabled, setAutoSubmitEnabled] = useState(() => loadAutoSubmitEnabled());
  const [rematchSeed, setRematchSeed] = useState<BattleRematchSeed | null>(null);
  const consumeRematchSeed = useCallback(() => setRematchSeed(null), []);
  const [challengeRefreshBump, setChallengeRefreshBump] = useState(0);
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

  const challengesRefreshSignal = refreshSignal + challengeRefreshBump;
  const onBattleFlowCreated = useCallback(async () => {
    await refreshBattles();
    setChallengeRefreshBump((n) => n + 1);
  }, [refreshBattles]);

  useEffect(() => {
    void refreshBattles().catch(() => {});
  }, [refreshBattles, refreshSignal]);

  useBattlePoll({
    resolvedSocialApiBaseUrl,
    refreshBattles,
    battles,
    selfOsuId,
  });

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
      await Promise.all(
        ids.map(async (osuId) => {
          try {
            const raw = await invoke<unknown>("osu_user_best_scores", {
              userId: osuId,
              limit: 100,
              mode: "osu",
            });
            if (cancelled) return;
            const base = baselinePpPerStarFromBestScores(raw);
            const med = medianStarsFromBestScores(raw);
            setBaselinePpByOsuId((prev) => {
              const next = new Map(prev);
              next.set(osuId, base);
              return next;
            });
            setMedianStarsByOsuId((prev) => {
              const next = new Map(prev);
              next.set(osuId, med);
              return next;
            });
          } catch {
            if (cancelled) return;
            setBaselinePpByOsuId((prev) => {
              const next = new Map(prev);
              next.set(osuId, null);
              return next;
            });
            setMedianStarsByOsuId((prev) => {
              const next = new Map(prev);
              next.set(osuId, null);
              return next;
            });
          }
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [relativeBaselineKey]);

  useEffect(() => {
    let cancelled = false;
    const bySet = new Map<number, Array<{ battleId: number; osuId: number; stars: number }>>();
    for (const raw of battles) {
      const r = asRecord(raw);
      if (Number(r.relative_pp) !== 1) continue;
      const fbm = r.beatmap_id != null ? Number(r.beatmap_id) : null;
      if (fbm != null && Number.isFinite(fbm)) continue;
      const setId = Number(r.beatmapset_id);
      const battleId = Number(r.id);
      const c = Number(r.creator_osu_id);
      const o = Number(r.opponent_osu_id);
      if (!Number.isFinite(setId) || setId <= 0 || !Number.isFinite(battleId)) continue;
      for (const pid of [c, o]) {
        if (!Number.isFinite(pid)) continue;
        const med = medianStarsByOsuId.get(pid);
        if (med == null || !Number.isFinite(med) || med <= 0) continue;
        if (!bySet.has(setId)) bySet.set(setId, []);
        bySet.get(setId)!.push({ battleId, osuId: pid, stars: med });
      }
    }
    if (bySet.size === 0) {
      setTierPlayHintsByBattleId(new Map());
      return;
    }
    void (async () => {
      const out = new Map<number, Map<number, BattlePlayHint | null>>();
      for (const [setId, jobs] of bySet) {
        if (cancelled) return;
        try {
          const raw = await invoke<unknown>("get_beatmapset", { beatmapsetId: setId });
          if (cancelled) return;
          const root = asRecord(raw);
          const bms = Array.isArray(root.beatmaps) ? root.beatmaps : [];
          for (const job of jobs) {
            const hint = playHintFromBeatmapset(bms, job.stars);
            if (!out.has(job.battleId)) out.set(job.battleId, new Map());
            out.get(job.battleId)!.set(job.osuId, hint);
          }
        } catch {
          for (const job of jobs) {
            if (!out.has(job.battleId)) out.set(job.battleId, new Map());
            out.get(job.battleId)!.set(job.osuId, null);
          }
        }
      }
      if (!cancelled) setTierPlayHintsByBattleId(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [battles, medianStarsByOsuId]);

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
      const disp = r.display as { title?: string; artist?: string; creator?: string } | undefined;
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
          const creator = String(o.creator ?? "").trim();
          if (cancelled) return;
          setHydratedTitles((prev) => ({
            ...prev,
            [sid]: { title, artist, ...(creator ? { creator } : {}) },
          }));
        } catch {
          /* keep placeholder */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [battles, hydratedTitles]);

  useEffect(() => {
    if (!isTauri()) return;
    const jobs: Array<{ setId: number; bmId: number }> = [];
    for (const raw of battles) {
      const r = asRecord(raw);
      if (Number(r.relative_pp) !== 1) continue;
      const bmId = r.beatmap_id != null ? Number(r.beatmap_id) : null;
      const setId = Number(r.beatmapset_id);
      if (bmId == null || !Number.isFinite(bmId) || !Number.isFinite(setId)) continue;
      if (fixedBeatmapDetailById.has(bmId)) continue;
      if (fixedBeatmapInFlightRef.current.has(bmId)) continue;
      fixedBeatmapInFlightRef.current.add(bmId);
      jobs.push({ setId, bmId });
    }
    if (jobs.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const { setId, bmId } of jobs) {
        if (cancelled) {
          fixedBeatmapInFlightRef.current.delete(bmId);
          continue;
        }
        try {
          const raw = await invoke<unknown>("get_beatmapset", { beatmapsetId: setId });
          const root = asRecord(raw);
          const bms = root.beatmaps;
          let detail: FixedBeatmapDetail | null = null;
          if (Array.isArray(bms)) {
            for (const x of bms) {
              const bm = asRecord(x);
              if (Number(bm.id) !== bmId) continue;
              const stars = Number(bm.difficulty_rating);
              detail = {
                version: String(bm.version ?? "Beatmap").trim() || "Beatmap",
                stars: Number.isFinite(stars) ? stars : NaN,
              };
              break;
            }
          }
          if (!cancelled) {
            setFixedBeatmapDetailById((prev) => {
              const next = new Map(prev);
              next.set(bmId, detail);
              return next;
            });
          }
        } catch {
          if (!cancelled) {
            setFixedBeatmapDetailById((prev) => {
              const next = new Map(prev);
              next.set(bmId, null);
              return next;
            });
          }
        } finally {
          fixedBeatmapInFlightRef.current.delete(bmId);
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const j of jobs) {
        fixedBeatmapInFlightRef.current.delete(j.bmId);
      }
    };
  }, [battles, fixedBeatmapDetailById]);

  const mapBeatmapDisplay = useCallback(
    (r: Record<string, unknown>) => {
      const sid = Number(r.beatmapset_id);
      const disp = r.display as { title?: string; artist?: string; creator?: string } | undefined;
      if (disp && (String(disp.title ?? "").trim() || String(disp.artist ?? "").trim())) {
        const title = String(disp.title ?? "").trim() || "—";
        const artist = String(disp.artist ?? "").trim() || "—";
        const mapper = String(disp.creator ?? "").trim() || null;
        return { titleLine: `${artist} — ${title}`, mapper };
      }
      if (Number.isFinite(sid) && hydratedTitles[sid]) {
        const h = hydratedTitles[sid];
        const mapper = h.creator?.trim() ? h.creator.trim() : null;
        return { titleLine: `${h.artist} — ${h.title}`, mapper };
      }
      return { titleLine: `Set #${Number.isFinite(sid) ? sid : "—"}`, mapper: null as string | null };
    },
    [hydratedTitles],
  );

  const mapLineForBattle = useCallback(
    (r: Record<string, unknown>) => {
      const { titleLine, mapper } = mapBeatmapDisplay(r);
      return mapper ? `${titleLine} · mapped by ${mapper}` : titleLine;
    },
    [mapBeatmapDisplay],
  );

  const fighterSubtitle = useCallback(
    (osuId: number, relativePpBattle: boolean, fixedBeatmapId: number | null) => {
      const rank = rankByOsuId.get(osuId);
      const rankBit = rank && !rank.isEmpty ? `${rank.name} (${rank.shortLabel})` : "—";
      const b = baselinePpByOsuId.get(osuId);
      const baseBit =
        relativePpBattle && b != null && Number.isFinite(b) && b > 0
          ? ` · ~${b.toFixed(0)}pp/★ baseline`
          : relativePpBattle
            ? " · baseline —"
            : "";
      const med = medianStarsByOsuId.get(osuId);
      const tierBit =
        relativePpBattle && fixedBeatmapId == null && med != null && Number.isFinite(med) && med > 0
          ? ` · ~${med.toFixed(1)}★ assigned (±${ASSIGNED_STAR_MAX_DELTA}★)`
          : relativePpBattle && fixedBeatmapId != null && Number.isFinite(fixedBeatmapId)
            ? ` · fixed map #${fixedBeatmapId}`
            : "";
      const fighterTitle = relativePpBattle
        ? fixedBeatmapId != null && Number.isFinite(fixedBeatmapId)
          ? "Submit from osu! only counts ranked plays on the fixed beatmap."
          : med != null && Number.isFinite(med) && med > 0
            ? `Assigned ~${med.toFixed(1)}★ from top plays. Submit from osu! only accepts recent plays on this set within ±${ASSIGNED_STAR_MAX_DELTA}★ of that star rating.`
            : "Relative PP vs baseline from top plays."
        : "Performance tier from osu! stats.";
      return (
        <span className="battles-panel__fighter-sub" title={fighterTitle}>
          {rankBit}
          {baseBit}
          {tierBit}
        </span>
      );
    },
    [rankByOsuId, baselinePpByOsuId, medianStarsByOsuId],
  );

  const applyRematch = useCallback(
    (r: Record<string, unknown>) => {
      const creator = Number(r.creator_osu_id);
      const opponent = Number(r.opponent_osu_id);
      const other = selfOsuId === creator ? opponent : creator;
      const friendVal = friendSelectOptions.some((o) => o.value === String(other) && o.value !== "");
      const disp = r.display as { title?: string; artist?: string; creator?: string } | undefined;
      const sid = Number(r.beatmapset_id);
      const rel = Number(r.relative_pp) === 1;
      const fbm = r.beatmap_id != null ? Number(r.beatmap_id) : null;
      const mapper = String(disp?.creator ?? "").trim();
      setRematchSeed({
        opponentFriend: friendVal ? String(other) : "",
        opponentManual: friendVal ? "" : String(other),
        beatmapsetId: sid,
        title: String(disp?.title ?? "").trim() || "—",
        artist: String(disp?.artist ?? "").trim() || "—",
        ...(mapper ? { creator: mapper } : {}),
        relativePp: rel,
        fixedBeatmapId: rel && fbm != null && Number.isFinite(fbm) ? fbm : null,
      });
    },
    [selfOsuId, friendSelectOptions],
  );

  const uiLocked = busy;

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

  const battleCardPlayProps = useCallback(
    (r: Record<string, unknown>) => {
      const id = Number(r.id);
      const fbm = r.beatmap_id != null ? Number(r.beatmap_id) : null;
      const rel = Number(r.relative_pp) === 1;
      const creator = Number(r.creator_osu_id);
      const opponent = Number(r.opponent_osu_id);
      const fixedDetail =
        fbm != null && Number.isFinite(fbm) ? fixedBeatmapDetailById.get(fbm) : undefined;
      const fixedPlayHint: BattlePlayHint | null =
        fbm != null && Number.isFinite(fbm)
          ? {
              beatmapId: fbm,
              version: fixedDetail?.version?.trim() ? fixedDetail.version.trim() : "Beatmap",
              stars: fixedDetail && fixedDetail.stars > 0 ? fixedDetail.stars : NaN,
            }
          : null;
      const th = tierPlayHintsByBattleId.get(id);
      const tierPlayHints =
        rel && !(fbm != null && Number.isFinite(fbm))
          ? {
              creator: Number.isFinite(creator) ? th?.get(creator) ?? null : null,
              opponent: Number.isFinite(opponent) ? th?.get(opponent) ?? null : null,
            }
          : null;
      const viewerPlayHint =
        selfOsuId != null && Number.isFinite(selfOsuId) ? th?.get(selfOsuId) ?? null : null;
      const viewerMedianStars =
        selfOsuId != null && Number.isFinite(selfOsuId) ? medianStarsByOsuId.get(selfOsuId) ?? null : null;
      return { fixedPlayHint, tierPlayHints, viewerPlayHint, viewerMedianStars };
    },
    [fixedBeatmapDetailById, tierPlayHintsByBattleId, selfOsuId, medianStarsByOsuId],
  );

  const { activeBattles, historyBattles, activeBattlesSorted } = useMemo(() => {
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
    return {
      activeBattles: active,
      historyBattles: hist,
      activeBattlesSorted: sortActiveBattlesByPriority(active, selfOsuId),
    };
  }, [battles, selfOsuId]);

  return (
    <div className="social-section battles-panel social-battle-view">
      <div className="social-subview-head battles-panel__head">
        <p className="panel-sub panel-sub--tight battles-panel__lede">
          <strong>1v1 battles</strong> on a ranked set — submit from osu! or type a score. Relative PP is the default;
          open challenges use the same flow (pick <strong>Open challenge</strong> in the form below).
        </p>
        <label
          className="field field--checkbox battles-panel__auto-submit"
          title='Checks about every 4 minutes while you have an open battle and no score yet. Same rules as “Submit from osu!”.'
        >
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
          <span>Auto-submit from osu!</span>
        </label>
      </div>

      <BattleNewFlow
        uiLocked={uiLocked}
        friendSelectOptions={friendSelectOptions}
        selfOsuId={selfOsuId}
        displayNameForOsu={displayNameForOsu}
        onToast={onToast}
        socialPost={socialPost}
        setBusy={setBusy}
        onCreated={onBattleFlowCreated}
        rematchSeed={rematchSeed}
        onRematchConsumed={consumeRematchSeed}
      />

      <section className="battles-panel__section social-list-section battles-panel__list-section--stagger" aria-labelledby="battles-active-heading">
        <h3 id="battles-active-heading" className="social-list-section__title">
          Active
        </h3>
        {activeBattles.length > 0 ? (
          <ul className="social-list battles-panel__list battles-panel__list--active">
            {activeBattlesSorted.map((b) => {
              const r = asRecord(b);
              const id = Number(r.id);
              const mapDisp = mapBeatmapDisplay(r);
              const play = battleCardPlayProps(r);
              return (
                <BattleCard
                  key={id}
                  raw={b}
                  selfOsuId={selfOsuId}
                  tick={tick}
                  uiLocked={uiLocked}
                  mapTitle={mapDisp.titleLine}
                  mapMapper={mapDisp.mapper ?? undefined}
                  displayNameForOsu={displayNameForOsu}
                  fighterSubtitle={fighterSubtitle}
                  fixedPlayHint={play.fixedPlayHint}
                  tierPlayHints={play.tierPlayHints}
                  viewerPlayHint={play.viewerPlayHint}
                  viewerMedianStars={play.viewerMedianStars}
                  onOpenDetails={setDetailBattleId}
                  onRematch={applyRematch}
                  onSubmitFromOsu={submitBattleFromOsu}
                  onOpenScoreModal={openScoreModal}
                  onOpenInOsuError={(msg) => onToast("error", msg)}
                />
              );
            })}
          </ul>
        ) : (
          <div className="social-card social-empty-card">
            <p className="hint social-empty-card-text">
              No active battles. Start one above, or wait for a friend to challenge you.
            </p>
          </div>
        )}
      </section>

      <section className="battles-panel__section social-list-section battles-panel__list-section--stagger" aria-labelledby="battles-history-heading">
        <h3 id="battles-history-heading" className="social-list-section__title">
          History
        </h3>
        {historyBattles.length > 0 ? (
          <ul className="social-list battles-panel__list">
            {historyBattles.map((b) => {
              const r = asRecord(b);
              const id = Number(r.id);
              const mapDisp = mapBeatmapDisplay(r);
              const play = battleCardPlayProps(r);
              return (
                <BattleCard
                  key={id}
                  raw={b}
                  selfOsuId={selfOsuId}
                  tick={tick}
                  uiLocked={uiLocked}
                  mapTitle={mapDisp.titleLine}
                  mapMapper={mapDisp.mapper ?? undefined}
                  displayNameForOsu={displayNameForOsu}
                  fighterSubtitle={fighterSubtitle}
                  fixedPlayHint={play.fixedPlayHint}
                  tierPlayHints={play.tierPlayHints}
                  viewerPlayHint={play.viewerPlayHint}
                  viewerMedianStars={play.viewerMedianStars}
                  onOpenDetails={setDetailBattleId}
                  onRematch={applyRematch}
                  onSubmitFromOsu={submitBattleFromOsu}
                  onOpenScoreModal={openScoreModal}
                  onOpenInOsuError={(msg) => onToast("error", msg)}
                />
              );
            })}
          </ul>
        ) : (
          <div className="social-card social-empty-card">
            <p className="hint social-empty-card-text">No past battles yet.</p>
          </div>
        )}
      </section>

      {detailBattleId != null && (
        <BattleDetailModal
          detailBattleId={detailBattleId}
          uiLocked={uiLocked}
          detailErr={detailErr}
          detailPayload={detailPayload}
          mapLineForBattle={mapLineForBattle}
          displayNameForOsu={displayNameForOsu}
          medianStarsByOsuId={medianStarsByOsuId}
          fixedBeatmapDetailById={fixedBeatmapDetailById}
          viewerOsuId={selfOsuId}
          onOpenInOsuError={(msg) => onToast("error", msg)}
          onClose={() => setDetailBattleId(null)}
        />
      )}

      {scoreModal && (
        <BattleScoreModal
          relativePp={scoreModal.relativePp}
          scoreDraft={scoreDraft}
          uiLocked={uiLocked}
          onScoreDraftChange={setScoreDraft}
          onCancel={() => setScoreModal(null)}
          onConfirm={confirmScoreModal}
        />
      )}

      <ChallengesPanel
        embeddedInBattles
        onToast={onToast}
        socialGet={socialGet}
        socialPost={socialPost}
        meId={meId}
        oauthOsuId={oauthOsuId}
        displayNameForOsu={displayNameForOsu}
        resolvedSocialApiBaseUrl={resolvedSocialApiBaseUrl}
        refreshSignal={challengesRefreshSignal}
        refreshBusy={refreshBusy}
      />
    </div>
  );
}

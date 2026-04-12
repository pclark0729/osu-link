import { invoke, isTauri } from "@tauri-apps/api/core";
import { Award, Dumbbell, LayoutGrid, Lock, Package, RefreshCw, Share2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  AchievementShareCard,
  achievementCardToPngBlob,
  copyAchievementPngToClipboard,
  downloadAchievementPng,
} from "./AchievementShareCard";
import { ACHIEVEMENTS, type AchievementCategory, type AchievementDef, getAchievementDef } from "./achievements/catalog";
import { evaluateAchievements, mergeEarnedMaps, type EvaluateInput } from "./achievements/evaluate";
import { PlayerRankCard } from "./PlayerRankCard";
import { computeOsuPerformanceRank } from "./playerRank";
import { parseUserRulesetPayload, type ParsedRow } from "./SocialLeaderboard";
import { computeTrainingAggregates, loadTrainingHistory } from "./trainHistory";
import { MainPaneSticky } from "./MainPaneSticky";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

type CategoryFilter = "all" | AchievementCategory;

type ProgressCtx = {
  mapsCleared: number;
  peakStars: number | null;
  sessionCount: number;
  friends: number;
  challengesJoined: number;
  battlesDone: number;
  battleWins: number;
  localMaps: number;
  friendRequestsSent: number;
};

function progressHint(def: AchievementDef, ctx: ProgressCtx): string | null {
  const {
    mapsCleared,
    peakStars,
    sessionCount,
    friends,
    challengesJoined,
    battlesDone,
    battleWins,
    localMaps,
    friendRequestsSent,
  } = ctx;

  switch (def.id) {
    case "app-library-10":
      return localMaps < 10 ? `${localMaps} / 10 sets indexed` : null;
    case "app-library-50":
      return localMaps < 50 ? `${localMaps} / 50 sets indexed` : null;
    case "app-library-100":
      return localMaps < 100 ? `${localMaps} / 100 sets indexed` : null;
    case "app-library-250":
      return localMaps < 250 ? `${localMaps} / 250 sets indexed` : null;
    case "train-sessions-5":
      return sessionCount < 5 ? `${sessionCount} / 5 sessions` : null;
    case "train-sessions-25":
      return sessionCount < 25 ? `${sessionCount} / 25 sessions` : null;
    case "train-maps-10":
      return mapsCleared < 10 ? `${Math.min(mapsCleared, 10)} / 10 maps passed` : null;
    case "train-maps-50":
      return mapsCleared < 50 ? `${Math.min(mapsCleared, 50)} / 50 maps passed` : null;
    case "train-maps-100":
      return mapsCleared < 100 ? `${Math.min(mapsCleared, 100)} / 100 maps passed` : null;
    case "train-maps-250":
      return mapsCleared < 250 ? `${Math.min(mapsCleared, 250)} / 250 maps passed` : null;
    case "train-peak-4":
      return peakStars != null && peakStars < 4 ? `Peak ${peakStars.toFixed(1)}★ / 4★` : null;
    case "train-peak-5":
      return peakStars != null && peakStars < 5 ? `Peak ${peakStars.toFixed(1)}★ / 5★` : null;
    case "train-peak-6":
      return peakStars != null && peakStars < 6 ? `Peak ${peakStars.toFixed(1)}★ / 6★` : null;
    case "train-peak-7":
      return peakStars != null && peakStars < 7 ? `Peak ${peakStars.toFixed(1)}★ / 7★` : null;
    case "train-peak-8":
      return peakStars != null && peakStars < 8 ? `Peak ${peakStars.toFixed(1)}★ / 8★` : null;
    case "train-custom-set":
      return "Finish a session with a custom training set";
    case "train-mode-taiko":
      return "Run a Taiko drill session";
    case "train-mode-catch":
      return "Run a Catch drill session";
    case "train-mode-mania":
      return "Run a Mania drill session";
    case "train-oops":
      return "Fail a map in training (below your acc goal)";
    case "train-accuracy-99":
      return "Pass a map at 99%+ accuracy";
    case "social-friend-request":
      return friendRequestsSent < 1 ? "Send a friend request (Social)" : null;
    case "social-first-friend":
      return friends < 1 ? "Accept an osu-link friend" : null;
    case "social-friends-5":
      return friends < 5 ? `${friends} / 5 accepted friends` : null;
    case "social-challenge-join":
      return challengesJoined < 1 ? "Join an open challenge from Social" : null;
    case "social-challenge-join-3":
      return challengesJoined < 3 ? `${challengesJoined} / 3 challenges joined` : null;
    case "social-battle-done":
      return battlesDone < 1 ? "Finish an async battle" : null;
    case "social-battle-win":
      return battleWins < 1 ? "Win an async battle" : null;
    case "social-battle-wins-3":
      return battleWins < 3 ? `${battleWins} / 3 battle wins` : null;
    default:
      return null;
  }
}

export function AchievementsPanel({
  pushToast,
  resolvedSocialApiBaseUrl,
  onboardingCompleted,
}: {
  pushToast: (tone: "info" | "success" | "error", message: string) => void;
  resolvedSocialApiBaseUrl: string | null;
  onboardingCompleted: boolean;
}) {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [earned, setEarned] = useState<Map<string, { earnedAtMs: number }>>(new Map());
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState("Player");
  const [shareTarget, setShareTarget] = useState<{ def: AchievementDef; earnedAtMs: number } | null>(null);
  const shareCardRef = useRef<HTMLDivElement>(null);
  const [osuRank, setOsuRank] = useState(() => computeOsuPerformanceRank([]));

  const [ctx, setCtx] = useState<ProgressCtx>({
    mapsCleared: 0,
    peakStars: null,
    sessionCount: 0,
    friends: 0,
    challengesJoined: 0,
    battlesDone: 0,
    battleWins: 0,
    localMaps: 0,
    friendRequestsSent: 0,
  });

  const socialGet = useCallback(async (path: string) => {
    return invoke<unknown>("social_api_get", { path });
  }, []);

  const socialPost = useCallback(async (path: string, body?: Record<string, unknown>) => {
    return invoke<unknown>("social_api_post", { path, body: body ?? null });
  }, []);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    setBusy(true);
    setSyncErr(null);
    try {
      const training = loadTrainingHistory();
      const agg = computeTrainingAggregates(training);
      let oauthLoggedIn = false;
      let meId: number | null = null;
      try {
        const st = await invoke<{ loggedIn: boolean; username?: string | null; osuId?: number | null }>("auth_status");
        oauthLoggedIn = Boolean(st.loggedIn);
        const id = st.osuId != null ? Number(st.osuId) : null;
        if (id != null && Number.isFinite(id)) meId = id;
        const authName = typeof st.username === "string" ? st.username.trim() : "";
        if (authName) setDisplayName(authName);
      } catch {
        oauthLoggedIn = false;
        meId = null;
      }
      {
        const osuRows: ParsedRow[] = [];
        if (meId != null) {
          const modes = ["osu", "taiko", "fruits", "mania"] as const;
          const statsResults = await Promise.all(
            modes.map((m) =>
              invoke<unknown>("osu_user_ruleset_stats", { userId: meId, mode: m }).catch(() => null),
            ),
          );
          for (let i = 0; i < modes.length; i++) {
            const raw = statsResults[i];
            const pr = raw ? parseUserRulesetPayload(raw, modes[i]) : null;
            if (pr) osuRows.push(pr);
          }
        }
        setOsuRank(computeOsuPerformanceRank(osuRows));
      }

      if (resolvedSocialApiBaseUrl) {
        try {
          const me = asRecord(await socialGet("/api/v1/me"));
          const u = asRecord(me.user);
          const id = Number(u.osu_id);
          if (Number.isFinite(id)) meId = id;
          const name = String(u.username ?? "").trim();
          if (name) setDisplayName(name);
        } catch {
          /* keep oauth meId */
        }
      }

      let localBeatmapsetCount = 0;
      try {
        const ids = await invoke<number[]>("get_local_beatmapset_ids");
        localBeatmapsetCount = Array.isArray(ids) ? ids.length : 0;
      } catch {
        localBeatmapsetCount = 0;
      }

      let acceptedFriends = 0;
      let friendRequestsSent = 0;
      let challengesJoined = 0;
      let battlesDone = 0;
      let battleWins = 0;
      if (resolvedSocialApiBaseUrl) {
        try {
          const fj = asRecord(await socialGet("/api/v1/friends"));
          const friends = Array.isArray(fj.friends) ? fj.friends : [];
          acceptedFriends = friends.filter((x) => String(asRecord(x).status).toLowerCase() === "accepted").length;
          if (meId != null) {
            friendRequestsSent = friends.filter((x) => Number(asRecord(x).requestedBy) === meId).length;
          }
        } catch {
          /* ignore */
        }
        try {
          const cj = asRecord(await socialGet("/api/v1/challenges"));
          const ch = Array.isArray(cj.challenges) ? cj.challenges : [];
          challengesJoined = ch.filter((x) => Boolean(asRecord(x).i_am_in)).length;
        } catch {
          /* ignore */
        }
        try {
          const bj = asRecord(await socialGet("/api/v1/battles"));
          const battles = Array.isArray(bj.battles) ? bj.battles : [];
          for (const raw of battles) {
            const r = asRecord(raw);
            if (String(r.state) !== "closed") continue;
            battlesDone += 1;
            const win = r.winner_osu_id != null ? Number(r.winner_osu_id) : null;
            if (meId != null && win === meId) battleWins += 1;
          }
        } catch {
          /* ignore */
        }
      }

      setCtx({
        mapsCleared: agg.mapsCleared,
        peakStars: agg.peakStars,
        sessionCount: training.sessions.length,
        friends: acceptedFriends,
        challengesJoined,
        battlesDone,
        battleWins,
        localMaps: localBeatmapsetCount,
        friendRequestsSent,
      });

      const input: EvaluateInput = {
        training,
        onboardingCompleted,
        oauthLoggedIn,
        acceptedFriendsCount: acceptedFriends,
        challengesJoinedCount: challengesJoined,
        battlesCompletedCount: battlesDone,
        asyncBattleWinsCount: battleWins,
        localBeatmapsetCount,
        friendRequestsSentCount: friendRequestsSent,
      };
      const localMap = evaluateAchievements(input);

      let serverRows: Array<{ achievementId: string; earnedAtMs: number }> = [];
      if (resolvedSocialApiBaseUrl && meId != null) {
        try {
          const aj = asRecord(await socialGet(`/api/v1/users/${meId}/achievements`));
          const ach = aj.achievements;
          if (Array.isArray(ach)) {
            serverRows = ach.map((row) => {
              const r = asRecord(row);
              return {
                achievementId: String(r.achievementId ?? r.achievement_id ?? ""),
                earnedAtMs: Number(r.earnedAtMs ?? r.earned_at_ms),
              };
            }).filter((x) => x.achievementId && Number.isFinite(x.earnedAtMs));
          }
        } catch {
          /* offline or no social */
        }
      }

      const merged = mergeEarnedMaps(localMap, serverRows);
      setEarned(merged);

      if (resolvedSocialApiBaseUrl && meId != null) {
        const items = [...merged.entries()].map(([achievementId, e]) => ({
          achievementId,
          earnedAtMs: e.earnedAtMs,
        }));
        try {
          await socialPost("/api/v1/achievements/sync", { items });
        } catch (e) {
          setSyncErr(String(e));
        }
      }
    } finally {
      setBusy(false);
    }
  }, [onboardingCompleted, resolvedSocialApiBaseUrl, socialGet, socialPost]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    if (category === "all") return ACHIEVEMENTS;
    return ACHIEVEMENTS.filter((a) => a.category === category);
  }, [category]);

  const unlockedCount = earned.size;
  const totalCount = ACHIEVEMENTS.length;
  const unlockPct = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

  const onShareCopy = async () => {
    const el = shareCardRef.current;
    if (!el) return;
    const ok = await copyAchievementPngToClipboard(el);
    if (ok) pushToast("success", "Image copied to clipboard.");
    else pushToast("error", "Could not copy image. Try Download PNG instead.");
  };

  const onShareDownload = async () => {
    const el = shareCardRef.current;
    if (!el) return;
    const blob = await achievementCardToPngBlob(el);
    if (!blob) {
      pushToast("error", "Could not render image.");
      return;
    }
    downloadAchievementPng(blob, shareTarget?.def.title ?? "achievement");
    pushToast("success", "PNG downloaded.");
  };

  const categoryFilterIcons = {
    all: LayoutGrid,
    app: Package,
    training: Dumbbell,
    social: Users,
  } as const;

  return (
    <div className="panel panel-elevated achievements-panel">
      <MainPaneSticky className="achievements-sticky">
        <header className="achievements-hero">
          <div className="achievements-hero-text">
            <h2 className="achievements-title">Achievements</h2>
            <p className="achievements-tagline">Milestones across your library, drills, and social play.</p>
            {busy || syncErr ? (
              <p className="achievements-meta">
                {busy ? <span className="achievements-meta-busy">Syncing…</span> : null}
                {syncErr ? <span className="achievement-sync-warn">Sync: {syncErr}</span> : null}
              </p>
            ) : null}
          </div>
          <div
            className="achievements-ring"
            style={{ "--ach-pct": unlockPct } as CSSProperties}
            role="img"
            aria-label={`${unlockedCount} of ${totalCount} achievements unlocked, ${unlockPct} percent`}
          >
            <div className="achievements-ring-inner">
              <span className="achievements-ring-pct">{unlockPct}%</span>
              <span className="achievements-ring-count">
                {unlockedCount}/{totalCount}
              </span>
            </div>
          </div>
        </header>

        <section className="achievements-rank-section" aria-label="Performance rank">
          <span className="achievements-section-label">osu! performance</span>
          <PlayerRankCard info={osuRank} />
        </section>

        <div className="achievement-filter-row" role="tablist" aria-label="Category">
          {(["all", "app", "training", "social"] as const).map((c) => {
            const Icon = categoryFilterIcons[c];
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={category === c}
                className={`achievement-filter-btn ${category === c ? "active" : ""}`}
                onClick={() => setCategory(c)}
              >
                <Icon className="achievement-filter-icon" aria-hidden />
                <span>{c === "all" ? "All" : c.charAt(0).toUpperCase() + c.slice(1)}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="secondary small-btn achievement-refresh-btn"
            title="Refresh progress"
            onClick={() => void refresh()}
          >
            <RefreshCw className="achievement-refresh-icon" size={16} aria-hidden />
            Refresh
          </button>
        </div>
      </MainPaneSticky>

      <ul className="achievement-grid">
        {filtered.map((def) => {
          const e = earned.get(def.id);
          const locked = !e;
          const hidden = def.hiddenUntilEarned && locked;
          const title = hidden ? "???" : def.title;
          const desc = hidden ? "Keep playing to discover this badge." : def.description;
          const hint = locked ? progressHint(def, ctx) : null;
          return (
            <li key={def.id}>
              <button
                type="button"
                className={`achievement-tile ${locked ? "achievement-tile--locked" : "achievement-tile--unlocked"} achievement-tile--${def.tier}`}
                data-category={def.category}
                disabled={locked}
                onClick={() => {
                  if (!e) return;
                  const full = getAchievementDef(def.id);
                  if (full) setShareTarget({ def: full, earnedAtMs: e.earnedAtMs });
                }}
              >
                <div className="achievement-tile-top">
                  <div className={`achievement-tile-medal achievement-tile-medal--${def.tier} ${hidden ? "achievement-tile-medal--hidden" : ""}`}>
                    {locked ? <Lock className="achievement-tile-medal-icon" strokeWidth={2} aria-hidden /> : <Award className="achievement-tile-medal-icon" strokeWidth={2} aria-hidden />}
                  </div>
                  <div className="achievement-tile-head">
                    <span className={`achievement-tile-tier achievement-tile-tier--${def.tier}`}>{def.tier}</span>
                    <span className="achievement-tile-cat">{def.category}</span>
                    <span className="achievement-tile-title">{title}</span>
                  </div>
                </div>
                <span className="achievement-tile-desc">{desc}</span>
                {!locked || hint ? (
                  <div className="achievement-tile-footer">
                    {!locked && e ? (
                      <time className="achievement-tile-date" dateTime={new Date(e.earnedAtMs).toISOString()}>
                        {new Date(e.earnedAtMs).toLocaleDateString(undefined, { dateStyle: "medium" })}
                      </time>
                    ) : hint ? (
                      <span className="achievement-tile-hint">{hint}</span>
                    ) : null}
                    {!locked ? (
                      <span className="achievement-tile-share-hint">
                        <Share2 size={14} aria-hidden />
                        Share
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {shareTarget && typeof document !== "undefined"
        ? createPortal(
            <div
              className="modal-overlay achievement-share-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="achievement-share-title"
              onClick={() => setShareTarget(null)}
            >
              <div className="modal-sheet achievement-share-sheet" onClick={(ev) => ev.stopPropagation()}>
                <div className="achievement-share-sheet-head">
                  <h3 id="achievement-share-title">Share achievement</h3>
                  <button type="button" className="toast-dismiss" aria-label="Close" onClick={() => setShareTarget(null)}>
                    ×
                  </button>
                </div>
                <div className="achievement-share-preview-wrap">
                  <AchievementShareCard
                    ref={shareCardRef}
                    achievement={shareTarget.def}
                    earnedAtMs={shareTarget.earnedAtMs}
                    displayName={displayName}
                  />
                </div>
                <div className="row-actions row-actions--spaced">
                  <button type="button" className="primary" onClick={() => void onShareCopy()}>
                    Copy image
                  </button>
                  <button type="button" className="secondary" onClick={() => void onShareDownload()}>
                    Download PNG
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ASSIGNED_STAR_MAX_DELTA,
  baselinePpPerStarFromBestScores,
  isGlobalChallengeRules,
  medianStarsFromBestScores,
  parseChallengeDifficultyMode,
  pickBestChallengePlay,
} from "./challengeScoring";
import type { ChallengeRow, ChallengeScoreRow } from "./challengeTypes";
import { Clock } from "lucide-react";
import { ChallengeStandingsLoadingSkeleton } from "./Skeleton";
import { formatTimeRemaining } from "./timeFormat";
import { useOsuProfileUsernames } from "./useOsuProfileUsernames";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseChallengeRulesDisplay(r: Record<string, unknown>): { artist: string; title: string } | null {
  const raw = r.rules_json;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const d = o.display;
  if (!d || typeof d !== "object") return null;
  const dr = d as Record<string, unknown>;
  const title = String(dr.title ?? "").trim();
  const artist = String(dr.artist ?? "").trim();
  if (!title && !artist) return null;
  return { title: title || "—", artist: artist || "—" };
}

function isUnweightedFlag(v: ChallengeScoreRow["is_unweighted"]): boolean {
  return v === true || v === 1;
}

function challengeDiffSummary(
  fixedDiff: number | null,
  diffMode: ReturnType<typeof parseChallengeDifficultyMode>,
): string {
  if (fixedDiff != null) return `Fixed #${fixedDiff}`;
  if (diffMode === "auto") return "Auto ★";
  return "Any diff";
}

function formatStandingLine(
  row: ChallengeScoreRow,
  displayNameForOsu: (id: number) => string,
): string {
  const uid = Number(row.user_osu_id);
  const sc = Number(row.score);
  const rv = row.rank_value != null ? Number(row.rank_value) : null;
  const ppV = row.pp != null ? Number(row.pp) : null;
  const starsV = row.stars != null ? Number(row.stars) : null;
  const unweighted = isUnweightedFlag(row.is_unweighted);
  if (unweighted) {
    return `${displayNameForOsu(uid)} — ${Number.isFinite(sc) ? sc.toLocaleString() : "—"} (raw)`;
  }
  if (rv != null && Number.isFinite(rv)) {
    const starBit = starsV != null && Number.isFinite(starsV) ? `★${starsV.toFixed(1)} · ` : "";
    const ppBit = ppV != null && Number.isFinite(ppV) ? `${ppV.toFixed(0)}pp · ` : "";
    return `${displayNameForOsu(uid)} — ${starBit}${ppBit}${rv.toFixed(2)}×`;
  }
  return `${displayNameForOsu(uid)} — ${Number.isFinite(sc) ? sc.toLocaleString() : "—"}`;
}

export type ChallengesPanelProps = {
  onToast: (tone: "info" | "success" | "error", message: string) => void;
  socialGet: (path: string) => Promise<unknown>;
  socialPost: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  meId: number | null;
  oauthOsuId: number | null;
  displayNameForOsu: (osuId: number) => string;
  resolvedSocialApiBaseUrl: string | null;
  /** Incremented when parent Social "Refresh" completes */
  refreshSignal: number;
  /** Parent Social panel busy (global refresh) */
  refreshBusy: boolean;
  /** When true, compact heading for use inside Battles (no duplicate hero). */
  embeddedInBattles?: boolean;
};

export function ChallengesPanel({
  onToast,
  socialGet,
  socialPost,
  meId,
  oauthOsuId,
  displayNameForOsu,
  resolvedSocialApiBaseUrl,
  refreshSignal,
  refreshBusy,
  embeddedInBattles = false,
}: ChallengesPanelProps) {
  const [actionBusy, setActionBusy] = useState(false);
  const busy = refreshBusy || actionBusy;

  const [challenges, setChallenges] = useState<ChallengeRow[]>([]);

  const [, pulseCountdown] = useReducer((n: number) => n + 1, 0);

  const [scoreModalChallengeId, setScoreModalChallengeId] = useState<number | null>(null);
  const [scoreDraft, setScoreDraft] = useState("");

  const [detailChallengeId, setDetailChallengeId] = useState<number | null>(null);
  const [detailStandings, setDetailStandings] = useState<ChallengeScoreRow[] | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const challengePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshChallenges = useCallback(async () => {
    const j = asRecord(await socialGet("/api/v1/challenges"));
    const c = j.challenges;
    setChallenges(Array.isArray(c) ? (c as ChallengeRow[]) : []);
  }, [socialGet]);

  useEffect(() => {
    void refreshChallenges().catch(() => {});
  }, [refreshChallenges, refreshSignal]);

  useEffect(() => {
    const id = window.setInterval(() => pulseCountdown(), 1000);
    return () => window.clearInterval(id);
  }, [pulseCountdown]);

  useEffect(() => {
    if (!resolvedSocialApiBaseUrl) {
      if (challengePollRef.current) {
        clearInterval(challengePollRef.current);
        challengePollRef.current = null;
      }
      return;
    }
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      void refreshChallenges().catch(() => {});
    };
    challengePollRef.current = setInterval(poll, 15_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshChallenges().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (challengePollRef.current) clearInterval(challengePollRef.current);
      challengePollRef.current = null;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [resolvedSocialApiBaseUrl, refreshChallenges]);

  useEffect(() => {
    if (detailChallengeId == null) {
      setDetailStandings(null);
      setDetailErr(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailErr(null);
    setDetailStandings(null);
    void (async () => {
      try {
        const j = asRecord(await socialGet(`/api/v1/challenges/${detailChallengeId}/standings`));
        const st = j.standings;
        if (cancelled) return;
        setDetailStandings(Array.isArray(st) ? (st as ChallengeScoreRow[]) : []);
      } catch (e) {
        if (!cancelled) setDetailErr(String(e));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailChallengeId, socialGet]);

  const joinChallenge = async (id: number) => {
    setActionBusy(true);
    try {
      await socialPost(`/api/v1/challenges/${id}/join`, {});
      onToast("success", "Joined challenge.");
      await refreshChallenges();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const submitChallengeFromOsu = async (challenge: ChallengeRow) => {
    if (meId == null) {
      onToast("error", "Sign in with osu! so we can read your recent scores.");
      return;
    }
    const challengeId = challenge.id;
    const beatmapsetId = challenge.beatmapset_id;
    const fixedBeatmapId =
      challenge.beatmap_id != null && Number.isFinite(challenge.beatmap_id) ? challenge.beatmap_id : null;
    const diffMode = parseChallengeDifficultyMode(challenge.rules_json, challenge.beatmap_id);

    const prevRow = challenges.find((c) => c.id === challengeId)?.my_standing ?? null;
    const prevRv =
      prevRow && prevRow.rank_value != null && Number.isFinite(Number(prevRow.rank_value))
        ? Number(prevRow.rank_value)
        : null;

    setActionBusy(true);
    try {
      const bestRaw = await invoke<unknown>("osu_user_best_scores", {
        userId: meId,
        limit: 100,
        mode: "osu",
      });
      const baseline = baselinePpPerStarFromBestScores(bestRaw);
      const preferredStars =
        diffMode === "auto" && fixedBeatmapId == null ? medianStarsFromBestScores(bestRaw) : null;
      const recentRaw = await invoke<unknown>("osu_user_recent_scores", { userId: meId, limit: 100, mode: "osu" });
      const picked = pickBestChallengePlay(recentRaw, beatmapsetId, {
        fixedBeatmapId,
        baselinePpPerStar: baseline,
        preferredStars,
      });
      if (picked == null) {
        if (fixedBeatmapId != null) {
          onToast(
            "error",
            `No recent ranked score on the fixed difficulty (beatmap #${fixedBeatmapId}). Play it in osu! (stable), then try again.`,
          );
        } else if (preferredStars != null) {
          onToast(
            "error",
            `No recent ranked score within ±${ASSIGNED_STAR_MAX_DELTA}★ of your assigned tier (~${preferredStars.toFixed(1)}★). Play a map in that range on this set in osu! (stable), then try again.`,
          );
        } else {
          onToast(
            "error",
            "No recent ranked score on this challenge (need PP on the map). Play in osu! (stable), then try again.",
          );
        }
        return;
      }
      await socialPost(`/api/v1/challenges/${challengeId}/submit`, {
        score: picked.score,
        mods: 0,
        rankValue: picked.rankValue,
        pp: picked.pp,
        stars: picked.stars,
        playBeatmapId: picked.playBeatmapId,
        baselinePpPerStar: picked.baselinePpPerStar,
        isUnweighted: false,
      });
      let msg = `Submitted ${picked.pp.toFixed(0)}pp (${picked.rankValue.toFixed(2)}× vs your baseline) from osu! recent scores.`;
      if (diffMode === "auto" && fixedBeatmapId == null && preferredStars != null) {
        msg += ` Auto: ~${preferredStars.toFixed(1)}★ tier.`;
      }
      if (prevRv != null && picked.rankValue > prevRv) {
        msg += ` (up from ${prevRv.toFixed(2)}×)`;
      } else if (prevRv != null && picked.rankValue < prevRv) {
        msg += ` (previous best ${prevRv.toFixed(2)}×)`;
      }
      onToast("success", msg);
      await refreshChallenges();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const openManualScoreModal = (id: number) => {
    setScoreDraft("");
    setScoreModalChallengeId(id);
  };

  const confirmManualScore = async () => {
    if (scoreModalChallengeId == null) return;
    const score = Number(scoreDraft.replace(/,/g, ""));
    if (!Number.isFinite(score)) {
      onToast("error", "Enter a numeric score.");
      return;
    }
    setActionBusy(true);
    try {
      await socialPost(`/api/v1/challenges/${scoreModalChallengeId}/submit`, { score, mods: 0, isUnweighted: true });
      onToast("success", "Raw score submitted (unweighted).");
      setScoreModalChallengeId(null);
      await refreshChallenges();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const selfOsuId = meId ?? oauthOsuId;

  const detailStandingOsuIds = useMemo(
    () => (detailStandings ?? []).map((r) => r.user_osu_id).filter((n) => Number.isFinite(n)),
    [detailStandings],
  );
  const detailStandingProfileNames = useOsuProfileUsernames(detailStandingOsuIds);

  const displayNameForChallengeStanding = useCallback(
    (osuId: number) => {
      if (selfOsuId != null && osuId === selfOsuId) return "You";
      const fromDetail = detailStandingProfileNames.get(osuId);
      if (fromDetail) return fromDetail;
      return displayNameForOsu(osuId);
    },
    [selfOsuId, detailStandingProfileNames, displayNameForOsu],
  );

  return (
    <div
      className={`social-section social-challenge-section social-challenge-view challenges-panel${
        embeddedInBattles ? " challenges-panel--embedded" : ""
      }`}
    >
      {embeddedInBattles ? (
        <div className="battles-panel__section battles-panel__challenges-intro">
          <h3 id="battles-challenges-heading" className="social-list-section__title">
            Multiplayer challenges
          </h3>
          <p className="panel-sub panel-sub--tight battles-panel__lede challenges-panel__lede-short">
            Open leaderboards on a ranked set — create with <strong>Open challenge</strong> above. Refreshes every ~15s.
          </p>
        </div>
      ) : (
        <header className="challenges-panel__hero">
          <div className="challenges-panel__hero-text">
            <h3 className="challenges-panel__hero-title">Challenges</h3>
            <p className="challenges-panel__hero-desc">
              Relative PP vs your PP/★ curve on a ranked set. Choose <strong>Any</strong> for the best relative play on
              any difficulty, <strong>Auto</strong> to weight difficulties near your median ★ from best scores, or lock a
              single map. Manual scores are unweighted. Updates every ~15s while this tab is visible.
            </p>
          </div>
        </header>
      )}

      <section className="social-list-section social-challenge-list-section challenges-panel__list" aria-labelledby="challenges-open-heading">
        <div className="challenges-panel__list-head">
          <h3 id="challenges-open-heading" className="challenges-panel__list-title">
            Open challenges
          </h3>
          {challenges.length > 0 ? (
            <span className="challenges-panel__list-count">{challenges.length}</span>
          ) : null}
        </div>
        <ul className="social-challenge-card-grid social-challenge-card-grid--calm">
          {challenges.map((c, idx) => {
            const id = c.id;
            const setId = c.beatmapset_id;
            const dl = c.deadline;
            const deadlineLabel = Number.isFinite(dl) ? new Date(dl).toLocaleString() : String(c.deadline ?? "—");
            const disp = parseChallengeRulesDisplay(c as unknown as Record<string, unknown>);
            const titleMain = disp ? disp.title : `Set #${String(c.beatmapset_id ?? "—")}`;
            const artistLine = disp ? disp.artist : null;
            const chBm = c.beatmap_id;
            const fixedDiff = chBm != null && Number.isFinite(chBm) ? chBm : null;
            const diffMode = parseChallengeDifficultyMode(c.rules_json, c.beatmap_id);
            const isGlobal = isGlobalChallengeRules(c.rules_json);
            const iAmIn = Boolean(c.i_am_in);
            const participantCount = c.participant_count;
            const pcLabel = Number.isFinite(participantCount) ? participantCount : 0;
            const standingsTop = Array.isArray(c.standings_top) ? c.standings_top : [];
            const ms = c.my_standing;
            const windowOpen = Number.isFinite(dl) && Date.now() < dl;
            const canSubmit = iAmIn && windowOpen;
            const remaining = Number.isFinite(dl) ? dl - Date.now() : 0;
            const setUrl =
              Number.isFinite(setId) && setId > 0 ? `https://osu.ppy.sh/beatmapsets/${setId}` : null;

            const titleContent = setUrl ? (
              <a className="social-challenge-card__title-link" href={setUrl} target="_blank" rel="noreferrer">
                {titleMain}
              </a>
            ) : (
              <span className="social-challenge-card__title-text">{titleMain}</span>
            );

            const diffSummary = challengeDiffSummary(fixedDiff, diffMode);
            const sublineBits = [
              Number.isFinite(dl) ? `Ends ${deadlineLabel}` : null,
              `${pcLabel} player${pcLabel === 1 ? "" : "s"}`,
              isGlobal ? "Global" : null,
              diffSummary,
            ].filter(Boolean);

            return (
              <li
                key={id}
                className="social-challenge-card social-challenge-card--calm"
                style={{ animationDelay: `${Math.min(idx, 6) * 0.02}s` }}
              >
                <div className="social-challenge-card__accent" aria-hidden />
                <div className="social-challenge-card__head">
                  <div className="social-challenge-card__title-block">
                    {artistLine ? (
                      <span className="social-challenge-card__artist">{artistLine}</span>
                    ) : null}
                    {titleContent}
                  </div>
                  <span className="challenges-pill challenges-pill--time" title={deadlineLabel}>
                    <Clock size={13} strokeWidth={2.25} aria-hidden />
                    {formatTimeRemaining(remaining)}
                  </span>
                </div>
                <p className="social-challenge-card__subline" title={sublineBits.join(" · ")}>
                  <span className="social-challenge-card__subline-inner">{sublineBits.join(" · ")}</span>
                  <span className="social-challenge-card__id-muted">#{id}</span>
                </p>
                {!windowOpen ? (
                  <span className="challenges-pill challenges-pill--ended social-challenge-card__ended-strip">Ended</span>
                ) : null}
                {standingsTop.length > 0 && (
                  <details className="social-challenge-card__preview-details">
                    <summary>Top scores ({standingsTop.length})</summary>
                    <ul className="social-challenge-standings social-challenge-card__standings" aria-label="Top scores">
                      {standingsTop.map((row) => (
                        <li key={Number(row.user_osu_id)}>{formatStandingLine(row, displayNameForChallengeStanding)}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {iAmIn && ms != null && (
                  <p className="social-challenge-card__mine-inline social-challenge-card__mine">
                    <span className="social-challenge-card__mine-label">Your run</span>{" "}
                    {formatStandingLine(ms, displayNameForChallengeStanding)}
                  </p>
                )}
                {iAmIn && ms == null && canSubmit && (
                  <p className="hint social-challenge-card__mine social-challenge-card__mine--empty">
                    No submission yet — play the set in osu!, then submit.
                  </p>
                )}
                <div className="social-challenge-card__actions social-challenge-card__actions--calm">
                  {isGlobal ? (
                    <span className="hint social-challenge-card__everyone-badge">Everyone</span>
                  ) : !iAmIn ? (
                    <button
                      type="button"
                      className="primary small-btn"
                      disabled={busy || !windowOpen}
                      onClick={() => void joinChallenge(id)}
                    >
                      Join
                    </button>
                  ) : (
                    <button type="button" className="secondary small-btn" disabled>
                      Joined
                    </button>
                  )}
                  {canSubmit && meId != null && (
                    <button
                      type="button"
                      className="primary small-btn"
                      disabled={busy}
                      onClick={() => void submitChallengeFromOsu(c)}
                    >
                      Submit from osu!
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary small-btn"
                    disabled={busy}
                    onClick={() => setDetailChallengeId(id)}
                  >
                    Standings
                  </button>
                  {canSubmit && (
                    <button
                      type="button"
                      className="secondary small-btn"
                      disabled={busy}
                      onClick={() => openManualScoreModal(id)}
                    >
                      Manual…
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {challenges.length === 0 && (
          <div className="challenges-panel__empty challenges-panel__empty--minimal" role="status">
            <p className="challenges-panel__empty-title">No open challenges right now</p>
            <p className="challenges-panel__empty-hint">
              Use <strong>Start a battle or challenge</strong> above and pick <strong>Open challenge</strong>.
            </p>
          </div>
        )}
      </section>

      {detailChallengeId != null && (
        <div
          className="battles-panel__modal-backdrop"
          role="presentation"
          onClick={() => !actionBusy && setDetailChallengeId(null)}
        >
          <div
            className="battles-panel__modal battles-panel__modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="challenges-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="challenges-panel__modal-eyebrow">Leaderboard</p>
            <h4 id="challenges-detail-title" className="battles-panel__modal-title">
              Full standings
            </h4>
            {detailLoading ? <ChallengeStandingsLoadingSkeleton /> : null}
            {detailErr && <div className="error-banner">{detailErr}</div>}
            {!detailLoading && detailStandings && detailStandings.length > 0 && (
              <ol className="social-challenge-standings-full">
                {detailStandings.map((row, i) => {
                  const uid = Number(row.user_osu_id);
                  const isSelf = selfOsuId != null && uid === selfOsuId;
                  const podium = i < 3 ? ` social-challenge-standings-full__li--podium-${i + 1}` : "";
                  return (
                    <li
                      key={`${uid}-${i}`}
                      className={`social-challenge-standings-full__li${podium}${isSelf ? " social-challenge-standings-full__li--self" : ""}`}
                    >
                      <span className="social-challenge-standings-full__rank">{i + 1}</span>
                      <span className="social-challenge-standings-full__body">
                        {formatStandingLine(row, displayNameForChallengeStanding)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            {!detailLoading && !detailErr && detailStandings && detailStandings.length === 0 && (
              <p className="hint">No scores yet.</p>
            )}
            <div className="battles-panel__modal-actions">
              <button type="button" className="primary" onClick={() => setDetailChallengeId(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {scoreModalChallengeId != null && (
        <div
          className="battles-panel__modal-backdrop"
          role="presentation"
          onClick={() => !actionBusy && setScoreModalChallengeId(null)}
        >
          <div
            className="battles-panel__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="challenges-score-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="challenges-score-modal-title" className="battles-panel__modal-title">
              Enter score
            </h4>
            <p className="hint battles-panel__modal-hint">
              Honor system — manual entries are unweighted raw score and rank below PP-weighted osu! submits.
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
                  if (e.key === "Enter") void confirmManualScore();
                }}
              />
            </label>
            <div className="battles-panel__modal-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => setScoreModalChallengeId(null)}>
                Cancel
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => void confirmManualScore()}>
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NeuSelect, type NeuSelectOption } from "./NeuSelect";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

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

function scoreTotalFromOsu(s: Record<string, unknown>): number | null {
  const n = Number(s.score);
  return Number.isFinite(n) ? n : null;
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
  const [battleMapResults, setBattleMapResults] = useState<Array<{ id: number; title: string; artist: string }>>([]);
  const [battleMapSearching, setBattleMapSearching] = useState(false);
  const [battlePick, setBattlePick] = useState<{ id: number; title: string; artist: string } | null>(null);
  const [battleMapSelectValue, setBattleMapSelectValue] = useState("");
  const [battleDeadlinePreset, setBattleDeadlinePreset] = useState("");
  const [battleDeadlineCustom, setBattleDeadlineCustom] = useState("");
  const [hydratedTitles, setHydratedTitles] = useState<Record<number, { title: string; artist: string }>>({});
  const fetchedSetRef = useRef<Set<number>>(new Set());
  const [tick, setTick] = useState(0);
  const [scoreModal, setScoreModal] = useState<{ battleId: number } | null>(null);
  const [scoreDraft, setScoreDraft] = useState("");
  const battlePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          const out: Array<{ id: number; title: string; artist: string }> = [];
          for (const x of sets.slice(0, 12)) {
            const r = asRecord(x);
            const id = Number(r.id);
            if (!Number.isFinite(id)) continue;
            out.push({
              id,
              title: String(r.title ?? ""),
              artist: String(r.artist ?? ""),
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

  const battleMapSelectOptions: NeuSelectOption[] = useMemo(() => {
    const hint = battleMapSearching ? "Searching…" : "Search below, then choose a set…";
    const opts: NeuSelectOption[] = [{ value: "", label: hint }];
    for (const m of battleMapResults) {
      opts.push({
        value: String(m.id),
        label: `${m.artist} — ${m.title} (#${m.id})`,
      });
    }
    return opts;
  }, [battleMapResults, battleMapSearching]);

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
      await socialPost("/api/v1/battles", {
        opponentOsuId: opp,
        beatmapsetId: battlePick.id,
        windowEndMs,
        display: { title: battlePick.title, artist: battlePick.artist },
      });
      onToast("success", "Battle created.");
      setBattleMapQuery("");
      setBattleMapResults([]);
      setBattlePick(null);
      setBattleMapSelectValue("");
      setBattleDeadlinePreset("");
      setBattleDeadlineCustom("");
      await refreshBattles();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitBattleFromOsu = async (battleId: number, beatmapsetId: number) => {
    const uid = meId ?? oauthOsuId;
    if (uid == null) {
      onToast("error", "Sign in with osu! so we can read your recent scores.");
      return;
    }
    setBusy(true);
    try {
      const raw = await invoke<unknown>("osu_user_recent_scores", { userId: uid, limit: 100, mode: "osu" });
      const list = Array.isArray(raw) ? raw : [];
      let best: number | null = null;
      for (const item of list) {
        const s = asRecord(item);
        const sid = scoreBeatmapsetId(s);
        if (sid !== beatmapsetId) continue;
        const tot = scoreTotalFromOsu(s);
        if (tot == null) continue;
        if (best == null || tot > best) best = tot;
      }
      if (best == null) {
        onToast(
          "error",
          "No recent osu! score on this beatmap set. Play it in osu! (stable), then use “Submit from osu!” again.",
        );
        return;
      }
      await socialPost(`/api/v1/battles/${battleId}/submit`, { score: best, mods: 0 });
      onToast("success", `Submitted score ${best.toLocaleString()} from your osu! recent scores.`);
      await refreshBattles();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const openScoreModal = (battleId: number) => {
    setScoreDraft("");
    setScoreModal({ battleId });
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
      await socialPost(`/api/v1/battles/${scoreModal.battleId}/submit`, { score, mods: 0 });
      onToast("success", "Score submitted.");
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
            return (
              <li key={uid}>
                {displayNameForOsu(uid)}: {Number.isFinite(sc) ? sc.toLocaleString() : "—"}
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
          <span className="hint battles-panel__versus">
            {displayNameForOsu(creator)} <span className="hint">vs</span> {displayNameForOsu(opponent)}
          </span>
          <span className="hint battles-panel__meta">
            #{id}
            {Number.isFinite(setId) ? ` · set ${setId}` : ""}
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
              onClick={() => void submitBattleFromOsu(id, setId)}
            >
              Submit from osu!
            </button>
            <button type="button" className="secondary small-btn" disabled={uiLocked} onClick={() => openScoreModal(id)}>
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
          1v1 on a ranked set: submit from osu! or enter a score. The server picks a winner when the window ends or both
          players have submitted.
        </p>
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
                  <span className="hint battle-selected-set"> · set {battlePick.id}</span>
                </p>
              </div>
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
            <p className="hint battles-panel__modal-hint">Honor system — use your best score on this map.</p>
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

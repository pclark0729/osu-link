import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { osuRankedStarRangeFromBeatmapset } from "../beatmapSetStarRange";
import { NeuSelect, type NeuSelectOption } from "../NeuSelect";
import { ASSIGNED_STAR_MAX_DELTA } from "../challengeScoring";
import {
  BATTLE_NEW_FLOW_SCROLL_CLASS,
  BATTLE_WINDOW_PRESET_OPTIONS,
  CHALLENGE_DEADLINE_PRESET_OPTIONS,
} from "./battleConstants";
import { asRecord } from "./battleUtils";

export type BattleRematchSeed = {
  opponentFriend: string;
  opponentManual: string;
  beatmapsetId: number;
  title: string;
  artist: string;
  /** Beatmap mapper username when known (e.g. rematch from API display). */
  creator?: string;
  relativePp: boolean;
  fixedBeatmapId: number | null;
};

type BattleMapPickRow = {
  id: number;
  title: string;
  artist: string;
  creator: string;
  starRange: string | null;
};

function formatBattleMapReviewLine(pick: BattleMapPickRow): string {
  const mapper = pick.creator.trim();
  const mid = mapper ? ` · mapped by ${mapper}` : "";
  return `${pick.artist} — ${pick.title}${mid} (#${pick.id})`;
}

type BattleNewFlowProps = {
  uiLocked: boolean;
  friendSelectOptions: NeuSelectOption[];
  selfOsuId: number | null;
  displayNameForOsu: (osuId: number) => string;
  onToast: (tone: "info" | "success" | "error", message: string) => void;
  socialPost: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  onCreated: () => Promise<void>;
  setBusy: (busy: boolean) => void;
  rematchSeed: BattleRematchSeed | null;
  onRematchConsumed: () => void;
};

type FlowKind = "battle" | "challenge";

const BATTLE_STEP_LABELS = ["Opponent", "Map", "Rules", "Time", "Review"] as const;
const CHALLENGE_STEP_LABELS = ["Map", "Rules", "Deadline", "Review"] as const;

export function BattleNewFlow({
  uiLocked,
  friendSelectOptions,
  selfOsuId,
  displayNameForOsu,
  onToast,
  socialPost,
  onCreated,
  setBusy,
  rematchSeed,
  onRematchConsumed,
}: BattleNewFlowProps) {
  const [flowKind, setFlowKind] = useState<FlowKind>("battle");
  const [step, setStep] = useState(0);
  const [battleOpponentFriend, setBattleOpponentFriend] = useState("");
  const [battleOpponentManual, setBattleOpponentManual] = useState("");
  const [battleMapQuery, setBattleMapQuery] = useState("");
  const [battleMapResults, setBattleMapResults] = useState<BattleMapPickRow[]>([]);
  const [battleMapSearching, setBattleMapSearching] = useState(false);
  const [battlePick, setBattlePick] = useState<BattleMapPickRow | null>(null);
  const [battleRelativePp, setBattleRelativePp] = useState(true);
  const [battleDiffOptions, setBattleDiffOptions] = useState<NeuSelectOption[]>([
    { value: "", label: "Any difficulty" },
  ]);
  const [battleDiffValue, setBattleDiffValue] = useState("");
  const [battleDeadlinePreset, setBattleDeadlinePreset] = useState("");
  const [battleDeadlineCustom, setBattleDeadlineCustom] = useState("");
  const [chDeadlinePreset, setChDeadlinePreset] = useState("");
  const [chDeadlineCustom, setChDeadlineCustom] = useState("");
  const [chDiffOptions, setChDiffOptions] = useState<NeuSelectOption[]>([
    { value: "", label: "Any (best relative PP, any diff)" },
    { value: "auto", label: "Auto (map near your ★ profile)" },
  ]);
  const [chDiffValue, setChDiffValue] = useState("");
  const [chGlobal, setChGlobal] = useState(false);
  const pendingRematchBmRef = useRef<number | null>(null);

  const isChallenge = flowKind === "challenge";
  const stepLabels = isChallenge ? CHALLENGE_STEP_LABELS : BATTLE_STEP_LABELS;
  const maxStep = isChallenge ? CHALLENGE_STEP_LABELS.length - 1 : BATTLE_STEP_LABELS.length - 1;

  useEffect(() => {
    if (!rematchSeed) return;
    setBattleOpponentFriend(rematchSeed.opponentFriend);
    setBattleOpponentManual(rematchSeed.opponentManual);
    setBattlePick({
      id: rematchSeed.beatmapsetId,
      title: rematchSeed.title,
      artist: rematchSeed.artist,
      creator: rematchSeed.creator ?? "",
      starRange: null,
    });
    setBattleRelativePp(rematchSeed.relativePp);
    if (rematchSeed.relativePp && rematchSeed.fixedBeatmapId != null && Number.isFinite(rematchSeed.fixedBeatmapId)) {
      pendingRematchBmRef.current = rematchSeed.fixedBeatmapId;
    } else {
      pendingRematchBmRef.current = null;
    }
    setBattleMapQuery("");
    setBattleMapResults([]);
    setFlowKind("battle");
    setStep(3);
    onToast("info", "Rematch — confirm time limit and start battle.");
    onRematchConsumed();
    requestAnimationFrame(() => {
      document.querySelector(`.${BATTLE_NEW_FLOW_SCROLL_CLASS}`)?.scrollIntoView({ behavior: "smooth" });
    });
  }, [rematchSeed, onToast, onRematchConsumed]);

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
          const out: BattleMapPickRow[] = [];
          for (const x of sets.slice(0, 12)) {
            const r = asRecord(x);
            const id = Number(r.id);
            if (!Number.isFinite(id)) continue;
            out.push({
              id,
              title: String(r.title ?? ""),
              artist: String(r.artist ?? ""),
              creator: String(r.creator ?? ""),
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
    if (battleMapQuery.trim().length < 2) return;
    if (!battleMapResults.some((m) => m.id === battlePick.id)) {
      setBattlePick(null);
    }
  }, [battleMapResults, battlePick, battleMapQuery]);

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

  useEffect(() => {
    if (!isChallenge || !battlePick) {
      setChDiffOptions([
        { value: "", label: "Any (best relative PP, any diff)" },
        { value: "auto", label: "Auto (map near your ★ profile)" },
      ]);
      setChDiffValue("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = await invoke<unknown>("get_beatmapset", { beatmapsetId: battlePick.id });
        const root = asRecord(raw);
        const bms = root.beatmaps;
        const opts: NeuSelectOption[] = [
          { value: "", label: "Any (best relative PP, any diff)" },
          { value: "auto", label: "Auto (map near your ★ profile)" },
        ];
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
          setChDiffOptions(opts);
          setChDiffValue("");
        }
      } catch {
        if (!cancelled) {
          setChDiffOptions([
            { value: "", label: "Any (best relative PP, any diff)" },
            { value: "auto", label: "Auto (map near your ★ profile)" },
          ]);
          setChDiffValue("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [battlePick, isChallenge]);

  const opponentOsuId = useMemo(() => {
    if (battleOpponentFriend !== "") return Number(battleOpponentFriend);
    return Number(battleOpponentManual.trim());
  }, [battleOpponentFriend, battleOpponentManual]);

  const validateStep = useCallback(
    (s: number): boolean => {
      if (!isChallenge) {
        if (s === 0) {
          if (!Number.isFinite(opponentOsuId)) {
            onToast("error", "Choose an opponent or enter a valid osu! user id.");
            return false;
          }
          if (selfOsuId != null && opponentOsuId === selfOsuId) {
            onToast("error", "You cannot battle yourself.");
            return false;
          }
          return true;
        }
        if (s === 1 || s === 2) {
          if (!battlePick) {
            onToast("error", "Search and select a beatmap set.");
            return false;
          }
          return true;
        }
        if (s === 3) {
          let windowEndMs: number | null = null;
          if (battleDeadlinePreset === "custom") {
            if (!battleDeadlineCustom.trim()) {
              onToast("error", "Pick an end date and time for the battle window.");
              return false;
            }
            const ms = new Date(battleDeadlineCustom).getTime();
            windowEndMs = Number.isFinite(ms) ? ms : null;
          } else if (battleDeadlinePreset) {
            const offset = Number(battleDeadlinePreset);
            windowEndMs = Number.isFinite(offset) ? Date.now() + offset : null;
          }
          if (windowEndMs == null || !Number.isFinite(windowEndMs) || windowEndMs <= Date.now()) {
            onToast("error", "Choose a valid time limit (end must be in the future).");
            return false;
          }
          return true;
        }
        return true;
      }
      if (s === 0 || s === 1) {
        if (!battlePick) {
          onToast("error", "Search and select a beatmap set.");
          return false;
        }
        return true;
      }
      if (s === 2) {
        let deadlineMs: number | null = null;
        if (chDeadlinePreset === "custom") {
          if (!chDeadlineCustom.trim()) {
            onToast("error", "Pick a date and time for the deadline.");
            return false;
          }
          const ms = new Date(chDeadlineCustom).getTime();
          deadlineMs = Number.isFinite(ms) ? ms : null;
        } else if (chDeadlinePreset) {
          const offset = Number(chDeadlinePreset);
          deadlineMs = Number.isFinite(offset) ? Date.now() + offset : null;
        }
        if (deadlineMs == null || !Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) {
          onToast("error", "Choose a valid deadline in the future.");
          return false;
        }
        return true;
      }
      return true;
    },
    [
      isChallenge,
      opponentOsuId,
      selfOsuId,
      battlePick,
      battleDeadlinePreset,
      battleDeadlineCustom,
      chDeadlinePreset,
      chDeadlineCustom,
      onToast,
    ],
  );

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep((x) => Math.min(x + 1, maxStep));
  };

  const goBack = () => setStep((x) => Math.max(x - 1, 0));

  const createBattle = async () => {
    if (!battlePick || !Number.isFinite(opponentOsuId)) {
      onToast("error", "Choose an opponent and a beatmap set.");
      return;
    }
    let windowEndMs: number | null = null;
    if (battleDeadlinePreset === "custom") {
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
      const display: Record<string, string> = {
        title: battlePick.title,
        artist: battlePick.artist,
      };
      if (battlePick.creator.trim()) display.creator = battlePick.creator.trim();
      const body: Record<string, unknown> = {
        opponentOsuId: opponentOsuId,
        beatmapsetId: battlePick.id,
        windowEndMs,
        display,
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
      setBattleRelativePp(true);
      setBattleDiffValue("");
      setBattleDeadlinePreset("");
      setBattleDeadlineCustom("");
      setStep(0);
      await onCreated();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const createChallengeFlow = async () => {
    if (!battlePick) {
      onToast("error", "Choose a beatmap set.");
      return;
    }
    let deadlineMs: number | null = null;
    if (chDeadlinePreset === "custom") {
      const ms = new Date(chDeadlineCustom).getTime();
      deadlineMs = Number.isFinite(ms) ? ms : null;
    } else if (chDeadlinePreset) {
      const offset = Number(chDeadlinePreset);
      deadlineMs = Number.isFinite(offset) ? Date.now() + offset : null;
    }
    if (deadlineMs == null || !Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) {
      onToast("error", "Choose a valid deadline in the future.");
      return;
    }
    setBusy(true);
    try {
      const chDisplay: Record<string, string> = {
        title: battlePick.title,
        artist: battlePick.artist,
      };
      if (battlePick.creator.trim()) chDisplay.creator = battlePick.creator.trim();
      const rulesJson: Record<string, unknown> = {
        display: chDisplay,
      };
      if (chGlobal) rulesJson.global = true;
      const body: Record<string, unknown> = {
        beatmapsetId: battlePick.id,
        deadlineMs,
        rulesJson,
      };
      if (chDiffValue === "auto") {
        rulesJson.difficultyMode = "auto";
      } else if (!chDiffValue.trim()) {
        rulesJson.difficultyMode = "any";
      } else {
        const bid = Number(chDiffValue);
        if (Number.isFinite(bid)) {
          body.beatmapId = bid;
          rulesJson.difficultyMode = "fixed";
        }
      }
      await socialPost("/api/v1/challenges", body);
      onToast("success", "Challenge published.");
      setBattleMapQuery("");
      setBattleMapResults([]);
      setBattlePick(null);
      setChDiffValue("");
      setChGlobal(false);
      setChDeadlinePreset("");
      setChDeadlineCustom("");
      setStep(0);
      await onCreated();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const deadlineSummary = useMemo(() => {
    if (battleDeadlinePreset === "custom" && battleDeadlineCustom.trim()) {
      try {
        return new Date(battleDeadlineCustom).toLocaleString();
      } catch {
        return battleDeadlineCustom;
      }
    }
    const opt = BATTLE_WINDOW_PRESET_OPTIONS.find((o) => o.value === battleDeadlinePreset);
    return opt?.label ?? "—";
  }, [battleDeadlinePreset, battleDeadlineCustom]);

  const challengeDeadlineSummary = useMemo(() => {
    if (chDeadlinePreset === "custom" && chDeadlineCustom.trim()) {
      try {
        return new Date(chDeadlineCustom).toLocaleString();
      } catch {
        return chDeadlineCustom;
      }
    }
    const opt = CHALLENGE_DEADLINE_PRESET_OPTIONS.find((o) => o.value === chDeadlinePreset);
    return opt?.label ?? "—";
  }, [chDeadlinePreset, chDeadlineCustom]);

  const setKind = (k: FlowKind) => {
    setFlowKind(k);
    setStep(0);
  };

  return (
    <details className={`social-compose-details ${BATTLE_NEW_FLOW_SCROLL_CLASS}`} open>
      <summary className="social-compose-details__summary">Start a battle or challenge</summary>
      <div className="social-compose-shell battles-panel__form">
        <div className="battle-flow__kind" role="group" aria-label="Create a 1v1 battle or an open challenge">
          <button
            type="button"
            className={`battle-flow__kind-btn${!isChallenge ? " battle-flow__kind-btn--on" : ""}`}
            disabled={uiLocked}
            onClick={() => setKind("battle")}
          >
            1v1 battle
          </button>
          <button
            type="button"
            className={`battle-flow__kind-btn${isChallenge ? " battle-flow__kind-btn--on" : ""}`}
            disabled={uiLocked}
            onClick={() => setKind("challenge")}
          >
            Open challenge
          </button>
        </div>
        <p className="hint battle-flow__kind-hint">
          {isChallenge
            ? "Leaderboard on a ranked set — players join (or use Global so everyone can submit). Relative PP scoring."
            : "Challenge one friend on a set — winner when the window ends or both submit."}
        </p>

        <nav className="battle-flow__steps" aria-label="Setup steps">
          {stepLabels.map((label, i) => (
            <button
              key={`${flowKind}-${label}`}
              type="button"
              className={`battle-flow__step${i === step ? " battle-flow__step--current" : ""}${
                i < step ? " battle-flow__step--done" : ""
              }`}
              disabled={uiLocked || i > step}
              onClick={() => {
                if (i < step) setStep(i);
              }}
            >
              <span className="battle-flow__step-num">{i + 1}</span>
              <span className="battle-flow__step-label">{label}</span>
            </button>
          ))}
        </nav>

        <div className="battle-flow__panel">
          {!isChallenge && step === 0 && (
            <div className="battle-flow__step-body">
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
            </div>
          )}

          {((isChallenge && step === 0) || (!isChallenge && step === 1)) && (
            <div className="battle-flow__step-body battle-flow__step-body--map">
              <div className="battle-map-panel">
                <p className="battle-map-panel-lead">
                  Ranked sets only — results appear as you type; tap a row to select.
                </p>
                <label className="field battle-map-search-field">
                  <span>Search</span>
                  <input
                    type="search"
                    value={battleMapQuery}
                    onChange={(e) => setBattleMapQuery(e.target.value)}
                    placeholder="Artist or title…"
                    autoComplete="off"
                  />
                </label>
                {battleMapQuery.trim().length > 0 && battleMapQuery.trim().length < 2 ? (
                  <p className="battle-map-helper">Enter at least two characters.</p>
                ) : null}
                {battleMapQuery.trim().length >= 2 && (
                  <div className="battle-map-results">
                    <div className="battle-map-results-head">
                      <span className="battle-map-results-label" aria-live="polite">
                        {battleMapSearching ? "Searching…" : "Results"}
                      </span>
                      {!battleMapSearching && battleMapResults.length > 0 ? (
                        <span className="battle-map-results-count">{battleMapResults.length}</span>
                      ) : null}
                    </div>
                    {!battleMapSearching && battleMapResults.length === 0 ? (
                      <p className="battle-map-results-state">No sets matched — try different words.</p>
                    ) : (
                      <div
                        className="battle-map-pick-list"
                        role="listbox"
                        aria-label={battleMapSearching ? "Loading beatmap results" : "Beatmap search results"}
                        aria-busy={battleMapSearching}
                      >
                        {battleMapResults.map((m) => {
                          const selected = battlePick?.id === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              disabled={uiLocked}
                              className={`battle-map-pick-option${selected ? " is-selected" : ""}`}
                              onClick={() => setBattlePick(m)}
                            >
                              <span className="battle-map-pick-text">
                                <span className="battle-map-pick-title">{m.title}</span>
                                <span className="battle-map-pick-artist">{m.artist}</span>
                                {m.creator.trim() ? (
                                  <span className="battle-map-pick-mapper">mapped by {m.creator}</span>
                                ) : null}
                              </span>
                              <span className="battle-map-pick-aside">
                                <span className="battle-map-pick-id">#{m.id}</span>
                                {m.starRange ? (
                                  <span className="battle-map-pick-stars">{m.starRange}</span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {battlePick && (
                  <div className="battle-selected-strip">
                    <span className="battle-selected-label">Selected</span>
                    <p className="battle-selected-body">
                      <strong>{battlePick.title}</strong>
                      <span className="battle-selected-dash"> — </span>
                      {battlePick.artist}
                      {battlePick.creator.trim() ? (
                        <span className="battle-selected-mapper"> · mapped by {battlePick.creator}</span>
                      ) : null}
                      <span className="hint battle-selected-set">
                        {" "}
                        · set {battlePick.id}
                        {battlePick.starRange ? ` · ${battlePick.starRange}` : ""}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {((isChallenge && step === 1) || (!isChallenge && step === 2)) && (
            <div className="battle-flow__step-body">
              {!isChallenge ? (
                <>
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
                  {battleRelativePp && battlePick && !battleDiffValue.trim() ? (
                    <p className="hint battle-flow__tier-hint">
                      Any difficulty: each player gets an <strong>assigned ~★</strong> from their osu! top plays (shown on
                      the battle card). “Submit from osu!” <strong>only</strong> accepts recent ranked scores on this set
                      within <strong>±{ASSIGNED_STAR_MAX_DELTA}★</strong> of that assignment.
                    </p>
                  ) : null}
                  {!battlePick && <p className="hint">Go back to the Map step to select a beatmap set.</p>}
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Difficulty</span>
                    <NeuSelect
                      value={chDiffValue}
                      disabled={uiLocked}
                      options={chDiffOptions}
                      onChange={(v) => setChDiffValue(v)}
                    />
                  </label>
                  <label className="field field--checkbox battle-flow__global-chk">
                    <input
                      type="checkbox"
                      checked={chGlobal}
                      disabled={uiLocked}
                      onChange={(e) => setChGlobal(e.target.checked)}
                    />
                    <span>Global — everyone can submit without joining first</span>
                  </label>
                  <p className="hint battle-flow__tier-hint">
                    Relative PP vs each player’s curve. <strong>Any</strong> picks the best qualifying play on the set;{" "}
                    <strong>Auto</strong> prefers difficulties near your median ★ from top plays.
                  </p>
                  {!battlePick && <p className="hint">Go back to the Map step to select a beatmap set.</p>}
                </>
              )}
            </div>
          )}

          {((isChallenge && step === 2) || (!isChallenge && step === 3)) && (
            <div className="battle-flow__step-body">
              <div className="grid-2">
                <label className="field">
                  <span>{isChallenge ? "Deadline" : "Time limit"}</span>
                  <NeuSelect
                    value={isChallenge ? chDeadlinePreset : battleDeadlinePreset}
                    disabled={uiLocked}
                    options={isChallenge ? CHALLENGE_DEADLINE_PRESET_OPTIONS : BATTLE_WINDOW_PRESET_OPTIONS}
                    onChange={(v) => {
                      if (isChallenge) {
                        setChDeadlinePreset(v);
                        if (v !== "custom") setChDeadlineCustom("");
                      } else {
                        setBattleDeadlinePreset(v);
                        if (v !== "custom") setBattleDeadlineCustom("");
                      }
                    }}
                  />
                </label>
                {((isChallenge && chDeadlinePreset === "custom") || (!isChallenge && battleDeadlinePreset === "custom")) && (
                  <label className="field">
                    <span>{isChallenge ? "Date & time" : "End date & time"}</span>
                    <input
                      type="datetime-local"
                      value={isChallenge ? chDeadlineCustom : battleDeadlineCustom}
                      onChange={(e) =>
                        isChallenge ? setChDeadlineCustom(e.target.value) : setBattleDeadlineCustom(e.target.value)
                      }
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {((isChallenge && step === 3) || (!isChallenge && step === 4)) && (
            <div className="battle-flow__step-body battle-flow__review">
              {!isChallenge ? (
                <ul className="battle-flow__review-list">
                  <li>
                    <strong>Opponent</strong>
                    <span>
                      {Number.isFinite(opponentOsuId)
                        ? `${displayNameForOsu(opponentOsuId)} (#${opponentOsuId})`
                        : "—"}
                    </span>
                  </li>
                  <li>
                    <strong>Map</strong>
                    <span>{battlePick ? formatBattleMapReviewLine(battlePick) : "—"}</span>
                  </li>
                  <li>
                    <strong>Mode</strong>
                    <span>{battleRelativePp ? "Relative PP" : "Raw score"}</span>
                  </li>
                  {battleRelativePp && battleDiffValue ? (
                    <li>
                      <strong>Fixed difficulty</strong>
                      <span>
                        {battleDiffOptions.find((o) => o.value === battleDiffValue)?.label ?? battleDiffValue}
                      </span>
                    </li>
                  ) : battleRelativePp && battlePick ? (
                    <li>
                      <strong>Difficulty</strong>
                      <span>
                        Any — submit must be within ±{ASSIGNED_STAR_MAX_DELTA}★ of each player’s assigned tier (from top
                        plays)
                      </span>
                    </li>
                  ) : null}
                  <li>
                    <strong>Ends</strong>
                    <span>{deadlineSummary}</span>
                  </li>
                </ul>
              ) : (
                <ul className="battle-flow__review-list">
                  <li>
                    <strong>Map</strong>
                    <span>{battlePick ? formatBattleMapReviewLine(battlePick) : "—"}</span>
                  </li>
                  <li>
                    <strong>Difficulty</strong>
                    <span>
                      {chDiffValue === "auto"
                        ? "Auto (near your ★ profile)"
                        : !chDiffValue.trim()
                          ? "Any difficulty"
                          : (chDiffOptions.find((o) => o.value === chDiffValue)?.label ?? chDiffValue)}
                    </span>
                  </li>
                  <li>
                    <strong>Global</strong>
                    <span>{chGlobal ? "Yes — open to all players" : "No — join required"}</span>
                  </li>
                  <li>
                    <strong>Ends</strong>
                    <span>{challengeDeadlineSummary}</span>
                  </li>
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="battle-flow__nav row-actions row-actions--spaced battles-panel__primary-row">
          {step > 0 ? (
            <button type="button" className="secondary" disabled={uiLocked} onClick={goBack}>
              Back
            </button>
          ) : (
            <span />
          )}
          {step < maxStep ? (
            <button type="button" className="primary" disabled={uiLocked} onClick={goNext}>
              Next
            </button>
          ) : isChallenge ? (
            <button type="button" className="primary" disabled={uiLocked} onClick={() => void createChallengeFlow()}>
              Publish challenge
            </button>
          ) : (
            <button type="button" className="primary" disabled={uiLocked} onClick={() => void createBattle()}>
              Start battle
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MutableRefObject } from "react";
import { buildSharedTrainingPayload, parseImportedTrainingSetJson, serializeSharedTrainingSet } from "./trainingShare";
import { computeTrainingBaseline } from "./trainBaseline";
import { appendMapOutcome, appendSessionSummary } from "./trainHistory";
import { detectSlotProgress } from "./trainProgress";
import {
  applyDifficultyFeelToBand,
  buildAutoQueueChunk,
  buildQueueFromCustomItems,
  nextStarBand,
  softenStarBand,
} from "./trainQueue";
import { MODE_API, SEARCH_MODE_OPTIONS, type Mode } from "./searchTypes";
import { NeuSelect, type NeuSelectOption } from "./NeuSelect";
import {
  loadTrainSession,
  newSessionId,
  saveTrainSession,
  type TrainDifficultyFeel,
  type TrainQueueItem,
  type TrainSessionStateV1,
} from "./trainSession";
import {
  addTrainingSet,
  loadTrainingSets,
  removeTrainingSet,
  saveTrainingSets,
  type SavedTrainingSet,
} from "./trainSetsStorage";
import { ArrowDown, ArrowUp, Pause, Play, Shuffle, Square } from "lucide-react";
import { notifyDesktop } from "./desktopNotify";

type ToastTone = "info" | "success" | "error";

const POLL_MS = 22000;
const DEFAULT_ACC = 90;
const QUEUE_CHUNK = 8;
const EXTEND_THRESHOLD = 3;

function bandAfterFeel(
  starMin: number,
  starMax: number,
  feel: TrainDifficultyFeel | null | undefined,
): { starMin: number; starMax: number } {
  if (feel == null) return { starMin, starMax };
  return applyDifficultyFeelToBand(starMin, starMax, feel);
}

function bumpHistoryEvent(): void {
  window.dispatchEvent(new CustomEvent("osu-link-training-history"));
}

function slugifyFilename(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "training-set";
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const MODE_OPTIONS_UI: NeuSelectOption[] = [...SEARCH_MODE_OPTIONS];

export function TrainPanel({
  pushToast,
  meOsuId,
  localBeatmapsetIds,
  onInspectBeatmapset,
  trainHotkeyOpenRef,
  trainHotkeyRandomizeRef,
  trainHotkeyEndRef,
}: {
  pushToast: (tone: ToastTone, message: string) => void;
  meOsuId: number | null;
  localBeatmapsetIds: Set<number>;
  onInspectBeatmapset?: (beatmapsetId: number) => void;
  trainHotkeyOpenRef: MutableRefObject<() => void>;
  trainHotkeyRandomizeRef: MutableRefObject<() => void>;
  trainHotkeyEndRef: MutableRefObject<() => void>;
}) {
  const [session, setSession] = useState<TrainSessionStateV1 | null>(() => loadTrainSession());
  const [savedSets, setSavedSets] = useState<SavedTrainingSet[]>(() => loadTrainingSets());
  const [busy, setBusy] = useState(false);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const [accDraft, setAccDraft] = useState(String(DEFAULT_ACC));
  const [modeDraft, setModeDraft] = useState<Mode>("osu");
  const [newSetName, setNewSetName] = useState("");
  const [pickQuery, setPickQuery] = useState("");
  const [pickBusy, setPickBusy] = useState(false);
  const [pickResults, setPickResults] = useState<unknown[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const importTrainRef = useRef<HTMLInputElement>(null);
  const failCountedIdx = useRef<number | null>(null);
  const mapsPassedRef = useRef(0);
  const mapsFailedRef = useRef(0);
  const sessionPeakRef = useRef(0);
  const handlingPassRef = useRef(false);
  const extendGuardRef = useRef<number | null>(null);

  useEffect(() => {
    saveTrainSession(session);
  }, [session]);

  const persistSavedSets = useCallback((next: SavedTrainingSet[]) => {
    setSavedSets(next);
    saveTrainingSets(next);
  }, []);

  const endSession = useCallback(
    (s: TrainSessionStateV1, reason: "user" | "complete") => {
      const ended = Date.now();
      appendSessionSummary({
        sessionId: s.sessionId,
        startedAtMs: s.startedAtMs,
        endedAtMs: ended,
        mode: s.mode,
        source: s.source,
        trainingSetName: s.trainingSetName,
        mapsPassed: mapsPassedRef.current,
        mapsFailed: mapsFailedRef.current,
        peakStars: sessionPeakRef.current,
        accSum: 0,
        accCount: mapsPassedRef.current,
      });
      bumpHistoryEvent();
      saveTrainSession(null);
      setSession(null);
      failCountedIdx.current = null;
      mapsPassedRef.current = 0;
      mapsFailedRef.current = 0;
      sessionPeakRef.current = 0;
      pushToast("success", reason === "complete" ? "Training queue finished." : "Session ended.");
    },
    [pushToast],
  );

  const openOsuBeatmap = useCallback(async (beatmapId: number) => {
    if (!isTauri()) return;
    try {
      await invoke("open_osu_beatmap", { beatmapId });
    } catch (e) {
      pushToast("error", String(e));
    }
  }, [pushToast]);

  const startAuto = useCallback(async () => {
    if (meOsuId == null) {
      pushToast("error", "Sign in with osu! first.");
      return;
    }
    const acc = Number(accDraft);
    const threshold = Number.isFinite(acc) ? Math.min(100, Math.max(70, acc)) : DEFAULT_ACC;
    setBusy(true);
    try {
      const [recentRaw, bestRaw] = await Promise.all([
        invoke<unknown>("osu_user_recent_scores", { userId: meOsuId, limit: 100, mode: modeDraft }),
        invoke<unknown>("osu_user_best_scores", { userId: meOsuId, limit: 100, mode: modeDraft }),
      ]);
      const baseline = computeTrainingBaseline(recentRaw, bestRaw, modeDraft);
      const exclude = new Set<number>();
      const chunk = await buildAutoQueueChunk(modeDraft, baseline.starMin, baseline.starMax, exclude, QUEUE_CHUNK);
      if (chunk.length === 0) {
        pushToast("error", "Could not build a queue — try a different mode or widen filters later.");
        return;
      }
      chunk.forEach((c) => exclude.add(c.beatmapsetId));
      const sid = newSessionId();
      const now = Date.now();
      const s: TrainSessionStateV1 = {
        v: 1,
        sessionId: sid,
        startedAtMs: now,
        mode: modeDraft,
        source: "auto",
        trainingSetName: null,
        accThreshold: threshold,
        queue: chunk,
        currentIndex: 0,
        paused: false,
        slotStartedAtMs: now,
        starMin: baseline.starMin,
        starMax: baseline.starMax,
        rampStep: 0.2,
        usedBeatmapsetIds: [...exclude],
      };
      mapsPassedRef.current = 0;
      mapsFailedRef.current = 0;
      sessionPeakRef.current = 0;
      failCountedIdx.current = null;
      setSession(s);
      pushToast("info", baseline.fallbackFromBestProfile ? "Baseline from profile — sparse recent plays." : "Training started.");
      void openOsuBeatmap(chunk[0].beatmapId);
    } catch (e) {
      pushToast("error", String(e));
    } finally {
      setBusy(false);
    }
  }, [meOsuId, accDraft, modeDraft, pushToast, openOsuBeatmap]);

  const startCustom = useCallback(
    async (set: SavedTrainingSet) => {
      if (set.items.length === 0) {
        pushToast("error", "This training set has no maps.");
        return;
      }
      setBusy(true);
      try {
        const queue = await buildQueueFromCustomItems(set.items, set.mode);
        if (queue.length === 0) {
          pushToast("error", "Could not resolve beatmaps for this set.");
          return;
        }
        const sid = newSessionId();
        const now = Date.now();
        const s: TrainSessionStateV1 = {
          v: 1,
          sessionId: sid,
          startedAtMs: now,
          mode: set.mode,
          source: "custom",
          trainingSetName: set.name,
          accThreshold: set.accThreshold,
          queue,
          currentIndex: 0,
          paused: false,
          slotStartedAtMs: now,
          starMin: queue[0]?.stars ?? 1,
          starMax: queue[queue.length - 1]?.stars ?? 5,
          rampStep: 0.2,
          usedBeatmapsetIds: queue.map((q) => q.beatmapsetId),
          customItems: set.items,
        };
        mapsPassedRef.current = 0;
        mapsFailedRef.current = 0;
        sessionPeakRef.current = 0;
        failCountedIdx.current = null;
        setAccDraft(String(set.accThreshold));
        setSession(s);
        pushToast("success", `Started “${set.name}”.`);
        void openOsuBeatmap(queue[0].beatmapId);
      } catch (e) {
        pushToast("error", String(e));
      } finally {
        setBusy(false);
      }
    },
    [pushToast, openOsuBeatmap],
  );

  const advanceAfterPass = useCallback(
    async (s: TrainSessionStateV1, passAcc: number, current: TrainQueueItem) => {
      if (handlingPassRef.current) return;
      handlingPassRef.current = true;
      try {
        appendMapOutcome({
          beatmapId: current.beatmapId,
          beatmapsetId: current.beatmapsetId,
          stars: current.stars,
          accuracy: passAcc,
          passed: true,
          accThreshold: s.accThreshold,
          atMs: Date.now(),
          label: `${current.artist} — ${current.title}`,
        });
        bumpHistoryEvent();
        mapsPassedRef.current += 1;
        sessionPeakRef.current = Math.max(sessionPeakRef.current, current.stars);

        const nextIdx = s.currentIndex + 1;
        if (nextIdx >= s.queue.length) {
          if (s.source === "auto") {
            const exclude = new Set(s.usedBeatmapsetIds);
            const band = nextStarBand(s.starMin, s.starMax, passAcc, s.accThreshold);
            const felt = bandAfterFeel(band.starMin, band.starMax, s.difficultyFeel);
            const more = await buildAutoQueueChunk(s.mode, felt.starMin, felt.starMax, exclude, QUEUE_CHUNK);
            more.forEach((m) => exclude.add(m.beatmapsetId));
            if (more.length === 0) {
              endSession(s, "complete");
              return;
            }
            const now = Date.now();
            const first = more[0];
            setSession({
              ...s,
              queue: [...s.queue, ...more],
              currentIndex: nextIdx,
              slotStartedAtMs: now,
              starMin: felt.starMin,
              starMax: felt.starMax,
              rampStep: band.rampStep,
              difficultyFeel: null,
              usedBeatmapsetIds: [...exclude],
            });
            void notifyDesktop("osu-link Train", `Passed. Next: ${first.title}`);
            void openOsuBeatmap(first.beatmapId);
            return;
          }
          endSession(s, "complete");
          return;
        }

        const now = Date.now();
        let starMin = s.starMin;
        let starMax = s.starMax;
        let rampStep = s.rampStep;
        if (s.source === "auto") {
          const band = nextStarBand(s.starMin, s.starMax, passAcc, s.accThreshold);
          const felt = bandAfterFeel(band.starMin, band.starMax, s.difficultyFeel);
          starMin = felt.starMin;
          starMax = felt.starMax;
          rampStep = band.rampStep;
        }

        const nextItem = s.queue[nextIdx];
        setSession({
          ...s,
          currentIndex: nextIdx,
          slotStartedAtMs: now,
          starMin,
          starMax,
          rampStep,
          difficultyFeel: null,
        });
        void notifyDesktop("osu-link Train", `Passed. Next: ${nextItem.title}`);
        void openOsuBeatmap(nextItem.beatmapId);
      } finally {
        handlingPassRef.current = false;
      }
    },
    [endSession, openOsuBeatmap],
  );

  useEffect(() => {
    if (!session || session.paused || meOsuId == null) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || handlingPassRef.current) return;
      try {
        const raw = await invoke<unknown>("osu_user_recent_scores", {
          userId: meOsuId,
          limit: 100,
          mode: session.mode,
        });
        if (cancelled || handlingPassRef.current) return;
        setPollErr(null);
        const cur = session.queue[session.currentIndex];
        if (!cur) return;
        const progress = detectSlotProgress(raw, cur.beatmapId, session.slotStartedAtMs, session.accThreshold);
        if (progress.passed && progress.accuracy != null) {
          void advanceAfterPass(session, progress.accuracy, cur);
          return;
        }
        if (progress.failedAttempt && failCountedIdx.current !== session.currentIndex) {
          failCountedIdx.current = session.currentIndex;
          mapsFailedRef.current += 1;
          appendMapOutcome({
            beatmapId: cur.beatmapId,
            beatmapsetId: cur.beatmapsetId,
            stars: cur.stars,
            accuracy: progress.accuracy,
            passed: false,
            accThreshold: session.accThreshold,
            atMs: Date.now(),
            label: `${cur.artist} — ${cur.title}`,
          });
          bumpHistoryEvent();
          if (session.source === "auto") {
            const soft = softenStarBand(session.starMin, session.starMax);
            const felt = bandAfterFeel(soft.starMin, soft.starMax, session.difficultyFeel);
            setSession((prev) =>
              prev
                ? {
                    ...prev,
                    starMin: felt.starMin,
                    starMax: felt.starMax,
                    difficultyFeel: null,
                  }
                : prev,
            );
          }
        }
      } catch (e) {
        if (!cancelled) setPollErr(String(e));
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [session, meOsuId, advanceAfterPass]);

  const current = session ? session.queue[session.currentIndex] : null;

  const extendAutoQueue = useCallback(async () => {
    if (!session || session.source !== "auto") return;
    setBusy(true);
    try {
      const exclude = new Set(session.usedBeatmapsetIds);
      const more = await buildAutoQueueChunk(session.mode, session.starMin, session.starMax, exclude, QUEUE_CHUNK);
      more.forEach((m) => exclude.add(m.beatmapsetId));
      if (more.length === 0) {
        extendGuardRef.current = null;
        pushToast("error", "No more maps found in this band.");
        return;
      }
      setSession({
        ...session,
        queue: [...session.queue, ...more],
        usedBeatmapsetIds: [...exclude],
      });
      pushToast("success", `Added ${more.length} map(s) to the queue.`);
    } catch (e) {
      pushToast("error", String(e));
    } finally {
      setBusy(false);
    }
  }, [session, pushToast]);

  useEffect(() => {
    if (!session || session.source !== "auto") return;
    const remaining = session.queue.length - session.currentIndex;
    if (remaining > EXTEND_THRESHOLD) {
      extendGuardRef.current = null;
      return;
    }
    if (remaining <= 0) return;
    if (extendGuardRef.current === session.currentIndex) return;
    extendGuardRef.current = session.currentIndex;
    void extendAutoQueue();
  }, [session, extendAutoQueue]);

  const rerollCurrent = useCallback(async () => {
    if (!session || !current) return;
    if (session.source !== "auto") {
      pushToast("info", "Randomize map is only for auto queue sessions.");
      return;
    }
    setBusy(true);
    try {
      const exclude = new Set(session.usedBeatmapsetIds.filter((id) => id !== current.beatmapsetId));
      const one = await buildAutoQueueChunk(session.mode, session.starMin, session.starMax, exclude, 1);
      if (one.length === 0) {
        pushToast("error", "No alternative map in this band.");
        return;
      }
      const rep = one[0];
      const q = [...session.queue];
      q[session.currentIndex] = rep;
      const used = [...new Set([...session.usedBeatmapsetIds, rep.beatmapsetId])];
      const now = Date.now();
      setSession({ ...session, queue: q, usedBeatmapsetIds: used, slotStartedAtMs: now, difficultyFeel: null });
      pushToast("info", "Swapped current map.");
      void openOsuBeatmap(rep.beatmapId);
    } catch (e) {
      pushToast("error", String(e));
    } finally {
      setBusy(false);
    }
  }, [session, current, pushToast, openOsuBeatmap]);

  useEffect(() => {
    trainHotkeyOpenRef.current = () => {
      if (!session) return;
      const cur = session.queue[session.currentIndex];
      if (!cur) return;
      void openOsuBeatmap(cur.beatmapId);
    };
    trainHotkeyRandomizeRef.current = () => {
      void rerollCurrent();
    };
    trainHotkeyEndRef.current = () => {
      if (session) endSession(session, "user");
    };
  }, [
    session,
    openOsuBeatmap,
    rerollCurrent,
    endSession,
    trainHotkeyOpenRef,
    trainHotkeyRandomizeRef,
    trainHotkeyEndRef,
  ]);

  const replaceCurrentWithSet = useCallback(
    (raw: unknown) => {
      if (!session) return;
      const set = raw as Record<string, unknown>;
      const sid = Number(set.id);
      if (!Number.isFinite(sid)) return;
      void (async () => {
        setBusy(true);
        try {
          await invoke<unknown>("get_beatmapset", { beatmapsetId: sid });
          const items = await buildQueueFromCustomItems(
            [
              {
                beatmapsetId: sid,
                artist: String(set.artist ?? ""),
                title: String(set.title ?? ""),
                creator: String(set.creator ?? ""),
                coverUrl: (set.covers as Record<string, string> | undefined)?.list ?? null,
              },
            ],
            session.mode,
          );
          if (items.length === 0) {
            pushToast("error", "No difficulties for this mode.");
            return;
          }
          const rep = items[0];
          const q = [...session.queue];
          q[session.currentIndex] = rep;
          const used = [...new Set([...session.usedBeatmapsetIds, rep.beatmapsetId])];
          setSession({
            ...session,
            queue: q,
            usedBeatmapsetIds: used,
            slotStartedAtMs: Date.now(),
            difficultyFeel: null,
          });
          setPickResults([]);
          pushToast("success", "Current map updated.");
          void openOsuBeatmap(rep.beatmapId);
        } catch (e) {
          pushToast("error", String(e));
        } finally {
          setBusy(false);
        }
      })();
    },
    [session, pushToast, openOsuBeatmap],
  );

  const runPickSearch = useCallback(async () => {
    if (!session) return;
    setPickBusy(true);
    try {
      const res = await invoke<Record<string, unknown>>("search_beatmapsets", {
        input: {
          q: pickQuery.trim() || null,
          m: MODE_API[session?.mode ?? modeDraft],
          s: "ranked",
          sort: "plays_desc",
          cursor_string: null,
          g: null,
          l: null,
          e: null,
          c: null,
          r: null,
          nsfw: false,
        },
      });
      const sets = (res.beatmapsets as unknown[]) || [];
      setPickResults(sets.slice(0, 12));
    } catch (e) {
      pushToast("error", String(e));
    } finally {
      setPickBusy(false);
    }
  }, [session, pickQuery, modeDraft, pushToast]);

  const importTrainingFile = useCallback(
    (text: string) => {
      const r = parseImportedTrainingSetJson(text);
      if (!r.ok) {
        pushToast("error", r.error);
        return;
      }
      const t = addTrainingSet({
        name: r.data.name,
        items: r.data.items,
        accThreshold: r.data.accThreshold ?? DEFAULT_ACC,
        mode: r.data.mode ?? modeDraft,
        notes: r.data.notes,
      });
      persistSavedSets(loadTrainingSets());
      pushToast("success", `Imported training set “${t.name}”.`);
    },
    [modeDraft, persistSavedSets, pushToast],
  );

  const exportSaved = useCallback(
    (set: SavedTrainingSet) => {
      const payload = buildSharedTrainingPayload(set.name, set.items, {
        accThreshold: set.accThreshold,
        mode: set.mode,
        notes: set.notes,
      });
      const body = serializeSharedTrainingSet(payload);
      downloadTextFile(`${slugifyFilename(set.name)}.osu-link-training.json`, body);
      pushToast("success", "Exported training set.");
    },
    [pushToast],
  );

  const onImportFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      void f.text().then(importTrainingFile);
    },
    [importTrainingFile],
  );

  const queueStep = session ? session.currentIndex + 1 : 0;
  const queueTotal = session ? session.queue.length : 0;
  const queueProgressPct = queueTotal > 0 ? Math.min(100, (queueStep / queueTotal) * 100) : 0;

  return (
    <div className="panel panel-elevated train-panel">
      {pollErr && (
        <div className="train-poll-alert" role="alert">
          <span className="train-poll-alert__label">Score poll failed</span>
          <span className="train-poll-alert__msg">{pollErr}</span>
        </div>
      )}

      <div className="train-controls">
        <label className="field">
          <span className="field-label">Mode</span>
          <NeuSelect
            value={modeDraft}
            options={MODE_OPTIONS_UI}
            onChange={(v) => setModeDraft(v as Mode)}
            disabled={busy || session != null}
          />
        </label>
        <label className="field">
          <span className="field-label">Accuracy % (min to pass)</span>
          <input
            type="number"
            min={70}
            max={100}
            step={0.5}
            value={accDraft}
            onChange={(e) => setAccDraft(e.target.value)}
            disabled={busy || session != null}
          />
        </label>
      </div>

      {!session && (
        <div className="train-setup-card">
          <p
            className="hint train-setup-warning"
            title="Passes come from recent scores (last ~100). Heavy play between polls can miss a pass."
          >
            Scores are polled from recent plays only.
          </p>
          <div className="train-subpanel">
            <details className="disclosure-block train-how-details">
              <summary>How training works</summary>
              <div className="train-disclosure-body">
                <ul className="train-how-list">
                  <li>
                    Minimum accuracy to advance is the value above (default {DEFAULT_ACC}%; adjustable before you start).
                  </li>
                  <li>
                    osu-link polls your recent scores about every {Math.round(POLL_MS / 1000)} seconds to detect passes and
                    fails.
                  </li>
                  <li>The API returns up to 100 recent plays — very long grind sessions can miss a pass.</li>
                  <li>Auto queue uses your last 30 days of plays to pick a starting star band.</li>
                </ul>
              </div>
            </details>
          </div>
          <div className="train-start-actions">
            <button type="button" className="primary" disabled={busy || meOsuId == null} onClick={() => void startAuto()}>
              Start auto queue
            </button>
            {meOsuId == null ? (
              <p className="hint train-start-hint">Sign in (Settings) to start.</p>
            ) : (
              <p className="hint train-start-hint" title="Starting ★ band from your last 30 days of plays.">
                Ready — starting band from recent plays.
              </p>
            )}
          </div>
        </div>
      )}

      {session && current && (
        <div className="train-active train-session">
          <div className="train-progress">
            <div className="train-progress__track" aria-hidden>
              <div className="train-progress__fill" style={{ width: `${queueProgressPct}%` }} />
            </div>
            <p className="train-progress__label">
              Step {queueStep} / {queueTotal}
              <span className="train-progress__meta">
                {" "}
                · Band ★{session.starMin.toFixed(2)}–{session.starMax.toFixed(2)}
                {session.source === "custom" ? ` · “${session.trainingSetName ?? "custom"}”` : ""}
              </span>
            </p>
          </div>

          <div className="train-hero">
            <h3 className="visually-hidden">Current map</h3>
            <p className="train-map-title">
              {current.artist} — {current.title}
            </p>
            <p className="train-stars-line">
              ★{current.stars.toFixed(2)}
              {current.avgPp != null ? ` · ~${Math.round(current.avgPp)} pp` : ""}
            </p>
            <div className="train-meta-row" role="group" aria-label="Beatmap details">
              <span className="train-meta-chip">#{current.beatmapId}</span>
              {localBeatmapsetIds.has(current.beatmapsetId) ? (
                <span className="train-meta-chip train-meta-chip--ok">In Songs</span>
              ) : (
                <span className="train-meta-chip train-meta-chip--warn">Not local</span>
              )}
            </div>
          </div>

          {session.source === "auto" && (
            <div
              className="train-feel-compact"
              title="Adjusts the next auto-pick star band. Click again to clear."
            >
              <div className="train-feel-compact__inner" role="group" aria-label="Star band nudge">
                <button
                  type="button"
                  className={`train-feel-btn ${session.difficultyFeel === "too_easy" ? "train-feel-btn--active" : ""}`}
                  disabled={busy}
                  aria-label="Too easy — nudge next picks easier"
                  aria-pressed={session.difficultyFeel === "too_easy"}
                  onClick={() =>
                    setSession((prev) =>
                      prev && prev.source === "auto"
                        ? {
                            ...prev,
                            difficultyFeel: prev.difficultyFeel === "too_easy" ? null : "too_easy",
                          }
                        : prev,
                    )
                  }
                >
                  <ArrowDown size={18} strokeWidth={2.25} aria-hidden />
                  <span className="train-feel-btn__text">Easier</span>
                </button>
                <button
                  type="button"
                  className={`train-feel-btn ${session.difficultyFeel === "too_hard" ? "train-feel-btn--active" : ""}`}
                  disabled={busy}
                  aria-label="Too hard — nudge next picks harder"
                  aria-pressed={session.difficultyFeel === "too_hard"}
                  onClick={() =>
                    setSession((prev) =>
                      prev && prev.source === "auto"
                        ? {
                            ...prev,
                            difficultyFeel: prev.difficultyFeel === "too_hard" ? null : "too_hard",
                          }
                        : prev,
                    )
                  }
                >
                  <ArrowUp size={18} strokeWidth={2.25} aria-hidden />
                  <span className="train-feel-btn__text">Harder</span>
                </button>
              </div>
            </div>
          )}

          <div className="train-actions-stack">
            <div className="train-open-pick-row">
              <div className="train-actions-primary">
                <button type="button" className="primary train-open-osu" onClick={() => void openOsuBeatmap(current.beatmapId)}>
                  Open in osu!
                </button>
              </div>
              <div className="train-pick-subpanel">
                <div className="disclosure-block train-pick-details">
                  <button
                    type="button"
                    className="secondary disclosure-toggle"
                    id="train-pick-toggle"
                    aria-expanded={pickOpen}
                    aria-controls="train-pick-panel"
                    onClick={() => setPickOpen((o) => !o)}
                  >
                    Pick a different map (search)
                  </button>
                  <div
                    id="train-pick-panel"
                    role="region"
                    aria-labelledby="train-pick-toggle"
                    hidden={!pickOpen}
                    className="train-disclosure-body"
                  >
                    <div className="train-pick-search">
                      <input
                        type="search"
                        value={pickQuery}
                        onChange={(e) => setPickQuery(e.target.value)}
                        placeholder="Search ranked sets…"
                        className="train-pick-input"
                      />
                      <button type="button" className="secondary" disabled={pickBusy} onClick={() => void runPickSearch()}>
                        Search
                      </button>
                    </div>
                    <ul className="train-pick-list">
                      {pickResults.map((raw) => {
                        const set = raw as Record<string, unknown>;
                        const id = Number(set.id);
                        return (
                          <li key={id}>
                            <button type="button" className="train-pick-item" onClick={() => replaceCurrentWithSet(raw)}>
                              {String(set.artist)} — {String(set.title)}
                            </button>
                            {onInspectBeatmapset && (
                              <button type="button" className="secondary train-pick-inspect" onClick={() => onInspectBeatmapset(id)}>
                                Details
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            <div className="train-actions-row train-actions-row--session-icons" role="toolbar" aria-label="Session controls">
              {session.source === "auto" && (
                <button
                  type="button"
                  className="secondary train-session-icon-btn"
                  disabled={busy}
                  aria-label="Randomize current map"
                  title="Randomize"
                  onClick={() => void rerollCurrent()}
                >
                  <Shuffle size={18} strokeWidth={2.25} aria-hidden />
                </button>
              )}
              <button
                type="button"
                className="secondary train-session-icon-btn"
                disabled={busy}
                aria-label={session.paused ? "Resume session" : "Pause session"}
                title={session.paused ? "Resume" : "Pause"}
                onClick={() => {
                  setSession((s) => (s ? { ...s, paused: !s.paused } : s));
                }}
              >
                {session.paused ? <Play size={18} strokeWidth={2.25} aria-hidden /> : <Pause size={18} strokeWidth={2.25} aria-hidden />}
              </button>
              <button
                type="button"
                className="secondary train-session-icon-btn"
                aria-label="End session"
                title="End session"
                onClick={() => {
                  if (session) endSession(session, "user");
                }}
              >
                <Square size={18} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="panel-section">
        <h3 className="social-h3">Saved training sets</h3>
        <p className="hint" title="Same shape as collection export, plus acc threshold and mode.">
          Import/export JSON — same idea as Collections.
        </p>
        <div className="share-actions train-share-actions">
          <input ref={importTrainRef} type="file" accept=".json,application/json" className="visually-hidden" onChange={onImportFile} />
          <button type="button" className="secondary" onClick={() => importTrainRef.current?.click()}>
            Import .json…
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void navigator.clipboard.readText().then(importTrainingFile).catch(() => pushToast("error", "Clipboard read failed."));
            }}
          >
            Paste from clipboard
          </button>
        </div>
        <label className="field">
          <span className="field-label">New set name (from active collection — type name)</span>
          <input value={newSetName} onChange={(e) => setNewSetName(e.target.value)} placeholder="My drills" />
        </label>
        <p className="hint" title="Export a collection from Collections and import here, or pick maps after you start a session.">
          From Collections: export → import here.
        </p>
        {savedSets.length === 0 ? (
          <p className="train-saved-empty hint">
            No saved sets — import <code className="train-code">.json</code> or paste.
          </p>
        ) : (
          <ul className="train-saved-list">
            {savedSets.map((s) => (
              <li key={s.id} className="train-saved-row">
                <div>
                  <strong>{s.name}</strong> · {s.items.length} sets · {s.mode} · ≥{s.accThreshold}%
                </div>
                <div className="train-saved-actions">
                  <button type="button" className="primary" disabled={busy} onClick={() => void startCustom(s)}>
                    Start
                  </button>
                  <button type="button" className="secondary" onClick={() => exportSaved(s)}>
                    Export
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      if (window.confirm(`Delete “${s.name}”?`)) {
                        removeTrainingSet(s.id);
                        persistSavedSets(loadTrainingSets());
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

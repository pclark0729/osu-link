import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MutableRefObject } from "react";
import { buildSharedTrainingPayload, parseImportedTrainingSetJson, serializeSharedTrainingSet } from "./trainingShare";
import { computeTrainingBaseline } from "./trainBaseline";
import { appendMapOutcome, appendSessionSummary } from "./trainHistory";
import { detectSlotProgress } from "./trainProgress";
import {
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
import { notifyDesktop } from "./desktopNotify";
import { MainPaneSticky } from "./MainPaneSticky";

type ToastTone = "info" | "success" | "error";

const POLL_MS = 22000;
const DEFAULT_ACC = 90;
const QUEUE_CHUNK = 8;
const EXTEND_THRESHOLD = 3;

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
            const more = await buildAutoQueueChunk(s.mode, band.starMin, band.starMax, exclude, QUEUE_CHUNK);
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
              starMin: band.starMin,
              starMax: band.starMax,
              rampStep: band.rampStep,
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
          starMin = band.starMin;
          starMax = band.starMax;
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
            setSession((prev) =>
              prev
                ? {
                    ...prev,
                    starMin: soft.starMin,
                    starMax: soft.starMax,
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
      setSession({ ...session, queue: q, usedBeatmapsetIds: used, slotStartedAtMs: now });
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

  return (
    <div className="panel panel-elevated train-panel">
      <MainPaneSticky>
        <div className="panel-head">
          <h2>Train</h2>
          <p className="panel-sub">
            Ramping queue, &gt;{DEFAULT_ACC}% acc to advance (adjustable). Polls recent scores — if you play 100+ maps before a
            check, a pass can roll off the recent list.
          </p>
        </div>
      </MainPaneSticky>

      {pollErr && (
        <p className="hint" role="alert">
          Poll: {pollErr}
        </p>
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
        <div className="train-start-actions">
          <button type="button" className="primary" disabled={busy || meOsuId == null} onClick={() => void startAuto()}>
            Start auto queue
          </button>
          <p className="hint">Uses your last 30 days of plays to set the starting star band.</p>
        </div>
      )}

      {session && current && (
        <div className="train-active">
          <div className="train-current-meta">
            <h3 className="social-h3">Current map</h3>
            <p className="train-map-title">
              {current.artist} — {current.title}
            </p>
            <p className="hint">
              ★{current.stars.toFixed(2)}
              {current.avgPp != null ? ` · avg PP ~${Math.round(current.avgPp)}` : ""}
            </p>
            <p className="hint">
              Target beatmap id {current.beatmapId} ·{" "}
              {localBeatmapsetIds.has(current.beatmapsetId) ? (
                <span className="train-in-lib">In your Songs folder</span>
              ) : (
                <span className="train-not-in-lib">Not detected locally — download the set first</span>
              )}
            </p>
          </div>
          <div className="train-actions-row">
            <button type="button" className="secondary" onClick={() => void openOsuBeatmap(current.beatmapId)}>
              Open in osu!
            </button>
            {session.source === "auto" && (
              <button type="button" className="secondary" disabled={busy} onClick={() => void rerollCurrent()}>
                Randomize map
              </button>
            )}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setSession((s) => (s ? { ...s, paused: !s.paused } : s));
              }}
            >
              {session.paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (session) endSession(session, "user");
              }}
            >
              End session
            </button>
          </div>
          <p className="hint">
            Global shortcuts (Settings → Keyboard): open current map, randomize (auto queue), end session — work while osu! is
            focused.
          </p>
          <p className="hint">
            Step {session.currentIndex + 1} / {session.queue.length} · band ★{session.starMin.toFixed(2)}–
            {session.starMax.toFixed(2)}
            {session.source === "custom" ? ` · “${session.trainingSetName ?? "custom"}”` : ""}
          </p>
        </div>
      )}

      {session && (
        <details className="settings-disclosure train-pick-details">
          <summary>Pick a different map (search)</summary>
          <div className="settings-disclosure-body">
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
        </details>
      )}

      <section className="panel-section">
        <h3 className="social-h3">Saved training sets</h3>
        <p className="hint">Import shared JSON (creates a new set). Export uses the same format as collections, plus optional acc threshold and mode.</p>
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
        <p className="hint">
          Create sets from the Collections tab by exporting a collection, then import here — or add maps via search in Train after
          starting a session.
        </p>
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
      </section>
    </div>
  );
}

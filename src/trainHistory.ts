/** Append-only training history and session persistence (localStorage). */

import type { Mode } from "./searchTypes";

export const TRAINING_HISTORY_KEY = "osu-link.training-history.v1";
export const TRAINING_SESSION_KEY = "osu-link.training-session.v1";

export type TrainSource = "auto" | "custom";

export interface TrainMapOutcome {
  beatmapId: number;
  beatmapsetId: number;
  stars: number;
  accuracy: number | null;
  passed: boolean;
  accThreshold: number;
  atMs: number;
  label: string;
}

export interface TrainSessionSummary {
  sessionId: string;
  startedAtMs: number;
  endedAtMs: number;
  mode: Mode;
  source: TrainSource;
  trainingSetName: string | null;
  mapsPassed: number;
  mapsFailed: number;
  peakStars: number;
  accSum: number;
  accCount: number;
}

export interface TrainingHistoryFile {
  sessions: TrainSessionSummary[];
  mapOutcomes: TrainMapOutcome[];
}

const MAX_OUTCOMES = 2000;
const MAX_SESSIONS = 500;

function emptyHistory(): TrainingHistoryFile {
  return { sessions: [], mapOutcomes: [] };
}

export function loadTrainingHistory(): TrainingHistoryFile {
  try {
    const raw = localStorage.getItem(TRAINING_HISTORY_KEY);
    if (!raw) return emptyHistory();
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return emptyHistory();
    const o = p as Record<string, unknown>;
    const sessions = Array.isArray(o.sessions) ? o.sessions : [];
    const mapOutcomes = Array.isArray(o.mapOutcomes) ? o.mapOutcomes : [];
    return {
      sessions: sessions.filter(Boolean) as TrainSessionSummary[],
      mapOutcomes: mapOutcomes.filter(Boolean) as TrainMapOutcome[],
    };
  } catch {
    return emptyHistory();
  }
}

export function saveTrainingHistory(h: TrainingHistoryFile): void {
  const trimSessions = h.sessions.slice(-MAX_SESSIONS);
  const trimOutcomes = h.mapOutcomes.slice(-MAX_OUTCOMES);
  try {
    localStorage.setItem(TRAINING_HISTORY_KEY, JSON.stringify({ sessions: trimSessions, mapOutcomes: trimOutcomes }));
  } catch {
    /* ignore quota */
  }
}

export function appendMapOutcome(outcome: TrainMapOutcome): void {
  const h = loadTrainingHistory();
  h.mapOutcomes.push(outcome);
  saveTrainingHistory(h);
}

export function appendSessionSummary(s: TrainSessionSummary): void {
  const h = loadTrainingHistory();
  h.sessions.push(s);
  saveTrainingHistory(h);
}

export type TrainingStatsAggregates = {
  sessionCount: number;
  mapsCleared: number;
  mapsFailed: number;
  meanAccPasses: number | null;
  medianAccPasses: number | null;
  peakStars: number | null;
  lastSessionEndedMs: number | null;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeTrainingAggregates(h: TrainingHistoryFile): TrainingStatsAggregates {
  const sessions = h.sessions;
  const sessionCount = sessions.length;
  let mapsCleared = 0;
  let mapsFailed = 0;
  let peakStars: number | null = null;
  let lastSessionEndedMs: number | null = null;

  for (const s of sessions) {
    mapsCleared += s.mapsPassed;
    mapsFailed += s.mapsFailed;
    if (s.peakStars > (peakStars ?? 0)) peakStars = s.peakStars;
    if (lastSessionEndedMs == null || s.endedAtMs > lastSessionEndedMs) lastSessionEndedMs = s.endedAtMs;
  }

  const passAccs = h.mapOutcomes.filter((o) => o.passed && o.accuracy != null).map((o) => o.accuracy!);
  const meanAccPasses =
    passAccs.length > 0 ? passAccs.reduce((a, b) => a + b, 0) / passAccs.length : null;
  const medianAccPasses = median(passAccs);

  return {
    sessionCount,
    mapsCleared,
    mapsFailed,
    meanAccPasses,
    medianAccPasses,
    peakStars,
    lastSessionEndedMs,
  };
}

/** Compare train pass accuracy to a list of recent/best score accuracies (0–100). */
export function trainVsGeneralAccInsight(
  trainMean: number | null,
  generalAccs: (number | null)[],
): { delta: number | null; note: string } {
  const g = generalAccs.filter((x): x is number => x != null && Number.isFinite(x));
  if (trainMean == null || g.length === 0) {
    return { delta: null, note: "Not enough overlapping data to compare." };
  }
  const gm = g.reduce((a, b) => a + b, 0) / g.length;
  return {
    delta: Math.round((trainMean - gm) * 100) / 100,
    note: "Train passes vs sampled score accuracy (illustrative only).",
  };
}

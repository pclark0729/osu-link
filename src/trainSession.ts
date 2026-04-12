/** In-progress training session (persisted). */

import type { SharedCollectionItem } from "./collectionShare";
import type { Mode } from "./searchTypes";
import type { TrainSource } from "./trainHistory";
import { TRAINING_SESSION_KEY } from "./trainHistory";

export const TRAINING_SESSION_VERSION = 1 as const;

/** Subjective difficulty vs the current map; nudges the auto star band for the next picks. */
export type TrainDifficultyFeel = "too_easy" | "too_hard";

export interface TrainQueueItem {
  beatmapsetId: number;
  beatmapId: number;
  artist: string;
  title: string;
  creator: string;
  stars: number;
  avgPp: number | null;
  coverUrl?: string | null;
}

export interface TrainSessionStateV1 {
  v: typeof TRAINING_SESSION_VERSION;
  sessionId: string;
  startedAtMs: number;
  mode: Mode;
  source: TrainSource;
  trainingSetName: string | null;
  accThreshold: number;
  queue: TrainQueueItem[];
  currentIndex: number;
  paused: boolean;
  slotStartedAtMs: number;
  starMin: number;
  starMax: number;
  rampStep: number;
  usedBeatmapsetIds: number[];
  /** Optional: applies after pass/fail band update for the next auto-queue fetches. */
  difficultyFeel?: TrainDifficultyFeel | null;
  /** Custom set items when source is custom — for export context */
  customItems?: SharedCollectionItem[];
}

export function newSessionId(): string {
  return `tr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function loadTrainSession(): TrainSessionStateV1 | null {
  try {
    const raw = localStorage.getItem(TRAINING_SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    if (o.v !== TRAINING_SESSION_VERSION) return null;
    if (!Array.isArray(o.queue)) return null;
    return p as TrainSessionStateV1;
  } catch {
    return null;
  }
}

export function saveTrainSession(s: TrainSessionStateV1 | null): void {
  try {
    if (s == null) {
      localStorage.removeItem(TRAINING_SESSION_KEY);
    } else {
      localStorage.setItem(TRAINING_SESSION_KEY, JSON.stringify(s));
    }
  } catch {
    /* ignore */
  }
}

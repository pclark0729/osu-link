/** User-saved training sets (localStorage). */

import type { SharedCollectionItem } from "./collectionShare";
import type { Mode } from "./searchTypes";

const KEY = "osu-link.training-sets.v1";

export interface SavedTrainingSet {
  id: string;
  name: string;
  items: SharedCollectionItem[];
  accThreshold: number;
  mode: Mode;
  notes?: string;
}

function randomId(): string {
  return `ts-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function loadTrainingSets(): SavedTrainingSet[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter(Boolean) as SavedTrainingSet[];
  } catch {
    return [];
  }
}

export function saveTrainingSets(sets: SavedTrainingSet[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sets.slice(0, 200)));
  } catch {
    /* ignore */
  }
}

export function addTrainingSet(set: Omit<SavedTrainingSet, "id">): SavedTrainingSet {
  const full: SavedTrainingSet = { ...set, id: randomId() };
  const all = loadTrainingSets();
  all.push(full);
  saveTrainingSets(all);
  return full;
}

export function removeTrainingSet(id: string): void {
  saveTrainingSets(loadTrainingSets().filter((s) => s.id !== id));
}

export function updateTrainingSet(id: string, patch: Partial<Omit<SavedTrainingSet, "id">>): void {
  const all = loadTrainingSets().map((s) => (s.id === id ? { ...s, ...patch } : s));
  saveTrainingSets(all);
}

import { uniqueCollectionName } from "./models";
import type { Mode } from "./searchTypes";

export const PRESETS_STORAGE_KEY = "osu-link.search-presets.v1";
export const RESULTS_LAYOUT_STORAGE_KEY = "osu-link.search-results-layout.v1";

export type ResultsLayout = "comfortable" | "compact" | "tiles";

/** Serializable filter state for API search + client toggles. */
export interface SearchFilterSnapshot {
  query: string;
  mode: Mode;
  section: string;
  sort: string;
  minStars: string;
  maxStars: string;
  genre: string;
  language: string;
  extras: string;
  general: string;
  ranks: string;
  nsfw: boolean;
  hideOwnedSearch: boolean;
  noVideo: boolean;
}

export interface SearchPreset {
  id: string;
  name: string;
  snapshot: SearchFilterSnapshot;
}

interface PresetsPayloadV1 {
  v: 1;
  presets: SearchPreset[];
}

function isMode(x: unknown): x is Mode {
  return x === "osu" || x === "taiko" || x === "fruits" || x === "mania";
}

function normalizeSnapshot(raw: unknown): SearchFilterSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isMode(o.mode)) return null;
  return {
    query: typeof o.query === "string" ? o.query : "",
    mode: o.mode,
    section: typeof o.section === "string" ? o.section : "ranked",
    sort: typeof o.sort === "string" ? o.sort : "plays_desc",
    minStars: typeof o.minStars === "string" ? o.minStars : "",
    maxStars: typeof o.maxStars === "string" ? o.maxStars : "",
    genre: typeof o.genre === "string" ? o.genre : "",
    language: typeof o.language === "string" ? o.language : "",
    extras: typeof o.extras === "string" ? o.extras : "",
    general: typeof o.general === "string" ? o.general : "",
    ranks: typeof o.ranks === "string" ? o.ranks : "",
    nsfw: o.nsfw === true,
    hideOwnedSearch: o.hideOwnedSearch === true,
    noVideo: o.noVideo !== false,
  };
}

function normalizePreset(raw: unknown): SearchPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id.length > 0 ? o.id : null;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const snapshot = normalizeSnapshot(o.snapshot);
  if (!id || !name || !snapshot) return null;
  return { id, name, snapshot };
}

export function loadPresets(): SearchPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const p = parsed as Record<string, unknown>;
    if (p.v !== 1 || !Array.isArray(p.presets)) return [];
    const out: SearchPreset[] = [];
    for (const item of p.presets) {
      const pr = normalizePreset(item);
      if (pr) out.push(pr);
    }
    return out;
  } catch {
    return [];
  }
}

export function savePresetsList(presets: SearchPreset[]): void {
  const payload: PresetsPayloadV1 = { v: 1, presets };
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(payload));
}

/** Pretty-printed JSON for sharing or backup (same schema as {@link PRESETS_STORAGE_KEY}). */
export function serializePresetsForExport(presets: SearchPreset[]): string {
  const payload: PresetsPayloadV1 = { v: 1, presets };
  return JSON.stringify(payload, null, 2);
}

/**
 * Merges presets from an exported JSON file. Generates new ids when they collide with existing entries.
 * Names are uniqued with {@link uniqueCollectionName} against the combined list.
 */
export function mergePresetsFromImportJson(current: SearchPreset[], rawJson: string): { merged: SearchPreset[]; added: number } {
  let data: unknown;
  try {
    data = JSON.parse(rawJson) as unknown;
  } catch {
    return { merged: current, added: 0 };
  }
  if (!data || typeof data !== "object") return { merged: current, added: 0 };
  const o = data as Record<string, unknown>;
  if (o.v !== 1 || !Array.isArray(o.presets)) return { merged: current, added: 0 };

  const existingIds = new Set(current.map((p) => p.id));
  const namePool = current.map((p) => p.name);
  const incoming: SearchPreset[] = [];
  let added = 0;

  for (const item of o.presets) {
    const pr = normalizePreset(item);
    if (!pr) continue;
    let id = pr.id;
    while (existingIds.has(id)) {
      id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
    existingIds.add(id);
    const base = pr.name.trim() || "Imported";
    const name = uniqueCollectionName(base, namePool);
    namePool.push(name);
    incoming.push({ ...pr, id, name, snapshot: pr.snapshot });
    added += 1;
  }

  return { merged: [...current, ...incoming], added };
}

export function loadResultsLayout(): ResultsLayout {
  try {
    const raw = localStorage.getItem(RESULTS_LAYOUT_STORAGE_KEY);
    if (!raw) return "compact";
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === "comfortable" || parsed === "compact" || parsed === "tiles") return parsed;
  } catch {
    /* ignore */
  }
  return "compact";
}

export function saveResultsLayout(layout: ResultsLayout): void {
  localStorage.setItem(RESULTS_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

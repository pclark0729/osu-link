/** Portable format for sharing custom training sets between osu-link users. */

import type { SharedCollectionItem } from "./collectionShare";

export const SHARED_TRAINING_SET_VERSION = 1 as const;

export type TrainingMode = "osu" | "taiko" | "fruits" | "mania";

export interface SharedTrainingSetFile {
  osuLinkTrainingSet: typeof SHARED_TRAINING_SET_VERSION;
  name: string;
  exportedAt: string;
  items: SharedCollectionItem[];
  /** Optional defaults when importing */
  accThreshold?: number;
  mode?: TrainingMode;
  notes?: string;
}

export function buildSharedTrainingPayload(
  name: string,
  items: SharedCollectionItem[],
  extras?: { accThreshold?: number; mode?: TrainingMode; notes?: string },
): SharedTrainingSetFile {
  return {
    osuLinkTrainingSet: SHARED_TRAINING_SET_VERSION,
    name: name.trim() || "Training set",
    exportedAt: new Date().toISOString(),
    items: items.map((i) => ({
      beatmapsetId: i.beatmapsetId,
      artist: i.artist,
      title: i.title,
      creator: i.creator,
      coverUrl: i.coverUrl ?? null,
    })),
    ...(extras?.accThreshold != null ? { accThreshold: extras.accThreshold } : {}),
    ...(extras?.mode != null ? { mode: extras.mode } : {}),
    ...(extras?.notes != null && extras.notes.trim() ? { notes: extras.notes.trim() } : {}),
  };
}

export function serializeSharedTrainingSet(data: SharedTrainingSetFile): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export type TrainingParseResult =
  | { ok: true; data: SharedTrainingSetFile }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseImportedTrainingSetJson(text: string): TrainingParseResult {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed) as unknown;
  } catch {
    return { ok: false, error: "Invalid JSON. Paste a file exported from osu-link or choose a .json file." };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: "Shared file must be a JSON object." };
  }
  if (raw.osuLinkTrainingSet !== SHARED_TRAINING_SET_VERSION) {
    return {
      ok: false,
      error: `Unknown or missing format version (expected osuLinkTrainingSet: ${SHARED_TRAINING_SET_VERSION}).`,
    };
  }
  const name = typeof raw.name === "string" ? raw.name : "";
  const itemsRaw = raw.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    return { ok: false, error: "This file has no beatmaps (items array is empty)." };
  }
  const items: SharedCollectionItem[] = [];
  const seen = new Set<number>();
  for (const entry of itemsRaw) {
    if (!isRecord(entry)) continue;
    const id = Number(entry.beatmapsetId ?? entry.beatmapset_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      beatmapsetId: id,
      artist: typeof entry.artist === "string" ? entry.artist : "",
      title: typeof entry.title === "string" ? entry.title : "",
      creator: typeof entry.creator === "string" ? entry.creator : "",
      coverUrl:
        typeof entry.coverUrl === "string"
          ? entry.coverUrl
          : typeof entry.cover_url === "string"
            ? entry.cover_url
            : null,
    });
  }
  if (items.length === 0) {
    return { ok: false, error: "No valid beatmap set IDs found in this file." };
  }

  const accThreshold = raw.accThreshold;
  const modeRaw = raw.mode;
  const notes = raw.notes;

  return {
    ok: true,
    data: {
      osuLinkTrainingSet: SHARED_TRAINING_SET_VERSION,
      name: name.trim() || "Imported training set",
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : new Date().toISOString(),
      items,
      ...(typeof accThreshold === "number" && Number.isFinite(accThreshold) ? { accThreshold } : {}),
      ...(modeRaw === "osu" || modeRaw === "taiko" || modeRaw === "fruits" || modeRaw === "mania"
        ? { mode: modeRaw }
        : {}),
      ...(typeof notes === "string" && notes.trim() ? { notes: notes.trim() } : {}),
    },
  };
}

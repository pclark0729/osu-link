/** Portable format for sharing collections between osu-link users. */

export const SHARED_COLLECTION_VERSION = 1 as const;

export interface SharedCollectionItem {
  beatmapsetId: number;
  artist: string;
  title: string;
  creator: string;
  coverUrl?: string | null;
}

export interface SharedCollectionFile {
  osuLinkCollection: typeof SHARED_COLLECTION_VERSION;
  name: string;
  exportedAt: string;
  items: SharedCollectionItem[];
}

export function buildSharedPayload(name: string, items: SharedCollectionItem[]): SharedCollectionFile {
  return {
    osuLinkCollection: SHARED_COLLECTION_VERSION,
    name: name.trim() || "Shared collection",
    exportedAt: new Date().toISOString(),
    items: items.map((i) => ({
      beatmapsetId: i.beatmapsetId,
      artist: i.artist,
      title: i.title,
      creator: i.creator,
      coverUrl: i.coverUrl ?? null,
    })),
  };
}

export function serializeSharedCollection(data: SharedCollectionFile): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export type ParseResult =
  | { ok: true; data: SharedCollectionFile }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseImportedCollectionJson(text: string): ParseResult {
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
  if (raw.osuLinkCollection !== SHARED_COLLECTION_VERSION) {
    return {
      ok: false,
      error: `Unknown or missing format version (expected osuLinkCollection: ${SHARED_COLLECTION_VERSION}).`,
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
  return {
    ok: true,
    data: {
      osuLinkCollection: SHARED_COLLECTION_VERSION,
      name: name.trim() || "Imported collection",
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : new Date().toISOString(),
      items,
    },
  };
}

/**
 * Build training queues from osu! search or from custom shared set items.
 */
import { invoke } from "@tauri-apps/api/core";
import type { SharedCollectionItem } from "./collectionShare";
import {
  CURATE_PAGE_CAP,
  filterSetsByModeAndStars,
  MODE_API,
  topBeatmapIdForMode,
  type Mode,
  type SearchInput,
} from "./searchTypes";
import type { TrainQueueItem } from "./trainSession";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function beatmapById(set: Record<string, unknown>, beatmapId: number): Record<string, unknown> | null {
  const beatmaps = (set.beatmaps as Record<string, unknown>[]) || [];
  for (const b of beatmaps) {
    if (Number(b.id) === beatmapId) return b;
  }
  return null;
}

function setMeta(set: Record<string, unknown>): {
  artist: string;
  title: string;
  creator: string;
  coverUrl: string | null;
} {
  const covers = set.covers as Record<string, string> | undefined;
  return {
    artist: String(set.artist ?? ""),
    title: String(set.title ?? ""),
    creator: String(set.creator ?? ""),
    coverUrl: covers?.list ?? covers?.card ?? null,
  };
}

export function rulesetForMode(mode: Mode): string {
  return mode;
}

/**
 * Batch-fetch average PP for beatmap ids (existing Tauri command).
 */
export async function fetchAvgPpMapFixed(beatmapIds: number[], mode: Mode): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  if (beatmapIds.length === 0) return out;
  const ruleset = rulesetForMode(mode);
  const raw = (await invoke("get_beatmap_avg_pp", {
    beatmapIds,
    ruleset,
  }).catch(() => ({}))) as Record<string, unknown>;
  for (const id of beatmapIds) {
    const v = raw[String(id)];
    if (v === undefined || v === null) out.set(id, null);
    else if (typeof v === "number" && Number.isFinite(v)) out.set(id, v);
    else out.set(id, null);
  }
  return out;
}

async function searchPage(input: SearchInput): Promise<{ sets: unknown[]; cursor: string | null }> {
  const res = await invoke<Record<string, unknown>>("search_beatmapsets", { input });
  const sets = (res.beatmapsets as unknown[]) || [];
  const cur = res.cursor_string as string | undefined | null;
  return { sets, cursor: cur && cur.length > 0 ? cur : null };
}

/**
 * Collect up to `count` beatmap sets from ranked search in a star band, excluding ids.
 */
export async function collectSetsFromStarBand(
  mode: Mode,
  starMin: number,
  starMax: number,
  exclude: Set<number>,
  count: number,
): Promise<unknown[]> {
  const minS = String(Math.max(1, starMin));
  const maxS = String(Math.min(10, starMax));
  const pool: unknown[] = [];
  let cursor: string | null = null;
  let pages = 0;
  while (pages < CURATE_PAGE_CAP && pool.length < count * 4) {
    pages += 1;
    const input: SearchInput = {
      q: null,
      m: MODE_API[mode],
      s: "ranked",
      sort: "plays_desc",
      cursor_string: cursor,
      g: null,
      l: null,
      e: null,
      c: null,
      r: null,
      nsfw: false,
    };
    const { sets, cursor: next } = await searchPage(input);
    const filtered = filterSetsByModeAndStars(sets, mode, minS, maxS);
    for (const s of filtered) {
      const id = Number((s as Record<string, unknown>).id);
      if (!Number.isFinite(id) || exclude.has(id)) continue;
      pool.push(s);
    }
    cursor = next;
    if (!cursor) break;
  }
  return pool;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build queue items from raw beatmap sets (star-filtered).
 */
export async function setsToQueueItems(sets: unknown[], mode: Mode): Promise<TrainQueueItem[]> {
  const ids: number[] = [];
  const rows: { set: Record<string, unknown>; bmid: number }[] = [];
  for (const raw of sets) {
    const set = asRecord(raw);
    const sid = Number(set.id);
    if (!Number.isFinite(sid)) continue;
    const bmid = topBeatmapIdForMode(raw, mode);
    if (bmid == null) continue;
    const bm = beatmapById(set, bmid);
    const stars = Number(bm?.difficulty_rating ?? 0);
    if (!Number.isFinite(stars) || stars <= 0) continue;
    ids.push(bmid);
    rows.push({ set, bmid });
  }
  const avgMap = await fetchAvgPpMapFixed(ids, mode);
  const out: TrainQueueItem[] = [];
  for (const { set, bmid } of rows) {
    const meta = setMeta(set);
    const bm = beatmapById(set, bmid);
    const stars = Number(bm?.difficulty_rating ?? 0);
    out.push({
      beatmapsetId: Number(set.id),
      beatmapId: bmid,
      ...meta,
      stars,
      avgPp: avgMap.get(bmid) ?? null,
    });
  }
  return out;
}

export async function buildAutoQueueChunk(
  mode: Mode,
  starMin: number,
  starMax: number,
  exclude: Set<number>,
  want: number,
): Promise<TrainQueueItem[]> {
  const sets = await collectSetsFromStarBand(mode, starMin, starMax, exclude, want);
  const shuffled = shuffle(sets);
  const items = await setsToQueueItems(shuffled.slice(0, Math.max(want * 3, 12)), mode);
  const byStars = [...items].sort((a, b) => a.stars - b.stars);
  return byStars.slice(0, want);
}

/**
 * Fetch beatmapsets by id and build queue sorted by stars ascending.
 */
export async function buildQueueFromCustomItems(items: SharedCollectionItem[], mode: Mode): Promise<TrainQueueItem[]> {
  const out: TrainQueueItem[] = [];
  const ids: number[] = [];
  const rows: TrainQueueItem[] = [];

  for (const it of items) {
    const raw = await invoke<unknown>("get_beatmapset", { beatmapsetId: it.beatmapsetId }).catch(() => null);
    if (!raw) continue;
    const set = asRecord(raw);
    const bmid = topBeatmapIdForMode(raw, mode);
    if (bmid == null) continue;
    const bm = beatmapById(set, bmid);
    const stars = Number(bm?.difficulty_rating ?? 0);
    if (!Number.isFinite(stars) || stars <= 0) continue;
    const covers = set.covers as Record<string, string> | undefined;
    rows.push({
      beatmapsetId: it.beatmapsetId,
      beatmapId: bmid,
      artist: it.artist || String(set.artist ?? ""),
      title: it.title || String(set.title ?? ""),
      creator: it.creator || String(set.creator ?? ""),
      stars,
      avgPp: null,
      coverUrl: it.coverUrl ?? covers?.list ?? covers?.card ?? null,
    });
    ids.push(bmid);
  }

  const avgMap = ids.length ? await fetchAvgPpMapFixed(ids, mode) : new Map();
  for (const r of rows) {
    out.push({ ...r, avgPp: avgMap.get(r.beatmapId) ?? null });
  }
  out.sort((a, b) => a.stars - b.stars);
  return out;
}

/** After pass: nudge star band upward. High acc widens step slightly. */
export function nextStarBand(
  starMin: number,
  starMax: number,
  passAccuracy: number,
  accThreshold: number,
): { starMin: number; starMax: number; rampStep: number } {
  let step = 0.2;
  if (passAccuracy >= 97) step = 0.28;
  else if (passAccuracy < accThreshold + 2) step = 0.12;

  const nextMin = Math.min(8.5, starMin + step);
  const nextMax = Math.min(9.99, Math.max(nextMin + 0.35, starMax + step));
  return { starMin: Math.round(nextMin * 10) / 10, starMax: Math.round(nextMax * 10) / 10, rampStep: step };
}

/** After fail: hold or slight decrease */
export function softenStarBand(starMin: number, starMax: number): { starMin: number; starMax: number } {
  const nextMin = Math.max(1, starMin - 0.15);
  const nextMax = Math.max(nextMin + 0.25, starMax - 0.1);
  return { starMin: Math.round(nextMin * 10) / 10, starMax: Math.round(nextMax * 10) / 10 };
}

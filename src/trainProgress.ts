/**
 * Detect pass/fail on target beatmap from osu! recent scores payload.
 */
import { beatmapStars, playBeatmapIdFromScore } from "./challengeScoring";
import { normalizeAccuracy } from "./trainBaseline";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function extractScoreArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const o = asRecord(raw);
  if (Array.isArray(o.scores)) return o.scores;
  return [];
}

function scoreAtMs(s: Record<string, unknown>): number | null {
  const atRaw = s.created_at ?? s.ended_at;
  if (typeof atRaw === "string") {
    const t = Date.parse(atRaw);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof atRaw === "number" && Number.isFinite(atRaw)) {
    return atRaw > 1e12 ? atRaw : atRaw * 1000;
  }
  return null;
}

function mapLabelFromScore(s: Record<string, unknown>): string {
  const bs = asRecord(s.beatmapset ?? {});
  const artist = String(bs.artist ?? bs.artist_unicode ?? "").trim();
  const title = String(bs.title ?? bs.title_unicode ?? "").trim();
  const line = artist && title ? `${artist} — ${title}` : title || artist || "Map";
  return line.length > 48 ? `${line.slice(0, 46)}…` : line;
}

function scoreBeatmapsetId(s: Record<string, unknown>): number | null {
  const bm = s.beatmap;
  if (bm && typeof bm === "object") {
    const n = Number((bm as Record<string, unknown>).beatmapset_id);
    if (Number.isFinite(n)) return n;
  }
  const bs = s.beatmapset;
  if (bs && typeof bs === "object") {
    const n = Number((bs as Record<string, unknown>).id);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export type SlotProgress = {
  passed: boolean;
  failedAttempt: boolean;
  accuracy: number | null;
  stars: number | null;
  atMs: number | null;
  label: string;
  beatmapsetId: number | null;
};

/**
 * Find the most recent score on the target beatmap at/after slotStartedAtMs.
 * Pass if accuracy >= threshold.
 */
export function detectSlotProgress(
  recentRaw: unknown,
  targetBeatmapId: number,
  slotStartedAtMs: number,
  accThreshold: number,
): SlotProgress {
  const list = extractScoreArray(recentRaw);
  let best: SlotProgress = {
    passed: false,
    failedAttempt: false,
    accuracy: null,
    stars: null,
    atMs: null,
    label: "",
    beatmapsetId: null,
  };

  for (const item of list) {
    const s = asRecord(item);
    const bmid = playBeatmapIdFromScore(s);
    if (bmid !== targetBeatmapId) continue;
    const at = scoreAtMs(s);
    if (at == null || at < slotStartedAtMs) continue;
    const acc = normalizeAccuracy(s.accuracy);
    const stars = beatmapStars(s);
    const label = mapLabelFromScore(s);
    const beatmapsetId = scoreBeatmapsetId(s);

    if (acc == null) {
      if (best.atMs == null || (at != null && at > best.atMs!)) {
        best = {
          passed: false,
          failedAttempt: false,
          accuracy: null,
          stars,
          atMs: at,
          label,
          beatmapsetId,
        };
      }
      continue;
    }

    if (acc >= accThreshold) {
      return {
        passed: true,
        failedAttempt: false,
        accuracy: acc,
        stars,
        atMs: at,
        label,
        beatmapsetId,
      };
    }

    if (best.atMs == null || (at != null && at > best.atMs)) {
      best = {
        passed: false,
        failedAttempt: true,
        accuracy: acc,
        stars,
        atMs: at,
        label,
        beatmapsetId,
      };
    }
  }

  return best;
}

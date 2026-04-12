import type { ParsedRow } from "../SocialLeaderboard";
import type { EnrichedScore } from "./statsTypes";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function extractScoreArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const o = asRecord(raw);
  if (Array.isArray(o.scores)) return o.scores;
  return [];
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

function beatmapStars(s: Record<string, unknown>): number | null {
  const bm = asRecord(s.beatmap ?? {});
  const d = num(bm.difficulty_rating);
  if (d != null && d > 0) return d;
  const diff = asRecord(bm.difficulty ?? {});
  return num(diff.nominal_rating) ?? num(diff.stars) ?? num(diff.difficulty_rating);
}

function mapLabelFromScore(s: Record<string, unknown>): string {
  const bs = asRecord(s.beatmapset ?? {});
  const artist = String(bs.artist ?? bs.artist_unicode ?? "").trim();
  const title = String(bs.title ?? bs.title_unicode ?? "").trim();
  const line = artist && title ? `${artist} — ${title}` : title || artist || "Map";
  return line.length > 48 ? `${line.slice(0, 46)}…` : line;
}

function modsLabel(mods: unknown): string {
  if (mods == null) return "NM";
  if (Array.isArray(mods)) {
    const parts = mods.map((x) => String(x)).filter(Boolean);
    return parts.length ? parts.join("+") : "NM";
  }
  if (typeof mods === "string" && mods.trim()) return mods.trim();
  if (typeof mods === "number" && mods !== 0) return String(mods);
  return "NM";
}

export function parseScoresDetailed(raw: unknown): EnrichedScore[] {
  const list = extractScoreArray(raw);
  const out: EnrichedScore[] = [];
  for (const item of list) {
    const s = asRecord(item);
    const pp = num(s.pp);
    const accPct = num(s.accuracy);
    const rank = String(s.rank ?? s.grade ?? "?").trim() || "?";
    const atRaw = s.created_at ?? s.ended_at;
    let atMs: number | null = null;
    if (typeof atRaw === "string") {
      const t = Date.parse(atRaw);
      atMs = Number.isFinite(t) ? t : null;
    } else if (typeof atRaw === "number" && Number.isFinite(atRaw)) {
      atMs = atRaw > 1e12 ? atRaw : atRaw * 1000;
    }
    out.push({
      pp,
      accuracy: accPct,
      rank,
      stars: beatmapStars(s),
      label: mapLabelFromScore(s),
      beatmapsetId: scoreBeatmapsetId(s),
      modsLabel: modsLabel(s.mods),
      atMs,
    });
  }
  return out;
}

type RadarSolo = Record<"PP" | "Accuracy" | "Volume" | "Rank" | "Hits" | "Grades", number>;

export function soloRadar(row: ParsedRow): RadarSolo {
  const ppN = Math.min(100, ((row.pp ?? 0) / 10_000) * 100);
  const accN = Math.min(100, row.accuracy ?? 0);
  const playN = Math.min(100, (Math.log10((row.playCount ?? 0) + 1) / Math.log10(50_000)) * 100);
  const gr = row.globalRank;
  const rankN = gr == null ? 0 : Math.min(100, (1 - Math.min(gr, 999_999) / 1_000_000) * 100);
  const hitsN = Math.min(100, ((row.totalHits ?? 0) / 5_000_000) * 100);
  const gradeW = row.gradeSS * 3 + row.gradeS * 2 + row.gradeA;
  const gradeN = Math.min(100, Math.sqrt(gradeW / Math.max(1, row.playCount ?? 1)) * 25);
  return {
    PP: Math.round(ppN),
    Accuracy: Math.round(accN),
    Volume: Math.round(playN),
    Rank: Math.round(rankN),
    Hits: Math.round(hitsN),
    Grades: Math.round(gradeN),
  };
}

export function radarRowsFromRuleset(row: ParsedRow | null): { metric: string; You: number }[] {
  if (!row || row.error) return [];
  const n = soloRadar(row);
  const keys = Object.keys(n) as (keyof RadarSolo)[];
  return keys.map((k) => ({ metric: k, You: n[k] }));
}

export function formatInt(n: number | null): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString();
}

export function ppHistogramBucket(pp: number): string {
  if (!Number.isFinite(pp) || pp < 0) return "0–100";
  if (pp >= 500) return "500+";
  const lo = Math.floor(pp / 100) * 100;
  return `${lo}–${lo + 100}`;
}

export function starHistogramBucket(stars: number): string {
  if (!Number.isFinite(stars) || stars < 0) return "—";
  if (stars >= 7) return "7+";
  const lo = Math.floor(stars);
  return `${lo}–${lo + 1}`;
}

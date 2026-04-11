export type Mode = "osu" | "taiko" | "fruits" | "mania";

export const MODE_API: Record<Mode, number> = {
  osu: 0,
  taiko: 1,
  fruits: 2,
  mania: 3,
};

export const SEARCH_MODE_OPTIONS = [
  { value: "osu", label: "osu!" },
  { value: "taiko", label: "Taiko" },
  { value: "fruits", label: "Catch" },
  { value: "mania", label: "Mania" },
] as const;

export const SEARCH_SECTION_OPTIONS = [
  { value: "ranked", label: "Ranked" },
  { value: "qualified", label: "Qualified" },
  { value: "loved", label: "Loved" },
  { value: "pending", label: "Pending" },
  { value: "graveyard", label: "Graveyard" },
] as const;

export const SEARCH_SORT_OPTIONS = [
  { value: "plays_desc", label: "Play count (high → low)" },
  {
    value: "difficulty_desc",
    label: "PP / star rating (high → low)",
  },
  { value: "favourites_desc", label: "Favourites" },
  { value: "ranked_desc", label: "Recently ranked" },
  { value: "rating_desc", label: "User rating" },
  { value: "title_asc", label: "Title A–Z" },
] as const;

/** Max API pages to walk when building curated lists; avoids unbounded requests. */
export const CURATE_PAGE_CAP = 8;
export const CURATE_PICK_COUNT = 8;

export interface SearchInput {
  q?: string | null;
  m?: number | null;
  s?: string | null;
  sort?: string | null;
  cursor_string?: string | null;
  g?: number | null;
  l?: number | null;
  e?: string | null;
  c?: string | null;
  r?: string | null;
  nsfw?: boolean | null;
}

/** Beatmap in this mode with the highest star rating (for PP cap display). */
export function topBeatmapIdForMode(rawSet: unknown, mode: Mode): number | null {
  const set = rawSet as Record<string, unknown>;
  const beatmaps = (set.beatmaps as Record<string, unknown>[]) || [];
  let bestId: number | null = null;
  let bestStars = -1;
  for (const b of beatmaps) {
    if (b.mode !== mode) continue;
    const id = Number(b.id);
    const stars = Number(b.difficulty_rating ?? 0);
    if (!Number.isFinite(id)) continue;
    if (stars > bestStars) {
      bestStars = stars;
      bestId = id;
    }
  }
  return bestId;
}

export function filterSetsByModeAndStars(
  sets: unknown[],
  mode: Mode,
  minStars: string,
  maxStars: string,
): unknown[] {
  const min = minStars.trim() === "" ? undefined : Number(minStars);
  const max = maxStars.trim() === "" ? undefined : Number(maxStars);
  return sets.filter((raw) => {
    const set = raw as Record<string, unknown>;
    const avail = set.availability as Record<string, unknown> | undefined;
    if (avail?.download_disabled === true) return false;
    const beatmaps = (set.beatmaps as Record<string, unknown>[]) || [];
    const ok = beatmaps.some((b) => {
      if (b.mode !== mode) return false;
      const stars = Number(b.difficulty_rating ?? 0);
      if (min !== undefined && !Number.isNaN(min) && stars < min) return false;
      if (max !== undefined && !Number.isNaN(max) && stars > max) return false;
      return true;
    });
    return ok;
  });
}

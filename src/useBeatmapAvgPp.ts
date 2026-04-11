import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Mode } from "./searchTypes";

function normalizeAvgPp(raw: unknown): Record<number, number | null> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<number, number | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(k);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (v === null || v === undefined) out[id] = null;
    else {
      const pp = Number(v);
      out[id] = Number.isFinite(pp) ? pp : null;
    }
  }
  return out;
}

/**
 * Mean PP on osu! global top scores for each beatmap (OAuth required; same token as search).
 */
export function useBeatmapAvgPp(
  beatmapIds: (number | null | undefined)[],
  ruleset: Mode,
) {
  const [avg, setAvg] = useState<Record<number, number | null>>({});
  const avgRef = useRef(avg);
  avgRef.current = avg;

  const key = useMemo(() => {
    const u = new Set<number>();
    for (const x of beatmapIds) {
      if (x != null && Number.isFinite(x) && x > 0) u.add(x);
    }
    return `${ruleset}:${[...u].sort((a, b) => a - b).join(",")}`;
  }, [beatmapIds, ruleset]);

  useEffect(() => {
    const rest = key.slice(key.indexOf(":") + 1);
    const ids =
      rest.length === 0
        ? []
        : rest
            .split(",")
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n) && n > 0);
    const missing = ids.filter((id) => avgRef.current[id] === undefined);
    if (missing.length === 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const raw = await invoke<unknown>("get_beatmap_avg_pp", {
          beatmapIds: missing,
          ruleset,
        });
        if (cancelled) return;
        const next = normalizeAvgPp(raw);
        setAvg((prev) => ({ ...prev, ...next }));
      } catch {
        const fallback: Record<number, number | null> = {};
        for (const id of missing) fallback[id] = null;
        if (!cancelled) setAvg((prev) => ({ ...prev, ...fallback }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, ruleset]);

  return avg;
}

export function formatAvgPp(pp: number | null | undefined): string {
  if (pp === null || pp === undefined || !Number.isFinite(pp)) return "—";
  const rounded = Math.round(pp * 10) / 10;
  return Number.isInteger(rounded) ? String(Math.round(rounded)) : rounded.toFixed(1);
}

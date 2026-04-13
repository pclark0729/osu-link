import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { asRecord } from "./battles/battleUtils";

/**
 * Resolves osu! usernames via the authenticated API for the given numeric ids.
 * Non-Tauri builds return an empty map (callers fall back to {@link displayNameForOsu}).
 */
export function useOsuProfileUsernames(osuIds: readonly number[]): Map<number, string> {
  const [map, setMap] = useState<Map<number, string>>(() => new Map());
  const inFlightRef = useRef<Set<number>>(new Set());
  const mapRef = useRef(map);
  mapRef.current = map;

  const idsKey = useMemo(
    () =>
      [...new Set(osuIds.filter((n) => Number.isFinite(n) && n > 0))]
        .sort((a, b) => a - b)
        .join(","),
    [osuIds],
  );

  useEffect(() => {
    if (!isTauri()) return;
    const ids = idsKey ? idsKey.split(",").map((s) => Number(s)) : [];
    let cancelled = false;

    void (async () => {
      for (const id of ids) {
        if (cancelled) return;
        if (mapRef.current.has(id) || inFlightRef.current.has(id)) continue;
        inFlightRef.current.add(id);
        try {
          const raw = await invoke<unknown>("osu_user_profile", { userId: id });
          if (cancelled) return;
          const pr = asRecord(raw);
          const name = String(pr.username ?? "").trim();
          if (name) {
            setMap((prev) => {
              if (prev.has(id)) return prev;
              const next = new Map(prev);
              next.set(id, name);
              return next;
            });
          }
        } catch {
          /* leave unset */
        } finally {
          inFlightRef.current.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  return map;
}

import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";

import type { Mode } from "./searchTypes";
import { formatAvgPp, useBeatmapAvgPp } from "./useBeatmapAvgPp";

export type BeatmapsetDetailTarget = {
  beatmapsetId: number;
  /** Search/curate: full API object. Omit when opening from collection (fetch by id). */
  initialRaw?: unknown;
};

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function extractUserBest(row: unknown): { pp: string; acc: string; rank: string } | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const scoreObj = o.score != null && typeof o.score === "object" ? (o.score as Record<string, unknown>) : o;
  const ppVal = num(scoreObj.pp);
  const accVal = num(scoreObj.accuracy);
  const rankRaw = scoreObj.rank;
  const rankVal = typeof rankRaw === "string" ? rankRaw : "";
  if (ppVal == null && accVal == null && !rankVal) return null;
  const pp =
    ppVal != null && Number.isFinite(ppVal)
      ? `${ppVal.toFixed(ppVal >= 100 ? 0 : 1)} pp`
      : "—";
  const acc =
    accVal != null && Number.isFinite(accVal)
      ? `${(accVal <= 1 ? accVal * 100 : accVal).toFixed(accVal <= 1 ? 2 : 1)}%`
      : "—";
  return { pp, acc, rank: rankVal || "—" };
}

export function BeatmapsetDetailModal({
  open,
  onClose,
  target,
  mode,
  meOsuId,
}: {
  open: boolean;
  onClose: () => void;
  target: BeatmapsetDetailTarget | null;
  mode: Mode;
  meOsuId: number | null;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const [setData, setSetData] = useState<unknown | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadingSet, setLoadingSet] = useState(false);
  const [userBests, setUserBests] = useState<Record<number, unknown | null | undefined>>({});
  const [loadingBests, setLoadingBests] = useState(false);

  /** Prefer inline search payload immediately; otherwise fetched `setData`. */
  const resolvedSetData = useMemo(() => {
    if (!open || !target) return null;
    if (target.initialRaw != null) return target.initialRaw;
    return setData;
  }, [open, target, setData]);

  useEffect(() => {
    if (!open || !target) {
      setSetData(null);
      setFetchError(null);
      setUserBests({});
      return;
    }

    if (target.initialRaw != null) {
      setSetData(target.initialRaw);
      setFetchError(null);
      setLoadingSet(false);
      return;
    }

    let cancelled = false;
    setLoadingSet(true);
    setFetchError(null);
    setSetData(null);
    void (async () => {
      try {
        const v = await invoke<unknown>("get_beatmapset", { beatmapsetId: target.beatmapsetId });
        if (!cancelled) {
          setSetData(v);
          setFetchError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setFetchError(String(e));
          setSetData(null);
        }
      } finally {
        if (!cancelled) setLoadingSet(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, target]);

  const rows = useMemo(() => {
    if (!resolvedSetData || typeof resolvedSetData !== "object") return [];
    const set = resolvedSetData as Record<string, unknown>;
    const beatmaps = (set.beatmaps as Record<string, unknown>[]) || [];
    const filtered = beatmaps.filter((b) => b.mode === mode);
    filtered.sort((a, b) => {
      const sa = num(a.difficulty_rating) ?? 0;
      const sb = num(b.difficulty_rating) ?? 0;
      return sa - sb;
    });
    return filtered;
  }, [resolvedSetData, mode]);

  const avgPpIds = useMemo(() => rows.map((b) => num(b.id)).filter((id): id is number => id != null && id > 0), [rows]);
  const avgPp = useBeatmapAvgPp(avgPpIds, mode);

  useEffect(() => {
    if (!open || rows.length === 0 || meOsuId == null || meOsuId <= 0) {
      setUserBests({});
      setLoadingBests(false);
      return;
    }
    const ids = avgPpIds;
    if (ids.length === 0) return;

    let cancelled = false;
    setLoadingBests(true);
    void (async () => {
      try {
        const raw = await invoke<Record<string, unknown>>("get_user_bests_on_beatmaps", {
          beatmapIds: ids,
          userId: meOsuId,
          ruleset: mode,
        });
        if (cancelled) return;
        const next: Record<number, unknown | null | undefined> = {};
        const r = raw as Record<string, unknown>;
        for (const id of ids) {
          next[id] = r[String(id)];
        }
        setUserBests(next);
      } catch {
        if (!cancelled) setUserBests({});
      } finally {
        if (!cancelled) setLoadingBests(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, rows.length, meOsuId, mode, avgPpIds]);

  useEffect(() => {
    if (!open || !target) return;
    lastFocusRef.current = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      const el = lastFocusRef.current;
      lastFocusRef.current = null;
      if (el && typeof el.focus === "function") {
        try {
          el.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, [open, target]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onDialogKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const list = Array.from(nodes).filter((el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true");
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const onBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open || !target) return null;

  const set =
    resolvedSetData && typeof resolvedSetData === "object"
      ? (resolvedSetData as Record<string, unknown>)
      : null;
  const covers = set?.covers as Record<string, string> | undefined;
  const title = set ? str(set.title) : "";
  const artist = set ? str(set.artist) : "";
  const creator = set ? str(set.creator) : "";
  const status = set && set.status != null ? str(set.status) : "";
  const source = set && set.source != null ? str(set.source) : "";
  const tags = set && set.tags != null ? str(set.tags) : "";
  const playCount = num(set?.play_count);
  const favCount = num(set?.favourite_count);
  const bpm = num(set?.bpm);

  return (
    <div
      className="beatmapset-detail-backdrop"
      role="presentation"
      onClick={onBackdropClick}
    >
      <div
        ref={dialogRef}
        className="beatmapset-detail-dialog panel panel-elevated"
        role="dialog"
        aria-modal="true"
        aria-labelledby="beatmapset-detail-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="beatmapset-detail-head">
          <h2 id="beatmapset-detail-title" className="beatmapset-detail-title">
            Map details
          </h2>
          <button ref={closeRef} type="button" className="secondary beatmapset-detail-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        {loadingSet && (
          <p className="hint" aria-live="polite">
            Loading beatmap set…
          </p>
        )}
        {fetchError && (
          <p className="error-banner" role="alert">
            {fetchError}
          </p>
        )}

        {!loadingSet && resolvedSetData != null && set != null && (
          <>
            <div className="beatmapset-detail-hero">
              {(covers?.cover ?? covers?.list) && (
                <img
                  src={covers?.cover ?? covers?.list ?? ""}
                  alt=""
                  className="beatmapset-detail-cover"
                />
              )}
              <div className="beatmapset-detail-hero-text">
                <div className="beatmapset-detail-map-title">{title}</div>
                <div className="beatmapset-detail-sub">
                  {artist}
                  {creator ? ` — mapped by ${creator}` : ""}
                </div>
                <div className="beatmapset-detail-meta-line">
                  {status && <span className="tag">{status}</span>}
                  {bpm != null && <span className="tag">BPM {Math.round(bpm)}</span>}
                  {playCount != null && (
                    <span className="tag" title="Total plays across difficulties">
                      Plays {playCount.toLocaleString()}
                    </span>
                  )}
                  {favCount != null && (
                    <span className="tag" title="Favourites">
                      Favs {favCount.toLocaleString()}
                    </span>
                  )}
                </div>
                {source ? (
                  <p className="beatmapset-detail-source">
                    <span className="muted">Source:</span> {source}
                  </p>
                ) : null}
                {tags ? (
                  <p className="beatmapset-detail-tags">
                    <span className="muted">Tags:</span> {tags}
                  </p>
                ) : null}
              </div>
            </div>

            <p className="hint beatmapset-detail-ruleset-hint">
              Difficulties for <strong>{mode}</strong> (same as Search).
            </p>

            {rows.length === 0 ? (
              <p className="hint">No difficulties for this ruleset in this set.</p>
            ) : (
              <div className="beatmapset-detail-table-wrap">
                <table className="beatmapset-detail-table">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>Stars</th>
                      <th>Length</th>
                      <th>CS</th>
                      <th>AR</th>
                      <th>OD</th>
                      <th>HP</th>
                      <th>Avg PP</th>
                      <th>Your best</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => {
                      const id = num(b.id);
                      const version = str(b.version) || "—";
                      const stars = num(b.difficulty_rating);
                      const lenSec = num(b.total_length);
                      const cs = num(b.cs);
                      const ar = num(b.ar);
                      const od = num(b.accuracy);
                      const hp = num(b.drain);
                      const sid = id ?? 0;
                      const ppAvg = id != null ? avgPp[id] : undefined;
                      const bestRaw = id != null ? userBests[id] : undefined;
                      const best = bestRaw !== undefined ? extractUserBest(bestRaw) : null;

                      return (
                        <tr key={sid || version}>
                          <td className="beatmapset-detail-version">{version}</td>
                          <td>{stars != null ? stars.toFixed(2) : "—"}</td>
                          <td>{formatDuration(lenSec)}</td>
                          <td>{cs != null ? cs.toFixed(1) : "—"}</td>
                          <td>{ar != null ? ar.toFixed(1) : "—"}</td>
                          <td>{od != null ? od.toFixed(1) : "—"}</td>
                          <td>{hp != null ? hp.toFixed(1) : "—"}</td>
                          <td className="tabular-nums">
                            {id == null
                              ? "—"
                              : ppAvg === undefined
                                ? "…"
                                : ppAvg === null
                                  ? "—"
                                  : `${formatAvgPp(ppAvg)} pp`}
                          </td>
                          <td className="beatmapset-detail-pb">
                            {meOsuId == null ? (
                              <span className="muted">—</span>
                            ) : loadingBests ? (
                              "…"
                            ) : best ? (
                              <span title={`Accuracy ${best.acc}`}>
                                {best.rank} · {best.pp}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {meOsuId == null && (
              <p className="hint beatmapset-detail-pb-hint">Sign in to see your best on each difficulty.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

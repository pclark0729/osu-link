import type { CollectionItem } from "./models";
import { type Mode, topBeatmapIdForMode } from "./searchTypes";
import { formatAvgPp } from "./useBeatmapAvgPp";

function AvgPpLine({
  beatmapId,
  avgPp,
}: {
  beatmapId: number | null;
  avgPp: Record<number, number | null>;
}) {
  if (beatmapId == null) return null;
  const v = avgPp[beatmapId];
  return (
    <div
      className="result-meta-pp-cap"
      title="Average PP from global top scores on this difficulty."
    >
      Avg PP: {v === undefined ? "…" : v === null ? "—" : `${formatAvgPp(v)} pp`}
    </div>
  );
}

export function BeatmapResultCard({
  raw,
  mode,
  avgPp,
  directImportSetId,
  activeItems,
  localBeatmapsetIds,
  importFromSearch,
  sendBeatmapToParty,
  addToCollection,
  showPartyActions,
  showCollectionActions,
  partyCanSend,
  onInspectSet,
}: {
  raw: unknown;
  mode: Mode;
  avgPp: Record<number, number | null>;
  directImportSetId: number | null;
  activeItems: CollectionItem[];
  localBeatmapsetIds: Set<number>;
  importFromSearch: (beatmapsetId: number) => void | Promise<void>;
  /** Opens detail modal with full search result payload. */
  onInspectSet?: (raw: unknown) => void;
  sendBeatmapToParty: (meta: {
    beatmapsetId: number;
    artist: string;
    title: string;
    creator: string;
    coverUrl?: string | null;
  }) => void;
  addToCollection: (set: Record<string, unknown>) => void;
  showPartyActions: boolean;
  showCollectionActions: boolean;
  partyCanSend: boolean;
}) {
  const set = raw as Record<string, unknown>;
  const covers = set.covers as Record<string, string> | undefined;
  const sid = Number(set.id);
  const disabledDl =
    (set.availability as { download_disabled?: boolean } | undefined)?.download_disabled === true;
  const inColl = activeItems.some((c) => c.beatmapsetId === sid);
  const importingThis = directImportSetId === sid;
  const locallyPresent = localBeatmapsetIds.has(sid);
  return (
    <div
      className={`result-card${onInspectSet ? " result-card--clickable" : ""}`}
      role={onInspectSet ? "article" : undefined}
      aria-label={onInspectSet ? "Open map details" : undefined}
      onClick={onInspectSet ? () => onInspectSet(raw) : undefined}
    >
      <img src={covers?.list || covers?.card || ""} alt="" loading="lazy" />
      <div className="result-meta">
        <div className="title">{String(set.title)}</div>
        <div className="sub">
          {String(set.artist)} — mapped by {String(set.creator)}
        </div>
        <AvgPpLine beatmapId={topBeatmapIdForMode(raw, mode)} avgPp={avgPp} />
        {set.status != null && <span className="tag">{String(set.status)}</span>}
        {locallyPresent && <span className="tag tag-local">In Songs folder</span>}
      </div>
      <div className="result-actions">
        <button
          type="button"
          className="primary"
          disabled={disabledDl || locallyPresent || importingThis || directImportSetId !== null}
          onClick={(e) => {
            e.stopPropagation();
            void importFromSearch(sid);
          }}
        >
          {locallyPresent ? "Already imported" : importingThis ? "Importing…" : "Import now"}
        </button>
        {showPartyActions && (
          <button
            type="button"
            className="secondary"
            disabled={!partyCanSend || disabledDl}
            onClick={(e) => {
              e.stopPropagation();
              sendBeatmapToParty({
                beatmapsetId: sid,
                artist: String(set.artist ?? ""),
                title: String(set.title ?? ""),
                creator: String(set.creator ?? ""),
                coverUrl: covers?.list ?? covers?.card ?? null,
              });
            }}
            title={
              partyCanSend
                ? "Leader: queue this set for everyone in the lobby"
                : "Create or join a lobby as leader"
            }
          >
            Send to party
          </button>
        )}
        {showCollectionActions && (
          <button
            type="button"
            className="secondary"
            disabled={inColl}
            onClick={(e) => {
              e.stopPropagation();
              addToCollection(set);
            }}
          >
            {inColl ? "In this collection" : "Add to collection"}
          </button>
        )}
      </div>
    </div>
  );
}

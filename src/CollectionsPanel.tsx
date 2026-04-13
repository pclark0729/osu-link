import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";
import { NeuSelect, type NeuSelectOption } from "./NeuSelect";
import { getActiveCollection, type CollectionItem, type CollectionStore } from "./models";

type ToastTone = "info" | "success" | "error";

type StatusFilter = "all" | "pending" | "downloading" | "error" | "imported";
type LibraryFilter = "all" | "inLibrary" | "notInLibrary";
type SortKey = "title" | "artist" | "status";

const STATUS_SORT_ORDER: Record<string, number> = {
  pending: 0,
  downloading: 1,
  error: 2,
  imported: 3,
};

function statusOrder(s: string): number {
  return STATUS_SORT_ORDER[s] ?? 99;
}

function countByStatus(items: CollectionItem[]) {
  const acc = { pending: 0, downloading: 0, error: 0, imported: 0 };
  for (const it of items) {
    if (it.status === "pending") acc.pending += 1;
    else if (it.status === "downloading") acc.downloading += 1;
    else if (it.status === "error") acc.error += 1;
    else if (it.status === "imported") acc.imported += 1;
  }
  return acc;
}

export interface CollectionsPanelProps {
  collectionStore: CollectionStore;
  setActiveCollectionId: (id: string) => void;
  createCollection: () => void;
  deleteActiveCollection: () => void;
  duplicateActiveCollection: () => void;
  commitCollectionRename: (name: string) => void;
  localBeatmapsetIds: Set<number>;
  importFileRef: RefObject<HTMLInputElement | null>;
  onImportSharedFile: (e: ChangeEvent<HTMLInputElement>) => void;
  exportSharedCollectionFile: () => void;
  copySharedCollectionJson: () => void;
  importSharedFromClipboard: () => void;
  importOne: (item: CollectionItem) => Promise<void>;
  importItemsQueue: (items: CollectionItem[]) => Promise<void>;
  removeFromCollection: (itemId: string) => void;
  removeItemsFromCollection: (itemIds: string[]) => Promise<void>;
  importBusy: boolean;
  noVideo: boolean;
  setNoVideo: (v: boolean) => void;
  partyCanSend: boolean;
  sendBeatmapToParty: (meta: {
    beatmapsetId: number;
    artist: string;
    title: string;
    creator: string;
    coverUrl?: string | null;
  }) => void;
  pushToast: (tone: ToastTone, message: string) => void;
  onGoToSearch: () => void;
  /** Open beatmap set detail (fetch by id). */
  onInspectBeatmapset?: (beatmapsetId: number) => void;
}

export function CollectionsPanel({
  collectionStore,
  setActiveCollectionId,
  createCollection,
  deleteActiveCollection,
  duplicateActiveCollection,
  commitCollectionRename,
  localBeatmapsetIds,
  importFileRef,
  onImportSharedFile,
  exportSharedCollectionFile,
  copySharedCollectionJson,
  importSharedFromClipboard,
  importOne,
  importItemsQueue,
  removeFromCollection,
  removeItemsFromCollection,
  importBusy,
  noVideo,
  setNoVideo,
  partyCanSend,
  sendBeatmapToParty,
  pushToast,
  onGoToSearch,
  onInspectBeatmapset,
}: CollectionsPanelProps) {
  const activeCollection = getActiveCollection(collectionStore);
  const activeItems = activeCollection?.items ?? [];

  const totalMapsAcrossCollections = useMemo(
    () => collectionStore.collections.reduce((acc, c) => acc + c.items.length, 0),
    [collectionStore.collections],
  );

  const [nameDraft, setNameDraft] = useState(activeCollection?.name ?? "");
  const [renameEditing, setRenameEditing] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNameDraft(activeCollection?.name ?? "");
  }, [activeCollection?.id, activeCollection?.name]);

  useEffect(() => {
    setRenameEditing(false);
  }, [activeCollection?.id]);

  useEffect(() => {
    if (!renameEditing) return;
    const t = window.requestAnimationFrame(() => {
      const el = renameInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
    return () => window.cancelAnimationFrame(t);
  }, [renameEditing]);

  const [listQuery, setListQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkAnnounce, setBulkAnnounce] = useState<string | null>(null);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeCollection?.id, listQuery, statusFilter, libraryFilter, sortKey]);

  useEffect(() => {
    if (!bulkAnnounce) return;
    const t = window.setTimeout(() => setBulkAnnounce(null), 4000);
    return () => window.clearTimeout(t);
  }, [bulkAnnounce]);

  const statusCounts = useMemo(() => countByStatus(activeItems), [activeItems]);
  const inLibraryCount = useMemo(
    () => activeItems.filter((i) => localBeatmapsetIds.has(i.beatmapsetId)).length,
    [activeItems, localBeatmapsetIds],
  );

  const pendingItems = useMemo(() => activeItems.filter((i) => i.status === "pending"), [activeItems]);
  const errorItems = useMemo(() => activeItems.filter((i) => i.status === "error"), [activeItems]);
  const queueItems = useMemo(
    () => activeItems.filter((i) => i.status !== "imported"),
    [activeItems],
  );

  const filteredSortedItems = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    let list = activeItems.filter((item) => {
      if (q) {
        const hay = `${item.title} ${item.artist} ${item.creator} ${String(item.beatmapsetId)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      const inLib = localBeatmapsetIds.has(item.beatmapsetId);
      if (libraryFilter === "inLibrary" && !inLib) return false;
      if (libraryFilter === "notInLibrary" && inLib) return false;
      return true;
    });

    const cmpTitle = (a: CollectionItem, b: CollectionItem) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    const cmpArtist = (a: CollectionItem, b: CollectionItem) =>
      a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" });
    const cmpStatus = (a: CollectionItem, b: CollectionItem) => {
      const d = statusOrder(a.status) - statusOrder(b.status);
      if (d !== 0) return d;
      return cmpTitle(a, b);
    };

    list = [...list];
    if (sortKey === "title") list.sort(cmpTitle);
    else if (sortKey === "artist") list.sort(cmpArtist);
    else list.sort(cmpStatus);
    return list;
  }, [activeItems, listQuery, statusFilter, libraryFilter, sortKey, localBeatmapsetIds]);

  const visibleIds = useMemo(() => filteredSortedItems.map((i) => i.id), [filteredSortedItems]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id)) && !allVisibleSelected;

  const toggleSelectAllVisible = useCallback(() => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.add(id);
        return next;
      });
    }
  }, [allVisibleSelected, visibleIds]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedItems = useMemo(
    () => activeItems.filter((i) => selectedIds.has(i.id)),
    [activeItems, selectedIds],
  );

  const selectedImportable = useMemo(
    () => selectedItems.filter((i) => i.status === "pending" || i.status === "error"),
    [selectedItems],
  );

  const handleBulkRemove = () => {
    if (selectedIds.size === 0) return;
    const n = selectedIds.size;
    const ids = [...selectedIds];
    if (!window.confirm(`Remove ${n} map(s) from this collection?`)) return;
    void removeItemsFromCollection(ids).then(() => {
      setSelectedIds(new Set());
      setBulkAnnounce(`Removed ${n} map(s) from the collection.`);
      pushToast("success", `Removed ${n} map(s).`);
    });
  };

  const handleBulkImport = () => {
    if (selectedImportable.length === 0) {
      pushToast("info", "No selected maps are pending or failed — nothing to import.");
      return;
    }
    const n = selectedImportable.length;
    void importItemsQueue(selectedImportable).then(() => {
      setBulkAnnounce(`Finished import batch (${n} map${n === 1 ? "" : "s"}).`);
    });
  };

  const handleDeleteCollection = () => {
    if (collectionStore.collections.length <= 1) return;
    if (
      !window.confirm(
        "Delete this collection permanently? Maps in the list are only references — this removes the list from osu-link.",
      )
    ) {
      return;
    }
    deleteActiveCollection();
  };

  const collectionOptions = useMemo((): NeuSelectOption[] => {
    return collectionStore.collections.map((c) => ({
      value: c.id,
      label: `${c.name} (${c.items.length})`,
    }));
  }, [collectionStore.collections]);

  const statusFilterOptions = useMemo((): NeuSelectOption[] => {
    const c = statusCounts;
    const n = activeItems.length;
    return [
      { value: "all", label: `All (${n})` },
      { value: "pending", label: `Pending (${c.pending})` },
      { value: "downloading", label: `Downloading (${c.downloading})` },
      { value: "error", label: `Error (${c.error})` },
      { value: "imported", label: `Imported (${c.imported})` },
    ];
  }, [activeItems.length, statusCounts]);

  const libraryFilterOptions = useMemo((): NeuSelectOption[] => {
    const notInLib = activeItems.length - inLibraryCount;
    return [
      { value: "all", label: "Library: all maps" },
      { value: "inLibrary", label: `In Songs folder (${inLibraryCount})` },
      { value: "notInLibrary", label: `Not in Songs (${notInLib})` },
    ];
  }, [activeItems.length, inLibraryCount]);

  const sortOptions = useMemo(
    (): NeuSelectOption[] => [
      { value: "title", label: "Sort: title" },
      { value: "artist", label: "Sort: artist" },
      { value: "status", label: "Sort: status" },
    ],
    [],
  );

  const filtersActive =
    listQuery.trim() !== "" || statusFilter !== "all" || libraryFilter !== "all";

  const clearListFilters = () => {
    setListQuery("");
    setStatusFilter("all");
    setLibraryFilter("all");
  };

  const commitRenameAndClose = useCallback(() => {
    commitCollectionRename(nameDraft);
    setRenameEditing(false);
  }, [commitCollectionRename, nameDraft]);

  const cancelRename = useCallback(() => {
    setNameDraft(activeCollection?.name ?? "");
    setRenameEditing(false);
  }, [activeCollection?.name]);

  return (
    <div className="panel panel-elevated collections-panel" data-ui-density="compact">
      <div className="collection-summary-strip" role="status" aria-label="Collection overview">
        <span className="collection-summary-item">
          <strong>{activeItems.length}</strong> in this list
        </span>
        <span className="collection-summary-item">
          <strong>{totalMapsAcrossCollections}</strong> across all lists
        </span>
        <span className="collection-summary-item">
          Pending <strong>{statusCounts.pending}</strong> · Downloading <strong>{statusCounts.downloading}</strong> ·
          Error <strong>{statusCounts.error}</strong> · Imported <strong>{statusCounts.imported}</strong>
        </span>
        <span className="collection-summary-item collection-summary-item--accent">
          In Songs <strong>{inLibraryCount}</strong>/<strong>{activeItems.length}</strong>
        </span>
      </div>
      <input
        ref={importFileRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        onChange={(e) => void onImportSharedFile(e)}
      />

      <div className="collection-toolbar">
        <div className="collection-toolbar-top">
          <div
            className="collection-switcher-wrap"
            role="group"
            aria-labelledby="collection-switcher-label"
          >
            <span className="collection-switcher-label" id="collection-switcher-label">
              Active list
            </span>
            <NeuSelect
              id="collection-active-select"
              value={activeCollection?.id ?? collectionStore.collections[0]?.id ?? ""}
              options={collectionOptions}
              onChange={(id) => setActiveCollectionId(id)}
            />
          </div>
          <div className="collection-toolbar-buttons" aria-label="Collection actions">
            {renameEditing ? (
              <div className="collection-rename-inline">
                <input
                  ref={renameInputRef}
                  type="text"
                  className="collection-rename-input"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => commitRenameAndClose()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRenameAndClose();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  placeholder="List name"
                  aria-label="Rename current collection"
                />
              </div>
            ) : (
              <button type="button" className="secondary" onClick={() => setRenameEditing(true)}>
                Rename
              </button>
            )}
            <button type="button" className="secondary" onClick={createCollection}>
              New
            </button>
            <button type="button" className="secondary" onClick={duplicateActiveCollection}>
              Duplicate
            </button>
            <button
              type="button"
              className="danger"
              disabled={collectionStore.collections.length <= 1}
              onClick={handleDeleteCollection}
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="collection-filters-shell">
        <label className="field collection-search-field">
          <span id="collection-search-label">Search this list</span>
          <input
            type="search"
            autoComplete="off"
            placeholder="Title, artist, mapper, set ID…"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setListQuery("");
              }
            }}
            aria-labelledby="collection-search-label"
          />
        </label>
        <div className="collection-controls-row collection-controls-row--selects">
          <div className="collection-filter-selects">
            <div className="collection-filter-slot">
              <NeuSelect
                value={statusFilter}
                options={statusFilterOptions}
                onChange={(v) => setStatusFilter(v as StatusFilter)}
                id="collection-status-filter"
              />
            </div>
            <div className="collection-filter-slot">
              <NeuSelect
                value={libraryFilter}
                options={libraryFilterOptions}
                onChange={(v) => setLibraryFilter(v as LibraryFilter)}
                id="collection-library-filter"
              />
            </div>
            <div className="collection-filter-slot">
              <NeuSelect
                value={sortKey}
                options={sortOptions}
                onChange={(v) => setSortKey(v as SortKey)}
                id="collection-sort"
              />
            </div>
          </div>
          {filtersActive ? (
            <button type="button" className="secondary collection-clear-filters" onClick={clearListFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      <div className="collection-import-actions" role="group" aria-label="Import from queue">
        <div className="collection-import-buttons">
          <button
            type="button"
            className="primary"
            disabled={importBusy || pendingItems.length === 0}
            onClick={() => void importItemsQueue(pendingItems)}
          >
            {importBusy ? "Importing…" : `Import pending (${pendingItems.length})`}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={importBusy || errorItems.length === 0}
            onClick={() => void importItemsQueue(errorItems)}
          >
            Retry failed ({errorItems.length})
          </button>
          <button
            type="button"
            className="secondary"
            disabled={importBusy || queueItems.length === 0}
            onClick={() => void importItemsQueue(queueItems)}
          >
            Import all queued ({queueItems.length})
          </button>
          <label className="checkbox-row collection-import-no-video">
            <input type="checkbox" checked={noVideo} onChange={(e) => setNoVideo(e.target.checked)} />
            No video
          </label>
        </div>
        {importBusy && (
          <p className="hint collection-import-hint" role="status">
            Importing…
          </p>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="collection-bulk-bar" role="region" aria-label="Bulk actions">
          <span className="collection-bulk-count">{selectedIds.size} selected</span>
          <button type="button" className="secondary" disabled={importBusy} onClick={() => void handleBulkImport()}>
            Import selected ({selectedImportable.length} queued)
          </button>
          <button type="button" className="danger" onClick={() => void handleBulkRemove()}>
            Remove selected
          </button>
        </div>
      )}

      {bulkAnnounce ? (
        <p className="hint collection-bulk-announce" role="status" aria-live="polite">
          {bulkAnnounce}
        </p>
      ) : null}

      <details className="collection-share-details">
        <summary>Share or import a collection</summary>
        <div className="share-panel">
          <div className="share-panel-title">Share this collection</div>
          <p className="share-panel-desc">
            Import always creates a <strong>new</strong> list — nothing is overwritten.
          </p>
          <div className="share-actions">
            <button
              type="button"
              className="secondary"
              disabled={activeItems.length === 0}
              onClick={exportSharedCollectionFile}
            >
              Export .osu-link.json
            </button>
            <button
              type="button"
              className="secondary"
              disabled={activeItems.length === 0}
              onClick={() => void copySharedCollectionJson()}
            >
              Copy JSON
            </button>
            <button type="button" className="secondary" onClick={() => importFileRef.current?.click()}>
              Import shared file…
            </button>
            <button type="button" className="secondary" onClick={() => void importSharedFromClipboard()}>
              Paste from clipboard
            </button>
          </div>
          <p className="hint collection-share-hint" title="Imports use public mirrors. On HTTP 429, wait and retry.">
            Mirrors, not the osu! API
          </p>
        </div>
      </details>

      <div className="collection-list" role="list">
        {activeItems.length === 0 && (
          <div className="empty-state empty-state-tight">
            <p className="empty-title">This collection is empty</p>
            <p className="empty-text">
              Add maps from Search, or import a friend&apos;s shared file to create a new list automatically.
            </p>
            <button type="button" className="secondary" onClick={onGoToSearch}>
              Go to Search
            </button>
          </div>
        )}
        {activeItems.length > 0 && filteredSortedItems.length === 0 && (
          <div className="empty-state empty-state-tight">
            <p className="empty-title">No maps match</p>
            <p className="empty-text">Try clearing search or changing filters.</p>
          </div>
        )}
        {activeItems.length > 0 && filteredSortedItems.length > 0 && (
          <div className="collection-list-head">
            <label className="collection-select-all">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someVisibleSelected;
                }}
                onChange={toggleSelectAllVisible}
                aria-label="Select all visible maps"
              />
            </label>
            <span className="collection-list-head-label">Map</span>
            <span className="collection-list-head-actions">Actions</span>
          </div>
        )}
        {filteredSortedItems.map((item) => {
          const inLib = localBeatmapsetIds.has(item.beatmapsetId);
          const titleLine = `${item.title} — ${item.artist}`;
          return (
            <div
              key={item.id}
              className={`collection-row${onInspectBeatmapset ? " collection-row--clickable" : ""}`}
              role="listitem"
              onClick={
                onInspectBeatmapset ? () => onInspectBeatmapset(item.beatmapsetId) : undefined
              }
            >
              <label className="collection-row-check" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleOne(item.id)}
                  aria-label={`Select ${titleLine}`}
                />
              </label>
              {item.coverUrl ? (
                <img
                  src={item.coverUrl}
                  alt=""
                  width={72}
                  height={50}
                  className="collection-row-thumb"
                />
              ) : (
                <div className="collection-row-cover-ph" aria-hidden />
              )}
              <div className="info">
                <div className="collection-row-title">
                  <span className="collection-row-title-text" title={titleLine}>
                    {item.title} — {item.artist}
                  </span>
                  {inLib && <span className="collection-lib-badge">In Songs folder</span>}
                </div>
                <div className="sub">{item.creator}</div>
                <div className={`st ${item.status}`}>
                  {item.status}
                  {item.error ? `: ${item.error}` : ""}
                </div>
              </div>
              <div className="collection-row-actions" data-ui-density="micro">
                <a
                  className="collection-osu-link secondary"
                  href={`https://osu.ppy.sh/beatmapsets/${item.beatmapsetId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  osu!
                </a>
                <button
                  type="button"
                  className="secondary"
                  disabled={importBusy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void importOne(item);
                  }}
                >
                  Import
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!partyCanSend}
                  onClick={(e) => {
                    e.stopPropagation();
                    sendBeatmapToParty({
                      beatmapsetId: item.beatmapsetId,
                      artist: item.artist,
                      title: item.title,
                      creator: item.creator,
                      coverUrl: item.coverUrl ?? null,
                    });
                  }}
                  title={partyCanSend ? "Leader: queue for party" : "Create or join a lobby as leader"}
                >
                  Party
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeFromCollection(item.id);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type RefObject } from "react";
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
  useEffect(() => {
    setNameDraft(activeCollection?.name ?? "");
  }, [activeCollection?.id, activeCollection?.name]);

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

  const filterChip = (id: StatusFilter, label: string) => (
    <button
      key={id}
      type="button"
      className={`collection-filter-chip ${statusFilter === id ? "active" : ""}`}
      aria-pressed={statusFilter === id}
      onClick={() => setStatusFilter(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="panel panel-elevated collections-panel">
      <div className="panel-head">
        <h2>Collections</h2>
        <p className="panel-sub panel-sub--tight">
          <strong>{activeItems.length}</strong> in &quot;{activeCollection?.name ?? "—"}&quot; ·{" "}
          <strong>{totalMapsAcrossCollections}</strong> total in all lists
        </p>
        <p className="collection-head-meta" aria-label="Queue status for this collection">
          <span className="collection-head-meta-item">
            Pending <strong>{statusCounts.pending}</strong>
          </span>
          <span className="collection-head-meta-item">
            Downloading <strong>{statusCounts.downloading}</strong>
          </span>
          <span className="collection-head-meta-item">
            Error <strong>{statusCounts.error}</strong>
          </span>
          <span className="collection-head-meta-item">
            Imported <strong>{statusCounts.imported}</strong>
          </span>
          <span className="collection-head-meta-item">
            In Songs <strong>{inLibraryCount}</strong> / <strong>{activeItems.length}</strong>
          </span>
        </p>
      </div>
      <input
        ref={importFileRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        onChange={(e) => void onImportSharedFile(e)}
      />

      <div className="collection-toolbar">
        <div className="collection-picker">
          <span className="collection-picker-heading" id="collection-picker-label">
            Switch collection
          </span>
          <div
            className="collection-picker-list"
            role="listbox"
            aria-labelledby="collection-picker-label"
          >
            {collectionStore.collections.map((c) => {
              const active = c.id === activeCollection?.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`collection-picker-card ${active ? "active" : ""}`}
                  onClick={() => setActiveCollectionId(c.id)}
                >
                  {active && <span className="collection-picker-current">Selected</span>}
                  <span className="collection-picker-card-name">{c.name}</span>
                  <span className="collection-picker-card-meta">
                    {c.items.length} {c.items.length === 1 ? "map" : "maps"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="collection-toolbar-actions">
          <div className="collection-toolbar-buttons">
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
          <label className="field collection-rename-field">
            <span className="collection-rename-label">Rename</span>
            <input
              type="text"
              className="collection-rename-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => commitCollectionRename(nameDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="Collection name"
              aria-label="Rename current collection"
            />
          </label>
        </div>
      </div>

      <div className="collection-filters-shell">
        <label className="field collection-search-field">
          <span id="collection-search-label">Filter list</span>
          <input
            type="search"
            autoComplete="off"
            placeholder="Title, artist, mapper, set ID…"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            aria-labelledby="collection-search-label"
          />
        </label>
        <div className="collection-controls-row">
          <div className="collection-filter-group" role="group" aria-label="Filter by status">
            {filterChip("all", "All")}
            {filterChip("pending", "Pending")}
            {filterChip("downloading", "Downloading")}
            {filterChip("error", "Error")}
            {filterChip("imported", "Imported")}
          </div>
          <div className="collection-select-group">
            <label className="collection-select-label">
              <span className="collection-select-caption">Library</span>
              <select
                className="collection-select"
                value={libraryFilter}
                onChange={(e) => setLibraryFilter(e.target.value as LibraryFilter)}
                aria-label="Filter by Songs folder"
              >
                <option value="all">All</option>
                <option value="inLibrary">In Songs</option>
                <option value="notInLibrary">Not in Songs</option>
              </select>
            </label>
            <label className="collection-select-label">
              <span className="collection-select-caption">Sort</span>
              <select
                className="collection-select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                aria-label="Sort list"
              >
                <option value="title">Title</option>
                <option value="artist">Artist</option>
                <option value="status">Status</option>
              </select>
            </label>
          </div>
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
            Retry errors ({errorItems.length})
          </button>
          <button
            type="button"
            className="secondary"
            disabled={importBusy || queueItems.length === 0}
            onClick={() => void importItemsQueue(queueItems)}
          >
            Import queue ({queueItems.length})
          </button>
          <label className="checkbox-row collection-import-no-video">
            <input type="checkbox" checked={noVideo} onChange={(e) => setNoVideo(e.target.checked)} />
            No video
          </label>
        </div>
        {importBusy && (
          <p className="hint collection-import-hint" role="status">
            Import queue running — you can switch tabs; avoid closing the app.
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
            Friends need osu-link too. Send the JSON file or paste from clipboard — imports always create a{" "}
            <strong>new</strong> collection so nothing is overwritten.
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
          <p className="hint collection-share-hint">
            Imports use public mirrors (not the osu! API). If you see 429, wait before retrying.
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
              <div className="collection-row-actions">
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

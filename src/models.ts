export interface CollectionItem {
  id: string;
  beatmapsetId: number;
  artist: string;
  title: string;
  creator: string;
  coverUrl?: string | null;
  status: string;
  error?: string | null;
}

export interface BeatmapCollection {
  id: string;
  name: string;
  items: CollectionItem[];
}

export interface CollectionStore {
  activeCollectionId: string | null;
  collections: BeatmapCollection[];
}

export function getActiveCollection(store: CollectionStore): BeatmapCollection | undefined {
  if (store.collections.length === 0) return undefined;
  const id = store.activeCollectionId;
  return store.collections.find((c) => c.id === id) ?? store.collections[0];
}

/** Unique display name among existing collection names (used for imports and duplicate). */
export function uniqueCollectionName(desired: string, existing: string[]): string {
  const base = desired.trim() || "Collection";
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

export function mapActiveItems(
  store: CollectionStore,
  fn: (items: CollectionItem[]) => CollectionItem[],
): CollectionStore {
  const active = getActiveCollection(store);
  if (!active) return store;
  const aid = active.id;
  return {
    ...store,
    activeCollectionId: store.activeCollectionId ?? aid,
    collections: store.collections.map((c) => (c.id === aid ? { ...c, items: fn(c.items) } : c)),
  };
}

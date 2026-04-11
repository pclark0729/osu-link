import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  getActiveCollection,
  mapActiveItems,
  type CollectionItem,
  type CollectionStore,
} from "./models";
import {
  loadPresets,
  loadResultsLayout,
  mergePresetsFromImportJson,
  savePresetsList,
  saveResultsLayout,
  type ResultsLayout,
  type SearchFilterSnapshot,
  type SearchPreset,
} from "./searchPresetStorage";
import {
  CURATE_PAGE_CAP,
  CURATE_PICK_COUNT,
  filterSetsByModeAndStars,
  MODE_API,
  type Mode,
  type SearchInput,
} from "./searchTypes";

export interface SearchDownloadDeps {
  pushToast: (tone: "info" | "success" | "error", message: string) => void;
  refreshPaths: () => Promise<void>;
  setSettingsMsg: (msg: string | null) => void;
  collectionStore: CollectionStore;
  persistStore: (next: CollectionStore) => Promise<void>;
  storeRef: MutableRefObject<CollectionStore>;
  partyCanSend: boolean;
  sendBeatmapToParty: (meta: {
    beatmapsetId: number;
    artist: string;
    title: string;
    creator: string;
    coverUrl?: string | null;
  }) => void;
  showPartyActions: boolean;
  showCollectionActions: boolean;
  localBeatmapsetIds: Set<number>;
  localIdsRef: MutableRefObject<Set<number>>;
  noVideo: boolean;
  setNoVideo: Dispatch<SetStateAction<boolean>>;
}

export function useSearchDownloadState(deps: SearchDownloadDeps) {
  const {
    pushToast,
    refreshPaths,
    setSettingsMsg,
    collectionStore,
    persistStore,
    storeRef,
    partyCanSend,
    sendBeatmapToParty,
    showPartyActions,
    showCollectionActions,
    localBeatmapsetIds,
    localIdsRef,
    noVideo,
    setNoVideo,
  } = deps;

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("osu");
  const [section, setSection] = useState("ranked");
  const [sort, setSort] = useState("plays_desc");
  const [minStars, setMinStars] = useState("");
  const [maxStars, setMaxStars] = useState("");
  const [genre, setGenre] = useState("");
  const [language, setLanguage] = useState("");
  const [extras, setExtras] = useState("");
  const [general, setGeneral] = useState("");
  const [ranks, setRanks] = useState("");
  const [nsfw, setNsfw] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [rawResults, setRawResults] = useState<unknown[]>([]);
  const [cursorString, setCursorString] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [hideOwnedSearch, setHideOwnedSearch] = useState(false);
  const [directImportSetId, setDirectImportSetId] = useState<number | null>(null);
  const [curateResults, setCurateResults] = useState<unknown[]>([]);
  const [curating, setCurating] = useState(false);
  const [curateError, setCurateError] = useState<string | null>(null);
  const [presets, setPresets] = useState<SearchPreset[]>(() => loadPresets());
  const [resultsLayout, setResultsLayout] = useState<ResultsLayout>(() => loadResultsLayout());

  useEffect(() => {
    saveResultsLayout(resultsLayout);
  }, [resultsLayout]);

  const activeCollection = getActiveCollection(collectionStore);
  const activeItems = activeCollection?.items ?? [];

  const searchDisplayResults = useMemo(() => {
    if (!hideOwnedSearch) return rawResults;
    return rawResults.filter((raw) => {
      const set = raw as Record<string, unknown>;
      const sid = Number(set.id);
      if (!Number.isFinite(sid)) return true;
      return !localBeatmapsetIds.has(sid);
    });
  }, [rawResults, hideOwnedSearch, localBeatmapsetIds]);

  const buildSnapshot = (): SearchFilterSnapshot => ({
    query,
    mode,
    section,
    sort,
    minStars,
    maxStars,
    genre,
    language,
    extras,
    general,
    ranks,
    nsfw,
    hideOwnedSearch,
    noVideo,
  });

  const applyPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    const sn = p.snapshot;
    setQuery(sn.query);
    setMode(sn.mode);
    setSection(sn.section);
    setSort(sn.sort);
    setMinStars(sn.minStars);
    setMaxStars(sn.maxStars);
    setGenre(sn.genre);
    setLanguage(sn.language);
    setExtras(sn.extras);
    setGeneral(sn.general);
    setRanks(sn.ranks);
    setNsfw(sn.nsfw);
    setHideOwnedSearch(sn.hideOwnedSearch);
    setNoVideo(sn.noVideo);
    setRawResults([]);
    setCursorString(null);
    setSearchError(null);
    setTotal(null);
    setSearchAttempted(false);
  };

  const savePreset = (name: string): string | null => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const snapshot = buildSnapshot();
    const newP: SearchPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: trimmed,
      snapshot,
    };
    const next = [...presets, newP];
    savePresetsList(next);
    setPresets(next);
    pushToast("success", `Saved preset “${trimmed}”.`);
    return newP.id;
  };

  const deletePreset = (id: string) => {
    const next = presets.filter((p) => p.id !== id);
    savePresetsList(next);
    setPresets(next);
  };

  const renamePreset = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = presets.map((p) => (p.id === id ? { ...p, name: trimmed } : p));
    savePresetsList(next);
    setPresets(next);
    pushToast("success", `Renamed preset to “${trimmed}”.`);
  };

  const importPresetsFromJsonText = (raw: string) => {
    const { merged, added } = mergePresetsFromImportJson(presets, raw);
    if (added === 0) {
      pushToast("error", "No valid presets found in file.");
      return;
    }
    savePresetsList(merged);
    setPresets(merged);
    pushToast("success", `Imported ${added} preset(s).`);
  };

  const runSearch = async (append: boolean) => {
    setSearchError(null);
    setSearchAttempted(true);
    setSearching(true);
    try {
      const input: SearchInput = {
        q: query.trim() || null,
        m: MODE_API[mode],
        s: section,
        sort,
        cursor_string: append && cursorString ? cursorString : null,
        g:
          genre.trim() === ""
            ? null
            : Number.isFinite(Number(genre))
              ? Number(genre)
              : null,
        l:
          language.trim() === ""
            ? null
            : Number.isFinite(Number(language))
              ? Number(language)
              : null,
        e: extras.trim() || null,
        c: general.trim() || null,
        r: ranks.trim() || null,
        nsfw: nsfw || null,
      };
      const res = await invoke<Record<string, unknown>>("search_beatmapsets", { input });
      const sets = (res.beatmapsets as unknown[]) || [];
      const filtered = filterSetsByModeAndStars(sets, mode, minStars, maxStars);
      if (append) {
        setRawResults((prev) => [...prev, ...filtered]);
      } else {
        setRawResults(filtered);
      }
      const cur = res.cursor_string as string | undefined | null;
      setCursorString(cur && cur.length > 0 ? cur : null);
      const t = res.total;
      setTotal(typeof t === "number" ? t : null);
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  };

  const runCurateDiscover = async () => {
    setCurateError(null);
    setCurating(true);
    setCurateResults([]);
    try {
      const pool: unknown[] = [];
      let cursor: string | null = null;
      const local = localIdsRef.current;
      let pages = 0;
      while (pages < CURATE_PAGE_CAP) {
        pages += 1;
        const input: SearchInput = {
          q: query.trim() || null,
          m: MODE_API[mode],
          s: section,
          sort,
          cursor_string: cursor,
          g:
            genre.trim() === ""
              ? null
              : Number.isFinite(Number(genre))
                ? Number(genre)
                : null,
          l:
            language.trim() === ""
              ? null
              : Number.isFinite(Number(language))
                ? Number(language)
                : null,
          e: extras.trim() || null,
          c: general.trim() || null,
          r: ranks.trim() || null,
          nsfw: nsfw || null,
        };
        const res = await invoke<Record<string, unknown>>("search_beatmapsets", { input });
        const sets = filterSetsByModeAndStars((res.beatmapsets as unknown[]) || [], mode, minStars, maxStars);
        for (const s of sets) {
          const id = Number((s as Record<string, unknown>).id);
          if (!Number.isFinite(id) || local.has(id)) continue;
          pool.push(s);
        }
        if (pool.length >= CURATE_PICK_COUNT * 3) break;
        const cur = res.cursor_string as string | undefined | null;
        cursor = cur && cur.length > 0 ? cur : null;
        if (!cursor) break;
      }
      const arr = [...pool];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      setCurateResults(arr.slice(0, CURATE_PICK_COUNT));
    } catch (e) {
      setCurateError(String(e));
    } finally {
      setCurating(false);
    }
  };

  const runCurateNewRanked = async () => {
    setCurateError(null);
    setCurating(true);
    setCurateResults([]);
    try {
      const out: unknown[] = [];
      let cursor: string | null = null;
      const local = localIdsRef.current;
      let pages = 0;
      while (pages < CURATE_PAGE_CAP) {
        pages += 1;
        const input: SearchInput = {
          q: query.trim() || null,
          m: MODE_API[mode],
          s: "ranked",
          sort: "ranked_desc",
          cursor_string: cursor,
          g:
            genre.trim() === ""
              ? null
              : Number.isFinite(Number(genre))
                ? Number(genre)
                : null,
          l:
            language.trim() === ""
              ? null
              : Number.isFinite(Number(language))
                ? Number(language)
                : null,
          e: extras.trim() || null,
          c: general.trim() || null,
          r: ranks.trim() || null,
          nsfw: nsfw || null,
        };
        const res = await invoke<Record<string, unknown>>("search_beatmapsets", { input });
        const sets = filterSetsByModeAndStars((res.beatmapsets as unknown[]) || [], mode, minStars, maxStars);
        for (const s of sets) {
          const id = Number((s as Record<string, unknown>).id);
          if (!Number.isFinite(id) || local.has(id)) continue;
          out.push(s);
          if (out.length >= CURATE_PICK_COUNT) break;
        }
        if (out.length >= CURATE_PICK_COUNT) break;
        const cur = res.cursor_string as string | undefined | null;
        cursor = cur && cur.length > 0 ? cur : null;
        if (!cursor) break;
      }
      setCurateResults(out.slice(0, CURATE_PICK_COUNT));
    } catch (e) {
      setCurateError(String(e));
    } finally {
      setCurating(false);
    }
  };

  const addToCollection = (set: Record<string, unknown>) => {
    const id = Number(set.id);
    if (Number.isNaN(id)) return;
    const store = storeRef.current;
    const active = getActiveCollection(store);
    if (!active) return;
    if (active.items.some((c) => c.beatmapsetId === id)) return;
    const covers = set.covers as Record<string, string> | undefined;
    const item: CollectionItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      beatmapsetId: id,
      artist: String(set.artist ?? ""),
      title: String(set.title ?? ""),
      creator: String(set.creator ?? ""),
      coverUrl: covers?.list ?? covers?.card ?? null,
      status: "pending",
      error: null,
    };
    void persistStore(mapActiveItems(store, (items) => [...items, item]));
  };

  const importFromSearch = async (beatmapsetId: number) => {
    setSettingsMsg(null);
    setDirectImportSetId(beatmapsetId);
    try {
      const path = await invoke<string>("download_and_import", {
        setId: beatmapsetId,
        noVideo,
      });
      const msg = `Imported to: ${path}. Press F5 in osu! if the map does not appear.`;
      setSettingsMsg(msg);
      pushToast("success", msg);
      await refreshPaths();
    } catch (e) {
      const msg = String(e);
      setSettingsMsg(msg);
      pushToast("error", msg);
    } finally {
      setDirectImportSetId(null);
    }
  };

  return {
    query,
    setQuery,
    mode,
    setMode,
    section,
    setSection,
    sort,
    setSort,
    minStars,
    setMinStars,
    maxStars,
    setMaxStars,
    noVideo,
    setNoVideo,
    genre,
    setGenre,
    language,
    setLanguage,
    extras,
    setExtras,
    general,
    setGeneral,
    ranks,
    setRanks,
    nsfw,
    setNsfw,
    searching,
    searchError,
    searchAttempted,
    rawResults,
    cursorString,
    total,
    runSearch,
    hideOwnedSearch,
    setHideOwnedSearch,
    directImportSetId,
    importFromSearch,
    curateResults,
    setCurateResults,
    curating,
    curateError,
    runCurateDiscover,
    runCurateNewRanked,
    activeCollection,
    activeItems,
    addToCollection,
    searchDisplayResults,
    partyCanSend,
    sendBeatmapToParty,
    showPartyActions,
    showCollectionActions,
    localBeatmapsetIds,
    presets,
    applyPreset,
    savePreset,
    deletePreset,
    renamePreset,
    importPresetsFromJsonText,
    resultsLayout,
    setResultsLayout,
  };
}

export type SearchDownloadState = ReturnType<typeof useSearchDownloadState>;

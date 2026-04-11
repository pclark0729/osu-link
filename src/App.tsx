import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSharedPayload,
  parseImportedCollectionJson,
  serializeSharedCollection,
} from "./collectionShare";
import {
  DEFAULT_PARTY_WS_URL,
  PARTY_SERVER_URL_UI_HIDDEN,
  PUBLIC_PARTY_WS_URL,
  defaultPartyWsUrlFromSettings,
} from "./constants";
import { OnboardingFlow } from "./OnboardingFlow";
import { buildPartyConnectUrlCandidates } from "./party/partyConnectUrls";
import { PartyClient, type PartyClientState } from "./party/partyClient";
import { parseLobbyCodeFromText } from "./party/parseLobbyCode";
import { PartyPanel } from "./PartyPanel";
import { NeuSelect } from "./NeuSelect";
import { SocialPanel } from "./SocialPanel";
import { TitleBar } from "./TitleBar";
import packageJson from "../package.json";
import { checkForUpdatesAndInstall, runAutoUpdate, updaterAvailable } from "./autoUpdate";
import "./App.css";

type Mode = "osu" | "taiko" | "fruits" | "mania";

const MODE_API: Record<Mode, number> = {
  osu: 0,
  taiko: 1,
  fruits: 2,
  mania: 3,
};

const SEARCH_MODE_OPTIONS = [
  { value: "osu", label: "osu!" },
  { value: "taiko", label: "Taiko" },
  { value: "fruits", label: "Catch" },
  { value: "mania", label: "Mania" },
] as const;

const SEARCH_SECTION_OPTIONS = [
  { value: "ranked", label: "Ranked" },
  { value: "qualified", label: "Qualified" },
  { value: "loved", label: "Loved" },
  { value: "pending", label: "Pending" },
  { value: "graveyard", label: "Graveyard" },
] as const;

const SEARCH_SORT_OPTIONS = [
  { value: "plays_desc", label: "Play count (high → low)" },
  { value: "favourites_desc", label: "Favourites" },
  { value: "ranked_desc", label: "Recently ranked" },
  { value: "rating_desc", label: "User rating" },
  { value: "title_asc", label: "Title A–Z" },
] as const;

/** Max API pages to walk when building curated lists; avoids unbounded requests. */
const CURATE_PAGE_CAP = 8;
const CURATE_PICK_COUNT = 8;

interface Settings {
  clientId: string;
  clientSecret: string;
  beatmapDirectory: string | null;
  onboardingCompleted: boolean;
  partyServerUrl: string | null;
  socialApiBaseUrl: string | null;
}

interface CollectionItem {
  id: string;
  beatmapsetId: number;
  artist: string;
  title: string;
  creator: string;
  coverUrl?: string | null;
  status: string;
  error?: string | null;
}

interface BeatmapCollection {
  id: string;
  name: string;
  items: CollectionItem[];
}

interface CollectionStore {
  activeCollectionId: string | null;
  collections: BeatmapCollection[];
}

function getActiveCollection(store: CollectionStore): BeatmapCollection | undefined {
  if (store.collections.length === 0) return undefined;
  const id = store.activeCollectionId;
  return store.collections.find((c) => c.id === id) ?? store.collections[0];
}

function mapActiveItems(
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

interface SearchInput {
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

function filterSetsByModeAndStars(
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

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function slugifyFilename(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "collection";
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function uniqueImportedCollectionName(desired: string, existing: string[]): string {
  const base = desired.trim() || "Imported collection";
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

type Toast = { tone: "info" | "success" | "error"; message: string };

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconCollections() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M4 12h16M4 18h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconParty() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSocial() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8v6M23 11h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const initialPartyState = (url: string): PartyClientState => ({
  connection: "disconnected",
  lastError: null,
  url,
  selfId: null,
  lobbyCode: null,
  leaderId: null,
  members: [],
  lastSeq: 0,
});

export default function App() {
  const [bootReady, setBootReady] = useState(false);
  const [tab, setTab] = useState<"search" | "collection" | "party" | "social" | "settings">("search");
  const [settings, setSettings] = useState<Settings>({
    clientId: "",
    clientSecret: "",
    beatmapDirectory: null,
    onboardingCompleted: false,
    partyServerUrl: null,
    socialApiBaseUrl: null,
  });
  const [resolvedSongs, setResolvedSongs] = useState<string>("");
  const [authLabel, setAuthLabel] = useState<string>("Signed out");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("osu");
  const [section, setSection] = useState("ranked");
  const [sort, setSort] = useState("plays_desc");
  const [minStars, setMinStars] = useState("");
  const [maxStars, setMaxStars] = useState("");
  const [noVideo, setNoVideo] = useState(true);
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
  const [collectionStore, setCollectionStore] = useState<CollectionStore>({
    activeCollectionId: null,
    collections: [],
  });
  const storeRef = useRef<CollectionStore>(collectionStore);
  const [importBusy, setImportBusy] = useState(false);
  const [directImportSetId, setDirectImportSetId] = useState<number | null>(null);
  const [collectionNameDraft, setCollectionNameDraft] = useState("");
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("—");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [localBeatmapsetIds, setLocalBeatmapsetIds] = useState<Set<number>>(() => new Set());
  const [hideOwnedSearch, setHideOwnedSearch] = useState(false);
  const [curateResults, setCurateResults] = useState<unknown[]>([]);
  const [curating, setCurating] = useState(false);
  const [curateError, setCurateError] = useState<string | null>(null);
  const localLibraryRef = useRef<Set<number>>(new Set());
  const importFileRef = useRef<HTMLInputElement>(null);
  const [partyState, setPartyState] = useState<PartyClientState>(() =>
    initialPartyState(defaultPartyWsUrlFromSettings(undefined)),
  );
  const [partyDisplayName, setPartyDisplayName] = useState("");
  const [joinCodeDraft, setJoinCodeDraft] = useState("");
  const partyClientRef = useRef<PartyClient | null>(null);
  /** When true, user chose Disconnect and we skip auto-connect until they Connect again. */
  const partyUserPrefersOfflineRef = useRef(false);
  const pushToastRef = useRef<(tone: Toast["tone"], message: string) => void>(() => {});
  const partyImportChain = useRef(Promise.resolve());

  useEffect(() => {
    storeRef.current = collectionStore;
  }, [collectionStore]);

  useEffect(() => {
    localLibraryRef.current = localBeatmapsetIds;
  }, [localBeatmapsetIds]);

  const reloadLocalLibrary = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const ids = await invoke<number[]>("get_local_beatmapset_ids");
      setLocalBeatmapsetIds(new Set(ids));
    } catch {
      setLocalBeatmapsetIds(new Set());
    }
  }, []);
  const reloadLocalLibraryRef = useRef(reloadLocalLibrary);
  reloadLocalLibraryRef.current = reloadLocalLibrary;

  const pushToast = useCallback((tone: Toast["tone"], message: string) => {
    setToast({ tone, message });
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    setUpdateBusy(true);
    try {
      const r = await checkForUpdatesAndInstall();
      switch (r.kind) {
        case "skipped":
          pushToast("error", "Updates are only available in the installed app (not dev or browser).");
          break;
        case "upToDate":
          pushToast("success", "You're on the latest version.");
          break;
        case "cancelled":
          break;
        case "installed":
          pushToast("success", `Installing ${r.version}…`);
          break;
        case "error":
          pushToast("error", r.message);
          break;
      }
    } finally {
      setUpdateBusy(false);
    }
  }, [pushToast]);

  useEffect(() => {
    pushToastRef.current = pushToast;
  }, [pushToast]);

  useEffect(() => {
    if (isTauri()) {
      void getVersion()
        .then(setAppVersion)
        .catch(() => setAppVersion("—"));
    } else {
      setAppVersion(packageJson.version);
    }
  }, []);

  useEffect(() => {
    void runAutoUpdate();
  }, []);

  useEffect(() => {
    const client = new PartyClient(defaultPartyWsUrlFromSettings(undefined), (ev) => {
      if (ev.kind === "state") setPartyState(ev.state);
      if (ev.kind === "beatmap_queued") {
        partyImportChain.current = partyImportChain.current.then(async () => {
          const st = partyClientRef.current?.getState();
          if (!st?.selfId) return;
          const idx = Math.max(0, st.members.findIndex((m) => m.id === st.selfId));
          await new Promise((r) => setTimeout(r, idx * 300));
          const msg = ev.msg;
          const label =
            msg.title && msg.artist ? `${msg.artist} – ${msg.title}` : `set #${msg.setId}`;
          try {
            const path = await invoke<string>("download_and_import", {
              setId: msg.setId,
              noVideo: msg.noVideo,
            });
            pushToastRef.current(
              "success",
              `Party: ${label} imported — ${path}. Press F5 in osu! if needed.`,
            );
            void reloadLocalLibraryRef.current();
          } catch (e) {
            pushToastRef.current("error", `Party import failed (${label}): ${String(e)}`);
          }
        });
      }
    });
    partyClientRef.current = client;
    setPartyState(client.getState());
    return () => {
      client.disconnect();
      partyClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

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

  useEffect(() => {
    setCollectionNameDraft(activeCollection?.name ?? "");
  }, [activeCollection?.id, activeCollection?.name]);

  const refreshAuth = useCallback(async () => {
    try {
      const st = await invoke<{ loggedIn: boolean; username?: string | null }>("auth_status");
      if (st.loggedIn) {
        setAuthLabel(st.username ? `Signed in as ${st.username}` : "Signed in");
        const u = st.username?.trim();
        if (u) {
          setPartyDisplayName((prev) => (prev.trim() === "" ? u : prev));
        }
      } else {
        setAuthLabel("Signed out");
      }
    } catch {
      setAuthLabel("Signed out");
    }
  }, []);

  const refreshPaths = useCallback(async () => {
    try {
      const p = await invoke<string>("get_beatmap_dir");
      setResolvedSongs(p);
    } catch {
      setResolvedSongs("");
    }
    await reloadLocalLibrary();
  }, [reloadLocalLibrary]);

  const handleOnboardingFinished = useCallback(async () => {
    try {
      const s = await invoke<Settings>("get_settings");
      setSettings({
        clientId: s.clientId ?? "",
        clientSecret: s.clientSecret ?? "",
        beatmapDirectory: s.beatmapDirectory ?? null,
        onboardingCompleted: s.onboardingCompleted !== false,
        partyServerUrl: s.partyServerUrl ?? null,
        socialApiBaseUrl: s.socialApiBaseUrl ?? null,
      });
    } catch {
      setSettings((prev) => ({ ...prev, onboardingCompleted: true }));
    }
    await refreshAuth();
    await refreshPaths();
  }, [refreshAuth, refreshPaths]);

  useEffect(() => {
    void (async () => {
      try {
        const s = await invoke<Settings>("get_settings");
        setSettings({
          clientId: s.clientId ?? "",
          clientSecret: s.clientSecret ?? "",
          beatmapDirectory: s.beatmapDirectory ?? null,
          onboardingCompleted: s.onboardingCompleted !== false,
          partyServerUrl: s.partyServerUrl ?? null,
          socialApiBaseUrl: s.socialApiBaseUrl ?? null,
        });
        const urls = buildPartyConnectUrlCandidates(s.partyServerUrl);
        partyClientRef.current?.setUrl(urls[0]);
        setPartyState((prev) => ({ ...prev, url: urls[0] }));
      } catch {
        /* ignore */
      }
      try {
        const st = await invoke<CollectionStore>("load_collections_cmd");
        storeRef.current = st;
        setCollectionStore(st);
      } catch {
        /* ignore */
      }
      await refreshAuth();
      await refreshPaths();
      setBootReady(true);
    })();
  }, [refreshAuth, refreshPaths]);

  useEffect(() => {
    if (!bootReady || !PARTY_SERVER_URL_UI_HIDDEN) return;
    if (partyUserPrefersOfflineRef.current) return;
    const urls = buildPartyConnectUrlCandidates(settings.partyServerUrl);
    const c = partyClientRef.current;
    if (!c) return;
    c.setUrl(urls[0]);
    const st = c.getState();
    if (st.connection === "disconnected" || st.connection === "error") {
      c.connect(undefined, urls);
    }
  }, [bootReady, settings.partyServerUrl]);

  const openSetupGuide = async () => {
    setSettingsMsg(null);
    try {
      await invoke("save_settings_cmd", {
        s: {
          clientId: settings.clientId.trim(),
          clientSecret: settings.clientSecret.trim(),
          beatmapDirectory:
            settings.beatmapDirectory && settings.beatmapDirectory.trim() !== ""
              ? settings.beatmapDirectory.trim()
              : null,
          onboardingCompleted: false,
          partyServerUrl:
            settings.partyServerUrl && settings.partyServerUrl.trim() !== ""
              ? settings.partyServerUrl.trim()
              : null,
          socialApiBaseUrl:
            settings.socialApiBaseUrl && settings.socialApiBaseUrl.trim() !== ""
              ? settings.socialApiBaseUrl.trim()
              : null,
        },
      });
      setSettings((prev) => ({ ...prev, onboardingCompleted: false }));
    } catch (e) {
      setSettingsMsg(String(e));
    }
  };

  const persistStore = async (next: CollectionStore) => {
    storeRef.current = next;
    setCollectionStore(next);
    await invoke("save_collections_cmd", { store: next });
  };

  const setActiveCollectionId = (id: string) => {
    const next = { ...storeRef.current, activeCollectionId: id };
    void persistStore(next);
  };

  const createCollection = () => {
    const store = storeRef.current;
    const n = store.collections.length + 1;
    const col: BeatmapCollection = {
      id: `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: `Collection ${n}`,
      items: [],
    };
    void persistStore({
      ...store,
      collections: [...store.collections, col],
      activeCollectionId: col.id,
    });
  };

  const deleteActiveCollection = () => {
    const store = storeRef.current;
    if (store.collections.length <= 1) return;
    const aid = store.activeCollectionId;
    const remaining = store.collections.filter((c) => c.id !== aid);
    const nextActive = remaining[0]?.id ?? null;
    void persistStore({
      activeCollectionId: nextActive,
      collections: remaining,
    });
  };

  const commitCollectionRename = () => {
    const store = storeRef.current;
    const aid = store.activeCollectionId;
    if (!aid) return;
    const name = collectionNameDraft.trim() || "Untitled";
    const next: CollectionStore = {
      ...store,
      collections: store.collections.map((c) => (c.id === aid ? { ...c, name } : c)),
    };
    void persistStore(next);
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
      const local = localLibraryRef.current;
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
      const local = localLibraryRef.current;
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
      id: randomId(),
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

  const partyCanSend = Boolean(
    partyState.selfId &&
      partyState.leaderId === partyState.selfId &&
      partyState.lobbyCode &&
      partyState.connection === "connected",
  );

  const sendBeatmapToParty = (meta: {
    beatmapsetId: number;
    artist: string;
    title: string;
    creator: string;
    coverUrl?: string | null;
  }) => {
    const c = partyClientRef.current;
    if (!partyCanSend || !c) {
      pushToast("error", "Connect and create or join a lobby as the leader to send maps to the party.");
      return;
    }
    const ok = c.queueBeatmap({
      setId: meta.beatmapsetId,
      noVideo,
      artist: meta.artist,
      title: meta.title,
      creator: meta.creator,
      coverUrl: meta.coverUrl ?? null,
    });
    if (!ok) pushToast("error", "Not connected to the party server.");
    else
      pushToast(
        "info",
        `Queued for party: ${meta.artist} – ${meta.title} (${noVideo ? "no video" : "with video"}).`,
      );
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

  const saveSettings = async () => {
    setSettingsMsg(null);
    try {
      const partyUrl =
        settings.partyServerUrl && settings.partyServerUrl.trim() !== ""
          ? settings.partyServerUrl.trim()
          : null;
      const socialUrl =
        settings.socialApiBaseUrl && settings.socialApiBaseUrl.trim() !== ""
          ? settings.socialApiBaseUrl.trim()
          : null;
      await invoke("save_settings_cmd", {
        s: {
          clientId: settings.clientId.trim(),
          clientSecret: settings.clientSecret.trim(),
          beatmapDirectory:
            settings.beatmapDirectory && settings.beatmapDirectory.trim() !== ""
              ? settings.beatmapDirectory.trim()
              : null,
          onboardingCompleted: settings.onboardingCompleted,
          partyServerUrl: partyUrl,
          socialApiBaseUrl: socialUrl,
        },
      });
      const wsUrl = defaultPartyWsUrlFromSettings(partyUrl);
      partyClientRef.current?.setUrl(wsUrl);
      setPartyState((prev) => ({ ...prev, url: wsUrl }));
      setSettingsMsg("Settings saved.");
      pushToast("success", "Settings saved.");
      await refreshPaths();
    } catch (e) {
      setSettingsMsg(String(e));
    }
  };

  const login = async () => {
    setSettingsMsg(null);
    try {
      await invoke("oauth_login");
      setSettingsMsg("Signed in successfully.");
      pushToast("success", "Signed in successfully.");
      await refreshAuth();
    } catch (e) {
      setSettingsMsg(String(e));
    }
  };

  const logout = async () => {
    await invoke("oauth_logout");
    await refreshAuth();
    setSettingsMsg("Signed out.");
  };

  const importOne = async (item: CollectionItem) => {
    const downloading = mapActiveItems(storeRef.current, (items) =>
      items.map((c) => (c.id === item.id ? { ...c, status: "downloading", error: null } : c)),
    );
    await persistStore(downloading);
    try {
      const path = await invoke<string>("download_and_import", {
        setId: item.beatmapsetId,
        noVideo,
      });
      const done = mapActiveItems(storeRef.current, (items) =>
        items.map((c) => (c.id === item.id ? { ...c, status: "imported", error: null } : c)),
      );
      await persistStore(done);
      const msg = `Imported to: ${path}. Press F5 in osu! if the map does not appear.`;
      setSettingsMsg(msg);
      pushToast("success", msg);
      await refreshPaths();
    } catch (e) {
      const msg = String(e);
      pushToast("error", msg);
      const err = mapActiveItems(storeRef.current, (items) =>
        items.map((c) => (c.id === item.id ? { ...c, status: "error", error: msg } : c)),
      );
      await persistStore(err);
    }
  };

  const importAll = async () => {
    setImportBusy(true);
    setSettingsMsg(null);
    try {
      const snapshot = [...(getActiveCollection(storeRef.current)?.items ?? [])];
      for (const item of snapshot) {
        if (item.status === "imported") continue;
        await importOne(item);
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setImportBusy(false);
    }
  };

  const removeFromCollection = async (itemId: string) => {
    await persistStore(
      mapActiveItems(storeRef.current, (items) => items.filter((c) => c.id !== itemId)),
    );
  };

  const exportSharedCollectionFile = () => {
    const active = getActiveCollection(storeRef.current);
    if (!active || active.items.length === 0) {
      pushToast("error", "This collection has no beatmaps to export.");
      return;
    }
    const payload = buildSharedPayload(
      active.name,
      active.items.map((i) => ({
        beatmapsetId: i.beatmapsetId,
        artist: i.artist,
        title: i.title,
        creator: i.creator,
        coverUrl: i.coverUrl,
      })),
    );
    const body = serializeSharedCollection(payload);
    const filename = `${slugifyFilename(active.name)}.osu-link.json`;
    downloadTextFile(filename, body);
    pushToast("success", `Saved ${filename}. Share the file with other osu-link users.`);
  };

  const copySharedCollectionJson = async () => {
    const active = getActiveCollection(storeRef.current);
    if (!active || active.items.length === 0) {
      pushToast("error", "This collection has no beatmaps to copy.");
      return;
    }
    const payload = buildSharedPayload(
      active.name,
      active.items.map((i) => ({
        beatmapsetId: i.beatmapsetId,
        artist: i.artist,
        title: i.title,
        creator: i.creator,
        coverUrl: i.coverUrl,
      })),
    );
    const body = serializeSharedCollection(payload).trimEnd();
    try {
      await navigator.clipboard.writeText(body);
      pushToast("success", "Collection JSON copied. Paste it in chat, a gist, or Discord.");
    } catch {
      pushToast("error", "Could not access the clipboard. Use Export file instead.");
    }
  };

  const applyImportedShared = async (text: string) => {
    const parsed = parseImportedCollectionJson(text);
    if (!parsed.ok) {
      pushToast("error", parsed.error);
      return;
    }
    const names = storeRef.current.collections.map((c) => c.name);
    const colName = uniqueImportedCollectionName(parsed.data.name, names);
    const col: BeatmapCollection = {
      id: `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: colName,
      items: parsed.data.items.map((i) => ({
        id: randomId(),
        beatmapsetId: i.beatmapsetId,
        artist: i.artist,
        title: i.title,
        creator: i.creator,
        coverUrl: i.coverUrl ?? null,
        status: "pending",
        error: null,
      })),
    };
    const next: CollectionStore = {
      ...storeRef.current,
      collections: [...storeRef.current.collections, col],
      activeCollectionId: col.id,
    };
    await persistStore(next);
    pushToast("success", `Imported “${colName}” (${col.items.length} maps).`);
  };

  const onImportSharedFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const text = await f.text();
      await applyImportedShared(text);
    } catch (err) {
      pushToast("error", String(err));
    }
  };

  const importSharedFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      await applyImportedShared(text);
    } catch (e) {
      pushToast("error", `Clipboard: ${String(e)}`);
    }
  };

  const joinPartyFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const code = parseLobbyCodeFromText(text);
      if (!code) {
        pushToast("error", "No valid lobby code found in clipboard.");
        return;
      }
      setJoinCodeDraft(code);
      const ok = partyClientRef.current?.joinLobby(code, partyDisplayName);
      if (!ok) pushToast("error", "Not connected to the party server.");
    } catch (e) {
      pushToast("error", `Clipboard: ${String(e)}`);
    }
  };

  const totalMapsInLibrary = collectionStore.collections.reduce((acc, c) => acc + c.items.length, 0);

  if (!bootReady) {
    const boot = (
      <div className="app-boot">
        <div className="boot-card">
          <div className="boot-spinner" aria-hidden />
          <p>Loading osu-link</p>
        </div>
      </div>
    );
    return isTauri() ? (
      <div className="app-desktop">
        <TitleBar />
        {boot}
      </div>
    ) : (
      boot
    );
  }

  if (!settings.onboardingCompleted) {
    const onboarding = (
      <OnboardingFlow
        onFinished={handleOnboardingFinished}
        initialClientId={settings.clientId}
        initialClientSecret={settings.clientSecret}
        initialBeatmapDirectory={settings.beatmapDirectory}
        initialPartyServerUrl={settings.partyServerUrl}
      />
    );
    return isTauri() ? (
      <div className="app-desktop">
        <TitleBar />
        {onboarding}
      </div>
    ) : (
      onboarding
    );
  }

  const main = (
    <div className="app-shell">
      <aside className="side-rail" aria-label="Main navigation">
        <div className="brand-block">
          <div className="brand-title">
            <span className="brand-osu">osu!</span>
            <span className="brand-link">link</span>
          </div>
          <p className="brand-tagline">Beatmaps for stable</p>
        </div>

        <nav className="side-nav">
          <button
            type="button"
            className={`side-nav-item ${tab === "search" ? "active" : ""}`}
            onClick={() => setTab("search")}
          >
            <span className="side-nav-icon">
              <IconSearch />
            </span>
            <span className="side-nav-text">
              Search
              <span className="side-nav-desc">Browse osu! library</span>
            </span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "collection" ? "active" : ""}`}
            onClick={() => setTab("collection")}
          >
            <span className="side-nav-icon">
              <IconCollections />
            </span>
            <span className="side-nav-text">
              Collections
              <span className="side-nav-desc">
                {activeItems.length} in &quot;{activeCollection?.name ?? "—"}&quot; · {totalMapsInLibrary} total
              </span>
            </span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "party" ? "active" : ""}`}
            onClick={() => setTab("party")}
          >
            <span className="side-nav-icon">
              <IconParty />
            </span>
            <span className="side-nav-text">
              Party
              <span className="side-nav-desc">
                {partyState.lobbyCode ? `Lobby ${partyState.lobbyCode}` : "Multiplayer lobbies"}
              </span>
            </span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "social" ? "active" : ""}`}
            onClick={() => setTab("social")}
          >
            <span className="side-nav-icon">
              <IconSocial />
            </span>
            <span className="side-nav-text">
              Social
              <span className="side-nav-desc">Friends, battles, activity</span>
            </span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            <span className="side-nav-icon">
              <IconSettings />
            </span>
            <span className="side-nav-text">
              Settings
              <span className="side-nav-desc">Account &amp; folders</span>
            </span>
          </button>
        </nav>

        <div className="side-footer">
          <div className="auth-compact">{authLabel}</div>
          <p className="side-credit">Made by Peyton</p>
        </div>
      </aside>

      <div className="app-stage">
        {toast && (
          <div className={`toast toast-${toast.tone}`} role="status">
            <span>{toast.message}</span>
            <button type="button" className="toast-dismiss" onClick={() => setToast(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        <main className="main-scroll">
          <div key={tab} className="main-tab-pane">
        {tab === "social" && (
          <SocialPanel onToast={(tone, message) => pushToast(tone, message)} />
        )}

        {tab === "party" && (
          <PartyPanel
            partyState={partyState}
            displayName={partyDisplayName}
            joinCodeDraft={joinCodeDraft}
            partyUrlDraft={settings.partyServerUrl ?? ""}
            onDisplayNameChange={setPartyDisplayName}
            onJoinCodeChange={setJoinCodeDraft}
            onPartyUrlChange={(v) =>
              setSettings((s) => ({ ...s, partyServerUrl: v.trim() === "" ? null : v.trim() }))
            }
            publicPartyUrl={PUBLIC_PARTY_WS_URL}
            onConnect={() => {
              partyUserPrefersOfflineRef.current = false;
              const urls = buildPartyConnectUrlCandidates(settings.partyServerUrl);
              partyClientRef.current?.setUrl(urls[0]);
              partyClientRef.current?.connect(undefined, urls);
            }}
            onDisconnect={() => {
              partyUserPrefersOfflineRef.current = true;
              partyClientRef.current?.disconnect();
            }}
            onCreateLobby={() => partyClientRef.current?.createLobby(partyDisplayName)}
            onJoinLobby={() => partyClientRef.current?.joinLobby(joinCodeDraft, partyDisplayName)}
            onJoinFromClipboard={() => void joinPartyFromClipboard()}
            onLeaveLobby={() => partyClientRef.current?.leaveLobby()}
            onCopyCode={async () => {
              const code = partyState.lobbyCode;
              if (!code) return;
              try {
                await navigator.clipboard.writeText(code);
                pushToast("success", "Lobby code copied.");
              } catch {
                pushToast("error", "Could not copy to clipboard.");
              }
            }}
          />
        )}

        {tab === "settings" && (
          <div className="panel panel-elevated">
            <div className="panel-head">
              <h2>Application</h2>
              <p className="panel-sub">
                Current version <strong>{appVersion}</strong>. Updates use GitHub Releases (signed builds only).
              </p>
            </div>
            <div className="row-actions" style={{ marginBottom: "1rem" }}>
              <button
                type="button"
                className="secondary"
                disabled={!updaterAvailable() || updateBusy}
                aria-busy={updateBusy}
                onClick={() => void handleCheckForUpdates()}
              >
                {updateBusy ? "Checking…" : "Check for updates"}
              </button>
            </div>
            {!updaterAvailable() && (
              <p className="hint" style={{ marginBottom: "1rem" }}>
                The updater runs in the packaged desktop app only (not in dev or the browser preview).
              </p>
            )}
            <div className="panel-head">
              <h2>OAuth application</h2>
              <p className="panel-sub">Keys for the official search API (downloads use a public mirror).</p>
            </div>
            <div className="row-actions" style={{ marginBottom: "0.75rem" }}>
              <button type="button" className="secondary" onClick={() => void openSetupGuide()}>
                Run setup guide again
              </button>
            </div>
            <p className="hint">
              Create an OAuth app on osu! (account settings → OAuth). Set redirect URI exactly to{" "}
              <code>http://127.0.0.1:42813/callback</code> (fixed port). Close other osu-link windows before signing in.
            </p>
            <div className="grid-2">
              <label className="field">
                <span>Client ID</span>
                <input
                  type="text"
                  autoComplete="off"
                  value={settings.clientId}
                  onChange={(e) => setSettings({ ...settings, clientId: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Client secret</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={settings.clientSecret}
                  onChange={(e) => setSettings({ ...settings, clientSecret: e.target.value })}
                />
              </label>
            </div>
            <label className="field" style={{ marginTop: "0.75rem" }}>
              <span>Beatmap directory override (optional)</span>
              <input
                type="text"
                placeholder="Leave empty to read osu!.cfg"
                value={settings.beatmapDirectory ?? ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    beatmapDirectory: e.target.value === "" ? null : e.target.value,
                  })
                }
              />
            </label>
            {!PARTY_SERVER_URL_UI_HIDDEN && (
              <label className="field" style={{ marginTop: "0.75rem" }}>
                <span>Party server WebSocket URL (optional)</span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder={PUBLIC_PARTY_WS_URL ?? DEFAULT_PARTY_WS_URL}
                  value={settings.partyServerUrl ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      partyServerUrl: e.target.value.trim() === "" ? null : e.target.value.trim(),
                    })
                  }
                />
              </label>
            )}
            <label className="field" style={{ marginTop: "0.75rem" }}>
              <span>Social API base URL (optional)</span>
              <input
                type="text"
                autoComplete="off"
                placeholder="Derived from party URL if empty (e.g. https://127.0.0.1:4681)"
                value={settings.socialApiBaseUrl ?? ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    socialApiBaseUrl: e.target.value.trim() === "" ? null : e.target.value.trim(),
                  })
                }
              />
            </label>
            <p className="hint">Resolved folder: {resolvedSongs || "—"}</p>
            <p className="hint">
              Local library:{" "}
              <strong>{localBeatmapsetIds.size}</strong> beatmap set{localBeatmapsetIds.size === 1 ? "" : "s"} detected
              under this folder (subfolders scanned for set IDs).
            </p>
            <div className="row-actions">
              <button type="button" className="secondary" disabled={!isTauri()} onClick={() => void refreshPaths()}>
                Rescan Songs folder
              </button>
            </div>
            <p className="hint">
              After scope changes, sign in again. Social features need the party server HTTP port (default{" "}
              <code>4681</code>) reachable where your app runs.
            </p>
            <div className="row-actions">
              <button type="button" className="primary" onClick={() => void saveSettings()}>
                Save settings
              </button>
              <button type="button" className="secondary" onClick={() => void login()}>
                Sign in with osu!
              </button>
              <button type="button" className="danger" onClick={() => void logout()}>
                Sign out
              </button>
            </div>
            {settingsMsg && <p className="hint">{settingsMsg}</p>}
          </div>
        )}

        {tab === "search" && (
          <>
            <div className="panel panel-elevated">
              <div className="panel-head">
                <h2>Search beatmaps</h2>
                <p className="panel-sub">Query the live osu! catalogue, then import or save sets to a collection.</p>
              </div>
              {searchError && <div className="error-banner">{searchError}</div>}
              <div className="grid-2">
                <label className="field">
                  <span>Query</span>
                  <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Artist, title, tags…" />
                </label>
                <label className="field">
                  <span>Mode</span>
                  <NeuSelect
                    id="search-mode"
                    value={mode}
                    onChange={(v) => setMode(v as Mode)}
                    options={SEARCH_MODE_OPTIONS}
                  />
                </label>
                <label className="field">
                  <span>Section</span>
                  <NeuSelect
                    id="search-section"
                    value={section}
                    onChange={setSection}
                    options={SEARCH_SECTION_OPTIONS}
                  />
                </label>
                <label className="field">
                  <span>Sort (default: most played)</span>
                  <NeuSelect id="search-sort" value={sort} onChange={setSort} options={SEARCH_SORT_OPTIONS} />
                </label>
                <label className="field">
                  <span>Min stars (filter)</span>
                  <input type="number" step="0.1" value={minStars} onChange={(e) => setMinStars(e.target.value)} />
                </label>
                <label className="field">
                  <span>Max stars (filter)</span>
                  <input type="number" step="0.1" value={maxStars} onChange={(e) => setMaxStars(e.target.value)} />
                </label>
              </div>
              <details className="advanced">
                <summary>Advanced filters (API params)</summary>
                <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                  <label className="field">
                    <span>Genre id (g)</span>
                    <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="e.g. 4" />
                  </label>
                  <label className="field">
                    <span>Language id (l)</span>
                    <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Extras (e), dot-separated</span>
                    <input type="text" value={extras} onChange={(e) => setExtras(e.target.value)} placeholder="video" />
                  </label>
                  <label className="field">
                    <span>General (c), dot-separated</span>
                    <input type="text" value={general} onChange={(e) => setGeneral(e.target.value)} placeholder="featured_artists" />
                  </label>
                  <label className="field">
                    <span>Ranks (r), dot-separated</span>
                    <input type="text" value={ranks} onChange={(e) => setRanks(e.target.value)} placeholder="S.SH.X" />
                  </label>
                  <label className="checkbox-row" style={{ alignSelf: "end" }}>
                    <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
                    Include NSFW
                  </label>
                </div>
              </details>
              <div className="row-actions">
                <button type="button" className="primary" disabled={searching} onClick={() => void runSearch(false)}>
                  {searching ? "Searching…" : "Search"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={searching || !cursorString}
                  onClick={() => void runSearch(true)}
                >
                  Load more
                </button>
                <label className="checkbox-row">
                  <input type="checkbox" checked={noVideo} onChange={(e) => setNoVideo(e.target.checked)} />
                  Downloads without video (recommended)
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={hideOwnedSearch} onChange={(e) => setHideOwnedSearch(e.target.checked)} />
                  Hide maps already in Songs folder
                </label>
              </div>
              <div className="curate-panel">
                <div className="curate-panel-title">Curate</div>
                <p className="hint curate-panel-desc">
                  Picks maps you don&apos;t have locally yet (same mode / star / advanced filters as above). Discover uses
                  your sort and shuffles; New ranked uses ranked sets sorted by most recently ranked.
                </p>
                {curateError && <div className="error-banner">{curateError}</div>}
                <div className="row-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={curating || searching}
                    onClick={() => void runCurateDiscover()}
                  >
                    {curating ? "Curating…" : "Discover (shuffle)"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={curating || searching}
                    onClick={() => void runCurateNewRanked()}
                  >
                    New ranked
                  </button>
                  {curateResults.length > 0 && (
                    <button type="button" className="secondary" onClick={() => setCurateResults([])}>
                      Clear curated picks
                    </button>
                  )}
                </div>
              </div>
              <p className="hint">
                Results are filtered client-side so at least one difficulty in the selected mode fits your star range.
                Downloads are full beatmap sets (.osz). After import, press <strong>F5</strong> in osu!stable song select
                if needed.
              </p>
              {total != null && (
                <p className="hint">
                  API total (before star filter): <strong>{total}</strong>
                </p>
              )}
              {activeCollection && (
                <p className="hint">
                  <strong>Add to collection:</strong> {activeCollection.name}
                </p>
              )}
            </div>

            {curateResults.length > 0 && (
              <div className="panel panel-nested curate-results-panel">
                <div className="panel-head">
                  <h2>Curated picks</h2>
                  <p className="panel-sub">Sets not detected in your Songs folder — import or save to a collection.</p>
                </div>
                <div className="results results-grid">
                  {curateResults.map((raw) => {
                    const set = raw as Record<string, unknown>;
                    const covers = set.covers as Record<string, string> | undefined;
                    const sid = Number(set.id);
                    const disabledDl = (set.availability as { download_disabled?: boolean } | undefined)
                      ?.download_disabled === true;
                    const inColl = activeItems.some((c) => c.beatmapsetId === sid);
                    const importingThis = directImportSetId === sid;
                    const locallyPresent = localBeatmapsetIds.has(sid);
                    return (
                      <div key={`curate-${sid}`} className="result-card">
                        <img src={covers?.list || covers?.card || ""} alt="" loading="lazy" />
                        <div className="result-meta">
                          <div className="title">{String(set.title)}</div>
                          <div className="sub">
                            {String(set.artist)} — mapped by {String(set.creator)}
                          </div>
                          {set.status != null && <span className="tag">{String(set.status)}</span>}
                          {locallyPresent && <span className="tag tag-local">In Songs folder</span>}
                        </div>
                        <div className="result-actions">
                          <button
                            type="button"
                            className="primary"
                            disabled={
                              disabledDl || locallyPresent || importingThis || directImportSetId !== null
                            }
                            onClick={() => void importFromSearch(sid)}
                          >
                            {locallyPresent
                              ? "Already imported"
                              : importingThis
                                ? "Importing…"
                                : "Import now"}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={!partyCanSend || disabledDl}
                            onClick={() =>
                              sendBeatmapToParty({
                                beatmapsetId: sid,
                                artist: String(set.artist ?? ""),
                                title: String(set.title ?? ""),
                                creator: String(set.creator ?? ""),
                                coverUrl: covers?.list ?? covers?.card ?? null,
                              })
                            }
                            title={
                              partyCanSend
                                ? "Leader: queue this set for everyone in the lobby"
                                : "Create or join a lobby as leader"
                            }
                          >
                            Send to party
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={inColl}
                            onClick={() => addToCollection(set)}
                          >
                            {inColl ? "In this collection" : "Add to collection"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="results results-grid">
              {searchDisplayResults.length === 0 &&
                rawResults.length > 0 &&
                hideOwnedSearch &&
                searchAttempted &&
                !searching && (
                  <div className="empty-state">
                    <p className="empty-title">All hidden</p>
                    <p className="empty-text">
                      Every result is already in your Songs folder. Turn off &quot;Hide maps already in Songs folder&quot; to
                      see them, or run Search again for different maps.
                    </p>
                  </div>
                )}
              {rawResults.length === 0 && searchAttempted && !searching && (
                <div className="empty-state">
                  <p className="empty-title">No beatmaps here</p>
                  <p className="empty-text">
                    Try a wider star range, another section, or a shorter query. Maps with downloads disabled are hidden.
                  </p>
                </div>
              )}
              {rawResults.length === 0 && !searchAttempted && !searching && (
                <div className="empty-state">
                  <p className="empty-title">Ready when you are</p>
                  <p className="empty-text">Set mode and filters, then press Search to load beatmap sets from osu!.</p>
                </div>
              )}
              {searching && rawResults.length === 0 && (
                <div className="empty-state">
                  <div className="boot-spinner boot-spinner-inline" aria-hidden />
                  <p className="empty-text">Fetching results…</p>
                </div>
              )}
              {searchDisplayResults.map((raw) => {
                const set = raw as Record<string, unknown>;
                const covers = set.covers as Record<string, string> | undefined;
                const sid = Number(set.id);
                const disabledDl = (set.availability as { download_disabled?: boolean } | undefined)?.download_disabled === true;
                const inColl = activeItems.some((c) => c.beatmapsetId === sid);
                const importingThis = directImportSetId === sid;
                const locallyPresent = localBeatmapsetIds.has(sid);
                return (
                                   <div key={sid} className="result-card">
                    <img src={covers?.list || covers?.card || ""} alt="" loading="lazy" />
                    <div className="result-meta">
                      <div className="title">{String(set.title)}</div>
                      <div className="sub">
                        {String(set.artist)} — mapped by {String(set.creator)}
                      </div>
                      {set.status != null && <span className="tag">{String(set.status)}</span>}
                      {locallyPresent && <span className="tag tag-local">In Songs folder</span>}
                    </div>
                    <div className="result-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={
                          disabledDl || locallyPresent || importingThis || directImportSetId !== null
                        }
                        onClick={() => void importFromSearch(sid)}
                      >
                        {locallyPresent
                          ? "Already imported"
                          : importingThis
                            ? "Importing…"
                            : "Import now"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!partyCanSend || disabledDl}
                        onClick={() =>
                          sendBeatmapToParty({
                            beatmapsetId: sid,
                            artist: String(set.artist ?? ""),
                            title: String(set.title ?? ""),
                            creator: String(set.creator ?? ""),
                            coverUrl: covers?.list ?? covers?.card ?? null,
                          })
                        }
                        title={partyCanSend ? "Leader: queue this set for everyone in the lobby" : "Create or join a lobby as leader"}
                      >
                        Send to party
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={inColl}
                        onClick={() => addToCollection(set)}
                      >
                        {inColl ? "In this collection" : "Add to collection"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "collection" && (
          <div className="panel panel-elevated">
            <div className="panel-head">
              <h2>Collections</h2>
              <p className="panel-sub">
                Queue maps for import, export a shareable list for friends, or import someone else&apos;s{' '}
                <code>.osu-link.json</code> file.
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
                <button type="button" className="secondary" onClick={createCollection}>
                  New collection
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={collectionStore.collections.length <= 1}
                  onClick={deleteActiveCollection}
                >
                  Delete this one
                </button>
                <label className="field collection-rename-field">
                  <span>Rename current</span>
                  <input
                    type="text"
                    value={collectionNameDraft}
                    onChange={(e) => setCollectionNameDraft(e.target.value)}
                    onBlur={() => void commitCollectionRename()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    placeholder="Collection name"
                  />
                </label>
              </div>
            </div>

            <div className="share-panel">
              <div className="share-panel-title">Share this collection</div>
              <p className="share-panel-desc">
                Friends need osu-link too. Send the JSON file or paste from clipboard — imports always create a{' '}
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
            </div>

            <div className="row-actions">
              <button
                type="button"
                className="primary"
                disabled={importBusy || activeItems.length === 0}
                onClick={() => void importAll()}
              >
                {importBusy ? "Importing…" : "Import all (pending / error)"}
              </button>
              <label className="checkbox-row">
                <input type="checkbox" checked={noVideo} onChange={(e) => setNoVideo(e.target.checked)} />
                Without video
              </label>
            </div>
            <p className="hint">
              Imports download <code>.osz</code> via public mirrors (not the osu! API), verify audio is present, and fall back if a
              mirror returns an incomplete archive. If you see 429, wait before retrying.
            </p>
            <div className="collection-list">
              {activeItems.length === 0 && (
                <div className="empty-state empty-state-tight">
                  <p className="empty-title">This collection is empty</p>
                  <p className="empty-text">
                    Add maps from Search, or import a friend&apos;s shared file to create a new list automatically.
                  </p>
                  <button type="button" className="secondary" onClick={() => setTab("search")}>
                    Go to Search
                  </button>
                </div>
              )}
              {activeItems.map((item) => (
                <div key={item.id} className="collection-row">
                  {item.coverUrl && <img src={item.coverUrl} alt="" width={72} height={50} style={{ objectFit: "cover", borderRadius: 4 }} />}
                  <div className="info">
                    <div>
                      {item.title} — {item.artist}
                    </div>
                    <div className="sub">{item.creator}</div>
                    <div className={`st ${item.status}`}>
                      {item.status}
                      {item.error ? `: ${item.error}` : ""}
                    </div>
                  </div>
                  <button type="button" className="secondary" disabled={importBusy} onClick={() => void importOne(item)}>
                    Import
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!partyCanSend}
                    onClick={() =>
                      sendBeatmapToParty({
                        beatmapsetId: item.beatmapsetId,
                        artist: item.artist,
                        title: item.title,
                        creator: item.creator,
                        coverUrl: item.coverUrl ?? null,
                      })
                    }
                    title={partyCanSend ? "Leader: queue for party" : "Create or join a lobby as leader"}
                  >
                    Party
                  </button>
                  <button type="button" className="danger" onClick={() => void removeFromCollection(item.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
          </div>
        </main>
      </div>
    </div>
  );

  return isTauri() ? (
    <div className="app-desktop">
      <TitleBar />
      {main}
    </div>
  ) : (
    main
  );
}

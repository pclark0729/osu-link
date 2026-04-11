import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  buildSharedPayload,
  parseImportedCollectionJson,
  serializeSharedCollection,
} from "./collectionShare";
import {
  DEFAULT_OVERLAY_FOCUS_HOTKEY,
  DEFAULT_OVERLAY_HOTKEY,
  DEFAULT_PARTY_WS_URL,
  PARTY_SERVER_URL_UI_HIDDEN,
  PUBLIC_PARTY_WS_URL,
  defaultPartyWsUrlFromSettings,
} from "./constants";
import {
  getActiveCollection,
  mapActiveItems,
  type BeatmapCollection,
  type CollectionItem,
  type CollectionStore,
} from "./models";
import { OnboardingFlow } from "./OnboardingFlow";
import { buildPartyConnectUrlCandidates } from "./party/partyConnectUrls";
import { PartyClient, type PartyClientState } from "./party/partyClient";
import { parseLobbyCodeFromText } from "./party/parseLobbyCode";
import { PartyPanel } from "./PartyPanel";
import { SearchDownloadPanel } from "./SearchDownloadPanel";
import { SocialPanel } from "./SocialPanel";
import { TitleBar } from "./TitleBar";
import { useOsuOverlay } from "./useOsuOverlay";
import { useSearchDownloadState } from "./useSearchDownloadState";
import packageJson from "../package.json";
import { checkForUpdatesAndInstall, updaterAvailable } from "./autoUpdate";
import "./App.css";

interface Settings {
  clientId: string;
  clientSecret: string;
  beatmapDirectory: string | null;
  onboardingCompleted: boolean;
  partyServerUrl: string | null;
  socialApiBaseUrl: string | null;
  /** Normalized shortcut string (never empty in UI). */
  overlayHotkey: string;
  /** Focus overlay for typing (never empty in UI). */
  overlayFocusHotkey: string;
  /** In-game overlay window and global shortcuts. */
  overlayEnabled: boolean;
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
    overlayHotkey: DEFAULT_OVERLAY_HOTKEY,
    overlayFocusHotkey: DEFAULT_OVERLAY_FOCUS_HOTKEY,
    overlayEnabled: true,
  });
  const [resolvedSongs, setResolvedSongs] = useState<string>("");
  const [authLabel, setAuthLabel] = useState<string>("Signed out");
  const [noVideo, setNoVideo] = useState(true);
  const [collectionStore, setCollectionStore] = useState<CollectionStore>({
    activeCollectionId: null,
    collections: [],
  });
  const storeRef = useRef<CollectionStore>(collectionStore);
  const [importBusy, setImportBusy] = useState(false);
  const [collectionNameDraft, setCollectionNameDraft] = useState("");
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("—");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [localBeatmapsetIds, setLocalBeatmapsetIds] = useState<Set<number>>(() => new Set());
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
        overlayHotkey: (s as Settings).overlayHotkey?.trim() || DEFAULT_OVERLAY_HOTKEY,
        overlayFocusHotkey: (s as Settings).overlayFocusHotkey?.trim() || DEFAULT_OVERLAY_FOCUS_HOTKEY,
        overlayEnabled: (s as Settings).overlayEnabled !== false,
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
          overlayHotkey: (s as Settings).overlayHotkey?.trim() || DEFAULT_OVERLAY_HOTKEY,
          overlayFocusHotkey: (s as Settings).overlayFocusHotkey?.trim() || DEFAULT_OVERLAY_FOCUS_HOTKEY,
          overlayEnabled: (s as Settings).overlayEnabled !== false,
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
          overlayHotkey:
            settings.overlayHotkey.trim() !== "" ? settings.overlayHotkey.trim() : null,
          overlayFocusHotkey:
            settings.overlayFocusHotkey.trim() !== "" ? settings.overlayFocusHotkey.trim() : null,
          overlayEnabled: settings.overlayEnabled,
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

  const searchDl = useSearchDownloadState({
    pushToast,
    refreshPaths,
    setSettingsMsg,
    collectionStore,
    persistStore,
    storeRef,
    partyCanSend,
    sendBeatmapToParty,
    showPartyActions: true,
    showCollectionActions: true,
    localBeatmapsetIds,
    localIdsRef: localLibraryRef,
    noVideo,
    setNoVideo,
  });

  useOsuOverlay(bootReady, settings.overlayEnabled, settings.overlayHotkey, settings.overlayFocusHotkey);

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
          overlayHotkey:
            settings.overlayHotkey.trim() !== "" ? settings.overlayHotkey.trim() : null,
          overlayFocusHotkey:
            settings.overlayFocusHotkey.trim() !== "" ? settings.overlayFocusHotkey.trim() : null,
          overlayEnabled: settings.overlayEnabled,
        },
      });
      const wsUrl = defaultPartyWsUrlFromSettings(partyUrl);
      partyClientRef.current?.setUrl(wsUrl);
      setPartyState((prev) => ({ ...prev, url: wsUrl }));
      setSettingsMsg("Settings saved.");
      pushToast("success", "Settings saved.");
      setSettings((prev) => ({
        ...prev,
        overlayHotkey: prev.overlayHotkey.trim() || DEFAULT_OVERLAY_HOTKEY,
        overlayFocusHotkey: prev.overlayFocusHotkey.trim() || DEFAULT_OVERLAY_FOCUS_HOTKEY,
      }));
      if (isTauri()) {
        await invoke("reload_overlay_hotkeys").catch(() => {});
      }
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
            {isTauri() && (
              <>
                <label className="field field--checkbox" style={{ marginBottom: "1rem" }}>
                  <input
                    type="checkbox"
                    checked={settings.overlayEnabled}
                    onChange={(e) => setSettings({ ...settings, overlayEnabled: e.target.checked })}
                  />
                  <span>Enable in-game overlay (search panel over osu!)</span>
                </label>
                <p className="hint" style={{ marginBottom: "0.75rem" }}>
                  In-game overlay: when osu!stable is running, you can open the search panel with the shortcuts below. On
                  Windows, shortcuts use a low-level keyboard hook (similar to Overwolf) so they still fire while osu!
                  has focus; other platforms use the standard global shortcut API. Toggle does not steal osu! focus; use
                  the second shortcut when you need to type in the overlay.
                </p>
                <p className="hint" style={{ marginBottom: "0.75rem" }}>
                  <strong>Fullscreen:</strong> true exclusive fullscreen owns the screen and a normal desktop window
                  cannot draw on top. Use osu! <strong>borderless</strong> at your display resolution (or windowed).
                  The overlay refreshes its stacking order several times per second to stay above the game when the OS
                  allows it.
                </p>
                <label className="field" style={{ marginBottom: "1rem" }}>
                  <span>Overlay toggle shortcut</span>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={DEFAULT_OVERLAY_HOTKEY}
                    value={settings.overlayHotkey}
                    disabled={!settings.overlayEnabled}
                    onChange={(e) => setSettings({ ...settings, overlayHotkey: e.target.value })}
                  />
                </label>
                <label className="field" style={{ marginBottom: "1rem" }}>
                  <span>Focus overlay shortcut</span>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={DEFAULT_OVERLAY_FOCUS_HOTKEY}
                    value={settings.overlayFocusHotkey}
                    disabled={!settings.overlayEnabled}
                    onChange={(e) => setSettings({ ...settings, overlayFocusHotkey: e.target.value })}
                  />
                </label>
                <p className="hint" style={{ marginBottom: "1rem" }}>
                  Use Tauri&apos;s format: modifiers and key separated by <code>+</code> (e.g.{" "}
                  <code>Shift+Tab</code>, <code>Ctrl+Shift+F</code>). The two shortcuts must differ. Save settings to
                  apply. If registration fails, try another combination.
                </p>
              </>
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

        {tab === "search" && <SearchDownloadPanel s={searchDl} variant="main" />}

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

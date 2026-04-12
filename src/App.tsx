import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type ChangeEvent,
  type UIEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  BarChart3,
  Dumbbell,
  Library,
  List,
  Search,
  Settings,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import {
  buildSharedPayload,
  parseImportedCollectionJson,
  serializeSharedCollection,
} from "./collectionShare";
import {
  DEFAULT_HOTKEY_FOCUS_SEARCH,
  DEFAULT_HOTKEY_RANDOM_CURATE,
  DEFAULT_HOTKEY_TRAIN_END,
  DEFAULT_HOTKEY_TRAIN_OPEN,
  DEFAULT_HOTKEY_TRAIN_RANDOMIZE,
  DEFAULT_PARTY_WS_URL,
  PARTY_SERVER_URL_UI_HIDDEN,
  PUBLIC_PARTY_WS_URL,
  defaultPartyWsUrlFromSettings,
} from "./constants";
import {
  getActiveCollection,
  mapActiveItems,
  uniqueCollectionName,
  type BeatmapCollection,
  type CollectionItem,
  type CollectionStore,
} from "./models";
import { JapaneseTextBackdrop } from "./JapaneseTextBackdrop";
import { CollectionsPanel } from "./CollectionsPanel";
import { OnboardingFlow } from "./OnboardingFlow";
import { buildPartyConnectUrlCandidates } from "./party/partyConnectUrls";
import { PartyClient, type PartyClientState } from "./party/partyClient";
import { parseLobbyCodeFromText } from "./party/parseLobbyCode";
import { PartyPanel } from "./PartyPanel";
import { BeatmapsetDetailModal, type BeatmapsetDetailTarget } from "./BeatmapsetDetailModal";
import { SearchDownloadPanel } from "./SearchDownloadPanel";
import { AchievementsPanel } from "./AchievementsPanel";
import { PersonalStatsPanel } from "./PersonalStatsPanel";
import { TrainPanel } from "./TrainPanel";
import { resolveSocialApiBaseUrl } from "./socialApiUrl";
import { SocialPanel } from "./SocialPanel";
import { TitleBar } from "./TitleBar";
import { useSearchDownloadState } from "./useSearchDownloadState";
import { useGlobalHotkeys } from "./useGlobalHotkeys";
import { DownloadLogsPanel } from "./DownloadLogsPanel";
import { MainPaneSticky } from "./MainPaneSticky";
import { DOWNLOAD_LOG_MAX, newDownloadLogId, type DownloadLogEntry } from "./downloadLog";
import packageJson from "../package.json";
import type { Update } from "@tauri-apps/plugin-updater";
import { applyUpdateAndRelaunch, check, checkForUpdatesAndInstall, updaterAvailable } from "./autoUpdate";
import {
  loadDesktopNotificationsEnabled,
  notifyDesktop,
  saveDesktopNotificationsEnabled,
} from "./desktopNotify";
import "./App.css";

interface Settings {
  clientId: string;
  clientSecret: string;
  beatmapDirectory: string | null;
  onboardingCompleted: boolean;
  partyServerUrl: string | null;
  socialApiBaseUrl: string | null;
  hotkeyFocusSearch: string;
  hotkeyRandomCurate: string;
  hotkeyTrainOpen: string;
  hotkeyTrainRandomize: string;
  hotkeyTrainEnd: string;
  discordControlEnabled: boolean;
  discordControlSessionToken: string | null;
  discordControlWsUrl: string | null;
}

function mapSettingsFromRust(s: Settings): Settings {
  return {
    clientId: s.clientId ?? "",
    clientSecret: s.clientSecret ?? "",
    beatmapDirectory: s.beatmapDirectory ?? null,
    onboardingCompleted: s.onboardingCompleted !== false,
    partyServerUrl: s.partyServerUrl ?? null,
    socialApiBaseUrl: s.socialApiBaseUrl ?? null,
    hotkeyFocusSearch: s.hotkeyFocusSearch ?? DEFAULT_HOTKEY_FOCUS_SEARCH,
    hotkeyRandomCurate: s.hotkeyRandomCurate ?? DEFAULT_HOTKEY_RANDOM_CURATE,
    hotkeyTrainOpen: s.hotkeyTrainOpen ?? DEFAULT_HOTKEY_TRAIN_OPEN,
    hotkeyTrainRandomize: s.hotkeyTrainRandomize ?? DEFAULT_HOTKEY_TRAIN_RANDOMIZE,
    hotkeyTrainEnd: s.hotkeyTrainEnd ?? DEFAULT_HOTKEY_TRAIN_END,
    discordControlEnabled: Boolean(s.discordControlEnabled),
    discordControlSessionToken: s.discordControlSessionToken ?? null,
    discordControlWsUrl: s.discordControlWsUrl ?? null,
  };
}

function settingsToCmdPayload(s: Settings) {
  const partyUrl =
    s.partyServerUrl && s.partyServerUrl.trim() !== "" ? s.partyServerUrl.trim() : null;
  const socialUrl =
    s.socialApiBaseUrl && s.socialApiBaseUrl.trim() !== "" ? s.socialApiBaseUrl.trim() : null;
  return {
    clientId: s.clientId.trim(),
    clientSecret: s.clientSecret.trim(),
    beatmapDirectory:
      s.beatmapDirectory && s.beatmapDirectory.trim() !== "" ? s.beatmapDirectory.trim() : null,
    onboardingCompleted: s.onboardingCompleted,
    partyServerUrl: partyUrl,
    socialApiBaseUrl: socialUrl,
    hotkeyFocusSearch: s.hotkeyFocusSearch.trim(),
    hotkeyRandomCurate: s.hotkeyRandomCurate.trim(),
    hotkeyTrainOpen: s.hotkeyTrainOpen.trim(),
    hotkeyTrainRandomize: s.hotkeyTrainRandomize.trim(),
    hotkeyTrainEnd: s.hotkeyTrainEnd.trim(),
    discordControlEnabled: true,
    discordControlSessionToken:
      s.discordControlSessionToken && s.discordControlSessionToken.trim() !== ""
        ? s.discordControlSessionToken.trim()
        : null,
    discordControlWsUrl:
      s.discordControlWsUrl && s.discordControlWsUrl.trim() !== ""
        ? s.discordControlWsUrl.trim()
        : null,
  };
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

type Toast = { tone: "info" | "success" | "error"; message: string };

const initialPartyState = (url: string): PartyClientState => ({
  connection: "disconnected",
  lastError: null,
  url,
  selfId: null,
  lobbyCode: null,
  leaderId: null,
  members: [],
  queuedMaps: [],
  chat: [],
  lastSeq: 0,
});

/** Primary destinations — copy aligned with NN/g recognition & real-world task names. */
type AppTab =
  | "search"
  | "collection"
  | "party"
  | "social"
  | "train"
  | "stats"
  | "achievements"
  | "logs"
  | "settings";

const VIEW_COPY: Record<AppTab, { title: string; subtitle: string }> = {
  search: {
    title: "Search",
    subtitle: "Browse the osu! catalogue, tune filters, and import full beatmap sets.",
  },
  collection: {
    title: "Collections",
    subtitle: "Queues, batch import, exports, and shared JSON lists.",
  },
  party: {
    title: "Party",
    subtitle: "Connect to the party server for synced lobbies, queue, and chat.",
  },
  social: {
    title: "Social",
    subtitle: "Friends, activity, battles, challenges, and leaderboards.",
  },
  train: {
    title: "Train",
    subtitle: "Ramping queue, accuracy goals, and osu! deep links.",
  },
  stats: {
    title: "Stats",
    subtitle: "Performance trends and charts from your recent scores.",
  },
  achievements: {
    title: "Achievements",
    subtitle: "Badges from training and social play — sync when the party server is online.",
  },
  logs: {
    title: "Logs",
    subtitle: "History of beatmap downloads and import paths.",
  },
  settings: {
    title: "Settings",
    subtitle: "Sign-in, Songs folder, party URLs, and updates.",
  },
};

function partyChipMeta(state: PartyClientState): { label: string; tone: "neutral" | "ok" | "warn" } {
  switch (state.connection) {
    case "disconnected":
      return { label: "Party offline", tone: "neutral" };
    case "connecting":
      return { label: "Party connecting…", tone: "warn" };
    case "error":
      return { label: "Party error", tone: "warn" };
    case "connected":
      return state.lobbyCode
        ? { label: `Lobby ${state.lobbyCode}`, tone: "ok" }
        : { label: "Party online", tone: "ok" };
  }
}

function viewSubtitle(tab: AppTab, partyState: PartyClientState): string {
  const base = VIEW_COPY[tab].subtitle;
  if (tab !== "party") return base;
  if (partyState.connection === "connecting") return "Connecting to the party server…";
  if (partyState.connection === "error") {
    const hint = partyState.lastError?.trim();
    return hint ? `Connection issue: ${hint}` : "Could not reach the party server. Check the WebSocket URL in Settings.";
  }
  if (partyState.connection === "connected") {
    return partyState.lobbyCode
      ? `You are in lobby ${partyState.lobbyCode}. Queue and chat are below.`
      : "Connected — create a lobby or join with a code.";
  }
  return base;
}

type DesktopIntroPhase = "idle" | "tv" | "eject" | "done";

const DESKTOP_INTRO_TV_MS = 820;
const DESKTOP_INTRO_EJECT_MS = 520;

function initialDesktopIntroPhase(): DesktopIntroPhase {
  if (!isTauri()) return "done";
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return "done";
  }
  return "idle";
}

const TauriTitleBarChrome = memo(function TauriTitleBarChrome({
  titleBarEjected,
  peek,
  onPeekEnter,
  onPeekLeave,
}: {
  titleBarEjected: boolean;
  peek: boolean;
  onPeekEnter: () => void;
  onPeekLeave: () => void;
}) {
  return (
    <div className="title-bar-chrome-root" onMouseLeave={titleBarEjected ? onPeekLeave : undefined}>
      {titleBarEjected && (
        <div
          className="title-bar-hover-strip"
          data-tauri-drag-region
          onMouseEnter={onPeekEnter}
          aria-hidden
        />
      )}
      <div
        className={`title-bar-slot ${titleBarEjected && !peek ? "title-bar-slot--ejected" : ""}`}
        onMouseEnter={titleBarEjected ? onPeekEnter : undefined}
      >
        <div className="title-bar-slot-inner">
          <TitleBar />
        </div>
      </div>
    </div>
  );
});

const CrtStartupOverlay = memo(function CrtStartupOverlay() {
  return <div className="crt-startup-overlay" aria-hidden />;
});

function ViewContextHeader({
  tab,
  authLabel,
  partyState,
}: {
  tab: AppTab;
  authLabel: string;
  partyState: PartyClientState;
}) {
  const copy = VIEW_COPY[tab];
  const chip = partyChipMeta(partyState);
  return (
    <header className="view-context-header" aria-labelledby="view-context-title">
      <div className="view-context-headline">
        <h1 id="view-context-title" className="view-context-title">
          {copy.title}
        </h1>
        <p className="view-context-subtitle">{viewSubtitle(tab, partyState)}</p>
      </div>
      <div className="view-context-chips" role="status" aria-live="polite">
        <span className="view-chip view-chip--neutral" title={authLabel}>
          {authLabel}
        </span>
        <span className={`view-chip view-chip--${chip.tone}`}>{chip.label}</span>
      </div>
    </header>
  );
}

export default function App() {
  const startupUpdateRef = useRef<Update | null>(null);
  const [startupUpdateVersion, setStartupUpdateVersion] = useState<string | null>(null);
  const [startupUpdateBusy, setStartupUpdateBusy] = useState(false);
  const [bootReady, setBootReady] = useState(false);
  const [desktopIntroPhase, setDesktopIntroPhase] = useState<DesktopIntroPhase>(initialDesktopIntroPhase);
  const [titleBarPeek, setTitleBarPeek] = useState(false);
  const titleBarPeekTimerRef = useRef<number | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const searchQueryRef = useRef<HTMLInputElement | null>(null);
  const [searchFocusNonce, setSearchFocusNonce] = useState(0);
  const focusSearchHotkeyRef = useRef<() => void>(() => {});
  const randomCurateHotkeyRef = useRef<() => void>(() => {});
  const trainHotkeyOpenRef = useRef<() => void>(() => {});
  const trainHotkeyRandomizeRef = useRef<() => void>(() => {});
  const trainHotkeyEndRef = useRef<() => void>(() => {});
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [tab, setTab] = useState<AppTab>("search");
  const [settings, setSettings] = useState<Settings>({
    clientId: "",
    clientSecret: "",
    beatmapDirectory: null,
    onboardingCompleted: false,
    partyServerUrl: null,
    socialApiBaseUrl: null,
    hotkeyFocusSearch: DEFAULT_HOTKEY_FOCUS_SEARCH,
    hotkeyRandomCurate: DEFAULT_HOTKEY_RANDOM_CURATE,
    hotkeyTrainOpen: DEFAULT_HOTKEY_TRAIN_OPEN,
    hotkeyTrainRandomize: DEFAULT_HOTKEY_TRAIN_RANDOMIZE,
    hotkeyTrainEnd: DEFAULT_HOTKEY_TRAIN_END,
    discordControlEnabled: true,
    discordControlSessionToken: null,
    discordControlWsUrl: null,
  });
  const [discordPairingCode, setDiscordPairingCode] = useState<string | null>(null);
  const [discordPairingBusy, setDiscordPairingBusy] = useState(false);
  const [discordWsConnected, setDiscordWsConnected] = useState(false);
  const [discordRemote, setDiscordRemote] = useState<{
    linked: boolean;
    discordUserId?: string;
    online?: boolean;
  } | null>(null);
  const [resolvedSongs, setResolvedSongs] = useState<string>("");
  const [authLabel, setAuthLabel] = useState<string>("Signed out");
  const [meOsuId, setMeOsuId] = useState<number | null>(null);
  const [beatmapsetDetail, setBeatmapsetDetail] = useState<BeatmapsetDetailTarget | null>(null);
  const [noVideo, setNoVideo] = useState(true);
  const [collectionStore, setCollectionStore] = useState<CollectionStore>({
    activeCollectionId: null,
    collections: [],
  });
  const storeRef = useRef<CollectionStore>(collectionStore);
  const [importBusy, setImportBusy] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("—");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [downloadLogs, setDownloadLogs] = useState<DownloadLogEntry[]>([]);
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useState(loadDesktopNotificationsEnabled);
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
  const appendDownloadLogRef = useRef<(entry: Omit<DownloadLogEntry, "id" | "at">) => void>(() => {});
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

  const appendDownloadLog = useCallback((entry: Omit<DownloadLogEntry, "id" | "at">) => {
    setDownloadLogs((prev) => {
      const row: DownloadLogEntry = { ...entry, id: newDownloadLogId(), at: Date.now() };
      return [row, ...prev].slice(0, DOWNLOAD_LOG_MAX);
    });
  }, []);

  const clearDownloadLogs = useCallback(() => {
    setDownloadLogs([]);
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

  const dismissStartupUpdate = useCallback(async () => {
    const u = startupUpdateRef.current;
    startupUpdateRef.current = null;
    setStartupUpdateVersion(null);
    if (u) await u.close();
  }, []);

  const installStartupUpdate = useCallback(async () => {
    const u = startupUpdateRef.current;
    if (!u) return;
    setStartupUpdateBusy(true);
    try {
      startupUpdateRef.current = null;
      setStartupUpdateVersion(null);
      await applyUpdateAndRelaunch(u);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast("error", message);
      await u.close();
    } finally {
      setStartupUpdateBusy(false);
    }
  }, [pushToast]);

  useEffect(() => {
    pushToastRef.current = pushToast;
    appendDownloadLogRef.current = appendDownloadLog;
  }, [pushToast, appendDownloadLog]);

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
        const stN = partyClientRef.current?.getState();
        const msg = ev.msg;
        if (
          stN?.selfId &&
          msg.fromMemberId &&
          msg.fromMemberId !== stN.selfId
        ) {
          const label =
            msg.title && msg.artist ? `${msg.artist} – ${msg.title}` : `set #${msg.setId}`;
          void notifyDesktop("osu-link — Party", `${label} added to queue`);
        }
        partyImportChain.current = partyImportChain.current.then(async () => {
          const st = partyClientRef.current?.getState();
          if (!st?.selfId) return;
          const idx = Math.max(0, st.members.findIndex((m) => m.id === st.selfId));
          await new Promise((r) => setTimeout(r, idx * 300));
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
            appendDownloadLogRef.current({
              source: "party",
              beatmapsetId: msg.setId,
              label,
              status: "success",
              importPath: path,
            });
            void reloadLocalLibraryRef.current();
          } catch (e) {
            const err = String(e);
            pushToastRef.current("error", `Party import failed (${label}): ${err}`);
            appendDownloadLogRef.current({
              source: "party",
              beatmapsetId: msg.setId,
              label,
              status: "error",
              errorMessage: err,
            });
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

  const refreshAuth = useCallback(async () => {
    try {
      const st = await invoke<{ loggedIn: boolean; username?: string | null; osuId?: number | null }>("auth_status");
      if (st.loggedIn) {
        setAuthLabel(st.username ? `Signed in as ${st.username}` : "Signed in");
        const oid = st.osuId;
        setMeOsuId(oid != null && Number.isFinite(Number(oid)) ? Number(oid) : null);
        const u = st.username?.trim();
        if (u) {
          setPartyDisplayName((prev) => (prev.trim() === "" ? u : prev));
        }
      } else {
        setAuthLabel("Signed out");
        setMeOsuId(null);
      }
    } catch {
      setAuthLabel("Signed out");
      setMeOsuId(null);
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
      setSettings(mapSettingsFromRust(s));
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
        setSettings(mapSettingsFromRust(s));
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

  useLayoutEffect(() => {
    if (!isTauri() || desktopIntroPhase !== "idle" || !bootReady) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDesktopIntroPhase("done");
      return;
    }
    setDesktopIntroPhase("tv");
  }, [bootReady, desktopIntroPhase]);

  useEffect(() => {
    if (desktopIntroPhase !== "tv") return;
    const t = window.setTimeout(() => setDesktopIntroPhase("eject"), DESKTOP_INTRO_TV_MS);
    return () => clearTimeout(t);
  }, [desktopIntroPhase]);

  useEffect(() => {
    if (desktopIntroPhase !== "eject") return;
    const t = window.setTimeout(() => setDesktopIntroPhase("done"), DESKTOP_INTRO_EJECT_MS);
    return () => clearTimeout(t);
  }, [desktopIntroPhase]);

  useEffect(() => {
    if (!isTauri()) return;
    const ejected = desktopIntroPhase === "eject" || desktopIntroPhase === "done";
    const hidden = ejected && !titleBarPeek;
    document.documentElement.toggleAttribute("data-title-bar-ejected", hidden);
    return () => document.documentElement.removeAttribute("data-title-bar-ejected");
  }, [desktopIntroPhase, titleBarPeek]);

  const scheduleTitleBarPeekEnd = useCallback(() => {
    if (titleBarPeekTimerRef.current != null) window.clearTimeout(titleBarPeekTimerRef.current);
    titleBarPeekTimerRef.current = window.setTimeout(() => {
      titleBarPeekTimerRef.current = null;
      setTitleBarPeek(false);
    }, 240);
  }, []);

  const cancelTitleBarPeekEnd = useCallback(() => {
    if (titleBarPeekTimerRef.current != null) {
      window.clearTimeout(titleBarPeekTimerRef.current);
      titleBarPeekTimerRef.current = null;
    }
  }, []);

  const onTitleBarPeekEnter = useCallback(() => {
    cancelTitleBarPeekEnd();
    setTitleBarPeek(true);
  }, [cancelTitleBarPeekEnd]);

  const onTitleBarPeekLeave = useCallback(() => {
    const ejected = isTauri() && (desktopIntroPhase === "eject" || desktopIntroPhase === "done");
    if (!ejected) return;
    scheduleTitleBarPeekEnd();
  }, [desktopIntroPhase, scheduleTitleBarPeekEnd]);

  useEffect(() => {
    const ejected = isTauri() && (desktopIntroPhase === "eject" || desktopIntroPhase === "done");
    if (!ejected) setTitleBarPeek(false);
  }, [desktopIntroPhase]);

  useEffect(() => {
    return () => {
      if (titleBarPeekTimerRef.current != null) window.clearTimeout(titleBarPeekTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!bootReady || !settings.onboardingCompleted || !updaterAvailable()) return;
    let cancelled = false;
    void (async () => {
      try {
        const update = await check();
        if (cancelled) {
          await update?.close();
          return;
        }
        if (!update) return;
        startupUpdateRef.current = update;
        setStartupUpdateVersion(update.version);
      } catch (err) {
        console.warn("Startup update check failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      const u = startupUpdateRef.current;
      startupUpdateRef.current = null;
      setStartupUpdateVersion(null);
      void u?.close();
    };
  }, [bootReady, settings.onboardingCompleted]);

  useEffect(() => {
    if (!isTauri() || !bootReady) return;
    let unlisten: (() => void) | undefined;
    void listen<{ connected?: boolean }>("discord-control-status", (e) => {
      setDiscordWsConnected(Boolean(e.payload.connected));
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, [bootReady]);

  useEffect(() => {
    if (!discordPairingCode || !isTauri()) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const st = await invoke<{ linked?: boolean; discordUserId?: string; online?: boolean }>(
            "discord_control_pairing_status",
          );
          if (st.linked) {
            setDiscordPairingCode(null);
            const s = await invoke<Settings>("get_settings");
            setSettings(mapSettingsFromRust(s));
            setDiscordRemote({
              linked: true,
              discordUserId: st.discordUserId,
              online: st.online,
            });
            pushToast("success", "Discord account linked.");
          }
        } catch {
          /* ignore */
        }
      })();
    }, 2000);
    return () => window.clearInterval(id);
  }, [discordPairingCode]);

  useEffect(() => {
    if (!isTauri() || tab !== "settings" || !bootReady) return;
    if (!settings.discordControlSessionToken) {
      setDiscordRemote(null);
      return;
    }
    void (async () => {
      try {
        const st = await invoke<{ linked?: boolean; discordUserId?: string; online?: boolean }>(
          "discord_control_pairing_status",
        );
        setDiscordRemote({
          linked: Boolean(st.linked),
          discordUserId: st.discordUserId,
          online: st.online,
        });
      } catch {
        setDiscordRemote(null);
      }
    })();
  }, [tab, bootReady, settings.discordControlSessionToken]);

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
        s: { ...settingsToCmdPayload(settings), onboardingCompleted: false },
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

  const commitCollectionRename = (name: string) => {
    const store = storeRef.current;
    const aid = store.activeCollectionId;
    if (!aid) return;
    const trimmed = name.trim() || "Untitled";
    const next: CollectionStore = {
      ...store,
      collections: store.collections.map((c) => (c.id === aid ? { ...c, name: trimmed } : c)),
    };
    void persistStore(next);
  };

  const duplicateActiveCollection = () => {
    const store = storeRef.current;
    const active = getActiveCollection(store);
    if (!active) return;
    const names = store.collections.map((c) => c.name);
    const name = uniqueCollectionName(`${active.name} (copy)`, names);
    const col: BeatmapCollection = {
      id: `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      items: active.items.map((i) => ({ ...i, id: randomId() })),
    };
    void persistStore({
      ...store,
      collections: [...store.collections, col],
      activeCollectionId: col.id,
    });
    pushToast("success", `Duplicated as “${name}”.`);
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
    appendDownloadLog,
  });

  const focusSearchFromHotkey = useCallback(() => {
    if (isTauri()) {
      void getCurrentWindow()
        .show()
        .then(() => getCurrentWindow().setFocus())
        .catch(() => {});
    }
    setTab("search");
    setSearchFocusNonce((n) => n + 1);
  }, []);

  const onHotkeyDuplicate = useCallback(() => {
    pushToast(
      "error",
      "Global hotkeys: two or more actions share the same shortcut. Only the first action registered for each key runs.",
    );
  }, [pushToast]);

  const onHotkeyRegisterError = useCallback(
    (message: string) => {
      pushToast("error", message.startsWith("Global shortcut:") ? message : `Global shortcut: ${message}`);
    },
    [pushToast],
  );

  focusSearchHotkeyRef.current = focusSearchFromHotkey;
  randomCurateHotkeyRef.current = () => {
    void searchDl.downloadRandomCurateDiscover();
  };

  useGlobalHotkeys({
    bootReady,
    onboardingCompleted: settings.onboardingCompleted,
    focusShortcut: settings.hotkeyFocusSearch,
    randomCurateShortcut: settings.hotkeyRandomCurate,
    trainOpenShortcut: settings.hotkeyTrainOpen,
    trainRandomizeShortcut: settings.hotkeyTrainRandomize,
    trainEndShortcut: settings.hotkeyTrainEnd,
    onFocusSearchRef: focusSearchHotkeyRef,
    onRandomCurateRef: randomCurateHotkeyRef,
    onTrainOpenRef: trainHotkeyOpenRef,
    onTrainRandomizeRef: trainHotkeyRandomizeRef,
    onTrainEndRef: trainHotkeyEndRef,
    onDuplicateShortcuts: onHotkeyDuplicate,
    onRegisterError: onHotkeyRegisterError,
  });

  const onMainScroll = useCallback((e: UIEvent<HTMLElement>) => {
    setShowScrollTop(e.currentTarget.scrollTop > 360);
  }, []);

  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setShowScrollTop(false);
  }, [tab]);

  useEffect(() => {
    if (!bootReady || !settings.onboardingCompleted) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const k = e.key;
      if (k < "1" || k > "9") return;
      const t = e.target;
      if (t instanceof Element && t.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      const order: Array<typeof tab> = [
        "search",
        "collection",
        "party",
        "social",
        "train",
        "stats",
        "achievements",
        "logs",
        "settings",
      ];
      setTab(order[parseInt(k, 10) - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bootReady, settings.onboardingCompleted]);

  const saveSettings = async () => {
    setSettingsMsg(null);
    try {
      const partyUrl =
        settings.partyServerUrl && settings.partyServerUrl.trim() !== ""
          ? settings.partyServerUrl.trim()
          : null;
      await invoke("save_settings_cmd", {
        s: settingsToCmdPayload(settings),
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

  const startDiscordPairing = async () => {
    if (!isTauri()) return;
    setDiscordPairingBusy(true);
    try {
      const r = await invoke<{ code?: string }>("discord_control_prepare_pairing", {
        draft: {
          partyServerUrl: settings.partyServerUrl,
          socialApiBaseUrl: settings.socialApiBaseUrl,
        },
      });
      if (r.code) setDiscordPairingCode(r.code);
      const s = await invoke<Settings>("get_settings");
      setSettings(mapSettingsFromRust(s));
      pushToast("success", "Pairing code ready. In Discord run: /osulink link (with your code).");
    } catch (e) {
      pushToast("error", String(e));
    } finally {
      setDiscordPairingBusy(false);
    }
  };

  const copyDiscordPairingCode = async () => {
    if (!discordPairingCode) return;
    try {
      await navigator.clipboard.writeText(discordPairingCode);
      pushToast("success", "Pairing code copied.");
    } catch {
      pushToast("error", "Could not copy to clipboard.");
    }
  };

  const revokeDiscordControl = async () => {
    try {
      await invoke("discord_control_revoke");
      setDiscordPairingCode(null);
      setDiscordRemote(null);
      setDiscordWsConnected(false);
      const s = await invoke<Settings>("get_settings");
      setSettings(mapSettingsFromRust(s));
      pushToast("success", "Discord control revoked.");
    } catch (e) {
      pushToast("error", String(e));
    }
  };

  const importOne = async (item: CollectionItem) => {
    const downloading = mapActiveItems(storeRef.current, (items) =>
      items.map((c) => (c.id === item.id ? { ...c, status: "downloading", error: null } : c)),
    );
    await persistStore(downloading);
    const label =
      `${item.artist} - ${item.title}`.trim() || `Set #${item.beatmapsetId}`;
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
      appendDownloadLog({
        source: "collection",
        beatmapsetId: item.beatmapsetId,
        label,
        status: "success",
        importPath: path,
      });
      await refreshPaths();
    } catch (e) {
      const msg = String(e);
      pushToast("error", msg);
      appendDownloadLog({
        source: "collection",
        beatmapsetId: item.beatmapsetId,
        label,
        status: "error",
        errorMessage: msg,
      });
      const err = mapActiveItems(storeRef.current, (items) =>
        items.map((c) => (c.id === item.id ? { ...c, status: "error", error: msg } : c)),
      );
      await persistStore(err);
    }
  };

  const importItemsQueue = async (items: CollectionItem[]) => {
    if (items.length === 0) return;
    setImportBusy(true);
    setSettingsMsg(null);
    try {
      for (const item of items) {
        const fresh = getActiveCollection(storeRef.current)?.items.find((i) => i.id === item.id);
        if (!fresh || fresh.status === "imported") continue;
        await importOne(fresh);
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

  const removeItemsFromCollection = async (itemIds: string[]) => {
    if (itemIds.length === 0) return;
    const idSet = new Set(itemIds);
    await persistStore(
      mapActiveItems(storeRef.current, (items) => items.filter((c) => !idSet.has(c.id))),
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
    const colName = uniqueCollectionName(parsed.data.name || "Imported collection", names);
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

  const desktopShellClass = "app-desktop";
  const showCrtOverlay = isTauri() && desktopIntroPhase === "tv";
  const titleBarEjected = isTauri() && (desktopIntroPhase === "eject" || desktopIntroPhase === "done");

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
      <div className={desktopShellClass}>
        {showCrtOverlay && <CrtStartupOverlay />}
        <JapaneseTextBackdrop />
        <TauriTitleBarChrome
          titleBarEjected={titleBarEjected}
          peek={titleBarPeek}
          onPeekEnter={onTitleBarPeekEnter}
          onPeekLeave={onTitleBarPeekLeave}
        />
        {boot}
      </div>
    ) : (
      <div className="app-desktop">
        <JapaneseTextBackdrop />
        {boot}
      </div>
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
      <div className={desktopShellClass}>
        {showCrtOverlay && <CrtStartupOverlay />}
        <JapaneseTextBackdrop />
        <TauriTitleBarChrome
          titleBarEjected={titleBarEjected}
          peek={titleBarPeek}
          onPeekEnter={onTitleBarPeekEnter}
          onPeekLeave={onTitleBarPeekLeave}
        />
        {onboarding}
      </div>
    ) : (
      <div className="app-desktop">
        <JapaneseTextBackdrop />
        {onboarding}
      </div>
    );
  }

  const main = (
    <div className="app-shell">
      <JapaneseTextBackdrop />
      <aside className="side-rail" aria-label="Main navigation">
        <div className="brand-block">
          <div className="brand-title">
            <span className="brand-osu">osu!</span>
            <span className="brand-link">link</span>
          </div>
          <p className="brand-tagline">Beatmaps for stable</p>
        </div>

        <nav className="side-nav" aria-label="Primary">
          <button
            type="button"
            className={`side-nav-item ${tab === "search" ? "active" : ""}`}
            onClick={() => setTab("search")}
            aria-current={tab === "search" ? "page" : undefined}
            title="Catalog — search and download beatmaps · Alt+1"
          >
            <span className="side-nav-icon">
              <Search size={20} aria-hidden />
            </span>
            <span className="side-nav-text">Search</span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "collection" ? "active" : ""}`}
            onClick={() => setTab("collection")}
            aria-current={tab === "collection" ? "page" : undefined}
            title={`${activeItems.length} maps in "${activeCollection?.name ?? "—"}" · ${totalMapsInLibrary} total across collections · Alt+2`}
          >
            <span className="side-nav-icon">
              <Library size={20} aria-hidden />
            </span>
            <span className="side-nav-text">Collections</span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "party" ? "active" : ""}`}
            onClick={() => setTab("party")}
            aria-current={tab === "party" ? "page" : undefined}
            title={
              partyState.lobbyCode
                ? `Lobby code ${partyState.lobbyCode} · Alt+3`
                : "Party — lobbies, queue, and chat · Alt+3"
            }
          >
            <span className="side-nav-icon">
              <Users size={20} aria-hidden />
            </span>
            <span className="side-nav-text">Party</span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "social" ? "active" : ""}`}
            onClick={() => setTab("social")}
            aria-current={tab === "social" ? "page" : undefined}
            title="Friends, activity, battles, challenges, leaderboard · Alt+4"
          >
            <span className="side-nav-icon">
              <UserPlus size={20} aria-hidden />
            </span>
            <span className="side-nav-text">Social</span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "train" ? "active" : ""}`}
            onClick={() => setTab("train")}
            aria-current={tab === "train" ? "page" : undefined}
            title="Training queue and drills · Alt+5"
          >
            <span className="side-nav-icon">
              <Dumbbell size={20} aria-hidden />
            </span>
            <span className="side-nav-text">Train</span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "stats" ? "active" : ""}`}
            onClick={() => setTab("stats")}
            aria-current={tab === "stats" ? "page" : undefined}
            title="Performance stats and charts · Alt+6"
          >
            <span className="side-nav-icon">
              <BarChart3 size={20} aria-hidden />
            </span>
            <span className="side-nav-text">Stats</span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "achievements" ? "active" : ""}`}
            onClick={() => setTab("achievements")}
            aria-current={tab === "achievements" ? "page" : undefined}
            title="Badges and share cards · Alt+7"
          >
            <span className="side-nav-icon">
              <Trophy size={20} aria-hidden />
            </span>
            <span className="side-nav-text">Achievements</span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "logs" ? "active" : ""}`}
            onClick={() => setTab("logs")}
            aria-current={tab === "logs" ? "page" : undefined}
            title="Download history and import paths · Alt+8"
          >
            <span className="side-nav-icon">
              <List size={20} aria-hidden />
            </span>
            <span className="side-nav-text">Logs</span>
          </button>
          <button
            type="button"
            className={`side-nav-item ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
            aria-current={tab === "settings" ? "page" : undefined}
            title="Account, OAuth, paths, and notifications · Alt+9"
          >
            <span className="side-nav-icon">
              <Settings size={20} aria-hidden />
            </span>
            <span className="side-nav-text">Settings</span>
          </button>
        </nav>

        <div className="side-footer">
          <div className="auth-compact">{authLabel}</div>
          <p className="side-nav-shortcut-hint">Alt+1–9 switch tabs</p>
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

        <BeatmapsetDetailModal
          open={beatmapsetDetail !== null}
          onClose={() => setBeatmapsetDetail(null)}
          target={beatmapsetDetail}
          mode={searchDl.mode}
          meOsuId={meOsuId}
        />

        <main
          ref={mainScrollRef}
          className="main-scroll"
          onScroll={onMainScroll}
          aria-labelledby="view-context-title"
          id="main-content"
        >
          <ViewContextHeader tab={tab} authLabel={authLabel} partyState={partyState} />
          <div className="main-tab-pane">
            <div style={{ display: tab === "train" ? "contents" : "none" }}>
              <TrainPanel
                pushToast={(tone, message) => pushToast(tone, message)}
                meOsuId={meOsuId}
                localBeatmapsetIds={localBeatmapsetIds}
                onInspectBeatmapset={(id) => setBeatmapsetDetail({ beatmapsetId: id })}
                trainHotkeyOpenRef={trainHotkeyOpenRef}
                trainHotkeyRandomizeRef={trainHotkeyRandomizeRef}
                trainHotkeyEndRef={trainHotkeyEndRef}
              />
            </div>
        {tab === "social" && (
          <SocialPanel
            onToast={(tone, message) => pushToast(tone, message)}
            resolvedSocialApiBaseUrl={resolveSocialApiBaseUrl(settings.partyServerUrl, settings.socialApiBaseUrl)}
            socialApiIsOverride={Boolean(settings.socialApiBaseUrl?.trim())}
          />
        )}

        {tab === "stats" && (
          <PersonalStatsPanel
            onToast={(tone, message) => pushToast(tone, message)}
            onGoToTrain={() => setTab("train")}
          />
        )}

        {tab === "achievements" && (
          <AchievementsPanel
            pushToast={(tone, message) => pushToast(tone, message)}
            resolvedSocialApiBaseUrl={resolveSocialApiBaseUrl(settings.partyServerUrl, settings.socialApiBaseUrl)}
            onboardingCompleted={settings.onboardingCompleted}
          />
        )}

        {tab === "logs" && (
          <DownloadLogsPanel entries={downloadLogs} onClear={clearDownloadLogs} onToast={pushToast} />
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
            onSendChat={(text) => {
              const ok = partyClientRef.current?.sendChat(text);
              if (!ok) pushToast("error", "Not connected to the party server.");
            }}
            onTransferLeadership={(targetMemberId) => {
              const ok = partyClientRef.current?.transferLeadership(targetMemberId);
              if (!ok) pushToast("error", "Not connected to the party server.");
            }}
            onClearQueue={() => {
              const ok = partyClientRef.current?.clearQueue();
              if (!ok) pushToast("error", "Not connected to the party server.");
            }}
            onRemoveQueueItem={(seq) => {
              const ok = partyClientRef.current?.removeQueueItem(seq);
              if (!ok) pushToast("error", "Not connected to the party server.");
            }}
          />
        )}

        {tab === "settings" && (
          <div className="panel panel-elevated settings-panel">
            <MainPaneSticky>
              <div className="panel-head">
                <h2>Settings</h2>
                <p className="panel-sub">
                  Version <strong>{appVersion}</strong> · updates via GitHub Releases.
                </p>
              </div>
            </MainPaneSticky>

            <details className="settings-disclosure">
              <summary>Keyboard shortcuts</summary>
              <div className="settings-disclosure-body">
                <p className="hint settings-shortcuts-hint">
                  <strong>Main window:</strong> Alt+1 Search · Alt+2 Collections · Alt+3 Party · Alt+4 Social · Alt+5
                  Train · Alt+6 Stats · Alt+7 Achievements · Alt+8 Logs · Alt+9 Settings
                </p>
                {isTauri() && (
                  <>
                    <p className="hint u-mb-3">
                      <strong>Global (desktop app):</strong> work even when osu-link is in the background. Use{" "}
                      <a
                        href="https://v2.tauri.app/plugin/global-shortcut/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Tauri shortcut syntax
                      </a>{" "}
                      (e.g. <code>Alt+Shift+O</code>, <code>Control+Shift+R</code>). Leave empty to disable.
                    </p>
                    <div className="grid-2">
                      <label className="field">
                        <span>Focus window &amp; search</span>
                        <input
                          type="text"
                          autoComplete="off"
                          placeholder={DEFAULT_HOTKEY_FOCUS_SEARCH}
                          value={settings.hotkeyFocusSearch}
                          onChange={(e) => setSettings({ ...settings, hotkeyFocusSearch: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Random curate download</span>
                        <input
                          type="text"
                          autoComplete="off"
                          placeholder={DEFAULT_HOTKEY_RANDOM_CURATE}
                          value={settings.hotkeyRandomCurate}
                          onChange={(e) => setSettings({ ...settings, hotkeyRandomCurate: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Train: open current map in osu!</span>
                        <input
                          type="text"
                          autoComplete="off"
                          placeholder={DEFAULT_HOTKEY_TRAIN_OPEN}
                          value={settings.hotkeyTrainOpen}
                          onChange={(e) => setSettings({ ...settings, hotkeyTrainOpen: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Train: randomize map (auto queue)</span>
                        <input
                          type="text"
                          autoComplete="off"
                          placeholder={DEFAULT_HOTKEY_TRAIN_RANDOMIZE}
                          value={settings.hotkeyTrainRandomize}
                          onChange={(e) => setSettings({ ...settings, hotkeyTrainRandomize: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Train: end session</span>
                        <input
                          type="text"
                          autoComplete="off"
                          placeholder={DEFAULT_HOTKEY_TRAIN_END}
                          value={settings.hotkeyTrainEnd}
                          onChange={(e) => setSettings({ ...settings, hotkeyTrainEnd: e.target.value })}
                        />
                      </label>
                    </div>
                    <div className="row-actions row-actions--spaced u-mt-3">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          setSettings((s) => ({
                            ...s,
                            hotkeyFocusSearch: "",
                            hotkeyRandomCurate: "",
                            hotkeyTrainOpen: "",
                            hotkeyTrainRandomize: "",
                            hotkeyTrainEnd: "",
                          }))
                        }
                      >
                        Clear global hotkeys
                      </button>
                    </div>
                  </>
                )}
              </div>
            </details>

            <details className="settings-disclosure" open>
              <summary>Application &amp; updates</summary>
              <div className="settings-disclosure-body">
                <div className="row-actions row-actions--spaced">
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
                  <p className="hint u-mb-0">
                    Updates only in the installed desktop app (not dev or browser).
                  </p>
                )}
              </div>
            </details>

            {isTauri() && (
              <details className="settings-disclosure" open>
                <summary>Notifications</summary>
                <div className="settings-disclosure-body">
                  <label className="field field--checkbox u-mb-3">
                    <input
                      type="checkbox"
                      checked={desktopNotificationsEnabled}
                      onChange={(e) => {
                        const v = e.target.checked;
                        saveDesktopNotificationsEnabled(v);
                        setDesktopNotificationsEnabled(v);
                      }}
                    />
                    <span>Notify: party queue &amp; friend requests</span>
                  </label>
                  <p className="hint u-mb-0">
                    The OS may ask for notification permission once.
                  </p>
                </div>
              </details>
            )}

            <details className="settings-disclosure" open>
              <summary>OAuth application</summary>
              <div className="settings-disclosure-body">
                <p className="panel-sub panel-sub--flush-top">
                  osu! OAuth keys for search; downloads use a public mirror.
                </p>
                <div className="row-actions row-actions--spaced">
                  <button type="button" className="secondary" onClick={() => void openSetupGuide()}>
                    Redo OAuth setup
                  </button>
                </div>
                <p className="hint">
                  On osu! (account → OAuth), redirect URI must be{" "}
                  <code>http://127.0.0.1:42813/callback</code>. Close other osu-link windows before sign-in.
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
              </div>
            </details>

            <details className="settings-disclosure" open>
              <summary>Paths &amp; server URLs</summary>
              <div className="settings-disclosure-body">
                <label className="field">
                  <span>Songs folder override (optional)</span>
                  <input
                    type="text"
                    placeholder="Default from osu!.cfg if empty"
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
                  <label className="field field--stack">
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
                <label className="field field--stack">
                  <span>Social API base URL (optional)</span>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="http://192.168.x.x:4681 (Pi / party-server on your LAN)"
                    value={settings.socialApiBaseUrl ?? ""}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        socialApiBaseUrl: e.target.value.trim() === "" ? null : e.target.value.trim(),
                      })
                    }
                  />
                </label>
                <p className="hint">
                  Social / Discord pairing use{" "}
                  <code>{resolveSocialApiBaseUrl(settings.partyServerUrl, settings.socialApiBaseUrl) ?? "—"}</code>. Party
                  HTTP is usually on port <code>4681</code> (party-server / Caddy on your Pi). Set this to your Pi&apos;s
                  LAN URL if you want a fixed host, or try <code>http://raspberrypi.local:4681</code> if mDNS works. Use{" "}
                  <code>http://127.0.0.1:4681</code> only when party-server runs on this PC. If you leave this empty,
                  pairing still tries LAN discovery, then the same silent fallback as party connect (
                  <code>http://192.168.1.43:4681</code>), then the public relay
                  {PARTY_SERVER_URL_UI_HIDDEN ? " (Party WebSocket may be hidden in this build)." : "."}
                </p>
                <label className="field field--stack">
                  <span>Discord control WebSocket URL (optional)</span>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="Derived from Social API base if empty (…/control)"
                    value={settings.discordControlWsUrl ?? ""}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        discordControlWsUrl: e.target.value.trim() === "" ? null : e.target.value.trim(),
                      })
                    }
                  />
                </label>
                <p className="hint">
                  Pairing uses the Party and Social API fields above immediately (no Save required first). Prefer{" "}
                  <code>http://</code> to your Pi unless you have terminated TLS on that port. If the first relay cannot
                  be reached, other relays (LAN discovery, <code>192.168.1.43:4681</code>, then the public host) are tried
                  automatically without extra prompts.
                </p>
                {discordPairingCode && (
                  <div className="discord-pairing-code-block">
                    <div className="party-code-row discord-pairing-code-row">
                      <span className="party-code-label">Discord pairing code</span>
                      <code className="party-code-value discord-pairing-code-value" aria-label="Discord pairing code">
                        {discordPairingCode}
                      </code>
                      <button type="button" className="secondary" onClick={() => void copyDiscordPairingCode()}>
                        Copy
                      </button>
                    </div>
                    <p className="hint discord-pairing-code-hint u-mb-0">
                      In Discord run <code>/osulink link</code> and paste this code. It expires in about 15 minutes.
                    </p>
                  </div>
                )}
                {settings.discordControlSessionToken && (
                  <p className="hint">
                    Relay:{" "}
                    {discordRemote?.linked
                      ? `linked (Discord user ${discordRemote.discordUserId ?? "?"})`
                      : "waiting for link in Discord"}{" "}
                    · App session: {discordWsConnected ? "connected" : "disconnected"}
                    {discordRemote?.online != null && (
                      <> · Desktop seen by relay: {discordRemote.online ? "online" : "offline"}</>
                    )}
                  </p>
                )}
                {!isTauri() && (
                  <p className="hint" role="status">
                    Discord pairing and remote control run in the desktop app only (not in the browser).
                  </p>
                )}
                <div className="row-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!isTauri() || discordPairingBusy}
                    aria-busy={discordPairingBusy}
                    onClick={() => void startDiscordPairing()}
                  >
                    {discordPairingBusy ? "Requesting code…" : "Start Discord pairing"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={!isTauri() || discordPairingBusy}
                    onClick={() => void revokeDiscordControl()}
                  >
                    Revoke Discord link
                  </button>
                </div>
                {discordPairingBusy && (
                  <p className="hint u-mb-0" aria-live="polite">
                    Contacting relay for a pairing code…
                  </p>
                )}
                <p className="hint">
                  Songs folder: {resolvedSongs || "—"} · <strong>{localBeatmapsetIds.size}</strong> set
                  {localBeatmapsetIds.size === 1 ? "" : "s"} found (subfolders scanned).
                </p>
                <div className="row-actions">
                  <button type="button" className="secondary" disabled={!isTauri()} onClick={() => void refreshPaths()}>
                    Rescan Songs folder
                  </button>
                </div>
                <p className="hint u-mb-0">
                  Re-sign in after changing OAuth scopes. Social needs party HTTP (<code>4681</code> by default)
                  reachable.
                </p>
              </div>
            </details>

            <details className="settings-disclosure" open>
              <summary>Account</summary>
              <div className="settings-disclosure-body">
                <div className="settings-danger-zone">
                  <p className="settings-danger-zone-title">Session &amp; saved keys</p>
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
                  <p className="hint settings-danger-zone-hint">
                    Sign out clears the local session. Save settings writes OAuth fields and paths to disk.
                  </p>
                </div>
                {settingsMsg && <p className="hint">{settingsMsg}</p>}
              </div>
            </details>
          </div>
        )}

        {tab === "search" && (
          <SearchDownloadPanel
            s={searchDl}
            heroQueryRef={searchQueryRef}
            searchFocusNonce={searchFocusNonce}
            onInspectSet={(raw) => {
              const id = Number((raw as Record<string, unknown>).id);
              if (!Number.isFinite(id)) return;
              setBeatmapsetDetail({ beatmapsetId: id, initialRaw: raw });
            }}
          />
        )}

        {tab === "collection" && (
          <CollectionsPanel
            collectionStore={collectionStore}
            setActiveCollectionId={setActiveCollectionId}
            createCollection={createCollection}
            deleteActiveCollection={deleteActiveCollection}
            duplicateActiveCollection={duplicateActiveCollection}
            commitCollectionRename={commitCollectionRename}
            localBeatmapsetIds={localBeatmapsetIds}
            importFileRef={importFileRef}
            onImportSharedFile={onImportSharedFile}
            exportSharedCollectionFile={exportSharedCollectionFile}
            copySharedCollectionJson={copySharedCollectionJson}
            importSharedFromClipboard={importSharedFromClipboard}
            importOne={importOne}
            importItemsQueue={importItemsQueue}
            removeFromCollection={removeFromCollection}
            removeItemsFromCollection={removeItemsFromCollection}
            importBusy={importBusy}
            noVideo={noVideo}
            setNoVideo={setNoVideo}
            partyCanSend={partyCanSend}
            sendBeatmapToParty={sendBeatmapToParty}
            pushToast={pushToast}
            onGoToSearch={() => setTab("search")}
            onInspectBeatmapset={(id) => setBeatmapsetDetail({ beatmapsetId: id })}
          />
        )}
          </div>
        </main>
      </div>
    </div>
  );

  return isTauri() ? (
    <div className={desktopShellClass}>
      {showCrtOverlay && <CrtStartupOverlay />}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <TauriTitleBarChrome
        titleBarEjected={titleBarEjected}
        peek={titleBarPeek}
        onPeekEnter={onTitleBarPeekEnter}
        onPeekLeave={onTitleBarPeekLeave}
      />
      {main}
      {showScrollTop && (
        <button
          type="button"
          className="main-scroll-top"
          onClick={() => mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Back to top"
        >
          ↑
        </button>
      )}
      {startupUpdateVersion && (
        <div
          className="update-prompt-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-prompt-title"
        >
          <div className="update-prompt-card">
            <h2 id="update-prompt-title" className="update-prompt-title">
              Update available
            </h2>
            <p className="update-prompt-text">
              osu-link {startupUpdateVersion} is ready to install. The app will restart to finish updating.
            </p>
            <div className="update-prompt-actions">
              <button
                type="button"
                className="secondary"
                disabled={startupUpdateBusy}
                onClick={() => void dismissStartupUpdate()}
              >
                Later
              </button>
              <button
                type="button"
                className="primary"
                disabled={startupUpdateBusy}
                onClick={() => void installStartupUpdate()}
              >
                {startupUpdateBusy ? "Installing…" : "Install and restart"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  ) : (
    <div className="app-desktop">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      {main}
      {showScrollTop && (
        <button
          type="button"
          className="main-scroll-top"
          onClick={() => mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Back to top"
        >
          ↑
        </button>
      )}
    </div>
  );
}

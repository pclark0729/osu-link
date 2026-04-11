import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { scheduleOverlayPin } from "./overlayPin";
import { SearchDownloadPanel } from "./SearchDownloadPanel";
import { getActiveCollection, type CollectionStore } from "./models";
import { useSearchDownloadState } from "./useSearchDownloadState";
import "./App.css";

type Toast = { tone: "info" | "success" | "error"; message: string };

export function OverlayApp() {
  const [bootReady, setBootReady] = useState(false);
  const [collectionStore, setCollectionStore] = useState<CollectionStore>({
    activeCollectionId: null,
    collections: [],
  });
  const storeRef = useRef(collectionStore);
  const [localBeatmapsetIds, setLocalBeatmapsetIds] = useState<Set<number>>(() => new Set());
  const localLibraryRef = useRef<Set<number>>(new Set());
  const [noVideo, setNoVideo] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [, setSettingsMsg] = useState<string | null>(null);

  useEffect(() => {
    storeRef.current = collectionStore;
  }, [collectionStore]);

  useEffect(() => {
    localLibraryRef.current = localBeatmapsetIds;
  }, [localBeatmapsetIds]);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("overlay-html");
    document.body.style.backgroundColor = "transparent";
    return () => {
      html.classList.remove("overlay-html");
      document.body.style.backgroundColor = "";
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    if (getCurrentWindow().label !== "overlay") return;
    void scheduleOverlayPin();
  }, []);

  /** Re-apply stacking above osu! while this window exists (helps borderless / fullscreen-optimized modes). */
  useEffect(() => {
    if (!isTauri()) return;
    if (getCurrentWindow().label !== "overlay") return;
    const id = window.setInterval(() => {
      void invoke("overlay_pin_topmost").catch(() => {});
    }, 280);
    return () => window.clearInterval(id);
  }, []);

  const pushToast = useCallback((tone: Toast["tone"], message: string) => {
    setToast({ tone, message });
  }, []);

  const reloadLocalLibrary = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const ids = await invoke<number[]>("get_local_beatmapset_ids");
      setLocalBeatmapsetIds(new Set(ids));
    } catch {
      setLocalBeatmapsetIds(new Set());
    }
  }, []);

  const refreshPaths = useCallback(async () => {
    await reloadLocalLibrary();
  }, [reloadLocalLibrary]);

  const persistStore = async (next: CollectionStore) => {
    storeRef.current = next;
    setCollectionStore(next);
    await invoke("save_collections_cmd", { store: next });
  };

  useEffect(() => {
    void (async () => {
      try {
        const st = await invoke<CollectionStore>("load_collections_cmd");
        storeRef.current = st;
        setCollectionStore(st);
      } catch {
        /* ignore */
      }
      await reloadLocalLibrary();
      setBootReady(true);
    })();
  }, [reloadLocalLibrary]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const active = getActiveCollection(collectionStore);
  const hasCollection = Boolean(active);

  const searchDl = useSearchDownloadState({
    pushToast,
    refreshPaths,
    setSettingsMsg,
    collectionStore,
    persistStore,
    storeRef,
    partyCanSend: false,
    sendBeatmapToParty: () => {},
    showPartyActions: false,
    showCollectionActions: hasCollection,
    localBeatmapsetIds,
    localIdsRef: localLibraryRef,
    noVideo,
    setNoVideo,
  });

  const close = () => void getCurrentWindow().hide().catch(() => {});

  if (!bootReady) {
    return (
      <div className="overlay-root overlay-root--boot">
        <div className="boot-spinner" aria-hidden />
      </div>
    );
  }

  return (
    <div className="overlay-root">
      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status">
          <span>{toast.message}</span>
          <button type="button" className="toast-dismiss" onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      <header className="overlay-chrome" data-tauri-drag-region>
        <span className="overlay-chrome-title">osu-link — Quick search</span>
        <button type="button" className="overlay-chrome-close" onClick={close} aria-label="Hide overlay">
          ×
        </button>
      </header>
      {!hasCollection && (
        <p className="overlay-hint">
          No collection selected in the main window — create one in osu-link to use &quot;Add to collection&quot; here.
        </p>
      )}
      <main className="overlay-main main-scroll">
        <SearchDownloadPanel s={searchDl} variant="overlay" />
      </main>
    </div>
  );
}

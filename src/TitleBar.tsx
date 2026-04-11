import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";

function IconMinimize() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconMaximize() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function IconRestore() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="8" y="10" width="11" height="11" stroke="currentColor" strokeWidth="2" rx="1" />
      <rect x="5" y="3" width="11" height="11" stroke="currentColor" strokeWidth="2" rx="1" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  const syncMaximized = useCallback(async () => {
    try {
      setMaximized(await getCurrentWindow().isMaximized());
    } catch {
      /* preview / unsupported */
    }
  }, []);

  useEffect(() => {
    void syncMaximized();
    const w = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const setup = w.onResized(() => void syncMaximized());
    void setup.then((fn) => {
      unlisten = fn;
    });
    return () => {
      void setup.then(() => unlisten?.());
    };
  }, [syncMaximized]);

  useEffect(() => {
    if (maximized) {
      document.documentElement.setAttribute("data-window-maximized", "true");
    } else {
      document.documentElement.removeAttribute("data-window-maximized");
    }
  }, [maximized]);

  const onMinimize = () => void getCurrentWindow().minimize().catch(() => {});
  const onToggleMax = () => void getCurrentWindow().toggleMaximize().catch(() => {});
  const onClose = () => void getCurrentWindow().close().catch(() => {});
  const onDragZoneDoubleClick = () => void onToggleMax();

  return (
    <header className="title-bar" data-maximized={maximized ? "true" : undefined}>
      <div className="title-bar-tracks">
        <div
          className="title-bar-zone title-bar-zone-rail"
          data-tauri-drag-region
          aria-label="Move window"
          onDoubleClick={onDragZoneDoubleClick}
        />
        <div
          className="title-bar-zone title-bar-zone-stage"
          data-tauri-drag-region
          aria-label="Move window"
          onDoubleClick={onDragZoneDoubleClick}
        />
      </div>
      <div className="title-bar-controls">
        <button type="button" className="title-bar-btn title-bar-btn-min" onClick={onMinimize} aria-label="Minimize">
          <IconMinimize />
        </button>
        <button type="button" className="title-bar-btn title-bar-btn-max" onClick={onToggleMax} aria-label={maximized ? "Restore" : "Maximize"}>
          {maximized ? <IconRestore /> : <IconMaximize />}
        </button>
        <button type="button" className="title-bar-btn title-bar-btn-close" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </div>
    </header>
  );
}

import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
          <Minus size={10} aria-hidden />
        </button>
        <button type="button" className="title-bar-btn title-bar-btn-max" onClick={onToggleMax} aria-label={maximized ? "Restore" : "Maximize"}>
          {maximized ? <Copy size={11} aria-hidden /> : <Square size={10} aria-hidden />}
        </button>
        <button type="button" className="title-bar-btn title-bar-btn-close" onClick={onClose} aria-label="Close">
          <X size={10} aria-hidden />
        </button>
      </div>
    </header>
  );
}

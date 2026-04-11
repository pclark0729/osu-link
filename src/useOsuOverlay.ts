import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { useEffect, useState } from "react";

import { DEFAULT_OVERLAY_FOCUS_HOTKEY, DEFAULT_OVERLAY_HOTKEY } from "./constants";
import { scheduleOverlayPin } from "./overlayPin";

const OVERLAY_LABEL = "overlay";
const POLL_MS = 1000;

/** Empty or whitespace falls back to the default shortcut. */
export function normalizeOverlayHotkey(raw: string): string {
  const t = raw.trim();
  return t.length > 0 ? t : DEFAULT_OVERLAY_HOTKEY;
}

/** Empty or whitespace falls back to the default focus shortcut. */
export function normalizeOverlayFocusHotkey(raw: string): string {
  const t = raw.trim();
  return t.length > 0 ? t : DEFAULT_OVERLAY_FOCUS_HOTKEY;
}

function buildOverlayUrl(): string {
  const { href } = window.location;
  const hashIdx = href.indexOf("#");
  return hashIdx >= 0 ? href.slice(0, hashIdx) : href;
}

async function showOverlayWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(OVERLAY_LABEL);
  if (existing) {
    await invoke("overlay_show_inactive");
    void scheduleOverlayPin();
    return;
  }
  new WebviewWindow(OVERLAY_LABEL, {
    url: buildOverlayUrl(),
    title: "osu-link — Search",
    width: 680,
    height: 480,
    minWidth: 360,
    minHeight: 280,
    resizable: true,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    // Do not take focus from osu! (see overlay_show_inactive / Win32 SW_SHOWNOACTIVATE).
    focus: false,
  });
  void scheduleOverlayPin();
}

async function toggleOverlayWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(OVERLAY_LABEL);
  if (existing) {
    const vis = await existing.isVisible();
    if (vis) await existing.hide();
    else {
      await invoke("overlay_show_inactive");
      void scheduleOverlayPin();
    }
    return;
  }
  await showOverlayWindow();
}

/**
 * Polls whether osu!stable is running (`is_osu_running`) to hide the overlay when osu exits; does not use HWND
 * eligibility so exclusive fullscreen still works. Registers global shortcuts only while osu is running (plugin
 * backend). Re-registers when hotkeys change (after Save in Settings).
 */
export function useOsuOverlay(
  bootReady: boolean,
  overlayEnabled: boolean,
  overlayHotkey: string,
  overlayFocusHotkey: string,
) {
  const [osuRunning, setOsuRunning] = useState(false);
  const [hotkeyBackend, setHotkeyBackend] = useState<string | null>(null);

  useEffect(() => {
    if (!overlayEnabled) {
      setOsuRunning(false);
    }
  }, [overlayEnabled]);

  useEffect(() => {
    if (!isTauri()) {
      setHotkeyBackend("plugin");
      return;
    }
    void invoke<string>("overlay_hotkeys_backend").then(setHotkeyBackend);
  }, []);

  useEffect(() => {
    if (!isTauri() || !bootReady || !overlayEnabled) {
      if (isTauri() && getCurrentWindow().label === "main") {
        void WebviewWindow.getByLabel(OVERLAY_LABEL).then((w) => w?.hide());
      }
      return;
    }
    if (getCurrentWindow().label !== "main") return;

    let cancelled = false;
    const tick = async () => {
      const running = await invoke<boolean>("is_osu_running").catch(() => false);
      if (cancelled) return;
      if (!running) {
        const w = await WebviewWindow.getByLabel(OVERLAY_LABEL);
        await w?.hide();
      }
      setOsuRunning(running);
    };
    const id = window.setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [bootReady, overlayEnabled]);

  /** Windows: low-level keyboard hook (Overwolf-style). Other platforms: Tauri global-shortcut plugin. */
  useEffect(() => {
    if (!isTauri() || !bootReady || !overlayEnabled || hotkeyBackend !== "ll-hook") return;
    if (getCurrentWindow().label !== "main") return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<string>("overlay-hotkey", (e) => {
      if (e.payload === "toggle") void toggleOverlayWindow();
      else if (e.payload === "focus") void invoke("overlay_focus");
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [bootReady, overlayEnabled, hotkeyBackend]);

  useEffect(() => {
    if (!isTauri() || !bootReady || !overlayEnabled) return;
    if (getCurrentWindow().label !== "main") return;
    if (hotkeyBackend !== "plugin") return;

    const hk = normalizeOverlayHotkey(overlayHotkey);

    if (!osuRunning) {
      void WebviewWindow.getByLabel(OVERLAY_LABEL).then((w) => w?.hide());
      return;
    }

    void register(hk, (event) => {
      if (event.state !== "Pressed") return;
      void toggleOverlayWindow();
    }).catch((err) => {
      console.warn("[osu-link] Overlay hotkey could not be registered:", hk, err);
    });

    return () => {
      void unregister(hk).catch(() => {});
    };
  }, [bootReady, overlayEnabled, hotkeyBackend, overlayHotkey, osuRunning]);

  useEffect(() => {
    if (!isTauri() || !bootReady || !overlayEnabled) return;
    if (getCurrentWindow().label !== "main") return;
    if (hotkeyBackend !== "plugin") return;

    const toggle = normalizeOverlayHotkey(overlayHotkey);
    const focus = normalizeOverlayFocusHotkey(overlayFocusHotkey);

    if (!osuRunning) {
      void unregister(focus).catch(() => {});
      return;
    }

    if (focus === toggle) {
      console.warn(
        "[osu-link] Overlay focus hotkey matches the toggle shortcut; set a different combination for Focus overlay.",
      );
      return;
    }

    void register(focus, (event) => {
      if (event.state !== "Pressed") return;
      void invoke("overlay_focus");
    }).catch((err) => {
      console.warn("[osu-link] Overlay focus hotkey could not be registered:", focus, err);
    });

    return () => {
      void unregister(focus).catch(() => {});
    };
  }, [bootReady, overlayEnabled, hotkeyBackend, overlayHotkey, overlayFocusHotkey, osuRunning]);
}

import { isTauri } from "@tauri-apps/api/core";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { useEffect, type MutableRefObject } from "react";

/**
 * Registers Tauri global shortcuts from settings. Uses refs for actions so shortcut
 * registration is not re-run every React render.
 */
export function useGlobalHotkeys(opts: {
  bootReady: boolean;
  onboardingCompleted: boolean;
  focusShortcut: string;
  randomCurateShortcut: string;
  onFocusSearchRef: MutableRefObject<() => void>;
  onRandomCurateRef: MutableRefObject<() => void>;
  onDuplicateShortcuts: () => void;
  onRegisterError: (message: string) => void;
}): void {
  const {
    bootReady,
    onboardingCompleted,
    focusShortcut,
    randomCurateShortcut,
    onFocusSearchRef,
    onRandomCurateRef,
    onDuplicateShortcuts,
    onRegisterError,
  } = opts;

  useEffect(() => {
    if (!isTauri() || !bootReady || !onboardingCompleted) return;

    let cancelled = false;

    void (async () => {
      try {
        await unregisterAll();
      } catch {
        /* ignore */
      }
      if (cancelled) return;

      const f = focusShortcut.trim();
      const r = randomCurateShortcut.trim();

      try {
        if (r && f && r === f) {
          onDuplicateShortcuts();
          await register(f, (event) => {
            if (event.state !== "Pressed") return;
            onFocusSearchRef.current();
          });
        } else {
          if (f) {
            await register(f, (event) => {
              if (event.state !== "Pressed") return;
              onFocusSearchRef.current();
            });
          }
          if (cancelled) return;
          if (r) {
            await register(r, (event) => {
              if (event.state !== "Pressed") return;
              onRandomCurateRef.current();
            });
          }
        }
      } catch (e) {
        onRegisterError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      void (async () => {
        try {
          await unregisterAll();
        } catch {
          /* ignore */
        }
      })();
    };
  }, [
    bootReady,
    onboardingCompleted,
    focusShortcut,
    randomCurateShortcut,
    onFocusSearchRef,
    onRandomCurateRef,
    onDuplicateShortcuts,
    onRegisterError,
  ]);
}

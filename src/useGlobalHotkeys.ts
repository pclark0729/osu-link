import { isTauri } from "@tauri-apps/api/core";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { useEffect, type MutableRefObject } from "react";

type ShortcutSlot = {
  key: string;
  label: string;
  ref: MutableRefObject<() => void>;
};

/**
 * Registers Tauri global shortcuts from settings. Uses refs for actions so shortcut
 * registration is not re-run every React render.
 */
export function useGlobalHotkeys(opts: {
  bootReady: boolean;
  onboardingCompleted: boolean;
  focusShortcut: string;
  randomCurateShortcut: string;
  trainOpenShortcut: string;
  trainRandomizeShortcut: string;
  trainEndShortcut: string;
  onFocusSearchRef: MutableRefObject<() => void>;
  onRandomCurateRef: MutableRefObject<() => void>;
  onTrainOpenRef: MutableRefObject<() => void>;
  onTrainRandomizeRef: MutableRefObject<() => void>;
  onTrainEndRef: MutableRefObject<() => void>;
  onDuplicateShortcuts: () => void;
  onRegisterError: (message: string) => void;
}): void {
  const {
    bootReady,
    onboardingCompleted,
    focusShortcut,
    randomCurateShortcut,
    trainOpenShortcut,
    trainRandomizeShortcut,
    trainEndShortcut,
    onFocusSearchRef,
    onRandomCurateRef,
    onTrainOpenRef,
    onTrainRandomizeRef,
    onTrainEndRef,
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

      const slots: ShortcutSlot[] = [
        { key: focusShortcut.trim(), label: "focus search", ref: onFocusSearchRef },
        { key: randomCurateShortcut.trim(), label: "random curate", ref: onRandomCurateRef },
        { key: trainOpenShortcut.trim(), label: "train open map", ref: onTrainOpenRef },
        { key: trainRandomizeShortcut.trim(), label: "train randomize", ref: onTrainRandomizeRef },
        { key: trainEndShortcut.trim(), label: "train end session", ref: onTrainEndRef },
      ].filter((s) => s.key.length > 0);

      const seenKeys = new Set<string>();
      let duplicate = false;
      for (const s of slots) {
        if (seenKeys.has(s.key)) duplicate = true;
        else seenKeys.add(s.key);
      }
      if (duplicate) onDuplicateShortcuts();

      try {
        const registered = new Set<string>();
        for (const s of slots) {
          if (registered.has(s.key)) continue;
          registered.add(s.key);
          await register(s.key, (event) => {
            if (event.state !== "Pressed") return;
            s.ref.current();
          });
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
    trainOpenShortcut,
    trainRandomizeShortcut,
    trainEndShortcut,
    onFocusSearchRef,
    onRandomCurateRef,
    onTrainOpenRef,
    onTrainRandomizeRef,
    onTrainEndRef,
    onDuplicateShortcuts,
    onRegisterError,
  ]);
}
